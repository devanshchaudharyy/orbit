import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  projectSchema,
  taskSchema,
  conversationMessageSchema,
  conversationListSchema,
  notificationListSchema,
  apiErrorSchema,
  livePresenceSchema,
} from '../../packages/contracts/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { createLogger } from '../../apps/api/src/infrastructure/logger.js';
import { MongoAuthRepository } from '../../apps/api/src/modules/auth/repository.js';
import { AuthService } from '../../apps/api/src/modules/auth/service.js';
import { hashPassword } from '../../apps/api/src/modules/auth/crypto.js';
import { MongoTenantRepository } from '../../apps/api/src/modules/tenants/repository.js';
import { TenantService } from '../../apps/api/src/modules/tenants/service.js';
import { ProjectRepository } from '../../apps/api/src/modules/projects/repository.js';
import { ProjectService } from '../../apps/api/src/modules/projects/service.js';
import { CollaborationRepository } from '../../apps/api/src/modules/collaboration/repository.js';
import { CollaborationService } from '../../apps/api/src/modules/collaboration/service.js';
import { createRealtime } from '../../apps/api/src/modules/collaboration/realtime.js';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';
const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const mongoose = requireApi('mongoose'),
  request = requireApi('supertest'),
  { io } = requireWeb('socket.io-client');
const { Types } = mongoose;
const uri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(uri).hostname));
assert(/^\/orbit_test(?:_[a-z0-9]+)?$/.test(new URL(uri).pathname));
const connection = await mongoose
  .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
  .asPromise();
const authRepo = new MongoAuthRepository(connection, async () => true),
  tenantRepo = new MongoTenantRepository(connection),
  tenants = new TenantService(tenantRepo);
const projectsRepo = new ProjectRepository(tenantRepo),
  projects = new ProjectService(projectsRepo),
  repo = new CollaborationRepository(projectsRepo),
  collaboration = new CollaborationService(repo);
const origin = 'http://127.0.0.1:5174';
const auth = new AuthService(
  authRepo,
  { available: async () => {}, send: async () => {} },
  { APP_ORIGIN: origin, NODE_ENV: 'test', SESSION_IDLE_MINUTES: 1440, SESSION_ABSOLUTE_HOURS: 168 },
);
const logger = createLogger('silent');
const app = createApp(
  { check: async () => ({ mongo: true, redis: false }), close: async () => {} },
  logger,
  auth,
  tenants,
  undefined,
  projects,
  collaboration,
);
const server = createServer(app),
  live = createRealtime(server, auth, tenants, collaboration, logger);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const socketOrigin = `http://127.0.0.1:${address.port}`;
const run = randomUUID(),
  password = `Collaboration ${run}`;
const users = Array.from({ length: 7 }, (_, i) => ({
  _id: new Types.ObjectId(),
  email: `collab-${run}-${i}@example.test`,
  name: `Collaborator ${i}`,
}));
const ids = users.map((u) => String(u._id)),
  orgs: string[] = [],
  results: string[] = [],
  sockets: ReturnType<typeof io>[] = [];
type Identity = { agent: ReturnType<typeof request.agent>; csrf: string; cookie: string };
async function login(index: number): Promise<Identity> {
  const agent = request.agent(app);
  const session = await agent.get('/api/v1/auth/session').expect(200);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', session.body.data.csrfToken)
    .send({ email: users[index]!.email, password })
    .expect(200);
  return {
    agent,
    csrf: res.body.data.csrfToken,
    cookie: res.headers['set-cookie']
      .find((s: string) => s.startsWith('orbit_session='))
      .split(';')[0],
  };
}
const mutate = (
  actor: Identity,
  path: string,
  input: unknown = {},
  method: 'post' | 'patch' | 'delete' = 'post',
) => actor.agent[method](path).set('Origin', origin).set('X-CSRF-Token', actor.csrf).send(input);
async function check(name: string, operation: () => Promise<void>) {
  await clearTestLoopbackLimits(connection.db);
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function until(operation: () => boolean | Promise<boolean>, message: string) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await operation()) return;
    await delay(50);
  }
  throw new Error(message);
}
async function socket(actor: Identity, extra: Record<string, unknown> = {}) {
  const client = io(socketOrigin, {
    path: '/api/live',
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    timeout: 3000,
    auth: { csrfToken: actor.csrf },
    extraHeaders: { Origin: origin, Cookie: actor.cookie },
    ...extra,
  });
  sockets.push(client);
  return client;
}
async function connect(client: ReturnType<typeof io>) {
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
    client.connect();
  });
}
async function subscribe(client: ReturnType<typeof io>, scope: unknown) {
  return await new Promise<{
    data?: { available: boolean };
    error?: unknown;
    meta: { requestId: string };
  }>((resolve, reject) =>
    client
      .timeout(5000)
      .emit(
        'project:subscribe',
        scope,
        (
          err: Error | null,
          value: { data?: { available: boolean }; error?: unknown; meta: { requestId: string } },
        ) => (err ? reject(err) : resolve(value)),
      ),
  );
}
try {
  await authRepo.ready();
  await collaboration.ready();
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
  for (let i = 0; i < 7; i++) identities.push(await login(i));
  const owner = identities[0]!,
    member = identities[1]!,
    guest = identities[2]!,
    outsider = identities[3]!;
  const org = (await tenants.create(ids[0]!, { name: 'Collaboration fixture', description: '' }))
    .id;
  orgs.push(org);
  const ws = (
    await tenants.createWorkspace(ids[0]!, org, {
      name: 'Collaboration studio',
      description: '',
      timezone: 'UTC',
    })
  ).id;
  const scope = { organizationId: org, workspaceId: ws };
  await tenantRepo.models.organizationMemberships.create(
    [1, 2, 4].map((i) => ({
      organizationId: org,
      userId: ids[i],
      role: i === 2 ? 'guest' : 'member',
    })),
  );
  await tenantRepo.models.workspaceMemberships.create(
    [1, 2, 4].map((i) => ({ ...scope, userId: ids[i] })),
  );
  const base = `/api/v1/organizations/${org}/workspaces/${ws}/projects`;
  const projectInput = {
    name: 'Shared project',
    description: '',
    status: 'active',
    priority: 'high',
    cover: 'aurora',
    ownerId: ids[0],
    memberIds: [ids[1], ids[2]],
    template: 'blank',
  };
  const project = projectSchema.parse(
    (await mutate(owner, base, projectInput).expect(201)).body.data,
  );
  const foreign = projectSchema.parse(
    (
      await mutate(owner, base, { ...projectInput, name: 'Other project', memberIds: [] }).expect(
        201,
      )
    ).body.data,
  );
  const liveScope = { ...scope, projectId: project.id },
    path = `${base}/${project.id}`,
    endpoint = `${path}/collaboration`;
  const taskInput = {
    title: 'Review collaboration',
    description: '',
    status: 'todo',
    priority: 'high',
    dueDate: null,
    ownerId: ids[1],
    assigneeIds: [ids[0], ids[1]],
    labelIds: [],
    checklist: [],
    parentId: null,
  };
  const task = taskSchema.parse(
    (await mutate(member, `${path}/tasks`, taskInput).expect(201)).body.data,
  );
  const message = (body = 'Decision recorded', mentionIds: string[] = [ids[1]!]) => ({
    body,
    mentionIds,
    clientId: randomUUID(),
  });
  const list = async (actor = owner, query = '') =>
    conversationListSchema.parse(
      (await actor.agent.get(`${endpoint}/messages${query}`).expect(200)).body.data,
    );
  const inbox = async (actor = member) =>
    notificationListSchema.parse(
      (await actor.agent.get(`${endpoint}/notifications`).expect(200)).body.data,
    );
  let firstId = '',
    taskMessageId = '';
  await check('empty conversations are private, bounded and use consistent envelopes', async () => {
    const r = await owner.agent.get(`${endpoint}/messages`).expect(200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.body.meta.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(conversationListSchema.parse(r.body.data).messages.length, 0);
  });
  await check(
    'anonymous, unverified, incomplete and foreign users cannot read collaboration',
    async () => {
      await request(app).get(`${endpoint}/messages`).expect(401);
      for (const i of [5, 6]) await identities[i]!.agent.get(`${endpoint}/messages`).expect(403);
      for (const actor of [outsider, identities[4]!]) {
        await actor.agent.get(`${endpoint}/messages`).expect(404);
        await actor.agent.get(`${endpoint}/notifications`).expect(404);
      }
    },
  );
  await check(
    'CSRF, Origin, canonical parents and strict request fields are enforced',
    async () => {
      await owner.agent.post(`${endpoint}/messages`).send(message()).expect(403);
      await owner.agent
        .post(`${endpoint}/messages`)
        .set('Origin', 'https://foreign.example')
        .set('X-CSRF-Token', owner.csrf)
        .send(message())
        .expect(403);
      await mutate(owner, `${endpoint}/messages`, { ...message(), userId: ids[3] }).expect(400);
      await mutate(owner, `${endpoint}/messages`, message('   ')).expect(400);
      await owner.agent.get(`${endpoint}/messages?room=arbitrary`).expect(400);
      await owner.agent.get(`${endpoint}/messages?taskId=${new Types.ObjectId()}`).expect(404);
    },
  );
  await check(
    'guests read threads but cannot post, edit, delete or enumerate mention choices',
    async () => {
      await guest.agent.get(`${endpoint}/messages`).expect(200);
      await guest.agent.get(`${endpoint}/people`).expect(403);
      await mutate(guest, `${endpoint}/messages`, message()).expect(403);
    },
  );
  await check(
    'discussion mentions persist atomically with private notifications and activity',
    async () => {
      const res = await mutate(owner, `${endpoint}/messages`, message()).expect(201);
      const row = conversationMessageSchema.parse(res.body.data);
      firstId = row.id;
      assert.equal(row.version, 1);
      assert.equal(row.mentions[0]!.name, users[1]!.name);
      assert.equal((await inbox()).unread, 1);
      assert.equal((await inbox(owner)).unread, 0);
      assert.equal((await inbox(guest)).unread, 0);
      assert.equal(
        await projectsRepo.models.events.countDocuments({
          projectId: project.id,
          action: 'posted message',
        }),
        1,
      );
    },
  );
  await check(
    'task comments notify current owner and assignees once, excluding the author',
    async () => {
      const row = conversationMessageSchema.parse(
        (
          await mutate(
            owner,
            `${endpoint}/messages?taskId=${task.id}`,
            message('Task decision', [ids[0]!, ids[1]!]),
          ).expect(201)
        ).body.data,
      );
      taskMessageId = row.id;
      assert.equal((await inbox()).unread, 2);
      assert.equal((await inbox(owner)).unread, 0);
      assert.equal(await repo.models.notifications.countDocuments({ messageId: row.id }), 1);
      assert.equal((await list(owner, `?taskId=${task.id}`)).messages[0]!.id, row.id);
      assert.equal((await list()).messages.length, 1);
    },
  );
  await check('retry identifiers deduplicate notifications, history and messages', async () => {
    const input = message('Idempotent');
    const a = await mutate(owner, `${endpoint}/messages`, input).expect(201);
    const before = await repo.models.notifications.countDocuments({ projectId: project.id });
    const b = await mutate(owner, `${endpoint}/messages`, input).expect(201);
    assert.equal(a.body.data.id, b.body.data.id);
    assert.equal(await repo.models.notifications.countDocuments({ projectId: project.id }), before);
    const conflict = await mutate(owner, `${endpoint}/messages?taskId=${task.id}`, input).expect(
      409,
    );
    assert.equal(apiErrorSchema.parse(conflict.body).error.code, 'IDEMPOTENCY_CONFLICT');
    await mutate(owner, `${endpoint}/messages`, { ...input, body: 'Changed retry' }).expect(409);
  });
  await check('foreign, revoked and duplicate mention identities cannot be injected', async () => {
    for (const mentionIds of [[ids[3]!], [ids[4]!], [ids[1]!, ids[1]!]])
      await mutate(owner, `${endpoint}/messages`, message('Invalid mentions', mentionIds)).expect(
        mentionIds.length === 2 ? 400 : 422,
      );
    const choices = await owner.agent.get(`${endpoint}/people`).expect(200);
    assert(!choices.body.data.people.some((p: { id: string }) => p.id === ids[4]));
    assert(!('email' in choices.body.data.people[0]));
  });
  await check('message edits preserve authorship and reject stale or foreign writes', async () => {
    await mutate(
      member,
      `${endpoint}/messages/${firstId}`,
      { body: 'Foreign edit', mentionIds: [], version: 1 },
      'patch',
    ).expect(403);
    const row = conversationMessageSchema.parse(
      (
        await mutate(
          owner,
          `${endpoint}/messages/${firstId}`,
          { body: 'Revised decision', mentionIds: [ids[1]], version: 1 },
          'patch',
        ).expect(200)
      ).body.data,
    );
    assert.equal(row.version, 2);
    assert(row.edited);
    await mutate(
      owner,
      `${endpoint}/messages/${firstId}`,
      { body: 'Stale', mentionIds: [], version: 1 },
      'patch',
    ).expect(409);
    await mutate(
      guest,
      `${endpoint}/messages/${firstId}`,
      { body: 'Guest', mentionIds: [], version: 2 },
      'patch',
    ).expect(403);
  });
  await check(
    'private read flags are idempotent and cannot mutate another user inbox',
    async () => {
      const row = (await inbox()).notifications.find((n) => n.messageId === firstId)!;
      await mutate(owner, `${endpoint}/notifications/${row.id}`, { read: true }, 'patch').expect(
        404,
      );
      await mutate(member, `${endpoint}/notifications/${row.id}`, { read: true }, 'patch').expect(
        200,
      );
      const first = (await inbox()).notifications.find((n) => n.id === row.id)!.readAt;
      await mutate(member, `${endpoint}/notifications/${row.id}`, { read: true }, 'patch').expect(
        200,
      );
      assert.equal((await inbox()).notifications.find((n) => n.id === row.id)!.readAt, first);
      await mutate(member, `${endpoint}/notifications/${row.id}`, { read: false }, 'patch').expect(
        200,
      );
      assert.equal((await inbox()).notifications.find((n) => n.id === row.id)!.readAt, null);
    },
  );
  await check(
    'failed activity commits roll back message and recipient notification writes',
    async () => {
      const event = projectsRepo.event;
      const before = await repo.models.messages.countDocuments({ projectId: project.id });
      const notifications = await repo.models.notifications.countDocuments({
        projectId: project.id,
      });
      projectsRepo.event = async () => {
        throw new Error('Injected transaction failure');
      };
      try {
        await mutate(owner, `${endpoint}/messages`, message('Rollback')).expect(503);
      } finally {
        projectsRepo.event = event;
      }
      assert.equal(await repo.models.messages.countDocuments({ projectId: project.id }), before);
      assert.equal(
        await repo.models.notifications.countDocuments({ projectId: project.id }),
        notifications,
      );
    },
  );
  await check(
    'scoped cursors and direct message anchors cross bounded pages without truncation',
    async () => {
      const rows = await repo.models.messages.insertMany(
        Array.from({ length: 55 }, (_, i) => ({
          ...liveScope,
          taskId: null,
          authorId: ids[0],
          body: `Page ${i}`,
          mentionIds: [],
          clientId: randomUUID(),
          inputHash: 'fixture',
          version: 1,
          deletedAt: null,
          edited: false,
        })),
      );
      const first = await list();
      assert.equal(first.messages.length, 50);
      assert(first.nextCursor);
      const next = await list(owner, `?cursor=${first.nextCursor}`);
      assert(next.messages.length > 0);
      assert.equal(new Set([...first.messages, ...next.messages].map((r) => r.id)).size, 57);
      const anchor = String(rows.at(-1)!._id);
      assert.equal((await list(owner, `?anchor=${anchor}`)).messages[0]!.id, anchor);
      await owner.agent.get(`${endpoint}/messages?anchor=${taskMessageId}`).expect(404);
      await owner.agent.get(`${endpoint}/messages?cursor=${new Types.ObjectId()}`).expect(409);
    },
  );
  await check('current persistence can be read from a new database connection', async () => {
    const fresh = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
      .asPromise();
    try {
      assert.equal(
        (
          await fresh
            .collection('collaboration_messages')
            .findOne({ _id: new Types.ObjectId(firstId) })
        ).body,
        'Revised decision',
      );
      assert(
        await fresh
          .collection('collaboration_notifications')
          .findOne({ messageId: new Types.ObjectId(firstId), userId: users[1]!._id }),
      );
    } finally {
      await fresh.close();
    }
  });
  await check(
    'tombstones clear content and remove deleted message notifications from active views',
    async () => {
      await mutate(member, `${endpoint}/messages/${firstId}`, { version: 2 }, 'delete').expect(403);
      await mutate(owner, `${endpoint}/messages/${firstId}`, { version: 1 }, 'delete').expect(409);
      await mutate(owner, `${endpoint}/messages/${firstId}`, { version: 2 }, 'delete').expect(200);
      const row = (await list()).messages.find((r) => r.id === firstId)!;
      assert(row.deleted);
      assert.equal(row.body, '');
      assert.deepEqual(row.mentions, []);
      assert(!(await inbox()).notifications.some((n) => n.messageId === firstId));
    },
  );
  await check('deleted tasks cannot expose retained conversations or notifications', async () => {
    await projectsRepo.models.tasks.updateOne(
      { _id: task.id },
      { $set: { deletedAt: new Date() } },
    );
    await owner.agent.get(`${endpoint}/messages?taskId=${task.id}`).expect(404);
    assert(!(await inbox()).notifications.some((n) => n.messageId === taskMessageId));
    await projectsRepo.models.tasks.updateOne({ _id: task.id }, { $set: { deletedAt: null } });
  });
  await check(
    'archived projects retain read access and reject collaboration mutations',
    async () => {
      await projectsRepo.models.projects.updateOne(
        { _id: project.id },
        { $set: { archived: true } },
      );
      await list();
      await mutate(owner, `${endpoint}/messages`, message()).expect(409);
      await projectsRepo.models.projects.updateOne(
        { _id: project.id },
        { $set: { archived: false } },
      );
    },
  );
  await check(
    'simultaneous creates with one retry identity commit only one message and notification',
    async () => {
      const value = message('Concurrent retry');
      const responses = await Promise.all([
        mutate(owner, `${endpoint}/messages`, value).expect(201),
        mutate(owner, `${endpoint}/messages`, value).expect(201),
      ]);
      assert.equal(responses[0].body.data.id, responses[1].body.data.id);
      assert.equal(
        await repo.models.notifications.countDocuments({ messageId: responses[0].body.data.id }),
        1,
      );
    },
  );
  await check(
    'private inbox pagination retains its whole unread count and rejects foreign cursors',
    async () => {
      const rows = await repo.models.messages
        .find({ ...liveScope, inputHash: 'fixture' })
        .limit(51)
        .lean();
      await repo.models.notifications.insertMany(
        rows.map((row) => ({
          ...liveScope,
          messageId: row._id,
          userId: ids[1],
          kind: 'mention',
          readAt: null,
          createdAt: new Date(),
        })),
      );
      const first = await inbox();
      assert.equal(first.notifications.length, 50);
      assert(first.nextCursor);
      const second = notificationListSchema.parse(
        (await member.agent.get(`${endpoint}/notifications?cursor=${first.nextCursor}`).expect(200))
          .body.data,
      );
      assert.equal(second.unread, first.unread);
      assert.equal(
        new Set([...first.notifications, ...second.notifications].map((r) => r.id)).size,
        first.unread,
      );
      await owner.agent.get(`${endpoint}/notifications?cursor=${first.nextCursor}`).expect(409);
      await member.agent.get(`${endpoint}/notifications?userId=${ids[0]}`).expect(400);
    },
  );
  await check(
    'guest role changes remove implicit project-owner names and mention choices',
    async () => {
      const owned = projectSchema.parse(
        (
          await mutate(owner, base, {
            ...projectInput,
            name: 'Owner role fixture',
            ownerId: ids[4],
            memberIds: [],
          }).expect(201)
        ).body.data,
      );
      const endpoint = `${base}/${owned.id}/collaboration`;
      await mutate(
        identities[4]!,
        `${endpoint}/messages`,
        message('Owner-authored', [ids[4]!]),
      ).expect(201);
      await tenantRepo.models.organizationMemberships.updateOne(
        { organizationId: org, userId: ids[4] },
        { $set: { role: 'guest' } },
      );
      try {
        const row = conversationListSchema.parse(
          (await owner.agent.get(`${endpoint}/messages`).expect(200)).body.data,
        ).messages[0]!;
        assert.equal(row.authorName, 'Former collaborator');
        assert.equal(row.mentions[0]!.name, 'Former collaborator');
        const choices = await owner.agent.get(`${endpoint}/people`).expect(200);
        assert(!choices.body.data.people.some((person: { id: string }) => person.id === ids[4]));
        await identities[4]!.agent.get(`${endpoint}/messages`).expect(404);
      } finally {
        await tenantRepo.models.organizationMemberships.updateOne(
          { organizationId: org, userId: ids[4] },
          { $set: { role: 'member' } },
        );
      }
    },
  );
  await check('passive live identity checks never extend session idle expiry', async () => {
    const raw = decodeURIComponent(owner.cookie.split('=')[1]!);
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const before = await authRepo.models.sessions.findOne({ tokenHash }).lean();
    assert(before);
    await delay(20);
    await auth.context(raw, false, false);
    const after = await authRepo.models.sessions.findOne({ tokenHash }).lean();
    assert.equal(after!.expiresAt.toISOString(), before.expiresAt.toISOString());
    assert.equal(after!.lastSeenAt.toISOString(), before.lastSeenAt.toISOString());
  });
  await check(
    'Socket.IO rejects anonymous, cross-origin and invalid CSRF connections',
    async () => {
      for (const extra of [
        { extraHeaders: { Origin: origin } },
        { extraHeaders: { Origin: 'https://foreign.example', Cookie: owner.cookie } },
        { auth: { csrfToken: 'invalid' } },
        { extraHeaders: { Origin: origin, Cookie: `${owner.cookie}; ${owner.cookie}` } },
      ]) {
        const client = await socket(owner, extra);
        await assert.rejects(() => connect(client));
        client.disconnect();
      }
    },
  );
  await check(
    'a failed stream reports degraded status and recovery resynchronizes durable messages',
    async () => {
      const db = connection.db,
        watch = db.watch.bind(db);
      let attempts = 0;
      db.watch = (...args: unknown[]) => {
        if (++attempts === 1) throw new Error('Injected stream startup failure');
        return watch(...args);
      };
      const recoveryServer = createServer(app),
        recovery = createRealtime(recoveryServer, auth, tenants, collaboration, logger);
      let client: ReturnType<typeof io> | undefined;
      try {
        await new Promise<void>((resolve) => recoveryServer.listen(0, '127.0.0.1', resolve));
        await until(() => attempts === 1, 'Stream failure was not exercised');
        const address = recoveryServer.address();
        assert(address && typeof address === 'object');
        client = io(`http://127.0.0.1:${address.port}`, {
          path: '/api/live',
          transports: ['websocket'],
          autoConnect: false,
          reconnection: false,
          auth: { csrfToken: owner.csrf },
          extraHeaders: { Origin: origin, Cookie: owner.cookie },
        });
        sockets.push(client);
        const refreshes: { scope: unknown; available: boolean }[] = [];
        client.on('project:refresh', (scope: unknown) =>
          refreshes.push({ scope, available: recovery.available }),
        );
        await connect(client);
        assert.equal((await subscribe(client, liveScope)).data?.available, false);
        const row = conversationMessageSchema.parse(
          (
            await mutate(
              owner,
              `${endpoint}/messages`,
              message('Durable during stream outage'),
            ).expect(201)
          ).body.data,
        );
        await until(() => recovery.available, 'Stream did not recover');
        await until(
          () => refreshes.some((event) => event.available),
          'Recovered stream did not resynchronize',
        );
        assert.equal(
          (await list(owner, `?anchor=${row.id}`)).messages[0]!.body,
          'Durable during stream outage',
        );
        for (const event of refreshes) assert.deepEqual(event.scope, liveScope);
      } finally {
        client?.disconnect();
        await recovery.close();
        db.watch = watch;
      }
    },
  );
  await until(() => live.available, 'Mongo change stream did not initialize');
  const a = await socket(owner),
    b = await socket(member),
    duplicate = await socket(member),
    g = await socket(guest);
  const received: unknown[] = [],
    presence: { total: number; people: { id: string; name: string }[] }[] = [];
  a.on('project:refresh', (data: unknown) => received.push(data));
  a.on('project:presence', (data: { total: number; people: { id: string; name: string }[] }) =>
    presence.push(data),
  );
  for (const client of [a, b, duplicate, g]) await connect(client);
  await check(
    'subscriptions verify parents and current project membership, never arbitrary room names',
    async () => {
      assert((await subscribe(b, { ...scope, projectId: foreign.id })).error);
      assert((await subscribe(b, { ...liveScope, room: 'arbitrary' })).error);
      for (const client of [a, b, duplicate, g]) {
        const ack = await subscribe(client, liveScope);
        assert(ack.data.available);
        assert.match(ack.meta.requestId, /^[a-f0-9-]{36}$/);
      }
    },
  );
  await check('presence counts authorized users once across duplicate tabs', async () => {
    await until(() => presence.some((p) => p.total === 3), 'Presence did not deduplicate users');
    const current = livePresenceSchema.parse(presence.at(-1));
    assert.equal(current.people.length, 3);
    assert.deepEqual(
      current.people.map((p) => p.id).toSorted(),
      [ids[0], ids[1], ids[2]].toSorted(),
    );
  });
  await check(
    'committed changes send only matching project invalidations, never message content',
    async () => {
      await delay(300);
      received.length = 0;
      await mutate(owner, `${endpoint}/messages`, message('Realtime decision')).expect(201);
      await until(() => received.length > 0, 'Committed message was not delivered');
      for (const value of received) assert.deepEqual(value, liveScope);
      await delay(300);
      received.length = 0;
      await projectsRepo.models.projects.updateOne(
        { _id: foreign.id },
        { $set: { description: 'Foreign private change' } },
      );
      await delay(350);
      assert.equal(received.length, 0);
    },
  );
  await check(
    'reconnect restores subscriptions and reads updates missed while disconnected',
    async () => {
      b.disconnect();
      const posted = conversationMessageSchema.parse(
        (await mutate(owner, `${endpoint}/messages`, message('Offline decision')).expect(201)).body
          .data,
      );
      await connect(b);
      assert((await subscribe(b, liveScope)).data.available);
      assert(await repo.models.messages.exists({ _id: posted.id }));
      const all = await list(member);
      const more = all.nextCursor ? await list(member, `?cursor=${all.nextCursor}`) : all;
      assert(more.messages.some((m) => m.id === posted.id));
    },
  );
  await check(
    'membership revocation removes presence and disconnects existing sockets',
    async () => {
      let revoked = false;
      g.on('project:revoked', () => {
        revoked = true;
      });
      await projectsRepo.models.projects.updateOne(
        { _id: project.id },
        { $pull: { memberIds: ids[2] } },
      );
      await until(() => revoked && !g.connected, 'Revoked guest socket remained connected');
      await guest.agent.get(`${endpoint}/messages`).expect(404);
      await until(() => presence.at(-1)?.total === 2, 'Revoked guest remained in presence');
    },
  );
  await check(
    'expired idle sessions are evicted from live subscriptions without being renewed',
    async () => {
      const identity = await login(0),
        client = await socket(identity);
      await connect(client);
      assert((await subscribe(client, liveScope)).data?.available);
      let revoked = false;
      client.on('project:revoked', () => {
        revoked = true;
      });
      const tokenHash = createHash('sha256')
        .update(decodeURIComponent(identity.cookie.split('=')[1]!))
        .digest('hex');
      await authRepo.models.sessions.updateOne(
        { tokenHash },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      await until(() => revoked && !client.connected, 'Expired session remained live');
      assert(a.connected);
    },
  );
  await check('session invalidation disconnects all live tabs for that identity', async () => {
    let revoked = 0;
    b.on('project:revoked', () => revoked++);
    duplicate.on('project:revoked', () => revoked++);
    await authRepo.models.sessions.deleteMany({ userId: ids[1] });
    await until(
      () => revoked === 2 && !b.connected && !duplicate.connected,
      'Revoked sessions remained live',
    );
    await member.agent.get(`${endpoint}/notifications`).expect(401);
  });
  await check(
    'deleted parents deny retained collaboration and disconnect project sockets',
    async () => {
      let revoked = false;
      a.on('project:revoked', () => {
        revoked = true;
      });
      await projectsRepo.models.projects.updateOne(
        { _id: project.id },
        { $set: { deletedAt: new Date() } },
      );
      await until(() => revoked && !a.connected, 'Deleted project remained subscribed');
      await owner.agent.get(`${endpoint}/messages`).expect(404);
      await owner.agent.get(`${endpoint}/notifications`).expect(404);
    },
  );
  console.log(`Phase 8 integration: ${results.length} checks passed.`);
} finally {
  for (const client of sockets) client.disconnect();
  await live.close();
  for (const model of Object.values(repo.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  for (const model of Object.values(projectsRepo.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  for (const name of ['workspaceMemberships', 'organizationMemberships', 'workspaces'] as const)
    await tenantRepo.models[name].deleteMany({ organizationId: { $in: orgs } });
  await tenantRepo.models.organizations.deleteMany({ _id: { $in: orgs } });
  await authRepo.models.sessions.deleteMany({ userId: { $in: ids } });
  await authRepo.models.users.deleteMany({ _id: { $in: ids } });
  await clearTestLoopbackLimits(connection.db);
  await connection.close();
}
