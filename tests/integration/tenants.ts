import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  organizationSchema,
  workspaceSchema,
  organizationListSchema,
  workspaceListSchema,
  apiErrorSchema,
} from '../../packages/contracts/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { createLogger } from '../../apps/api/src/infrastructure/logger.js';
import { MongoAuthRepository } from '../../apps/api/src/modules/auth/repository.js';
import { AuthService } from '../../apps/api/src/modules/auth/service.js';
import { hashPassword } from '../../apps/api/src/modules/auth/crypto.js';
import { MongoTenantRepository } from '../../apps/api/src/modules/tenants/repository.js';
import { TenantService } from '../../apps/api/src/modules/tenants/service.js';
import { AuthError } from '../../apps/api/src/modules/auth/errors.js';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const mongoose = requireApi('mongoose');
const { Types } = mongoose;
const request = requireApi('supertest');
const uri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
let target: URL;
try {
  target = new URL(uri);
} catch {
  throw new Error('Tenant checks require a valid loopback test database URL.');
}
assert(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
assert(
  /^\/orbit_test(?:_[a-z0-9]+)?$/.test(target.pathname),
  'An isolated test database is required.',
);
const connection = await mongoose
  .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
  .asPromise();
const authRepo = new MongoAuthRepository(connection, async () => true);
const tenants = new MongoTenantRepository(connection);
const origin = 'http://127.0.0.1:5174';
const auth = new AuthService(
  authRepo,
  { available: async () => {}, send: async () => {} },
  { APP_ORIGIN: origin, NODE_ENV: 'test', SESSION_IDLE_MINUTES: 1440, SESSION_ABSOLUTE_HOURS: 168 },
);
const app = createApp(
  { check: async () => ({ mongo: true, redis: false }), close: async () => {} },
  createLogger('silent'),
  auth,
  new TenantService(tenants),
);
const userIds = Array.from({ length: 4 }, () => new Types.ObjectId());
const run = randomUUID();
const password = `Tenant fixture ${run}`;
const results: string[] = [];
async function check(name: string, operation: () => Promise<void>) {
  await clearTestLoopbackLimits(connection.db);
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
const path = '/api/v1/organizations';
type Agent = ReturnType<typeof request.agent>;
async function login(index: number) {
  const agent = request.agent(app);
  const session = await agent.get('/api/v1/auth/session').expect(200);
  const response = await agent
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', session.body.data.csrfToken)
    .send({ email: `tenant-${run}-${index}@example.test`, password })
    .expect(200);
  return { agent, csrf: response.body.data.csrfToken };
}
const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;
let orgA!: string;
let orgB!: string;
let wsA!: string;
let wsB!: string;
try {
  await authRepo.ready();
  await tenants.ready();
  const passwordHash = await hashPassword(password);
  await authRepo.models.users.create(
    userIds.map((_id, index) => ({
      _id,
      email: `tenant-${run}-${index}@example.test`,
      name: 'Tenant verification user',
      passwordHash,
      emailVerified: index !== 2,
      onboardingCompleted: index !== 3,
    })),
  );
  // Respect the production password-hashing concurrency bound while arranging fixtures.
  const identities = [];
  for (let index = 0; index < userIds.length; index++) identities.push(await login(index));
  const [a, b, unverified, incomplete] = identities;
  const mutation = (
    identity: { agent: Agent; csrf: string },
    route: string,
    data: unknown,
    method: 'post' | 'patch' = 'post',
  ) =>
    identity.agent[method](route)
      .set('Origin', origin)
      .set('X-CSRF-Token', identity.csrf)
      .send(data);
  await check('anonymous and unverified/incomplete identities cannot open tenants', async () => {
    assert.equal(errorCode((await request(app).get(path).expect(401)).body), 'UNAUTHENTICATED');
    assert.equal(
      errorCode((await unverified!.agent.get(path).expect(403)).body),
      'EMAIL_NOT_VERIFIED',
    );
    assert.equal(
      errorCode((await incomplete!.agent.get(path).expect(403)).body),
      'ONBOARDING_REQUIRED',
    );
  });
  await check('tenant mutations enforce exact Origin and session CSRF', async () => {
    assert.equal(
      errorCode(
        (await a!.agent.post(path).send({ name: 'Studio', description: '' }).expect(403)).body,
      ),
      'ORIGIN_INVALID',
    );
    assert.equal(
      errorCode(
        (
          await a!.agent
            .post(path)
            .set('Origin', origin)
            .send({ name: 'Studio', description: '' })
            .expect(403)
        ).body,
      ),
      'CSRF_INVALID',
    );
  });
  await check(
    'strict validation rejects authority injection and malformed identifiers',
    async () => {
      await mutation(a!, path, {
        name: 'Studio',
        description: '',
        ownerId: userIds[1]!.toString(),
      }).expect(400);
      await a!.agent.get(`${path}/invalid`).expect(400);
      await a!.agent.get(`${path}?cursor[gt]=something`).expect(400);
    },
  );
  await check(
    'organization creation atomically persists owner membership and explicit DTO',
    async () => {
      const res = await mutation(a!, path, {
        name: `Studio A ${run}`,
        description: 'First organization',
      }).expect(201);
      const org = organizationSchema.parse(res.body.data);
      orgA = org.id;
      assert.equal(org.role, 'owner');
      assert.equal(org.version, 1);
      assert(!('ownerId' in res.body.data));
      assert.equal(res.body.meta.requestId, res.headers['x-request-id']);
      assert.equal(
        await tenants.models.organizationMemberships.countDocuments({
          organizationId: orgA,
          userId: userIds[0],
          role: 'owner',
        }),
        1,
      );
      assert.equal(
        workspaceListSchema.parse(
          (await a!.agent.get(`${path}/${orgA}/workspaces`).expect(200)).body.data,
        ).workspaces.length,
        0,
      );
      orgB = organizationSchema.parse(
        (await mutation(b!, path, { name: `Studio B ${run}`, description: '' }).expect(201)).body
          .data,
      ).id;
    },
  );
  await check('organization lists and direct reads isolate two real tenants', async () => {
    const list = organizationListSchema.parse((await a!.agent.get(path).expect(200)).body.data);
    assert.deepEqual(
      list.organizations.map((o) => o.id),
      [orgA],
    );
    const foreign = await a!.agent.get(`${path}/${orgB}`).expect(404);
    const absent = await a!.agent.get(`${path}/${new Types.ObjectId()}`).expect(404);
    assert.deepEqual(foreign.body.error, absent.body.error);
    assert.equal(foreign.headers['cache-control'], 'no-store');
    await mutation(
      a!,
      `${path}/${orgB}`,
      { name: 'Stolen', description: '', version: 1 },
      'patch',
    ).expect(404);
    await a!.agent.get(`${path}/${orgB}/workspaces`).expect(404);
  });
  await check('workspace creation atomically grants its creator explicit access', async () => {
    wsA = workspaceSchema.parse(
      (
        await mutation(a!, `${path}/${orgA}/workspaces`, {
          name: 'Product studio',
          description: 'A private initiative',
          timezone: 'Asia/Calcutta',
        }).expect(201)
      ).body.data,
    ).id;
    wsB = workspaceSchema.parse(
      (
        await mutation(b!, `${path}/${orgB}/workspaces`, {
          name: 'Client work',
          description: '',
          timezone: 'UTC',
        }).expect(201)
      ).body.data,
    ).id;
    assert.equal(
      await tenants.models.workspaceMemberships.countDocuments({
        organizationId: orgA,
        workspaceId: wsA,
        userId: userIds[0],
      }),
      1,
    );
    await mutation(a!, `${path}/${orgA}/workspaces`, {
      name: 'Bad timezone',
      description: '',
      timezone: 'invalid',
    }).expect(400);
    await mutation(a!, `${path}/${orgA}/workspaces`, {
      name: 'Foreign fields',
      description: '',
      timezone: 'UTC',
      organizationId: orgB,
    }).expect(400);
  });
  await check(
    'foreign and mismatched workspace identifiers cannot be read or mutated',
    async () => {
      for (const route of [
        `${path}/${orgB}/workspaces/${wsB}`,
        `${path}/${orgA}/workspaces/${wsB}`,
        `${path}/${orgB}/workspaces/${wsA}`,
      ]) {
        await a!.agent.get(route).expect(404);
        await mutation(
          a!,
          route,
          { name: 'Stolen', description: '', timezone: 'UTC', version: 1 },
          'patch',
        ).expect(404);
      }
      await mutation(a!, `${path}/${orgB}/workspaces`, {
        name: 'Intrusion',
        description: '',
        timezone: 'UTC',
      }).expect(404);
    },
  );
  await check('organization membership and guest status never imply workspace access', async () => {
    await tenants.models.organizationMemberships.create({
      organizationId: orgA,
      userId: userIds[1],
      role: 'member',
    });
    await b!.agent.get(`${path}/${orgA}`).expect(200);
    assert.equal(
      workspaceListSchema.parse(
        (await b!.agent.get(`${path}/${orgA}/workspaces`).expect(200)).body.data,
      ).workspaces.length,
      0,
    );
    await b!.agent.get(`${path}/${orgA}/workspaces/${wsA}`).expect(404);
    await tenants.models.organizationMemberships.updateOne(
      { organizationId: orgA, userId: userIds[1] },
      { $set: { role: 'guest' } },
    );
    await b!.agent.get(`${path}/${orgA}/workspaces/${wsA}`).expect(404);
  });
  await check('members and guests with explicit workspace access remain read-only', async () => {
    await tenants.models.workspaceMemberships.create({
      organizationId: orgA,
      workspaceId: wsA,
      userId: userIds[1],
    });
    for (const role of ['member', 'guest']) {
      await tenants.models.organizationMemberships.updateOne(
        { organizationId: orgA, userId: userIds[1] },
        { $set: { role } },
      );
      assert.equal(
        workspaceSchema.parse(
          (await b!.agent.get(`${path}/${orgA}/workspaces/${wsA}`).expect(200)).body.data,
        ).canManage,
        false,
      );
      await mutation(
        b!,
        `${path}/${orgA}`,
        { name: 'Denied', description: '', version: 1 },
        'patch',
      ).expect(403);
      await mutation(
        b!,
        `${path}/${orgA}/workspaces/${wsA}`,
        { name: 'Denied', description: '', timezone: 'UTC', version: 1 },
        'patch',
      ).expect(403);
      await mutation(b!, `${path}/${orgA}/workspaces`, {
        name: 'Denied',
        description: '',
        timezone: 'UTC',
      }).expect(403);
    }
  });
  await check(
    'admin organization rights coexist with explicit workspace requirements',
    async () => {
      await tenants.models.organizationMemberships.updateOne(
        { organizationId: orgA, userId: userIds[1] },
        { $set: { role: 'admin' } },
      );
      await mutation(
        b!,
        `${path}/${orgA}`,
        { name: 'Renamed studio', description: 'Admin update', version: 1 },
        'patch',
      ).expect(200);
      await mutation(
        b!,
        `${path}/${orgA}/workspaces/${wsA}`,
        { name: 'Product studio', description: 'Admin update', timezone: 'UTC', version: 1 },
        'patch',
      ).expect(200);
      await tenants.models.workspaceMemberships.deleteOne({
        organizationId: orgA,
        workspaceId: wsA,
        userId: userIds[1],
      });
      await b!.agent.get(`${path}/${orgA}/workspaces/${wsA}`).expect(404);
      await mutation(
        b!,
        `${path}/${orgA}/workspaces/${wsA}`,
        { name: 'Denied', description: '', timezone: 'UTC', version: 2 },
        'patch',
      ).expect(404);
    },
  );
  await check('even an owner without explicit workspace membership is denied', async () => {
    await tenants.models.workspaceMemberships.deleteOne({
      organizationId: orgA,
      workspaceId: wsA,
      userId: userIds[0],
    });
    await a!.agent.get(`${path}/${orgA}/workspaces/${wsA}`).expect(404);
    await tenants.models.workspaceMemberships.create({
      organizationId: orgA,
      workspaceId: wsA,
      userId: userIds[0],
    });
  });
  await check('orphan workspace membership never bypasses organization membership', async () => {
    await tenants.models.workspaceMemberships.create({
      organizationId: orgB,
      workspaceId: wsB,
      userId: userIds[0],
    });
    await a!.agent.get(`${path}/${orgB}/workspaces/${wsB}`).expect(404);
  });
  await check(
    'concurrent settings updates accept one version and reject the stale writer',
    async () => {
      const version = workspaceSchema.parse(
        (await a!.agent.get(`${path}/${orgA}/workspaces/${wsA}`).expect(200)).body.data,
      ).version;
      const responses = await Promise.all(
        ['First', 'Second'].map((name) =>
          mutation(
            a!,
            `${path}/${orgA}/workspaces/${wsA}`,
            { name: `${name} edit`, description: '', timezone: 'UTC', version },
            'patch',
          ),
        ),
      );
      assert.deepEqual(responses.map((res) => res.status).sort(), [200, 409]);
      assert.equal(
        errorCode(responses.find((res) => res.status === 409)!.body),
        'VERSION_CONFLICT',
      );
      assert.equal((await tenants.models.workspaces.findById(wsA).lean())!.version, version + 1);
      await mutation(
        a!,
        `${path}/${orgA}`,
        { name: 'Stale edit', description: '', version: 1 },
        'patch',
      ).expect(409);
    },
  );
  await check('membership failure rolls organization and workspace creation back', async () => {
    const originalOrg = tenants.models.organizationMemberships.create;
    tenants.models.organizationMemberships.create = async () => {
      throw new Error('Controlled membership insert failure');
    };
    try {
      await assert.rejects(() =>
        tenants.createOrganization(userIds[0]!.toString(), {
          name: `Rollback org ${run}`,
          description: '',
        }),
      );
    } finally {
      tenants.models.organizationMemberships.create = originalOrg;
    }
    assert.equal(
      await tenants.models.organizations.countDocuments({ name: `Rollback org ${run}` }),
      0,
    );
    const originalWs = tenants.models.workspaceMemberships.create;
    tenants.models.workspaceMemberships.create = async () => {
      throw new Error('Controlled membership insert failure');
    };
    try {
      await assert.rejects(() =>
        tenants.createWorkspace(userIds[0]!.toString(), orgA, {
          name: `Rollback ws ${run}`,
          description: '',
          timezone: 'UTC',
        }),
      );
    } finally {
      tenants.models.workspaceMemberships.create = originalWs;
    }
    assert.equal(await tenants.models.workspaces.countDocuments({ name: `Rollback ws ${run}` }), 0);
  });
  await check('compound membership indexes reject duplicate grants', async () => {
    await assert.rejects(
      () =>
        tenants.models.organizationMemberships.create({
          organizationId: orgA,
          userId: userIds[0],
          role: 'owner',
        }),
      (error) => (error as { code?: number }).code === 11000,
    );
    await assert.rejects(
      () =>
        tenants.models.workspaceMemberships.create({
          organizationId: orgA,
          workspaceId: wsA,
          userId: userIds[0],
        }),
      (error) => (error as { code?: number }).code === 11000,
    );
  });
  await check('tenant lists paginate at 50 without leaking another organization', async () => {
    const ids = Array.from({ length: 51 }, () => new Types.ObjectId());
    await tenants.models.workspaces.create(
      ids.map((_id) => ({
        _id,
        organizationId: orgA,
        name: 'Pagination verification',
        description: '',
        timezone: 'UTC',
      })),
    );
    await tenants.models.workspaceMemberships.create(
      ids.map((workspaceId) => ({ organizationId: orgA, workspaceId, userId: userIds[0] })),
    );
    const first = workspaceListSchema.parse(
      (await a!.agent.get(`${path}/${orgA}/workspaces`).expect(200)).body.data,
    );
    assert.equal(first.workspaces.length, 50);
    assert(first.nextCursor);
    const second = workspaceListSchema.parse(
      (await a!.agent.get(`${path}/${orgA}/workspaces?cursor=${first.nextCursor}`).expect(200)).body
        .data,
    );
    assert.equal(second.workspaces.length, 2);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.workspaces, ...second.workspaces].map((ws) => ws.id)).size, 52);
    assert([...first.workspaces, ...second.workspaces].every((ws) => ws.organizationId === orgA));
  });
  await check('a fresh database connection reads saved settings and memberships', async () => {
    const fresh = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
      .asPromise();
    try {
      const copy = new MongoTenantRepository(fresh);
      const ws = await copy.getWorkspace(userIds[0]!.toString(), orgA, wsA);
      assert.equal(ws.version, 3);
      assert.equal(ws.canManage, true);
    } finally {
      await fresh.close();
    }
  });
  await check('organization pagination returns every authorized record once', async () => {
    const ids = Array.from({ length: 51 }, () => new Types.ObjectId());
    await tenants.models.organizations.create(
      ids.map((_id) => ({
        _id,
        ownerId: userIds[0],
        name: 'Organization pagination',
        description: '',
      })),
    );
    await tenants.models.organizationMemberships.create(
      ids.map((organizationId) => ({ organizationId, userId: userIds[0], role: 'owner' })),
    );
    const first = organizationListSchema.parse((await a!.agent.get(path).expect(200)).body.data);
    assert.equal(first.organizations.length, 50);
    assert(first.nextCursor);
    const second = organizationListSchema.parse(
      (await a!.agent.get(`${path}?cursor=${first.nextCursor}`).expect(200)).body.data,
    );
    assert.equal(second.organizations.length, 2);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.organizations, ...second.organizations].map((org) => org.id)).size,
      52,
    );
    assert(![...first.organizations, ...second.organizations].some((org) => org.id === orgB));
  });
  await check('membership write fence orders creation before concurrent revocation', async () => {
    const original = tenants.models.workspaces.create.bind(tenants.models.workspaces);
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const observed = new Promise<void>((done) => {
      reached = done;
    });
    let intercepted = false;
    const gate = async (...args: Parameters<typeof original>) => {
      if (!intercepted) {
        intercepted = true;
        reached();
        await held;
      }
      return original(...args);
    };
    tenants.models.workspaces.create = gate as typeof tenants.models.workspaces.create;
    let revoked = false;
    const creating = tenants.createWorkspace(userIds[0]!.toString(), orgA, {
      name: 'Fenced workspace',
      description: '',
      timezone: 'UTC',
    });
    const revoking = (async () => {
      await observed;
      await tenants.models.organizationMemberships.deleteOne({
        organizationId: orgA,
        userId: userIds[0],
      });
      revoked = true;
    })();
    try {
      await observed;
      await new Promise((done) => setTimeout(done, 100));
      assert.equal(revoked, false, 'Revocation must wait for the membership authority fence.');
    } finally {
      release();
      tenants.models.workspaces.create = original;
    }
    const created = await creating;
    await revoking;
    await a!.agent.get(`${path}/${orgA}/workspaces/${created.id}`).expect(404);
    await tenants.models.organizationMemberships.create({
      organizationId: orgA,
      userId: userIds[0],
      role: 'owner',
    });
  });
  await check('generic persistence failures are sanitized as 503 with request IDs', async () => {
    const original = tenants.getOrganization;
    tenants.getOrganization = async () => {
      throw new Error('mongodb://private:secret@example.test');
    };
    try {
      const res = await a!.agent.get(`${path}/${orgA}`).expect(503);
      assert.equal(errorCode(res.body), 'TENANT_UNAVAILABLE');
      assert(!JSON.stringify(res.body).includes('secret'));
      assert.equal(res.body.meta.requestId, res.headers['x-request-id']);
    } finally {
      tenants.getOrganization = original;
    }
  });
  await check('shared persistent mutation budget denies excessive writes', async () => {
    const original = authRepo.rateLimit;
    authRepo.rateLimit = async (scope, ...args) => {
      if (scope === 'tenant-mutations')
        throw new AuthError(429, 'RATE_LIMITED', 'Too many attempts.');
      return original.call(authRepo, scope, ...args);
    };
    try {
      await mutation(a!, path, { name: 'Rate limited', description: '' }).expect(429);
    } finally {
      authRepo.rateLimit = original;
    }
  });
  console.log(`${results.length} tenant integration checks passed.`);
} finally {
  const orgs = await tenants.models.organizations
    .find({ ownerId: { $in: userIds } })
    .select('_id')
    .lean();
  const ids = orgs.map((org) => org._id);
  await tenants.models.workspaceMemberships.deleteMany({
    $or: [{ organizationId: { $in: ids } }, { userId: { $in: userIds } }],
  });
  await tenants.models.workspaces.deleteMany({ organizationId: { $in: ids } });
  await tenants.models.organizationMemberships.deleteMany({
    $or: [{ organizationId: { $in: ids } }, { userId: { $in: userIds } }],
  });
  await tenants.models.organizations.deleteMany({ _id: { $in: ids }, ownerId: { $in: userIds } });
  await authRepo.models.sessions.deleteMany({ userId: { $in: userIds } });
  await authRepo.models.users.deleteMany({ _id: { $in: userIds } });
  await connection.close();
}
