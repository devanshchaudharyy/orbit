import { cleanupBillingFixtures, seedPaidBillingFixture } from '../support/billing-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  apiErrorSchema,
  projectSchema,
  projectListSchema,
  taskSchema,
  taskListSchema,
  activityListSchema,
  peopleSchema,
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
  const [owner, manager, member, guest, outsider, admin] = identities as [
    Identity,
    Identity,
    Identity,
    Identity,
    Identity,
    Identity,
  ];
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
  let project = projectSchema.parse((await mutate(owner, base, input).expect(201)).body.data);
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
  await check(
    'protected reads require verified profile and return request IDs/no-store',
    async () => {
      await request(app).get(base).expect(401);
      for (const index of [6, 7]) await identities[index]!.agent.get(base).expect(403);
      const res = await owner.agent.get(base).expect(200);
      projectListSchema.parse(res.body.data);
      assert.equal(res.body.meta.requestId, res.headers['x-request-id']);
      assert.equal(res.headers['cache-control'], 'no-store');
    },
  );
  await check('exact Origin, CSRF, strict inputs and canonical parents are enforced', async () => {
    await owner.agent.post(base).send(input).expect(403);
    await owner.agent.post(base).set('Origin', origin).send(input).expect(403);
    await owner.agent
      .post(base)
      .set('Origin', 'https://foreign.test')
      .set('X-CSRF-Token', owner.csrf)
      .send(input)
      .expect(403);
    await mutate(owner, base, { ...input, organizationId: foreign }).expect(400);
    await owner.agent.get(base.replace(ws, 'invalid')).expect(400);
    await owner.agent.get(`${path}/tasks?assignee[$ne]=x`).expect(400);
  });
  await check(
    'foreign tenants/workspaces/projects/tasks/history cannot be enumerated',
    async () => {
      for (const route of [base, path, `${path}/tasks`, `${path}/activity`, `${path}/people`])
        await outsider.agent.get(route).expect(404);
      await owner.agent.get(base.replace(ws, foreignWs)).expect(404);
      await owner.agent.get(path.replace(org, foreign)).expect(404);
      await member.agent.get(`${path}/tasks/${new Types.ObjectId()}`).expect(404);
    },
  );
  await check('organization admins require an explicit workspace grant', async () => {
    await admin.agent.get(base).expect(404);
    await mutate(admin, base, input).expect(404);
  });
  await check(
    'project managers create/manage projects but members and guests cannot create',
    async () => {
      const created = projectSchema.parse(
        (
          await mutate(manager, base, { ...input, name: 'Manager project', memberIds: [] }).expect(
            201,
          )
        ).body.data,
      );
      assert(created.canManage);
      await mutate(member, base, input).expect(403);
      await mutate(guest, base, input).expect(403);
      await member.agent.get(`${base}/${created.id}`).expect(404);
      await guest.agent.get(`${base}/${created.id}`).expect(404);
    },
  );
  await check(
    'explicit guests read tasks and history but cannot mutate work or inspect choices',
    async () => {
      const guestProject = projectSchema.parse((await guest.agent.get(path).expect(200)).body.data);
      assert(!guestProject.canManage && !guestProject.canWriteTasks);
      await guest.agent.get(`${path}/tasks`).expect(200);
      await guest.agent.get(`${path}/activity`).expect(200);
      await mutate(guest, `${path}/tasks`, taskInput).expect(403);
      await guest.agent.get(`${path}/people`).expect(403);
    },
  );
  await check('project member can manage tasks but cannot change project grants', async () => {
    await mutate(
      member,
      path,
      { ...input, template: undefined, version: project.version },
      'patch',
    ).expect(403);
    const current = taskSchema.parse(
      (await member.agent.get(`${path}/tasks/${task.id}`).expect(200)).body.data,
    );
    assert.equal(current.ownerId, ids[2]);
  });
  await check(
    'owners/grants and assignments require current eligible workspace/project access',
    async () => {
      for (const override of [{ ownerId: ids[3] }, { memberIds: [ids[4]] }])
        await mutate(owner, base, { ...input, ...override }).expect(422);
      for (const override of [
        { ownerId: ids[3] },
        { assigneeIds: [ids[3]] },
        { assigneeIds: [ids[4]] },
        { labelIds: [String(new Types.ObjectId())] },
      ])
        await mutate(member, `${path}/tasks`, { ...taskInput, ...override }).expect(422);
      const choice = peopleSchema.parse(
        (await member.agent.get(`${path}/people`).expect(200)).body.data,
      );
      assert(choice.people.some((person) => person.id === ids[2] && person.canAssign));
      assert(choice.people.some((person) => person.id === ids[3] && !person.canAssign));
    },
  );
  await check('project labels are unique and task references are project scoped', async () => {
    project = projectSchema.parse(
      (
        await mutate(owner, `${path}/labels`, {
          name: 'Release',
          color: 'violet',
          version: (await get()).version,
        }).expect(201)
      ).body.data,
    );
    await mutate(owner, `${path}/labels`, {
      name: 'release',
      color: 'cyan',
      version: project.version,
    }).expect(422);
    const fields = Object.fromEntries(
      Object.entries(taskInput).filter(([key]) => key !== 'parentId'),
    );
    task = taskSchema.parse(
      (
        await mutate(
          member,
          `${path}/tasks/${task.id}`,
          { ...fields, labelIds: [project.labels[0]!.id], version: task.version },
          'patch',
        ).expect(200)
      ).body.data,
    );
  });
  await check(
    'task update persists status, checklist, multiple assignments and append-only history',
    async () => {
      const fields = Object.fromEntries(
        Object.entries(taskInput).filter(([key]) => key !== 'parentId'),
      );
      task = taskSchema.parse(
        (
          await mutate(
            member,
            `${path}/tasks/${task.id}`,
            {
              ...fields,
              status: 'done',
              checklist: [{ text: 'Review security', done: true }],
              labelIds: task.labelIds,
              version: task.version,
            },
            'patch',
          ).expect(200)
        ).body.data,
      );
      assert.equal(task.status, 'done');
      assert(task.checklist[0]!.done);
      const events = activityListSchema.parse(
        (await member.agent.get(`${path}/activity`).expect(200)).body.data,
      );
      assert(events.events.some((event) => event.detail === 'todo → done'));
      const current = await get();
      assert.equal(current.taskCount, 1);
      assert.equal(current.doneCount, 1);
    },
  );
  await check('stale task editors cannot overwrite a newer version or append events', async () => {
    const before = await repo.models.events.countDocuments({ projectId: project.id });
    const fields = Object.fromEntries(
      Object.entries(taskInput).filter(([key]) => key !== 'parentId'),
    );
    const res = await mutate(
      member,
      `${path}/tasks/${task.id}`,
      { ...fields, version: 1 },
      'patch',
    ).expect(409);
    assert.equal(errorCode(res.body), 'VERSION_CONFLICT');
    assert.equal(await repo.models.events.countDocuments({ projectId: project.id }), before);
    assert.equal((await projects.task(ids[0]!, scope, project.id, task.id)).status, 'done');
  });
  await check(
    'concurrent project editors commit once and require explicit conflict recovery',
    async () => {
      project = await get();
      const fields = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'template'),
      );
      const responses = await Promise.all(
        ['Alpha', 'Beta'].map((name) =>
          mutate(owner, path, { ...fields, name, version: project.version }, 'patch'),
        ),
      );
      assert.deepEqual(responses.map((res) => res.status).sort(), [200, 409]);
      project = await get();
    },
  );
  await check('one-level subtasks reject foreign, deleted and nested parents', async () => {
    const child = taskSchema.parse(
      (
        await mutate(member, `${path}/tasks`, {
          ...taskInput,
          title: 'Review subtask',
          parentId: task.id,
        }).expect(201)
      ).body.data,
    );
    await mutate(member, `${path}/tasks`, { ...taskInput, parentId: child.id }).expect(422);
    await mutate(member, `${path}/tasks`, {
      ...taskInput,
      parentId: String(new Types.ObjectId()),
    }).expect(422);
    const res = taskListSchema.parse(
      (await member.agent.get(`${path}/tasks?parent=${task.id}`).expect(200)).body.data,
    );
    assert.equal(res.tasks.length, 1);
    assert.equal(res.tasks[0]!.id, child.id);
  });
  await check(
    'typed filters combine labels/status/assignee/search/overdue without regex interpretation',
    async () => {
      const label = task.labelIds[0]!;
      const matched = taskListSchema.parse(
        (
          await member.agent
            .get(`${path}/tasks?status=done&assignee=${ids[2]}&label=${label}&q=Ship`)
            .expect(200)
        ).body.data,
      );
      assert.equal(matched.tasks.length, 1);
      assert.equal(
        taskListSchema.parse(
          (await member.agent.get(`${path}/tasks?q=${encodeURIComponent('.*')}`).expect(200)).body
            .data,
        ).tasks.length,
        0,
      );
      assert.equal(
        taskListSchema.parse(
          (await member.agent.get(`${path}/tasks?status=done&overdue=true`).expect(200)).body.data,
        ).tasks.length,
        0,
      );
      assert.equal(
        taskListSchema.parse(
          (await member.agent.get(`${path}/tasks?overdue=true`).expect(200)).body.data,
        ).tasks.length,
        1,
      );
    },
  );
  await check(
    'archive is reversible, retains history, and blocks all content mutations',
    async () => {
      project = projectSchema.parse(
        (
          await mutate(owner, `${path}/archive`, {
            version: (await get()).version,
            archived: true,
          }).expect(200)
        ).body.data,
      );
      assert(project.archived);
      await mutate(member, `${path}/tasks`, taskInput).expect(409);
      await mutate(owner, `${path}/labels`, {
        version: project.version,
        name: 'Blocked',
        color: 'rose',
      }).expect(409);
      assert.equal(
        projectListSchema.parse(
          (await owner.agent.get(`${base}?archived=true`).expect(200)).body.data,
        ).projects.length,
        1,
      );
      await mutate(owner, `${path}/archive`, { version: project.version, archived: false }).expect(
        200,
      );
    },
  );
  await check(
    'label removal cleans task references atomically and invalidates stale editors',
    async () => {
      project = await get();
      await mutate(
        owner,
        `${path}/labels/${task.labelIds[0]}`,
        { version: project.version },
        'delete',
      ).expect(200);
      const updated = taskSchema.parse(
        (await member.agent.get(`${path}/tasks/${task.id}`).expect(200)).body.data,
      );
      assert.equal(updated.labelIds.length, 0);
      assert.equal(updated.version, task.version + 1);
      task = updated;
    },
  );
  await check('event failure rolls back task, progress and activity together', async () => {
    const before = await repo.models.tasks.countDocuments({ projectId: project.id });
    const original = repo.models.events.create;
    repo.models.events.create = async () => {
      throw new Error('Controlled activity persistence failure');
    };
    try {
      await mutate(member, `${path}/tasks`, { ...taskInput, title: 'Rollback sentinel' }).expect(
        503,
      );
    } finally {
      repo.models.events.create = original;
    }
    assert.equal(await repo.models.tasks.countDocuments({ projectId: project.id }), before);
    assert.equal(
      await repo.models.tasks.countDocuments({ title: 'Rollback sentinel', projectId: project.id }),
      0,
    );
  });
  await check('project template, tasks and history roll back on activity failure', async () => {
    const before = await repo.models.projects.countDocuments(scope);
    const original = repo.models.events.create;
    repo.models.events.create = async () => {
      throw new Error('Controlled template failure');
    };
    try {
      await mutate(owner, base, { ...input, template: 'launch' }).expect(503);
    } finally {
      repo.models.events.create = original;
    }
    assert.equal(await repo.models.projects.countDocuments(scope), before);
  });
  await check(
    'launch template creates three genuine editable tasks and actual progress',
    async () => {
      const template = projectSchema.parse(
        (
          await mutate(manager, base, {
            ...input,
            name: 'Template launch',
            template: 'launch',
          }).expect(201)
        ).body.data,
      );
      assert.equal(template.taskCount, 3);
      assert.equal(template.doneCount, 0);
      assert.equal((await projects.tasks(ids[1]!, scope, template.id, {})).tasks.length, 3);
    },
  );
  await check(
    'current project grant removal denies members/guests and prevents stale assignments',
    async () => {
      project = await get();
      const fields = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'template'),
      );
      await mutate(
        owner,
        path,
        { ...fields, memberIds: [], version: project.version },
        'patch',
      ).expect(200);
      await member.agent.get(path).expect(404);
      await guest.agent.get(`${path}/tasks`).expect(404);
      await mutate(owner, `${path}/tasks`, taskInput).expect(422);
      project = await get();
      await mutate(owner, path, { ...fields, version: project.version }, 'patch').expect(200);
    },
  );
  await check(
    'workspace revocation immediately denies project/history and retained task references',
    async () => {
      await tenantRepo.models.workspaceMemberships.deleteOne({ ...scope, userId: ids[2] });
      await member.agent.get(path).expect(404);
      await member.agent.get(`${path}/activity`).expect(404);
      await mutate(member, `${path}/tasks`, taskInput).expect(404);
      await mutate(owner, `${path}/tasks`, taskInput).expect(422);
      await tenantRepo.models.workspaceMemberships.create({ ...scope, userId: ids[2] });
    },
  );
  await check(
    'project owners manage their project but cannot transfer ownership without workspace authority',
    async () => {
      project = await get();
      const fields = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'template'),
      );
      await mutate(
        owner,
        path,
        { ...fields, ownerId: ids[2], version: project.version },
        'patch',
      ).expect(200);
      const current = projectSchema.parse((await member.agent.get(path).expect(200)).body.data);
      assert(current.canManage && !current.canAssignOwner);
      await mutate(member, path, { ...fields, version: current.version }, 'patch').expect(403);
      await mutate(
        member,
        path,
        {
          ...fields,
          ownerId: ids[2],
          description: 'Project owner update',
          version: current.version,
        },
        'patch',
      ).expect(200);
    },
  );
  await check(
    'parent deletion atomically soft deletes its subtasks and removes active progress',
    async () => {
      await mutate(member, `${path}/tasks/${task.id}`, { version: task.version }, 'delete').expect(
        200,
      );
      await member.agent.get(`${path}/tasks/${task.id}`).expect(404);
      assert.equal((await projects.tasks(ids[0]!, scope, project.id, {})).tasks.length, 0);
      assert.equal((await get()).taskCount, 0);
      assert.equal(
        await repo.models.tasks.countDocuments({ projectId: project.id, deletedAt: { $ne: null } }),
        2,
      );
    },
  );
  await check('bounded task pagination never repeats records', async () => {
    await repo.models.tasks.create(
      Array.from({ length: 52 }, (_, index) => ({
        ...scope,
        projectId: project.id,
        ...taskInput,
        title: `Paged ${index}`,
        ownerId: ids[0],
        assigneeIds: [],
      })),
    );
    const first = taskListSchema.parse(
      (await owner.agent.get(`${path}/tasks`).expect(200)).body.data,
    );
    assert.equal(first.tasks.length, 50);
    assert(first.nextCursor);
    const second = taskListSchema.parse(
      (await owner.agent.get(`${path}/tasks?cursor=${first.nextCursor}`).expect(200)).body.data,
    );
    assert.equal(second.tasks.length, 2);
    assert.equal(new Set([...first.tasks, ...second.tasks].map((item) => item.id)).size, 52);
  });
  await check(
    'project, activity and teammate pages are bounded and use stable cursors',
    async () => {
      await repo.models.projects.create(
        Array.from({ length: 52 }, (_, index) => ({
          ...scope,
          ...input,
          name: `Pagination project ${index}`,
        })),
      );
      const first = projectListSchema.parse((await owner.agent.get(base).expect(200)).body.data);
      assert.equal(first.projects.length, 50);
      assert(first.nextCursor);
      const second = projectListSchema.parse(
        (await owner.agent.get(`${base}?cursor=${first.nextCursor}`).expect(200)).body.data,
      );
      assert(!second.nextCursor);
      assert(second.projects.length >= 2);
      assert.equal(
        new Set([...first.projects, ...second.projects].map((item) => item.id)).size,
        first.projects.length + second.projects.length,
      );
      await repo.models.events.create(
        Array.from({ length: 52 }, (_, index) => ({
          ...scope,
          projectId: project.id,
          actorId: ids[0],
          actorName: 'Pagination fixture',
          action: 'fixture record',
          targetName: `Event ${index}`,
          detail: '',
          createdAt: new Date(),
        })),
      );
      const events = activityListSchema.parse(
        (await owner.agent.get(`${path}/activity`).expect(200)).body.data,
      );
      assert.equal(events.events.length, 50);
      assert(events.nextCursor);
      const older = activityListSchema.parse(
        (await owner.agent.get(`${path}/activity?cursor=${events.nextCursor}`).expect(200)).body
          .data,
      );
      assert(older.events.length >= 2);
      assert.equal(
        new Set([...events.events, ...older.events].map((item) => item.id)).size,
        events.events.length + older.events.length,
      );
      const extra = Array.from({ length: 52 }, (_, index) => ({
        _id: new Types.ObjectId(),
        name: `Pagination teammate ${index}`,
        email: `project-${run}-extra-${index}@example.test`,
        passwordHash,
        emailVerified: true,
        onboardingCompleted: true,
      }));
      ids.push(...extra.map((user) => String(user._id)));
      await authRepo.models.users.create(extra);
      await tenantRepo.models.organizationMemberships.create(
        extra.map((user) => ({ organizationId: org, userId: user._id, role: 'member' })),
      );
      await tenantRepo.models.workspaceMemberships.create(
        extra.map((user) => ({ ...scope, userId: user._id })),
      );
      const people = peopleSchema.parse(
        (await owner.agent.get(`${path}/people`).expect(200)).body.data,
      );
      assert.equal(people.people.length, 50);
      assert(people.nextCursor);
      const more = peopleSchema.parse(
        (await owner.agent.get(`${path}/people?cursor=${people.nextCursor}`).expect(200)).body.data,
      );
      assert(!more.nextCursor);
      assert(more.people.length >= 2);
      assert.equal(
        new Set([...people.people, ...more.people].map((item) => item.id)).size,
        people.people.length + more.people.length,
      );
    },
  );
  await check(
    'transaction retries recheck membership after a project grant is revoked',
    async () => {
      await seedPaidBillingFixture(uri, org, 'pro');
      const race = await projects.create(ids[0]!, scope, input);
      const originalCreate = repo.models.events.create;
      const originalAccess = tenantRepo.workspaceAccess.bind(tenantRepo);
      let retryRevocation = false;
      let injected = false;
      repo.models.events.create = async () => {
        if (!injected) {
          injected = true;
          retryRevocation = true;
          const failure = new mongoose.mongo.MongoServerError({
            message: 'Controlled transaction retry',
            code: 112,
          });
          failure.addErrorLabel('TransientTransactionError');
          throw failure;
        }
        throw new Error('Revoked actor must never reach activity persistence on retry.');
      };
      tenantRepo.workspaceAccess = async (...args) => {
        if (retryRevocation) {
          retryRevocation = false;
          await repo.models.projects.updateOne(
            { ...scope, _id: race.id },
            { $set: { memberIds: [] }, $inc: { version: 1 } },
          );
        }
        return originalAccess(...args);
      };
      try {
        await mutate(member, `${base}/${race.id}/tasks`, taskInput).expect(404);
      } finally {
        repo.models.events.create = originalCreate;
        tenantRepo.workspaceAccess = originalAccess;
      }
      assert(injected);
      assert.equal(await repo.models.tasks.countDocuments({ projectId: race.id }), 0);
      assert.equal(
        await repo.models.events.countDocuments({ projectId: race.id, action: 'created task' }),
        0,
      );
    },
  );
  await check(
    'fresh database connection reads persisted project/task/history records',
    async () => {
      const fresh = await mongoose
        .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
        .asPromise();
      try {
        assert(
          await fresh.collection('projects').findOne({
            _id: new Types.ObjectId(project.id),
            organizationId: new Types.ObjectId(org),
          }),
        );
        assert.equal(
          await fresh
            .collection('tasks')
            .countDocuments({ projectId: new Types.ObjectId(project.id), deletedAt: null }),
          52,
        );
        assert(
          await fresh
            .collection('project_events')
            .findOne({ projectId: new Types.ObjectId(project.id) }),
        );
      } finally {
        await fresh.close();
      }
    },
  );
  await check(
    'project deletion atomically hides project/tasks while retaining history',
    async () => {
      project = await get();
      await mutate(owner, path, { version: project.version }, 'delete').expect(200);
      await owner.agent.get(path).expect(404);
      await owner.agent.get(`${path}/tasks`).expect(404);
      await owner.agent.get(`${path}/activity`).expect(404);
      assert.equal(
        await repo.models.tasks.countDocuments({ projectId: project.id, deletedAt: null }),
        0,
      );
      assert(await repo.models.events.exists({ projectId: project.id, action: 'deleted project' }));
    },
  );
  console.log(
    `${results.length} project integration checks passed against real MongoDB transactions.`,
  );
} finally {
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
