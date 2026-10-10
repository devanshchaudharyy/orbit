import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  teamSchema,
  invitationsSchema,
  invitationSchema,
  apiErrorSchema,
} from '../../packages/contracts/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { createLogger } from '../../apps/api/src/infrastructure/logger.js';
import { MongoAuthRepository } from '../../apps/api/src/modules/auth/repository.js';
import { AuthService } from '../../apps/api/src/modules/auth/service.js';
import { hashPassword, digest } from '../../apps/api/src/modules/auth/crypto.js';
import { AuthError } from '../../apps/api/src/modules/auth/errors.js';
import { MongoTenantRepository } from '../../apps/api/src/modules/tenants/repository.js';
import { TenantService } from '../../apps/api/src/modules/tenants/service.js';
import { TeamRepository } from '../../apps/api/src/modules/teams/repository.js';
import { TeamService } from '../../apps/api/src/modules/teams/service.js';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const mongoose = apiRequire('mongoose');
const request = apiRequire('supertest');
const { Types } = mongoose;
const uri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
const target = new URL(uri);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
assert(/^\/orbit_test(?:_[a-z0-9]+)?$/.test(target.pathname), 'Use an isolated test database.');
const connection = await mongoose
  .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
  .asPromise();
const authRepo = new MongoAuthRepository(connection, async () => true);
const tenantRepo = new MongoTenantRepository(connection);
const tenants = new TenantService(tenantRepo);
const origin = 'http://127.0.0.1:5174';
const auth = new AuthService(
  authRepo,
  { available: async () => {}, send: async () => {} },
  { APP_ORIGIN: origin, NODE_ENV: 'test', SESSION_IDLE_MINUTES: 1440, SESSION_ABSOLUTE_HOURS: 168 },
);
const repository = new TeamRepository(tenantRepo);
const deliveries: { email: string; token: string }[] = [];
let mailFailed = false;
const teams = new TeamService(repository, {
  send: async (email, _org, token) => {
    if (mailFailed) throw new AuthError(503, 'EMAIL_UNAVAILABLE', 'Email delivery unavailable.');
    deliveries.push({ email, token });
  },
});
const app = createApp(
  { check: async () => ({ mongo: true, redis: false }), close: async () => {} },
  createLogger('silent'),
  auth,
  tenants,
  teams,
);
const run = randomUUID();
const password = `Team fixture ${run}`;
const users = Array.from({ length: 7 }, (_, i) => ({
  _id: new Types.ObjectId(),
  email: `team-${run}-${i}@example.test`,
  name: `Team person ${i}`,
}));
const ids = users.map((u) => u._id.toString());
const results: string[] = [];
const orgIds: string[] = [];
type Identity = { agent: ReturnType<typeof request.agent>; csrf: string };
async function login(index: number): Promise<Identity> {
  const agent = request.agent(app);
  const session = await agent.get('/api/v1/auth/session').expect(200);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', session.body.data.csrfToken)
    .send({ email: users[index]!.email, password })
    .expect(200);
  return { agent, csrf: res.body.data.csrfToken };
}
const path = '/api/v1/organizations';
const mutation = (
  actor: Identity,
  route: string,
  data: unknown = {},
  method: 'post' | 'patch' | 'delete' = 'post',
) =>
  actor.agent[method](path + route)
    .set('Origin', origin)
    .set('X-CSRF-Token', actor.csrf)
    .send(data);
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const tokenFor = (email: string) => deliveries.filter((d) => d.email === email).at(-1)!.token;
async function check(name: string, operation: () => Promise<void>) {
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function member(org: string, user: string) {
  const m = await tenantRepo.models.organizationMemberships
    .findOne({ organizationId: org, userId: user })
    .lean();
  assert(m);
  return m;
}
try {
  await authRepo.ready();
  await teams.ready();
  await clearTestLoopbackLimits(connection.db);
  const passwordHash = await hashPassword(password);
  await authRepo.models.users.create(
    users.map((u, i) => ({
      ...u,
      passwordHash,
      emailVerified: i !== 5,
      onboardingCompleted: i !== 6,
    })),
  );
  const identities: Identity[] = [];
  for (let i = 0; i < users.length; i++) identities.push(await login(i));
  const owner = identities[0]!;
  const recipient = identities[1]!;
  const admin = identities[2]!;
  const outsider = identities[3]!;
  const org = (await tenants.create(ids[0]!, { name: 'Team transaction fixture', description: '' }))
    .id;
  orgIds.push(org);
  const foreign = (await tenants.create(ids[3]!, { name: 'Foreign team fixture', description: '' }))
    .id;
  orgIds.push(foreign);
  const workspace = (
    await tenants.createWorkspace(ids[0]!, org, {
      name: 'Product studio',
      description: '',
      timezone: 'UTC',
    })
  ).id;
  const foreignWs = (
    await tenants.createWorkspace(ids[3]!, foreign, {
      name: 'Private studio',
      description: '',
      timezone: 'UTC',
    })
  ).id;
  await tenantRepo.models.organizationMemberships.create({
    organizationId: org,
    userId: ids[2],
    role: 'admin',
  });
  await check(
    'team reads are private, require verified setup, and keep consistent errors/request IDs',
    async () => {
      await request(app).get(`${path}/${org}/team`).expect(401);
      await outsider.agent.get(`${path}/${org}/team`).expect(404);
      for (const index of [5, 6])
        await identities[index]!.agent.get(`${path}/${org}/team`).expect(403);
      const res = await owner.agent.get(`${path}/${org}/team`).expect(200);
      teamSchema.parse(res.body.data);
      assert.equal(res.body.meta.requestId, res.headers['x-request-id']);
      assert.equal(res.headers['cache-control'], 'no-store');
    },
  );
  await check(
    'mutations enforce exact origin, CSRF, strict input and no owner invites',
    async () => {
      await owner.agent.post(`${path}/${org}/invitations`).send({}).expect(403);
      await owner.agent
        .post(`${path}/${org}/invitations`)
        .set('Origin', origin)
        .send({})
        .expect(403);
      for (const input of [
        { email: users[1]!.email, role: 'owner', workspaceIds: [] },
        { email: users[1]!.email, role: 'member', workspaceIds: [], inviterId: ids[3] },
        { email: users[1]!.email, role: 'guest', workspaceIds: [workspace, workspace] },
      ])
        await mutation(owner, `/${org}/invitations`, input).expect(400);
    },
  );
  await check(
    'foreign workspace grants and tenant invitations are denied before email delivery',
    async () => {
      await mutation(owner, `/${org}/invitations`, {
        email: users[1]!.email,
        role: 'member',
        workspaceIds: [foreignWs],
      }).expect(404);
      await mutation(outsider, `/${org}/invitations`, {
        email: users[1]!.email,
        role: 'member',
        workspaceIds: [],
      }).expect(404);
      assert.equal(deliveries.length, 0);
    },
  );
  let invitationId = '';
  await check('invitation stores only a hash, bounded expiry and explicit grants', async () => {
    const res = await mutation(owner, `/${org}/invitations`, {
      email: users[1]!.email.toUpperCase(),
      role: 'project-manager',
      workspaceIds: [workspace],
    }).expect(201);
    const invitation = invitationSchema.parse(res.body.data);
    invitationId = invitation.id;
    assert.equal(invitation.email, users[1]!.email);
    assert(!('token' in res.body.data));
    assert(!('tokenHash' in res.body.data));
    const stored = await repository.invitations.findById(invitationId).lean();
    assert(stored);
    assert.equal(stored.tokenHash, digest(tokenFor(invitation.email)));
    assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 7 * 86400000);
    assert.equal(
      await tenantRepo.models.organizationMemberships.countDocuments({
        organizationId: org,
        userId: ids[1],
      }),
      0,
    );
    await mutation(owner, `/${org}/invitations`, {
      email: users[1]!.email,
      role: 'member',
      workspaceIds: [],
    }).expect(409);
    assert.equal(deliveries.length, 1);
  });
  await check('wrong recipient, unverified and incomplete accounts cannot accept', async () => {
    const token = tokenFor(users[1]!.email);
    assert.equal(
      code((await mutation(outsider, '/invitations/accept', { token }).expect(403)).body),
      'INVITATION_EMAIL_MISMATCH',
    );
    for (const index of [5, 6])
      await mutation(identities[index]!, '/invitations/accept', { token }).expect(403);
    await request(app).get(`${path}/invitations/accept`).expect(404); // GET cannot consume a link.
    assert.equal((await repository.invitations.findById(invitationId).lean())!.status, 'pending');
  });
  await check('concurrent acceptance commits one membership and rejects token replay', async () => {
    const responses = await Promise.all([
      mutation(recipient, '/invitations/accept', { token: tokenFor(users[1]!.email) }),
      mutation(recipient, '/invitations/accept', { token: tokenFor(users[1]!.email) }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 410]);
    const m = await member(org, ids[1]!);
    assert.equal(m.role, 'project-manager');
    await recipient.agent.get(`${path}/${org}/workspaces/${workspace}`).expect(200);
    await recipient.agent.get(`${path}/${foreign}/workspaces/${foreignWs}`).expect(404);
    await mutation(recipient, '/invitations/accept', { token: tokenFor(users[1]!.email) }).expect(
      410,
    );
    assert.equal(
      await tenantRepo.models.organizationMemberships.countDocuments({
        organizationId: org,
        userId: ids[1],
      }),
      1,
    );
  });
  await check(
    'project managers cannot manage rosters or settings; admins have no implicit workspace access',
    async () => {
      await recipient.agent.get(`${path}/${org}/team`).expect(403);
      await recipient.agent.get(`${path}/${org}/invitations`).expect(403);
      await mutation(
        recipient,
        `/${org}`,
        { name: 'Unauthorized', description: '', version: 1 },
        'patch',
      ).expect(403);
      await admin.agent.get(`${path}/${org}/team`).expect(200);
      await admin.agent.get(`${path}/${org}/workspaces/${workspace}`).expect(404);
    },
  );
  await check(
    'admins cannot assign admin, edit/remove owners/admins, or transfer ownership',
    async () => {
      const own = await member(org, ids[0]!);
      const a = await member(org, ids[2]!);
      const r = await member(org, ids[1]!);
      await mutation(admin, `/${org}/invitations`, {
        email: users[4]!.email,
        role: 'admin',
        workspaceIds: [],
      }).expect(403);
      for (const m of [own, a]) {
        await mutation(
          admin,
          `/${org}/members/${m._id}`,
          { role: 'member', workspaceIds: [], version: 1 },
          'patch',
        ).expect(403);
        await mutation(admin, `/${org}/members/${m._id}`, { version: 1 }, 'delete').expect(403);
      }
      await mutation(
        admin,
        `/${org}/members/${r._id}`,
        { role: 'admin', workspaceIds: [], version: 1 },
        'patch',
      ).expect(403);
      await mutation(admin, `/${org}/ownership`, {
        memberId: r._id.toString(),
        version: 1,
        currentPassword: password,
      }).expect(403);
    },
  );
  await check('admins can edit lower roles and revoke explicit grants immediately', async () => {
    const r = await member(org, ids[1]!);
    await mutation(
      admin,
      `/${org}/members/${r._id}`,
      { role: 'guest', workspaceIds: [], version: r.version },
      'patch',
    ).expect(200);
    await recipient.agent.get(`${path}/${org}/workspaces/${workspace}`).expect(404);
    assert.equal((await member(org, ids[1]!)).role, 'guest');
  });
  await check('two stale membership writers yield one commit and a version conflict', async () => {
    const r = await member(org, ids[1]!);
    const data = { role: 'member', workspaceIds: [workspace], version: r.version };
    const responses = await Promise.all([
      mutation(owner, `/${org}/members/${r._id}`, data, 'patch'),
      mutation(admin, `/${org}/members/${r._id}`, data, 'patch'),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await member(org, ids[1]!)).version, r.version + 1);
  });
  await check(
    'owner may edit their workspace grants but cannot demote themselves or forge owner',
    async () => {
      const o = await member(org, ids[0]!);
      const r = await member(org, ids[1]!);
      await mutation(
        owner,
        `/${org}/members/${o._id}`,
        { role: 'owner', workspaceIds: [workspace], version: o.version },
        'patch',
      ).expect(200);
      await mutation(
        owner,
        `/${org}/members/${o._id}`,
        { role: 'admin', workspaceIds: [], version: o.version + 1 },
        'patch',
      ).expect(403);
      await mutation(
        owner,
        `/${org}/members/${r._id}`,
        { role: 'owner', workspaceIds: [], version: r.version },
        'patch',
      ).expect(403);
    },
  );
  await check('SMTP failure rolls back a pending invitation', async () => {
    mailFailed = true;
    try {
      await mutation(owner, `/${org}/invitations`, {
        email: users[4]!.email,
        role: 'member',
        workspaceIds: [],
      }).expect(503);
    } finally {
      mailFailed = false;
    }
    assert.equal(
      await repository.invitations.countDocuments({ organizationId: org, email: users[4]!.email }),
      0,
    );
  });
  await check(
    'automatic transaction retry reuses the token and sends email at most once',
    async () => {
      const original = repository.invite;
      let retried = false;
      repository.invite = (actor, organization, input, hash, deliver) =>
        original.call(repository, actor, organization, input, hash, async (name) => {
          await deliver(name);
          if (!retried) {
            retried = true;
            const error = new mongoose.mongo.MongoServerError({
              message: 'Controlled transient transaction failure',
            });
            error.addErrorLabel('TransientTransactionError');
            throw error;
          }
        });
      const before = deliveries.length;
      try {
        const invitation = await teams.invite(ids[0]!, org, {
          email: users[4]!.email,
          role: 'guest',
          workspaceIds: [],
        });
        assert(retried);
        assert.equal(deliveries.length, before + 1);
        assert.equal(
          (await repository.invitations.findById(invitation.id).lean())!.tokenHash,
          digest(tokenFor(users[4]!.email)),
        );
        await teams.revoke(ids[0]!, org, invitation.id);
      } finally {
        repository.invite = original;
      }
    },
  );
  await check('revoked and expired links cannot create membership', async () => {
    let i = await teams.invite(ids[0]!, org, {
      email: users[4]!.email,
      role: 'guest',
      workspaceIds: [],
    });
    await mutation(owner, `/${org}/invitations/${i.id}`, {}, 'delete').expect(200);
    await mutation(identities[4]!, '/invitations/accept', {
      token: tokenFor(users[4]!.email),
    }).expect(410);
    i = await teams.invite(ids[0]!, org, {
      email: users[4]!.email,
      role: 'guest',
      workspaceIds: [],
    });
    await repository.invitations.updateOne(
      { _id: i.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await mutation(identities[4]!, '/invitations/accept', {
      token: tokenFor(users[4]!.email),
    }).expect(410);
    const list = invitationsSchema.parse(
      (await owner.agent.get(`${path}/${org}/invitations`).expect(200)).body.data,
    );
    assert(!list.invitations.some((inv) => inv.id === i.id));
  });
  await check('role demotion revokes links issued under previous authority', async () => {
    const i = await teams.invite(ids[2]!, org, {
      email: users[4]!.email,
      role: 'member',
      workspaceIds: [],
    });
    const a = await member(org, ids[2]!);
    await mutation(
      owner,
      `/${org}/members/${a._id}`,
      { role: 'member', workspaceIds: [], version: a.version },
      'patch',
    ).expect(200);
    await mutation(identities[4]!, '/invitations/accept', {
      token: tokenFor(users[4]!.email),
    }).expect(410);
    assert.equal((await repository.invitations.findById(i.id).lean())!.status, 'revoked');
  });
  await check(
    'controlled grant failure rolls back acceptance and preserves a usable pending link',
    async () => {
      await teams.invite(ids[0]!, org, {
        email: users[4]!.email,
        role: 'guest',
        workspaceIds: [workspace],
      });
      const original = tenantRepo.models.workspaceMemberships.create;
      tenantRepo.models.workspaceMemberships.create = (() => {
        throw new Error('Controlled private database failure');
      }) as typeof original;
      try {
        const res = await mutation(identities[4]!, '/invitations/accept', {
          token: tokenFor(users[4]!.email),
        }).expect(503);
        assert.equal(code(res.body), 'TEAM_UNAVAILABLE');
        assert(!JSON.stringify(res.body).includes('Controlled'));
      } finally {
        tenantRepo.models.workspaceMemberships.create = original;
      }
      assert.equal(
        await tenantRepo.models.organizationMemberships.countDocuments({
          organizationId: org,
          userId: ids[4],
        }),
        0,
      );
      await mutation(identities[4]!, '/invitations/accept', {
        token: tokenFor(users[4]!.email),
      }).expect(200);
    },
  );
  await check('member removal deletes all grants and leaves the account intact', async () => {
    const r = await member(org, ids[4]!);
    await mutation(owner, `/${org}/members/${r._id}`, { version: r.version }, 'delete').expect(200);
    await identities[4]!.agent.get(`${path}/${org}`).expect(404);
    assert.equal(
      await tenantRepo.models.workspaceMemberships.countDocuments({
        organizationId: org,
        userId: ids[4],
      }),
      0,
    );
    assert(await authRepo.models.users.exists({ _id: ids[4] }));
  });
  await check(
    'ownership transfer rejects incorrect password, stale recipient, and leaving owner',
    async () => {
      const r = await member(org, ids[1]!);
      await mutation(owner, `/${org}/leave`).expect(409);
      await mutation(owner, `/${org}/ownership`, {
        memberId: r._id.toString(),
        version: r.version,
        currentPassword: 'incorrect password',
      }).expect(400);
      await mutation(owner, `/${org}/ownership`, {
        memberId: r._id.toString(),
        version: 999,
        currentPassword: password,
      }).expect(409);
      assert.equal(
        await tenantRepo.models.organizationMemberships.countDocuments({
          organizationId: org,
          role: 'owner',
        }),
        1,
      );
    },
  );
  await check(
    'ownership changes atomically with one owner, old owner admin and retained grants',
    async () => {
      const r = await member(org, ids[1]!);
      const before = await tenantRepo.models.workspaceMemberships.countDocuments({
        organizationId: org,
      });
      await mutation(owner, `/${org}/ownership`, {
        memberId: r._id.toString(),
        version: r.version,
        currentPassword: password,
      }).expect(200);
      assert.equal(
        await tenantRepo.models.organizationMemberships.countDocuments({
          organizationId: org,
          role: 'owner',
        }),
        1,
      );
      assert.equal((await member(org, ids[1]!)).role, 'owner');
      assert.equal((await member(org, ids[0]!)).role, 'admin');
      assert.equal(
        (await tenantRepo.models.organizations.findById(org).lean())!.ownerId.toString(),
        ids[1],
      );
      assert.equal(
        await tenantRepo.models.workspaceMemberships.countDocuments({ organizationId: org }),
        before,
      );
    },
  );
  await check(
    'concurrent transfers retain exactly one owner and consistent owner pointer',
    async () => {
      const raceOrg = (
        await tenants.create(ids[1]!, { name: 'Ownership race fixture', description: '' })
      ).id;
      orgIds.push(raceOrg);
      await tenantRepo.models.organizationMemberships.create(
        [ids[2], ids[3]].map((userId) => ({ organizationId: raceOrg, userId, role: 'member' })),
      );
      const targets = [await member(raceOrg, ids[2]!), await member(raceOrg, ids[3]!)];
      const responses = await Promise.allSettled(
        targets.map((m) => teams.transfer(ids[1]!, raceOrg, m._id.toString(), m.version, password)),
      );
      assert.equal(responses.filter((r) => r.status === 'fulfilled').length, 1);
      const owners = await tenantRepo.models.organizationMemberships
        .find({ organizationId: raceOrg, role: 'owner' })
        .lean();
      assert.equal(owners.length, 1);
      assert.equal(
        (await tenantRepo.models.organizations.findById(raceOrg).lean())!.ownerId.toString(),
        owners[0]!.userId.toString(),
      );
      assert.equal((await member(raceOrg, ids[1]!)).role, 'admin');
    },
  );
  await check(
    'transfer database failure rolls back roles, owner pointer and credential fence',
    async () => {
      const r = await member(org, ids[2]!);
      const before = await authRepo.models.users.findById(ids[1]).lean();
      const original = tenantRepo.models.organizations.updateOne;
      tenantRepo.models.organizations.updateOne = function (...args: Parameters<typeof original>) {
        if (JSON.stringify(args[1]).includes('ownerId'))
          throw new Error('Controlled ownership write failure');
        return original.apply(this, args);
      } as typeof original;
      try {
        await assert.rejects(
          teams.transfer(ids[1]!, org, r._id.toString(), r.version, password),
          /Controlled ownership/,
        );
      } finally {
        tenantRepo.models.organizations.updateOne = original;
      }
      assert.equal((await member(org, ids[1]!)).role, 'owner');
      assert.equal((await member(org, ids[2]!)).role, r.role);
      assert.equal(
        (await tenantRepo.models.organizations.findById(org).lean())!.ownerId.toString(),
        ids[1],
      );
      assert.equal(
        (await authRepo.models.users.findById(ids[1]).lean())!.authRevision,
        before!.authRevision,
      );
    },
  );
  await check('revoke and accept race commits one consistent invitation outcome', async () => {
    const i = await teams.invite(ids[1]!, org, {
      email: users[4]!.email,
      role: 'member',
      workspaceIds: [workspace],
    });
    await Promise.allSettled([
      teams.revoke(ids[1]!, org, i.id),
      teams.accept(ids[4]!, tokenFor(users[4]!.email)),
    ]);
    const stored = await repository.invitations.findById(i.id).lean();
    assert(stored);
    assert(['revoked', 'accepted'].includes(stored.status));
    assert.equal(
      await tenantRepo.models.organizationMemberships.countDocuments({
        organizationId: org,
        userId: ids[4],
      }),
      stored.status === 'accepted' ? 1 : 0,
    );
    assert.equal(
      await tenantRepo.models.workspaceMemberships.countDocuments({
        organizationId: org,
        userId: ids[4],
      }),
      stored.status === 'accepted' ? 1 : 0,
    );
  });
  await check('non-owner leaves atomically and immediately loses tenant access', async () => {
    await mutation(owner, `/${org}/leave`).expect(200);
    await owner.agent.get(`${path}/${org}`).expect(404);
    assert.equal(
      await tenantRepo.models.workspaceMemberships.countDocuments({
        organizationId: org,
        userId: ids[0],
      }),
      0,
    );
  });
  await check('team pagination bounds members and administrative workspace metadata', async () => {
    const synthetic = Array.from({ length: 52 }, () => new Types.ObjectId());
    await tenantRepo.models.organizationMemberships.create(
      synthetic.map((userId) => ({ organizationId: org, userId, role: 'member' })),
    );
    await tenantRepo.models.workspaces.create(
      Array.from({ length: 52 }, (_, i) => ({
        organizationId: org,
        name: `Extra ${i}`,
        description: '',
        timezone: 'UTC',
      })),
    );
    const first = teamSchema.parse(
      (await recipient.agent.get(`${path}/${org}/team`).expect(200)).body.data,
    );
    assert.equal(first.members.length, 50);
    assert.equal(first.workspaces.length, 50);
    assert(first.nextCursor);
    assert(first.nextWorkspaceCursor);
    const second = teamSchema.parse(
      (
        await recipient.agent
          .get(
            `${path}/${org}/team?cursor=${first.nextCursor}&workspaceCursor=${first.nextWorkspaceCursor}`,
          )
          .expect(200)
      ).body.data,
    );
    assert(second.members.length < 50);
    assert(second.workspaces.length < 50);
    assert(!second.nextCursor);
    assert(!second.nextWorkspaceCursor);
    assert.equal(
      new Set([...first.members, ...second.members].map((m) => m.id)).size,
      first.members.length + second.members.length,
    );
  });
  await check('membership and invitation data survive a fresh database connection', async () => {
    const fresh = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
      .asPromise();
    try {
      assert.equal(
        (
          await fresh
            .collection('organization_memberships')
            .findOne({ organizationId: new Types.ObjectId(org), userId: users[1]!._id })
        ).role,
        'owner',
      );
      assert(
        await fresh
          .collection('team_invitations')
          .findOne({ _id: new Types.ObjectId(invitationId), status: 'accepted' }),
      );
    } finally {
      await fresh.close();
    }
  });
  console.log(
    `${results.length} team integration checks passed against real MongoDB transactions. Mail adapter is controlled here; browser tests exercise real SMTP.`,
  );
} finally {
  await repository.invitations.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.workspaceMemberships.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.organizationMemberships.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.workspaces.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.organizations.deleteMany({ _id: { $in: orgIds } });
  await authRepo.models.sessions.deleteMany({ userId: { $in: ids } });
  await authRepo.models.users.deleteMany({ _id: { $in: ids } });
  await clearTestLoopbackLimits(connection.db);
  await connection.close();
}
