import { cleanupBillingFixtures } from '../support/billing-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  apiErrorSchema,
  projectSchema,
  taskSchema,
  taskListSchema,
  activityListSchema,
  workPreferencesSchema,
  savedFilterSchema,
  savedFilterListSchema,
  defaultWorkPreferences,
  type ProjectInput,
  type TaskInput,
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
import { WorkViewRepository } from '../../apps/api/src/modules/views/repository.js';
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
assert(/^\/orbit_test(?:_[a-z0-9]+)?$/.test(target.pathname));
const connection = await mongoose
  .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
  .asPromise();
const authRepo = new MongoAuthRepository(connection, async () => true);
const tenantRepo = new MongoTenantRepository(connection);
const tenants = new TenantService(tenantRepo);
const repo = new ProjectRepository(tenantRepo);
const projects = new ProjectService(repo);
const views = new WorkViewRepository(repo);
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
  tenants,
  undefined,
  projects,
);
const run = randomUUID();
const password = `Project fixture ${run}`;
const users = Array.from({ length: 8 }, (_, index) => ({
  _id: new Types.ObjectId(),
  email: `project-${run}-${index}@example.test`,
  name: `Project person ${index}`,
}));
const ids: string[] = users.map((user) => String(user._id));
const orgIds: string[] = [];
const results: string[] = [];
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
const mutate = (
  actor: Identity,
  route: string,
  input: unknown = {},
  method: 'post' | 'patch' | 'delete' = 'post',
) => actor.agent[method](route).set('Origin', origin).set('X-CSRF-Token', actor.csrf).send(input);
async function check(name: string, operation: () => Promise<void>) {
  await clearTestLoopbackLimits(connection.db);
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;
try {
  await authRepo.ready();
  await projects.ready();
  await clearTestLoopbackLimits(connection.db);
  const passwordHash = await hashPassword(password);
  await authRepo.models.users.create(
    users.map((user, index) => ({
      ...user,
      passwordHash,
      emailVerified: index !== 6,
      onboardingCompleted: index !== 7,
    })),
  );
  const identities: Identity[] = [];
  for (let index = 0; index < users.length; index++) identities.push(await login(index));
  const owner = identities[0]!;
  const member = identities[2]!;
  const guest = identities[3]!;
  const outsider = identities[4]!;
  const org = (await tenants.create(ids[0]!, { name: 'Project fixture', description: '' })).id;
  orgIds.push(org);
  const foreign = (
    await tenants.create(ids[4]!, { name: 'Foreign project fixture', description: '' })
  ).id;
  orgIds.push(foreign);
  const ws = (
    await tenants.createWorkspace(ids[0]!, org, {
      name: 'Project studio',
      description: '',
      timezone: 'UTC',
    })
  ).id;
  const foreignWs = (
    await tenants.createWorkspace(ids[4]!, foreign, {
      name: 'Foreign studio',
      description: '',
      timezone: 'UTC',
    })
  ).id;
  const scope = { organizationId: org, workspaceId: ws };
  await tenantRepo.models.organizationMemberships.create(
    [1, 2, 3, 5].map((index) => ({
      organizationId: org,
      userId: ids[index],
      role:
        index === 1 ? 'project-manager' : index === 3 ? 'guest' : index === 5 ? 'admin' : 'member',
    })),
  );
  await tenantRepo.models.workspaceMemberships.create(
    [1, 2, 3].map((index) => ({ ...scope, userId: ids[index] })),
  );
  const base = `/api/v1/organizations/${org}/workspaces/${ws}/projects`;
  const input: ProjectInput = {
    name: 'Release orbit',
    description: 'A real project',
    status: 'active',
    priority: 'high',
    cover: 'aurora',
    ownerId: ids[0]!,
    memberIds: [ids[2]!, ids[3]!],
    template: 'blank',
  };
  const project = projectSchema.parse((await mutate(owner, base, input).expect(201)).body.data);
  const path = `${base}/${project.id}`;
  const get = async () => projectSchema.parse((await owner.agent.get(path).expect(200)).body.data);
  const taskInput: TaskInput = {
    title: 'Ship the outcome',
    description: 'Prepare a focused release',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-01-01',
    ownerId: ids[2]!,
    assigneeIds: [ids[0]!, ids[2]!],
    labelIds: [],
    checklist: [{ text: 'Review security', done: false }],
    parentId: null,
  };
  let task = taskSchema.parse(
    (await mutate(member, `${path}/tasks`, taskInput).expect(201)).body.data,
  );
  const preferencesPath = `${path}/view-preferences`;
  const filtersPath = `${path}/saved-filters`;
  const criteria = { view: 'table', sort: 'title', group: 'status', filters: { priority: 'high' } };
  await views.ready();
  await check('default preferences are private and do not create records', async () => {
    const response = await owner.agent.get(preferencesPath).expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.body.meta.requestId);
    assert.deepEqual(workPreferencesSchema.parse(response.body.data), {
      ...defaultWorkPreferences,
      version: 0,
    });
    assert.equal(await views.models.preferences.countDocuments({ projectId: project.id }), 0);
  });
  await check('authentication, verification and onboarding gate personal views', async () => {
    await request(app).get(preferencesPath).expect(401);
    await identities[6]!.agent.get(preferencesPath).expect(403);
    await identities[7]!.agent.get(preferencesPath).expect(403);
    await outsider.agent.get(preferencesPath).expect(404);
  });
  await check('CSRF and strict inputs reject forged preference writes', async () => {
    await owner.agent
      .patch(preferencesPath)
      .send({ ...defaultWorkPreferences, version: 0 })
      .expect(403);
    await mutate(
      owner,
      preferencesPath,
      { ...defaultWorkPreferences, version: 0, userId: ids[3] },
      'patch',
    ).expect(400);
    await mutate(owner, filtersPath, {
      name: 'Unsafe',
      criteria: { ...criteria, filters: { cursor: task.id } },
    }).expect(400);
    await mutate(owner, `${path}/tasks/${task.id}/move`, {
      version: 1,
      status: 'done',
      title: 'Overwrite',
    }).expect(400);
  });
  await check('preferences persist per actor and project', async () => {
    const response = await mutate(
      owner,
      preferencesPath,
      { ...defaultWorkPreferences, view: 'table', density: 'compact', version: 0 },
      'patch',
    ).expect(200);
    assert.equal(workPreferencesSchema.parse(response.body.data).version, 1);
    assert.equal((await guest.agent.get(preferencesPath).expect(200)).body.data.version, 0);
    assert.equal(
      await views.models.preferences.countDocuments({
        userId: ids[0],
        projectId: project.id,
        ...scope,
      }),
      1,
    );
  });
  await check('concurrent preference writes reject stale versions', async () => {
    await mutate(owner, preferencesPath, { ...defaultWorkPreferences, version: 0 }, 'patch').expect(
      409,
    );
    const responses = await Promise.all(
      ['list', 'calendar'].map((view) =>
        mutate(owner, preferencesPath, { ...defaultWorkPreferences, view, version: 1 }, 'patch'),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await owner.agent.get(preferencesPath)).body.data.version, 2);
  });
  await check('guests save personal preferences but cannot move tasks', async () => {
    await mutate(
      guest,
      preferencesPath,
      { ...defaultWorkPreferences, view: 'kanban', version: 0 },
      'patch',
    ).expect(200);
    await mutate(guest, `${path}/tasks/${task.id}/move`, {
      version: task.version,
      status: 'done',
    }).expect(403);
  });
  await check('foreign organization, workspace and project paths remain inaccessible', async () => {
    await owner.agent.get(preferencesPath.replace(ws, foreignWs)).expect(404);
    await owner.agent.get(filtersPath.replace(org, foreign)).expect(404);
    await owner.agent
      .get(preferencesPath.replace(project.id, String(new Types.ObjectId())))
      .expect(404);
    await owner.agent.get(preferencesPath.replace(project.id, 'malformed')).expect(400);
  });
  let saved = savedFilterSchema.parse(
    (await mutate(owner, filtersPath, { name: 'Release table', criteria }).expect(201)).body.data,
  );
  await check('saved filters are owned by the authenticated user', async () => {
    const empty = savedFilterSchema.parse(
      (
        await mutate(guest, filtersPath, {
          name: 'Unfiltered board',
          criteria: { view: 'kanban', sort: 'oldest', group: 'none', filters: {} },
        }).expect(201)
      ).body.data,
    );
    assert.deepEqual(empty.criteria.filters, {});
    assert.deepEqual((await views.models.filters.findById(empty.id).lean())!.criteria.filters, {});
    savedFilterListSchema.parse((await guest.agent.get(filtersPath).expect(200)).body.data);
    assert.equal(
      savedFilterListSchema.parse((await owner.agent.get(filtersPath)).body.data).filters.length,
      1,
    );
    assert.equal((await member.agent.get(filtersPath).expect(200)).body.data.filters.length, 0);
    await mutate(
      member,
      `${filtersPath}/${saved.id}`,
      { name: 'Stolen filter', criteria, version: 1 },
      'patch',
    ).expect(404);
    await mutate(guest, `${filtersPath}/${saved.id}`, { version: 1 }, 'delete').expect(404);
  });
  await check('filter names are case-insensitively unique within an actor project', async () => {
    assert.equal(
      errorCode(
        (await mutate(owner, filtersPath, { name: 'RELEASE TABLE', criteria }).expect(422)).body,
      ),
      'FILTER_NAME_USED',
    );
    await mutate(guest, filtersPath, { name: 'Release table', criteria }).expect(201);
  });
  await check('saved-filter update and deletion require original versions', async () => {
    saved = savedFilterSchema.parse(
      (
        await mutate(
          owner,
          `${filtersPath}/${saved.id}`,
          { name: 'Release updated', criteria, version: 1 },
          'patch',
        ).expect(200)
      ).body.data,
    );
    assert.equal(saved.version, 2);
    await mutate(
      owner,
      `${filtersPath}/${saved.id}`,
      { name: 'Stale update', criteria, version: 1 },
      'patch',
    ).expect(409);
    await mutate(owner, `${filtersPath}/${saved.id}`, { version: 1 }, 'delete').expect(409);
    await mutate(owner, `${filtersPath}/${saved.id}`, { version: 2 }, 'delete').expect(200);
    await owner.agent.get(`${path}/tasks/${task.id}`).expect(200);
  });
  await check('concurrent filter creation enforces the twenty-filter bound', async () => {
    for (let index = 0; index < 19; index++)
      await mutate(owner, filtersPath, { name: `Filter ${index}`, criteria }).expect(201);
    const responses = await Promise.all(
      ['Final A', 'Final B'].map((name) => mutate(owner, filtersPath, { name, criteria })),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 422]);
    assert.equal((await owner.agent.get(filtersPath)).body.data.filters.length, 20);
  });
  const taskGet = async () =>
    taskSchema.parse((await owner.agent.get(`${path}/tasks/${task.id}`).expect(200)).body.data);
  await check('partial moves preserve assignments, description and checklist', async () => {
    const old = task;
    task = taskSchema.parse(
      (
        await mutate(member, `${path}/tasks/${task.id}/move`, {
          version: task.version,
          status: 'in-progress',
          dueDate: '2026-10-02',
        }).expect(200)
      ).body.data,
    );
    assert.equal(task.version, old.version + 1);
    for (const key of [
      'title',
      'description',
      'ownerId',
      'assigneeIds',
      'checklist',
      'parentId',
    ] as const)
      assert.deepEqual(task[key], old[key]);
    const activity = activityListSchema.parse(
      (await owner.agent.get(`${path}/activity`).expect(200)).body.data,
    );
    assert.ok(activity.events.some((event) => event.action === 'moved task'));
  });
  await check('no-op moves create neither a task version nor an event', async () => {
    const count = await repo.models.events.countDocuments({ projectId: project.id });
    const response = await mutate(owner, `${path}/tasks/${task.id}/move`, {
      version: task.version,
      status: task.status,
    }).expect(200);
    assert.equal(response.body.data.version, task.version);
    assert.equal(await repo.models.events.countDocuments({ projectId: project.id }), count);
  });
  await check('concurrent task moves commit once with one activity event', async () => {
    const count = await repo.models.events.countDocuments({ projectId: project.id });
    const responses = await Promise.all(
      ['blocked', 'done'].map((status) =>
        mutate(owner, `${path}/tasks/${task.id}/move`, { version: task.version, status }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await repo.models.events.countDocuments({ projectId: project.id }), count + 1);
    task = await taskGet();
  });
  await check('activity failure rolls back task movement', async () => {
    const create = repo.models.events.create;
    repo.models.events.create = (() => {
      throw new Error('Test activity persistence failure');
    }) as typeof create;
    try {
      await assert.rejects(
        repo.moveTask(ids[0]!, scope, project.id, task.id, {
          version: task.version,
          dueDate: null,
        }),
      );
    } finally {
      repo.models.events.create = create;
    }
    assert.deepEqual(await taskGet(), task);
  });
  await check('archived projects reject moves and retain personal settings', async () => {
    await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: true } });
    await mutate(owner, `${path}/tasks/${task.id}/move`, {
      version: task.version,
      status: 'todo',
    }).expect(409);
    await owner.agent.get(preferencesPath).expect(200);
    await mutate(guest, preferencesPath, { ...defaultWorkPreferences, version: 1 }, 'patch').expect(
      200,
    );
    await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: false } });
  });
  await check('revoked project grants also revoke personal view access', async () => {
    await repo.models.projects.updateOne(
      { _id: project.id },
      { $pull: { memberIds: new Types.ObjectId(ids[3]) } },
    );
    await guest.agent.get(preferencesPath).expect(404);
    await guest.agent.get(filtersPath).expect(404);
    await mutate(guest, preferencesPath, { ...defaultWorkPreferences, version: 2 }, 'patch').expect(
      404,
    );
    await repo.models.projects.updateOne(
      { _id: project.id },
      { $addToSet: { memberIds: new Types.ObjectId(ids[3]) } },
    );
  });
  await check('revoked workspace membership overrides stored view preferences', async () => {
    await tenantRepo.models.workspaceMemberships.deleteOne({ ...scope, userId: ids[3] });
    await guest.agent.get(preferencesPath).expect(404);
    await mutate(guest, filtersPath, { name: 'Revoked', criteria }).expect(404);
    await tenantRepo.models.workspaceMemberships.create({ ...scope, userId: ids[3] });
  });
  await check(
    'calendar filtering uses inclusive UTC bounds and separate undated tasks',
    async () => {
      for (const [title, dueDate, status] of [
        ['Boundary first', '2026-10-01', 'todo'],
        ['Boundary last', '2026-10-31', 'done'],
        ['Outside month', '2026-11-01', 'todo'],
        ['Undated work', null, 'todo'],
      ] as const)
        await repo.saveTask(ids[0]!, scope, project.id, { ...taskInput, title, dueDate, status });
      const response = await owner.agent
        .get(`${path}/tasks?dueFrom=2026-10-01&dueTo=2026-10-31`)
        .expect(200);
      const data = taskListSchema.parse(response.body.data);
      assert.equal(data.total, 3);
      assert.ok(data.tasks.some((row) => row.dueDate === '2026-10-01'));
      assert.ok(data.tasks.some((row) => row.dueDate === '2026-10-31'));
      assert.equal((await owner.agent.get(`${path}/tasks?undated=true`)).body.data.total, 1);
      await owner.agent.get(`${path}/tasks?undated=true&dueFrom=2026-10-01`).expect(400);
      await owner.agent.get(`${path}/tasks?dueFrom=2026-10-31&dueTo=2026-10-01`).expect(400);
      const overdue = taskListSchema.parse(
        (await owner.agent.get(`${path}/tasks?overdue=true`)).body.data,
      );
      assert.ok(
        overdue.tasks.every(
          (row) =>
            row.status !== 'done' &&
            row.dueDate &&
            row.dueDate < new Date().toISOString().slice(0, 10),
        ),
      );
    },
  );
  await check('all sort orders paginate without duplicate or missing task IDs', async () => {
    const now = new Date();
    await repo.models.tasks.insertMany(
      Array.from({ length: 57 }, (_, index) => ({
        ...scope,
        projectId: project.id,
        ...taskInput,
        title: `Page ${String(index % 9).padStart(2, '0')}`,
        priority: index % 2 ? 'low' : 'urgent',
        dueDate: index % 3 ? '2026-10-15' : null,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
    );
    for (const sort of ['oldest', 'newest', 'title', 'priority', 'due-date', 'status']) {
      const found: string[] = [];
      const loaded: (typeof task)[] = [];
      let cursor: string | null = null;
      do {
        const result = taskListSchema.parse(
          (
            await owner.agent
              .get(`${path}/tasks?sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`)
              .expect(200)
          ).body.data,
        );
        assert.equal(result.total, 62);
        found.push(...result.tasks.map((row) => row.id));
        loaded.push(...result.tasks);
        cursor = result.nextCursor;
      } while (cursor);
      assert.equal(found.length, 62);
      assert.equal(new Set(found).size, 62);
      const score = (row: typeof task) =>
        sort === 'title'
          ? row.title.toLowerCase()
          : sort === 'due-date'
            ? (row.dueDate ?? '9999-12-32')
            : sort === 'priority'
              ? ['urgent', 'high', 'normal', 'low', 'none'].indexOf(row.priority)
              : sort === 'status'
                ? ['todo', 'in-progress', 'blocked', 'done'].indexOf(row.status)
                : row.id;
      const expected = [...loaded].sort((left, right) => {
        const a = score(left),
          b = score(right);
        const order = a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id);
        return sort === 'newest' ? -order : order;
      });
      assert.deepEqual(
        found,
        expected.map((row) => row.id),
      );
    }
  });
  await check('changed or foreign pagination anchors return a safe reload conflict', async () => {
    const first = taskListSchema.parse(
      (await owner.agent.get(`${path}/tasks?sort=title`)).body.data,
    );
    assert.ok(first.nextCursor);
    const response = await owner.agent
      .get(`${path}/tasks?sort=title&q=does-not-match&cursor=${first.nextCursor}`)
      .expect(409);
    assert.equal(errorCode(response.body), 'TASK_PAGE_CHANGED');
    await owner.agent.get(`${path}/tasks?cursor=${new Types.ObjectId()}`).expect(409);
  });
  await check('root and subtask filters share accurate collection totals', async () => {
    await repo.saveTask(ids[0]!, scope, project.id, {
      ...taskInput,
      title: 'Child work',
      parentId: task.id,
    });
    assert.equal((await owner.agent.get(`${path}/tasks?parent=root`)).body.data.total, 62);
    assert.equal((await owner.agent.get(`${path}/tasks?parent=${task.id}`)).body.data.total, 1);
  });
  await check('preferences, filters and moves survive a fresh database connection', async () => {
    const fresh = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
      .asPromise();
    try {
      assert.equal(
        (
          await fresh.collection('work_preferences').findOne({
            userId: new Types.ObjectId(ids[0]),
            projectId: new Types.ObjectId(project.id),
          })
        ).version,
        2,
      );
      assert.equal(
        await fresh.collection('saved_task_filters').countDocuments({
          userId: new Types.ObjectId(ids[0]),
          projectId: new Types.ObjectId(project.id),
        }),
        20,
      );
      assert.equal(
        (await fresh.collection('tasks').findOne({ _id: new Types.ObjectId(task.id) })).version,
        task.version,
      );
    } finally {
      await fresh.close();
    }
  });
  await check('deleted projects make retained personal settings inaccessible', async () => {
    assert.equal((await get()).id, project.id);
    await repo.models.projects.updateOne({ _id: project.id }, { $set: { deletedAt: new Date() } });
    await owner.agent.get(preferencesPath).expect(404);
    await owner.agent.get(filtersPath).expect(404);
    await mutate(owner, `${path}/tasks/${task.id}/move`, {
      version: task.version,
      status: 'todo',
    }).expect(404);
  });
  console.log(`Phase 6 integration: ${results.length} checks passed.`);
} finally {
  for (const model of Object.values(views.models))
    await model.deleteMany({ organizationId: { $in: orgIds } });
  for (const model of Object.values(repo.models))
    await model.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.workspaceMemberships.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.organizationMemberships.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.workspaces.deleteMany({ organizationId: { $in: orgIds } });
  await tenantRepo.models.organizations.deleteMany({ _id: { $in: orgIds } });
  await authRepo.models.sessions.deleteMany({ userId: { $in: ids } });
  await authRepo.models.users.deleteMany({ _id: { $in: ids } });
  await clearTestLoopbackLimits(connection.db);
  await cleanupBillingFixtures(uri, orgIds);
  await connection.close();
}
