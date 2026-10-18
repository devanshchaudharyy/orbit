import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createApp } from '../../apps/api/src/app.js';
import { createLogger } from '../../apps/api/src/infrastructure/logger.js';
import { MongoAuthRepository } from '../../apps/api/src/modules/auth/repository.js';
import { AuthService } from '../../apps/api/src/modules/auth/service.js';
import { hashPassword } from '../../apps/api/src/modules/auth/crypto.js';
import { MongoTenantRepository } from '../../apps/api/src/modules/tenants/repository.js';
import { TenantService } from '../../apps/api/src/modules/tenants/service.js';
import { ProjectRepository } from '../../apps/api/src/modules/projects/repository.js';
import { ProjectService } from '../../apps/api/src/modules/projects/service.js';
import { DocumentRepository } from '../../apps/api/src/modules/documents/repository.js';
import { CollaborationRepository } from '../../apps/api/src/modules/collaboration/repository.js';
import { CollaborationService } from '../../apps/api/src/modules/collaboration/service.js';
import { TeamRepository } from '../../apps/api/src/modules/teams/repository.js';
import { AdministrationRepository } from '../../apps/api/src/modules/administration/repository.js';
import { GlobalSearch } from '../../apps/api/src/modules/administration/search.js';
import {
  searchPageSchema,
  auditPageSchema,
  administrationSchema,
} from '../../packages/contracts/src/index.js';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url)),
  mongoose = require('mongoose'),
  request = require('supertest');
const source =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(source).hostname));
assert(/^\/orbit_test(?:_[a-z0-9]+)?$/.test(new URL(source).pathname));
const uri = new URL(source);
uri.pathname = '/orbit_test_administration' + randomUUID().replaceAll('-', '');
const connection = await mongoose
    .createConnection(uri.href, { serverSelectionTimeoutMS: 3000 })
    .asPromise(),
  authRepo = new MongoAuthRepository(connection, async () => true),
  tenantRepo = new MongoTenantRepository(connection),
  tenants = new TenantService(tenantRepo),
  repo = new ProjectRepository(tenantRepo),
  projects = new ProjectService(repo),
  admin = new AdministrationRepository(repo),
  documents = new DocumentRepository(repo),
  collaboration = new CollaborationRepository(repo),
  teams = new TeamRepository(tenantRepo),
  search = new GlobalSearch(repo);
const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174',
  run = randomUUID(),
  password = `Discovery ${run}`,
  auth = new AuthService(
    authRepo,
    { available: async () => {}, send: async () => {} },
    {
      APP_ORIGIN: origin,
      NODE_ENV: 'test',
      SESSION_IDLE_MINUTES: 1440,
      SESSION_ABSOLUTE_HOURS: 168,
    },
  );
const app = createApp(
  { check: async () => ({ mongo: true, redis: false }), close: async () => {} },
  createLogger('silent'),
  auth,
  tenants,
  undefined,
  projects,
  new CollaborationService(collaboration),
);
const users = Array.from({ length: 7 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(),
    email: `discovery-${run}-${i}@example.test`,
    name: `Person ${i}`,
  })),
  ids = users.map((u) => String(u._id)),
  results: string[] = [];
type Identity = { agent: ReturnType<typeof request.agent>; csrf: string };
async function login(index: number): Promise<Identity> {
  const agent = request.agent(app),
    initial = await agent.get('/api/v1/auth/session').expect(200),
    response = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', initial.body.data.csrfToken)
      .send({ email: users[index]!.email, password })
      .expect(200);
  return { agent, csrf: response.body.data.csrfToken };
}
const change = (who: Identity, path: string, input: unknown, method: 'post' | 'patch' = 'patch') =>
  who.agent[method](path).set('Origin', origin).set('X-CSRF-Token', who.csrf).send(input);
async function check(name: string, fn: () => Promise<void>) {
  await authRepo.models.rateLimits.deleteMany({});
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  await authRepo.ready();
  await admin.ready();
  await documents.ready();
  await collaboration.ready();
  await teams.ready();
  const passwordHash = await hashPassword(password);
  await authRepo.models.users.create(
    users.map((u, i) => ({
      ...u,
      passwordHash,
      emailVerified: i !== 5,
      onboardingCompleted: i !== 6,
    })),
  );
  const people: Identity[] = [];
  for (let i = 0; i < 7; i++) people.push(await login(i));
  const [owner, member, guest, outsider, administrator, unverified, incomplete] = people as [
    Identity,
    Identity,
    Identity,
    Identity,
    Identity,
    Identity,
    Identity,
  ];
  const org = (
      await tenantRepo.createOrganization(ids[0]!, { name: 'Discovery studio', description: '' })
    ).id,
    ws = (
      await tenantRepo.createWorkspace(ids[0]!, org, {
        name: 'Discovery work',
        description: '',
        timezone: 'UTC',
      })
    ).id;
  for (const [index, role] of [
    [1, 'member'],
    [2, 'guest'],
    [4, 'admin'],
  ] as const) {
    await tenantRepo.models.organizationMemberships.create({
      organizationId: org,
      userId: ids[index],
      role,
    });
    await tenantRepo.models.workspaceMemberships.create({
      organizationId: org,
      workspaceId: ws,
      userId: ids[index],
    });
  }
  const scope = { organizationId: org, workspaceId: ws },
    project = await repo.create(ids[0]!, scope, {
      name: 'Discovery launch',
      description: 'Private body not searched',
      status: 'active',
      priority: 'normal',
      cover: 'orbit',
      ownerId: ids[0]!,
      memberIds: [ids[1]!, ids[2]!],
      template: 'blank',
    }),
    live = { ...scope, projectId: project.id },
    base = `/api/v1/discovery`,
    adminPath = `${base}/organizations/${org}`;
  const taskInput = {
      title: 'Discovery deadline, résumé; 🌙',
      description: 'Do not export this private body',
      status: 'todo' as const,
      priority: 'normal' as const,
      dueDate: '2026-12-31',
      ownerId: ids[1]!,
      assigneeIds: [ids[1]!],
      labelIds: [],
      checklist: [],
      parentId: null,
    },
    task = await repo.saveTask(ids[0]!, scope, project.id, taskInput);
  const doc = await documents.save(ids[0]!, live, {
    title: 'Discovery guide',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private document body' }] }],
    },
    clientId: randomUUID(),
  });
  const fileId = new mongoose.Types.ObjectId();
  await documents.models.files.create({
    _id: fileId,
    ...live,
    name: 'Discovery.pdf',
    type: 'application/pdf',
    size: 42,
    sha256: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    authorId: ids[0],
    clientId: randomUUID(),
    version: 1,
    status: 'ready',
    objectKey: 'private/not-returned',
    documentId: null,
    taskId: null,
  });
  await check(
    'new routes require sign-in, verified identity, onboarding, strict input and request metadata',
    async () => {
      await request(app).get(`${base}/search?q=Discovery`).expect(401);
      await unverified.agent.get(`${base}/search?q=Discovery`).expect(403);
      await incomplete.agent.get(`${base}/search?q=Discovery`).expect(403);
      for (const query of [
        'q=x',
        'q=valid&kind=users',
        'q=valid&organizationId=bad',
        'q=valid&q=other',
        'q=valid&userId=' + ids[0],
      ])
        await owner.agent.get(`${base}/search?${query}`).expect(400);
      const response = await owner.agent.get(`${base}/search?q=Discovery`).expect(200);
      assert(response.headers['x-request-id']);
      assert.equal(response.body.meta.requestId, response.headers['x-request-id']);
      assert.equal(response.headers['cache-control'], 'no-store');
    },
  );
  await check(
    'global search returns current authorized organizations, workspaces, projects, tasks, documents and ready files',
    async () => {
      const body = searchPageSchema.parse(
        (await owner.agent.get(`${base}/search?q=Discovery`).expect(200)).body.data,
      );
      assert.deepEqual(
        new Set(body.results.map((x) => x.kind)),
        new Set(['organization', 'workspace', 'project', 'task', 'document', 'file']),
      );
      assert(body.results.some((x) => x.href.endsWith(`/tasks/${task.id}`)));
      assert(body.results.some((x) => x.href.endsWith(`document=${doc.id}`)));
      assert(!JSON.stringify(body).includes('Private document body'));
      assert(!JSON.stringify(body).includes('private/not-returned'));
    },
  );
  await check(
    'foreign organizations and ungranted workspaces expose no names or content, including for organization administrators',
    async () => {
      assert.equal(
        (await outsider.agent.get(`${base}/search?q=Discovery`).expect(200)).body.data.results
          .length,
        0,
      );
      await outsider.agent.get(`${base}/search?q=Discovery&organizationId=${org}`).expect(404);
      await tenantRepo.models.workspaceMemberships.deleteOne({
        organizationId: org,
        userId: ids[4],
      });
      const rows = (await administrator.agent.get(`${base}/search?q=Discovery`).expect(200)).body
        .data.results;
      assert.deepEqual(
        rows.map((x: { kind: string }) => x.kind),
        ['organization'],
      );
    },
  );
  await check(
    'guest search requires explicit project grants and never treats project ownership as a guest grant',
    async () => {
      await repo.models.projects.updateOne(
        { _id: project.id },
        { $pull: { memberIds: new mongoose.Types.ObjectId(ids[2]) }, $set: { ownerId: ids[2] } },
      );
      const rows = (await guest.agent.get(`${base}/search?q=Discovery`).expect(200)).body.data
        .results;
      assert(rows.every((r: { kind: string }) => ['organization', 'workspace'].includes(r.kind)));
      await repo.models.projects.updateOne(
        { _id: project.id },
        { $addToSet: { memberIds: ids[2] }, $set: { ownerId: ids[0] } },
      );
      assert(
        (await guest.agent.get(`${base}/search?q=Discovery&kind=task`).expect(200)).body.data
          .results.length === 1,
      );
    },
  );
  await check(
    'literal metacharacters cannot become regex operators and body-only matches are excluded',
    async () => {
      assert.equal(
        (await owner.agent.get(`${base}/search?q=.*`).expect(200)).body.data.results.length,
        0,
      );
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Private%20document%20body`).expect(200)).body.data
          .results.length,
        0,
      );
      await repo.models.tasks.updateOne(
        { _id: task.id },
        { $set: { title: 'Discovery literal .*' } },
      );
      assert.equal(
        (await owner.agent.get(`${base}/search?q=.*`).expect(200)).body.data.results[0].id,
        task.id,
      );
    },
  );
  await check(
    'archived, soft-deleted, orphaned and unready search rows are excluded before pagination',
    async () => {
      await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: true } });
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=task`).expect(200)).body.data
          .results.length,
        0,
      );
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=task&archived=true`).expect(200))
          .body.data.results.length,
        1,
      );
      await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: false } });
      await documents.models.files.updateOne({ _id: fileId }, { $set: { status: 'pending' } });
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=file`).expect(200)).body.data
          .results.length,
        0,
      );
      await documents.models.files.updateOne({ _id: fileId }, { $set: { status: 'ready' } });
      await documents.models.documents.updateOne(
        { _id: doc.id },
        { $set: { deletedAt: new Date() } },
      );
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=document`).expect(200)).body.data
          .results.length,
        0,
      );
      await documents.models.documents.updateOne({ _id: doc.id }, { $set: { deletedAt: null } });
      await repo.models.projects.updateOne(
        { _id: project.id },
        { $set: { deletedAt: new Date() } },
      );
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=task&archived=true`).expect(200))
          .body.data.results.length,
        0,
      );
      await repo.models.projects.updateOne({ _id: project.id }, { $set: { deletedAt: null } });
    },
  );
  await check(
    'files with deleted or foreign task/document parents are hidden from global search',
    async () => {
      await documents.models.files.updateOne({ _id: fileId }, { $set: { documentId: doc.id } });
      await documents.models.documents.updateOne(
        { _id: doc.id },
        { $set: { deletedAt: new Date() } },
      );
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=file`).expect(200)).body.data
          .results.length,
        0,
      );
      await documents.models.documents.updateOne({ _id: doc.id }, { $set: { deletedAt: null } });
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=file`).expect(200)).body.data
          .results.length,
        1,
      );
      await documents.models.files.updateOne(
        { _id: fileId },
        { $set: { documentId: null, taskId: new mongoose.Types.ObjectId() } },
      );
      assert.equal(
        (await owner.agent.get(`${base}/search?q=Discovery&kind=file`).expect(200)).body.data
          .results.length,
        0,
      );
      await documents.models.files.updateOne({ _id: fileId }, { $set: { taskId: null } });
    },
  );
  await check(
    'search paginates actual authorized matches across types without duplicates or a scan cap',
    async () => {
      await repo.models.tasks.create(
        Array.from({ length: 33 }, (_, i) => ({
          ...live,
          ...taskInput,
          title: `Discovery page ${i}`,
          ownerId: ids[0],
        })),
      );
      const seen = new Set<string>();
      let cursor: string | null = null,
        pages = 0;
      do {
        const data = searchPageSchema.parse(
          (
            await owner.agent
              .get(`${base}/search?q=Discovery${cursor ? `&cursor=${cursor}` : ''}`)
              .expect(200)
          ).body.data,
        );
        for (const r of data.results) {
          assert(!seen.has(r.id));
          seen.add(r.id);
        }
        cursor = data.nextCursor;
        pages++;
      } while (cursor);
      assert.equal(seen.size, 39);
      assert.equal(pages, 2);
    },
  );
  await check(
    'search cursor validation rejects malformed or changed queries without broadening scope',
    async () => {
      const current = (await owner.agent.get(`${base}/search?q=Discovery`).expect(200)).body.data
        .nextCursor;
      assert(current);
      for (const query of [
        `q=Other&cursor=${current}`,
        `q=Discovery&kind=task&cursor=${current}`,
        `q=Discovery&organizationId=${org}&cursor=${current}`,
        'q=Discovery&cursor=abcd',
      ])
        await owner.agent.get(`${base}/search?${query}`).expect(400);
    },
  );
  await check(
    'revocation during a search read is rechecked before returning resource titles',
    async () => {
      const original = repo.access.bind(repo);
      let once = true;
      repo.access = async (...args) => {
        if (once && args[0] === ids[1]) {
          once = false;
          await tenantRepo.models.workspaceMemberships.deleteOne({
            organizationId: org,
            userId: ids[1],
          });
        }
        return original(...args);
      };
      try {
        const rows = await search.run(ids[1]!, { q: 'Discovery', kind: 'task', archived: 'false' });
        assert.equal(rows.results.length, 0);
      } finally {
        repo.access = original;
        await tenantRepo.models.workspaceMemberships.create({
          organizationId: org,
          workspaceId: ws,
          userId: ids[1],
        });
      }
    },
  );
  await check(
    'preferences are private, versioned and require Origin/CSRF with exact boolean fields',
    async () => {
      assert.deepEqual((await member.agent.get(`${base}/preferences`).expect(200)).body.data, {
        mentions: true,
        taskComments: true,
        version: 0,
      });
      await member.agent
        .patch(`${base}/preferences`)
        .send({ mentions: false, taskComments: true, version: 0 })
        .expect(403);
      await change(member, `${base}/preferences`, {
        mentions: false,
        taskComments: true,
        version: 0,
        userId: ids[0],
      }).expect(400);
      const row = (
        await change(member, `${base}/preferences`, {
          mentions: false,
          taskComments: true,
          version: 0,
        }).expect(200)
      ).body.data;
      assert.equal(row.version, 1);
      await change(member, `${base}/preferences`, {
        mentions: true,
        taskComments: true,
        version: 0,
      }).expect(409);
      assert.equal(
        (await owner.agent.get(`${base}/preferences`).expect(200)).body.data.mentions,
        true,
      );
    },
  );
  await check(
    'mention opt-out suppresses actual new inbox entries while task-comment delivery remains independent',
    async () => {
      await collaboration.save(ids[0]!, live, null, {
        body: 'Private mention body',
        mentionIds: [ids[1]!],
        clientId: randomUUID(),
      });
      assert.equal(await collaboration.models.notifications.countDocuments({ userId: ids[1] }), 0);
      await collaboration.save(ids[0]!, live, task.id, {
        body: 'Task comment',
        mentionIds: [],
        clientId: randomUUID(),
      });
      assert.equal(await collaboration.models.notifications.countDocuments({ userId: ids[1] }), 1);
      const prefs = await admin.preferences(ids[1]!);
      await admin.savePreferences(ids[1]!, { ...prefs, taskComments: false });
      await collaboration.save(ids[0]!, live, task.id, {
        body: 'New quiet comment',
        mentionIds: [],
        clientId: randomUUID(),
      });
      assert.equal(await collaboration.models.notifications.countDocuments({ userId: ids[1] }), 1);
    },
  );
  await check(
    're-enabling mentions delivers exactly one entry and older history is retained',
    async () => {
      const prefs = await admin.preferences(ids[1]!);
      await admin.savePreferences(ids[1]!, { ...prefs, mentions: true });
      const input = { body: 'Mention restored', mentionIds: [ids[1]!], clientId: randomUUID() };
      await collaboration.save(ids[0]!, live, task.id, input);
      await collaboration.save(ids[0]!, live, task.id, input);
      assert.equal(await collaboration.models.notifications.countDocuments({ userId: ids[1] }), 2);
    },
  );
  await check(
    'organization usage and audit reads require owner/admin rights independently of explicit workspace access',
    async () => {
      for (const who of [member, guest]) {
        await who.agent.get(adminPath).expect(403);
        await who.agent.get(`${adminPath}/audit`).expect(403);
      }
      await outsider.agent.get(adminPath).expect(404);
      const data = administrationSchema.parse(
        (await administrator.agent.get(adminPath).expect(200)).body.data,
      );
      assert.equal(data.usage.members, 4);
      assert.equal(data.usage.tasks, 34);
      assert.equal(data.usage.files, 1);
      assert.equal(data.usage.storageBytes, 42);
      assert.equal(data.integration.calendarEnabled, false);
    },
  );
  await check(
    'audit records are transactional metadata without private titles, bodies, emails, keys or update/delete endpoints',
    async () => {
      const data = auditPageSchema.parse(
          (await owner.agent.get(`${adminPath}/audit`).expect(200)).body.data,
        ),
        text = JSON.stringify(data);
      assert(data.events.length > 0);
      for (const value of [
        'Discovery deadline',
        'Private mention body',
        'example.test',
        'objectKey',
        'passwordHash',
        'tokenHash',
      ])
        assert(!text.includes(value));
      await change(owner, `${adminPath}/audit`, {}).expect(404);
      assert(
        await admin.models.audit.exists({
          organizationId: org,
          category: 'organization',
          action: 'organization.created',
        }),
      );
      assert(await admin.models.audit.exists({ organizationId: org, category: 'project' }));
    },
  );
  await check(
    'failed local mutations roll back both state and appended audit records',
    async () => {
      const count = await admin.models.audit.countDocuments({ organizationId: org }),
        original = repo.event.bind(repo);
      repo.event = async (...args) => {
        await original(...args);
        throw new Error('Controlled rollback');
      };
      try {
        await assert.rejects(() =>
          repo.saveTask(ids[0]!, scope, project.id, { ...taskInput, title: 'Never committed' }),
        );
      } finally {
        repo.event = original;
      }
      assert.equal(await repo.models.tasks.countDocuments({ title: 'Never committed' }), 0);
      assert.equal(await admin.models.audit.countDocuments({ organizationId: org }), count);
    },
  );
  await check(
    'team grants, invitation lifecycle and ownership changes append metadata in their transactions',
    async () => {
      const target = await tenantRepo.models.organizationMemberships
        .findOne({ organizationId: org, userId: ids[1] })
        .lean();
      await teams.update(ids[0]!, org, String(target!._id), {
        role: 'member',
        workspaceIds: [ws],
        version: target!.version,
      });
      assert(
        await admin.models.audit.exists({ organizationId: org, action: 'membership.updated' }),
      );
      const invite = await teams.invite(
        ids[0]!,
        org,
        { email: 'invite-' + run + '@example.test', role: 'guest', workspaceIds: [ws] },
        'c'.repeat(64),
        async () => {},
      );
      await teams.revoke(ids[0]!, org, invite.id);
      assert(
        await admin.models.audit.exists({ organizationId: org, action: 'invitation.revoked' }),
      );
      const recipient = await tenantRepo.models.organizationMemberships
        .findOne({ organizationId: org, userId: ids[4] })
        .lean();
      await teams.transfer(ids[0]!, org, String(recipient!._id), recipient!.version, passwordHash);
      assert(
        await admin.models.audit.exists({
          organizationId: org,
          action: 'ownership.transferred',
          actorId: ids[0],
          resourceId: recipient!._id,
        }),
      );
    },
  );
  await check(
    'audit pagination and category filters retain unique descending records and ignore expired rows',
    async () => {
      await admin.models.audit.create(
        Array.from({ length: 31 }, () => ({
          organizationId: org,
          actorId: ids[0],
          category: 'integration',
          action: 'calendar.enabled',
          resourceId: org,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
        })),
      );
      await admin.models.audit.create({
        organizationId: org,
        actorId: ids[0],
        category: 'integration',
        action: 'expired-record',
        resourceId: org,
        createdAt: new Date(),
        expiresAt: new Date(0),
      });
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const data = auditPageSchema.parse(
          (
            await owner.agent
              .get(`${adminPath}/audit?category=integration${cursor ? `&cursor=${cursor}` : ''}`)
              .expect(200)
          ).body.data,
        );
        for (const row of data.events) {
          assert.equal(row.category, 'integration');
          assert.notEqual(row.action, 'expired-record');
          assert(!seen.has(row.id));
          seen.add(row.id);
        }
        cursor = data.nextCursor;
      } while (cursor);
      assert.equal(seen.size, 31);
    },
  );
  const calendar = `${adminPath}/workspaces/${ws}/projects/${project.id}/calendar?from=2026-12-01&to=2026-12-31`;
  await check(
    'calendar is disabled by default and only administrators can change its versioned configuration',
    async () => {
      await owner.agent.get(calendar).expect(409);
      await change(member, `${adminPath}/integration`, {
        calendarEnabled: true,
        version: 0,
      }).expect(403);
      const response = await change(administrator, `${adminPath}/integration`, {
        calendarEnabled: true,
        version: 0,
      }).expect(200);
      assert.equal(response.body.data.version, 1);
      await change(owner, `${adminPath}/integration`, {
        calendarEnabled: false,
        version: 0,
      }).expect(409);
      assert(
        await admin.models.audit.exists({
          organizationId: org,
          category: 'integration',
          action: 'calendar.enabled',
        }),
      );
    },
  );
  await check(
    'authenticated calendar exports correct all-day deadlines, stable IDs, no private bodies and safe download headers',
    async () => {
      await repo.models.tasks.updateOne({ _id: task.id }, { $set: { title: taskInput.title } });
      const response = await owner.agent.get(calendar).expect(200);
      assert.match(response.headers['content-type'], /text\/calendar/);
      assert.match(response.headers['content-disposition'], /attachment.*orbit-deadlines\.ics/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert(response.text.includes('DTEND;VALUE=DATE:20270101'));
      assert(response.text.includes('SUMMARY:Discovery deadline\\, résumé\\; 🌙'));
      assert(!response.text.includes(taskInput.description));
      assert(!response.text.includes(users[1]!.email));
      assert(response.text.includes(`UID:task-${task.id}@orbit.local`));
      await guest.agent.get(calendar).expect(200);
    },
  );
  await check(
    'calendar validates date windows and fails clearly instead of truncating more than 2,000 tasks',
    async () => {
      await owner.agent.get(calendar.replace('2026-12-31', '2026-02-30')).expect(400);
      const rows = await repo.models.tasks.create(
        Array.from({ length: 2001 }, (_, i) => ({ ...live, ...taskInput, title: `Bound ${i}` })),
      );
      try {
        await owner.agent.get(calendar).expect(422);
      } finally {
        await repo.models.tasks.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
      }
    },
  );
  await check(
    'calendar permission and enabled state are rechecked before returning bytes',
    async () => {
      const find = repo.models.tasks.find.bind(repo.models.tasks);
      let changed = false;
      repo.models.tasks.find = ((...args: Parameters<typeof find>) => {
        const query = find(...args);
        if (!changed) {
          changed = true;
          const lean = query.lean.bind(query);
          query.lean = async () => {
            const rows = await lean();
            await admin.models.integration.updateOne(
              { _id: org },
              { $set: { calendarEnabled: false } },
            );
            return rows;
          };
        }
        return query;
      }) as typeof repo.models.tasks.find;
      try {
        await owner.agent.get(calendar).expect(409);
      } finally {
        repo.models.tasks.find = find;
      }
      await admin.models.integration.updateOne({ _id: org }, { $set: { calendarEnabled: true } });
      await tenantRepo.models.workspaceMemberships.deleteOne({
        organizationId: org,
        userId: ids[2],
      });
      await guest.agent.get(calendar).expect(404);
    },
  );
  await check(
    'fresh database connections retain preferences, integration settings and audit history',
    async () => {
      const fresh = await mongoose
        .createConnection(uri.href, { serverSelectionTimeoutMS: 3000 })
        .asPromise();
      try {
        assert.equal(
          (await fresh.collection('notification_preferences').findOne({ _id: users[1]!._id }))
            .mentions,
          true,
        );
        assert.equal(
          (
            await fresh
              .collection('organization_integrations')
              .findOne({ _id: new mongoose.Types.ObjectId(org) })
          ).calendarEnabled,
          true,
        );
        assert(
          (await fresh
            .collection('audit_logs')
            .countDocuments({ organizationId: new mongoose.Types.ObjectId(org) })) > 0,
        );
      } finally {
        await fresh.close();
      }
    },
  );
  console.log(`Phase 13 administration integration: ${results.length} checks passed.`);
} finally {
  await connection.dropDatabase();
  await connection.close();
}
