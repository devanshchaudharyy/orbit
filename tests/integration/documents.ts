import { cleanupBillingFixtures } from '../support/billing-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  documentSchema,
  documentHistorySchema,
  documentListSchema,
  fileSchema,
  fileListSchema,
  emptyDocument,
  projectSchema,
  taskSchema,
  type RichDocument,
  type ProjectDocument,
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
import { DocumentRepository } from '../../apps/api/src/modules/documents/repository.js';
import { DocumentService } from '../../apps/api/src/modules/documents/service.js';
import {
  DiskStorage,
  S3Storage,
  type PrivateStorage,
} from '../../apps/api/src/modules/documents/storage.js';
import { parseEnvironment } from '../../apps/api/src/config/env.js';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url)),
  mongoose = require('mongoose'),
  request = require('supertest');
const uri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(uri).hostname));
assert(/^\/orbit_test(?:_[a-z0-9]+)?$/.test(new URL(uri).pathname));
const connection = await mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
    .asPromise(),
  authRepo = new MongoAuthRepository(connection, async () => true),
  tenantRepo = new MongoTenantRepository(connection),
  tenants = new TenantService(tenantRepo),
  projectsRepo = new ProjectRepository(tenantRepo),
  projects = new ProjectService(projectsRepo),
  repo = new DocumentRepository(projectsRepo);
const run = randomUUID(),
  parent = resolve('.local/testing'),
  storageRoot = resolve(parent, `files-integration-${run}`),
  env = parseEnvironment({ ...process.env, MONGO_URI: uri, NODE_ENV: 'test' });
if (env.FILE_STORAGE_DRIVER === 's3')
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.S3_ENDPOINT).hostname));
const actual = env.FILE_STORAGE_DRIVER === 's3' ? new S3Storage(env) : new DiskStorage(storageRoot);
let failPut = false,
  failRemove = false,
  afterRead: (() => Promise<void>) | undefined;
const storage: PrivateStorage = {
  put: async (key, data, type) => {
    if (failPut) throw new Error('controlled write failure');
    await actual.put(key, data, type);
  },
  get: async (key) => {
    const bytes = await actual.get(key);
    await afterRead?.();
    return bytes;
  },
  remove: async (key) => {
    if (failRemove) throw new Error('controlled cleanup failure');
    await actual.remove(key);
  },
};
const service = new DocumentService(repo, storage),
  origin = 'http://127.0.0.1:5174',
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
  undefined,
  service,
);
const users = Array.from({ length: 6 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(),
    email: `documents-${run}-${i}@example.test`,
    name: `Document author ${i}`,
  })),
  ids = users.map((user) => String(user._id)),
  orgs: string[] = [],
  results: string[] = [];
type Identity = { agent: ReturnType<typeof request.agent>; csrf: string };
async function login(index: number): Promise<Identity> {
  const agent = request.agent(app),
    session = await agent.get('/api/v1/auth/session').expect(200),
    response = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', session.body.data.csrfToken)
      .send({ email: users[index]!.email, password: `Documents ${run}` })
      .expect(200);
  return { agent, csrf: response.body.data.csrfToken };
}
const mutate = (
  actor: Identity,
  path: string,
  input: unknown,
  method: 'post' | 'patch' | 'delete' = 'post',
) => actor.agent[method](path).set('Origin', origin).set('X-CSRF-Token', actor.csrf).send(input);
const text = (body: string): RichDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
});
async function check(name: string, operation: () => Promise<void>) {
  await clearTestLoopbackLimits(connection.db);
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  await authRepo.ready();
  await service.ready();
  const passwordHash = await hashPassword(`Documents ${run}`);
  await authRepo.models.users.create(
    users.map((user, i) => ({
      ...user,
      passwordHash,
      emailVerified: i !== 4,
      onboardingCompleted: i !== 5,
    })),
  );
  const identity: Identity[] = [];
  for (let i = 0; i < 6; i++) identity.push(await login(i));
  const owner = identity[0]!,
    member = identity[1]!,
    guest = identity[2]!,
    outsider = identity[3]!;
  const org = (await tenants.create(ids[0]!, { name: 'Document fixture', description: '' })).id;
  orgs.push(org);
  const ws = (
    await tenants.createWorkspace(ids[0]!, org, {
      name: 'Knowledge studio',
      description: '',
      timezone: 'UTC',
    })
  ).id;
  await tenantRepo.models.organizationMemberships.create(
    [1, 2].map((i) => ({
      organizationId: org,
      userId: ids[i],
      role: i === 2 ? 'guest' : 'member',
    })),
  );
  await tenantRepo.models.workspaceMemberships.create(
    [1, 2].map((i) => ({ organizationId: org, workspaceId: ws, userId: ids[i] })),
  );
  const base = `/api/v1/organizations/${org}/workspaces/${ws}/projects`,
    projectInput = {
      name: 'Knowledge project',
      description: '',
      status: 'active',
      priority: 'normal',
      cover: 'aurora',
      ownerId: ids[0],
      memberIds: [ids[1], ids[2]],
      template: 'blank',
    },
    project = projectSchema.parse((await mutate(owner, base, projectInput).expect(201)).body.data),
    foreign = projectSchema.parse(
      (
        await mutate(owner, base, { ...projectInput, name: 'Other project', memberIds: [] }).expect(
          201,
        )
      ).body.data,
    ),
    path = `${base}/${project.id}`;
  const create = (title = 'Decision log', body = 'Approved launch') => ({
    title,
    content: text(body),
    clientId: randomUUID(),
  });
  let document: ProjectDocument;
  await check(
    'documents and private file lists use scoped envelopes and reject unknown query keys',
    async () => {
      const res = await owner.agent.get(`${path}/documents`).expect(200);
      assert(res.headers['x-request-id']);
      assert.equal(documentListSchema.parse(res.body.data).total, 0);
      assert.equal(
        fileListSchema.parse((await owner.agent.get(`${path}/files`).expect(200)).body.data).total,
        0,
      );
      await owner.agent.get(`${path}/documents?html=1`).expect(400);
    },
  );
  await check(
    'anonymous, incomplete, unverified and foreign identities cannot read project knowledge',
    async () => {
      await request(app).get(`${path}/documents`).expect(401);
      await outsider.agent.get(`${path}/files`).expect(404);
      await identity[4]!.agent.get(`${path}/documents`).expect(403);
      await identity[5]!.agent.get(`${path}/documents`).expect(403);
    },
  );
  await check(
    'create commits document, immutable first revision and project history together',
    async () => {
      document = documentSchema.parse(
        (await mutate(owner, `${path}/documents`, create()).expect(201)).body.data,
      );
      assert.equal(document.version, 1);
      assert.equal(await repo.models.revisions.countDocuments({ documentId: document.id }), 1);
      assert.equal(
        await projectsRepo.models.events.countDocuments({
          projectId: project.id,
          action: 'created document',
        }),
        1,
      );
    },
  );
  await check(
    'safe structured content rejects raw HTML, scripts, unsafe links and unknown fields',
    async () => {
      for (const content of [
        { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.test' } }] },
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'bad',
                  marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                },
              ],
            },
          ],
        },
      ])
        await mutate(owner, `${path}/documents`, { ...create(), content }).expect(400);
      await mutate(owner, `${path}/documents`, { ...create(), unsafe: true }).expect(400);
    },
  );
  await check(
    'UUID retries deduplicate documents, revisions and activity and reject conflicting reuse',
    async () => {
      const input = create('Retry record'),
        first = (await mutate(owner, `${path}/documents`, input).expect(201)).body.data,
        again = (await mutate(owner, `${path}/documents`, input).expect(201)).body.data;
      assert.equal(first.id, again.id);
      assert.equal(await repo.models.revisions.countDocuments({ documentId: first.id }), 1);
      await mutate(owner, `${path}/documents`, { ...input, title: 'Different' }).expect(409);
    },
  );
  await check(
    'team edits create immutable revisions and preserve original optimistic versions',
    async () => {
      document = documentSchema.parse(
        (
          await mutate(
            member,
            `${path}/documents/${document.id}`,
            { title: document.title, content: text('Updated team decision'), version: 1 },
            'patch',
          ).expect(200)
        ).body.data,
      );
      await mutate(
        owner,
        `${path}/documents/${document.id}`,
        { title: 'Stale', content: emptyDocument, version: 1 },
        'patch',
      ).expect(409);
      const history = documentHistorySchema.parse(
        (await owner.agent.get(`${path}/documents/${document.id}/history`).expect(200)).body.data,
      );
      assert.equal(history.revisions.length, 2);
      assert.equal(
        history.revisions.at(-1)!.content.content[0]!.content![0]!.text,
        'Approved launch',
      );
    },
  );
  await check(
    'restoring a prior revision appends a new revision and rejects foreign revision substitution',
    async () => {
      const revisions = await repo.models.revisions
        .find({ documentId: document.id })
        .sort({ version: 1 })
        .lean();
      document = documentSchema.parse(
        (
          await mutate(
            owner,
            `${path}/documents/${document.id}/history/${revisions[0]!._id}/restore`,
            { version: 2 },
          ).expect(200)
        ).body.data,
      );
      assert.equal(document.version, 3);
      assert.equal(await repo.models.revisions.countDocuments({ documentId: document.id }), 3);
      const other = documentSchema.parse(
          (
            await mutate(
              owner,
              `${base}/${foreign.id}/documents`,
              create('Foreign history'),
            ).expect(201)
          ).body.data,
        ),
        revision = await repo.models.revisions.findOne({ documentId: other.id }).lean();
      await mutate(owner, `${path}/documents/${document.id}/history/${revision!._id}/restore`, {
        version: 3,
      }).expect(404);
    },
  );
  await check(
    'no-op saves do not create extra history and transaction failures roll back content and revisions',
    async () => {
      await mutate(
        owner,
        `${path}/documents/${document.id}`,
        { title: document.title, content: document.content, version: 3 },
        'patch',
      ).expect(200);
      assert.equal(await repo.models.revisions.countDocuments({ documentId: document.id }), 3);
      const event = projectsRepo.event;
      projectsRepo.event = async () => {
        throw new Error('controlled transaction failure');
      };
      try {
        await mutate(
          owner,
          `${path}/documents/${document.id}`,
          { title: 'Not committed', content: emptyDocument, version: 3 },
          'patch',
        ).expect(503);
      } finally {
        projectsRepo.event = event;
      }
      assert.equal((await repo.models.documents.findById(document.id).lean())!.version, 3);
      assert.equal(await repo.models.revisions.countDocuments({ documentId: document.id }), 3);
    },
  );
  await check('read-only guests cannot create, edit, restore or remove documents', async () => {
    assert.equal(
      documentSchema.parse(
        (await guest.agent.get(`${path}/documents/${document.id}`).expect(200)).body.data,
      ).canWrite,
      false,
    );
    await mutate(guest, `${path}/documents`, create()).expect(403);
    await mutate(
      guest,
      `${path}/documents/${document.id}`,
      { title: 'x', content: emptyDocument, version: 3 },
      'patch',
    ).expect(403);
    await mutate(guest, `${path}/documents/${document.id}`, { version: 3 }, 'delete').expect(403);
  });
  const data = Buffer.from('Real private bytes.\nProject context persists.'),
    metadata = (name = 'notes.txt') => ({ name, type: 'text/plain', clientId: randomUUID() }),
    upload = (actor: Identity, input: Record<string, string>, bytes = data) =>
      actor.agent
        .post(`${path}/files`)
        .query(input)
        .set('Origin', origin)
        .set('X-CSRF-Token', actor.csrf)
        .set('Content-Type', 'application/octet-stream')
        .send(bytes);
  let file: ReturnType<typeof fileSchema.parse>;
  await check(
    'authenticated binary uploads persist actual private bytes and original metadata',
    async () => {
      file = fileSchema.parse((await upload(owner, metadata()).expect(201)).body.data);
      assert.equal(file.size, data.length);
      const row = await repo.models.files.findById(file.id).lean();
      assert((await actual.get(row!.objectKey)).equals(data));
      assert.equal(
        await projectsRepo.models.events.countDocuments({
          projectId: project.id,
          action: 'uploaded file',
        }),
        1,
      );
    },
  );
  await check(
    'raw uploads require exact Origin, CSRF and binary content type before body parsing',
    async () => {
      await owner.agent
        .post(`${path}/files`)
        .query(metadata())
        .set('Origin', origin)
        .set('Content-Type', 'application/octet-stream')
        .send(data)
        .expect(403);
      await upload(owner, metadata()).set('Origin', 'https://other.test').expect(403);
      await mutate(owner, `${path}/files`, {}).expect(415);
      await upload(guest, metadata()).expect(403);
    },
  );
  await check(
    'file validation rejects unsupported content, paths, forged MIME and oversized bytes',
    async () => {
      await upload(owner, metadata('../secret.txt')).expect(400);
      await upload(owner, { ...metadata('image.png'), type: 'image/png' }).expect(422);
      await upload(owner, metadata(), Buffer.from([255, 254])).expect(422);
      await upload(owner, metadata(), Buffer.alloc(8 * 1024 * 1024 + 1)).expect(413);
    },
  );
  await check(
    'private content downloads recheck access and return safe no-store binary headers',
    async () => {
      const response = await owner.agent
        .get(`${path}/files/${file.id}/content?download=1`)
        .expect(200);
      assert.equal(response.text, data.toString());
      assert.match(response.headers['content-disposition'], /^attachment/);
      assert.match(response.headers['cache-control'], /no-store/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      await outsider.agent.get(`${path}/files/${file.id}/content`).expect(404);
      await owner.agent.get(`${base}/${foreign.id}/files/${file.id}/content`).expect(404);
    },
  );
  await check(
    'retry identities prevent duplicate file bytes, metadata and upload activity',
    async () => {
      const input = metadata('retry.txt'),
        a = fileSchema.parse((await upload(owner, input).expect(201)).body.data),
        b = fileSchema.parse((await upload(owner, input).expect(201)).body.data);
      assert.equal(a.id, b.id);
      await upload(owner, input, Buffer.from('Different content')).expect(409);
      assert.equal(
        await projectsRepo.models.events.countDocuments({
          projectId: project.id,
          action: 'uploaded file',
          targetName: 'retry.txt',
        }),
        1,
      );
    },
  );
  await check(
    'unavailable storage keeps a durable pending intent and a same-identifier retry finalizes it',
    async () => {
      const input = metadata('pending.txt');
      failPut = true;
      try {
        await upload(owner, input).expect(503);
      } finally {
        failPut = false;
      }
      const pending = await repo.models.files
        .findOne({ projectId: project.id, clientId: input.clientId })
        .lean();
      assert.equal(pending!.status, 'pending');
      await owner.agent.get(`${path}/files/${pending!._id}/content`).expect(404);
      const result = fileSchema.parse((await upload(owner, input).expect(201)).body.data);
      assert.equal(result.id, String(pending!._id));
      assert.equal((await repo.models.files.findById(result.id).lean())!.status, 'ready');
    },
  );
  await check(
    'failed finalization activity leaves no served object and retries safely without duplicate events',
    async () => {
      const input = metadata('finalize.txt'),
        event = projectsRepo.event;
      projectsRepo.event = async () => {
        throw new Error('controlled finalization failure');
      };
      try {
        await upload(owner, input).expect(503);
      } finally {
        projectsRepo.event = event;
      }
      const pending = await repo.models.files
        .findOne({ clientId: input.clientId, projectId: project.id })
        .lean();
      assert.equal(pending!.status, 'pending');
      await owner.agent.get(`${path}/files/${pending!._id}`).expect(404);
      await upload(owner, input).expect(201);
      assert.equal(
        await projectsRepo.models.events.countDocuments({
          projectId: project.id,
          action: 'uploaded file',
          targetName: 'finalize.txt',
        }),
        1,
      );
    },
  );
  await check('task and document attachments verify current same-project parents', async () => {
    const task = taskSchema.parse(
      (
        await mutate(owner, `${path}/tasks`, {
          title: 'Review attachments',
          description: '',
          status: 'todo',
          priority: 'normal',
          dueDate: null,
          ownerId: ids[0],
          assigneeIds: [],
          labelIds: [],
          checklist: [],
          parentId: null,
        }).expect(201)
      ).body.data,
    );
    const taskFile = fileSchema.parse(
        (await upload(owner, { ...metadata('task.txt'), taskId: task.id }).expect(201)).body.data,
      ),
      docFile = fileSchema.parse(
        (await upload(owner, { ...metadata('document.txt'), documentId: document.id }).expect(201))
          .body.data,
      );
    assert.equal(taskFile.taskId, task.id);
    assert.equal(docFile.documentId, document.id);
    await upload(owner, { ...metadata(), taskId: task.id, documentId: document.id }).expect(400);
    await owner.agent.get(`${base}/${foreign.id}/files?documentId=${document.id}`).expect(404);
    await mutate(owner, `${path}/tasks/${task.id}`, { version: task.version }, 'delete').expect(
      200,
    );
    await owner.agent.get(`${path}/files/${taskFile.id}/content`).expect(404);
    assert(
      !fileListSchema
        .parse((await owner.agent.get(`${path}/files`).expect(200)).body.data)
        .files.some((value) => value.id === taskFile.id),
    );
  });
  await check(
    'renames and removals require author or manager rights and original versions',
    async () => {
      await mutate(
        member,
        `${path}/files/${file.id}`,
        { name: 'member.txt', version: 1 },
        'patch',
      ).expect(403);
      file = fileSchema.parse(
        (
          await mutate(
            owner,
            `${path}/files/${file.id}`,
            { name: 'renamed.txt', version: 1 },
            'patch',
          ).expect(200)
        ).body.data,
      );
      await mutate(
        owner,
        `${path}/files/${file.id}`,
        { name: 'stale.txt', version: 1 },
        'patch',
      ).expect(409);
      await mutate(
        owner,
        `${path}/files/${file.id}`,
        { name: 'wrong.pdf', version: 2 },
        'patch',
      ).expect(422);
    },
  );
  await check(
    'deleted metadata immediately hides private bytes when storage cleanup fails, then reconciliation deletes them',
    async () => {
      const row = await repo.models.files.findById(file.id).lean();
      failRemove = true;
      try {
        assert.equal(
          (await mutate(owner, `${path}/files/${file.id}`, { version: 2 }, 'delete').expect(200))
            .body.data.cleanupPending,
          true,
        );
      } finally {
        failRemove = false;
      }
      await owner.agent.get(`${path}/files/${file.id}/content`).expect(404);
      await service.reconcile();
      await assert.rejects(actual.get(row!.objectKey));
    },
  );
  await check(
    'fresh storage instances and database connections retain the actual durable file',
    async () => {
      const row = await repo.models.files
        .findOne({ projectId: project.id, status: 'ready' })
        .lean();
      const fresh =
        env.FILE_STORAGE_DRIVER === 's3' ? new S3Storage(env) : new DiskStorage(storageRoot);
      assert((await fresh.get(row!.objectKey)).equals(data));
      if (env.FILE_STORAGE_DRIVER === 's3') {
        const response = await fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${row!.objectKey}`);
        assert.equal(response.status, 403);
      }
      const freshDb = await mongoose
        .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
        .asPromise();
      try {
        assert.equal(
          await freshDb.db
            .collection('document_revisions')
            .countDocuments({ documentId: new mongoose.Types.ObjectId(document.id) }),
          3,
        );
      } finally {
        await freshDb.close();
      }
    },
  );
  await check(
    'membership revoked during storage read prevents returning file content',
    async () => {
      const own = fileSchema.parse(
        (await upload(owner, metadata('revocation.txt')).expect(201)).body.data,
      );
      afterRead = async () => {
        await tenantRepo.models.workspaceMemberships.deleteOne({ workspaceId: ws, userId: ids[1] });
      };
      try {
        await member.agent.get(`${path}/files/${own.id}/content`).expect(404);
      } finally {
        afterRead = undefined;
        await tenantRepo.models.workspaceMemberships.create({
          organizationId: org,
          workspaceId: ws,
          userId: ids[1],
        });
      }
    },
  );
  await check('archived projects keep readable documents/files and reject all writes', async () => {
    await projectsRepo.models.projects.updateOne({ _id: project.id }, { $set: { archived: true } });
    try {
      await owner.agent.get(`${path}/documents/${document.id}`).expect(200);
      await mutate(owner, `${path}/documents`, create()).expect(409);
      await upload(owner, metadata()).expect(409);
    } finally {
      await projectsRepo.models.projects.updateOne(
        { _id: project.id },
        { $set: { archived: false } },
      );
    }
  });
  await check(
    'current membership revocation hides documents, revisions and file lists',
    async () => {
      await tenantRepo.models.workspaceMemberships.deleteOne({ workspaceId: ws, userId: ids[1] });
      try {
        await member.agent.get(`${path}/documents`).expect(404);
        await member.agent.get(`${path}/documents/${document.id}/history`).expect(404);
        await member.agent.get(`${path}/files`).expect(404);
      } finally {
        await tenantRepo.models.workspaceMemberships.create({
          organizationId: org,
          workspaceId: ws,
          userId: ids[1],
        });
      }
    },
  );
  await check(
    'document removal hides retained revisions and attachments and reconciliation cleans orphan objects',
    async () => {
      await mutate(
        member,
        `${path}/documents/${document.id}`,
        { version: document.version },
        'delete',
      ).expect(403);
      await mutate(
        owner,
        `${path}/documents/${document.id}`,
        { version: document.version },
        'delete',
      ).expect(200);
      await owner.agent.get(`${path}/documents/${document.id}/history`).expect(404);
      const attached = await repo.models.files
        .findOne({ documentId: document.id, status: 'ready' })
        .lean();
      await owner.agent.get(`${path}/files/${attached!._id}/content`).expect(404);
      await service.reconcile();
      await assert.rejects(actual.get(attached!.objectKey));
      assert.equal(await repo.models.revisions.countDocuments({ documentId: document.id }), 3);
    },
  );
  await check(
    'file pagination covers real stored objects and literal filters without duplicates',
    async () => {
      const window = Math.floor(Date.now() / 60000);
      await authRepo.models.rateLimits.deleteMany({
        _id: {
          $in: ids.flatMap((id) =>
            [window - 1, window].map((value) =>
              createHash('sha256').update(`library-mutations:${id}:${value}`).digest('hex'),
            ),
          ),
        },
      });
      for (let index = 0; index < 51; index++)
        await upload(owner, metadata(`page-${String(index).padStart(2, '0')}.txt`)).expect(201);
      const first = fileListSchema.parse(
        (await owner.agent.get(`${path}/files?q=page-&type=text`).expect(200)).body.data,
      );
      assert.equal(first.files.length, 50);
      assert.equal(first.total, 51);
      assert(first.nextCursor);
      const second = fileListSchema.parse(
        (
          await owner.agent
            .get(`${path}/files?q=page-&type=text&cursor=${first.nextCursor}`)
            .expect(200)
        ).body.data,
      );
      assert.equal(second.files.length, 1);
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.files, ...second.files].map((row) => row.id)).size, 51);
      const image = fileListSchema.parse(
        (await owner.agent.get(`${path}/files?q=page-&type=image`).expect(200)).body.data,
      );
      assert.equal(image.total, 0);
      await owner.agent.get(`${base}/${foreign.id}/files?cursor=${first.nextCursor}`).expect(404);
    },
  );
  await check('concurrent identical uploads commit one file and one upload event', async () => {
    const input = metadata('concurrent.txt');
    const responses = await Promise.all([
      upload(owner, input).expect(201),
      upload(owner, input).expect(201),
    ]);
    assert.equal(responses[0].body.data.id, responses[1].body.data.id);
    assert.equal(
      await repo.models.files.countDocuments({ projectId: project.id, clientId: input.clientId }),
      1,
    );
    const row = await repo.models.files
      .findOne({ projectId: project.id, clientId: input.clientId })
      .lean();
    assert.deepEqual(await actual.get(row!.objectKey), data);
    assert.equal(
      await projectsRepo.models.events.countDocuments({
        projectId: project.id,
        action: 'uploaded file',
        targetName: 'concurrent.txt',
      }),
      1,
    );
  });
  await check('deleted projects cannot expose retained documents or files', async () => {
    await projectsRepo.models.projects.updateOne(
      { _id: project.id },
      { $set: { deletedAt: new Date() } },
    );
    await owner.agent.get(`${path}/documents`).expect(404);
    await owner.agent.get(`${path}/files`).expect(404);
  });
  console.log(
    `Phase 9 integration: ${results.length} checks passed using ${env.FILE_STORAGE_DRIVER} storage.`,
  );
} finally {
  const rows = await repo.models.files.find({ organizationId: { $in: orgs } }).lean();
  for (const row of rows) await actual.remove(row.objectKey).catch(() => {});
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
  await cleanupBillingFixtures(uri, orgs);
  await connection.close();
  if (env.FILE_STORAGE_DRIVER === 'disk') {
    if (dirname(storageRoot) !== parent) throw new Error('Unsafe isolated cleanup');
    await rm(storageRoot, { recursive: true, force: true });
  }
}
