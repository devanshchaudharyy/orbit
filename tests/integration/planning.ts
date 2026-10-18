import { cleanupBillingFixtures } from '../support/billing-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  projectSchema,
  taskSchema,
  planningSnapshotSchema,
  apiErrorSchema,
  type TaskInput,
  type TaskPlanInput,
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
import { PlanningRepository } from '../../apps/api/src/modules/planning/repository.js';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';
const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const mongoose = requireApi('mongoose'),
  request = requireApi('supertest');
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
const planning = new PlanningRepository(repo);
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
const run = randomUUID(),
  password = `Planning ${run}`;
const users = Array.from({ length: 8 }, (_, index) => ({
  _id: new Types.ObjectId(),
  email: `planning-${run}-${index}@example.test`,
  name: `Planner ${index}`,
}));
const ids: string[] = users.map((u) => String(u._id));
const orgs: string[] = [];
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
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
try {
  await authRepo.ready();
  await projects.ready();
  await planning.ready();
  await clearTestLoopbackLimits(connection.db);
  const passwordHash = await hashPassword(password);
  await authRepo.models.users.create(
    users.map((u, i) => ({
      ...u,
      passwordHash,
      emailVerified: i !== 6,
      onboardingCompleted: i !== 7,
    })),
  );
  const identities: Identity[] = [];
  for (let i = 0; i < 8; i++) identities.push(await login(i));
  const owner = identities[0]!,
    member = identities[2]!,
    guest = identities[3]!,
    outsider = identities[4]!;
  const org = (await tenants.create(ids[0]!, { name: 'Delivery fixture', description: '' })).id;
  orgs.push(org);
  const ws = (
    await tenants.createWorkspace(ids[0]!, org, {
      name: 'Planning studio',
      description: '',
      timezone: 'UTC',
    })
  ).id;
  const scope = { organizationId: org, workspaceId: ws };
  await tenantRepo.models.organizationMemberships.create(
    [1, 2, 3, 5].map((i) => ({
      organizationId: org,
      userId: ids[i],
      role: i === 1 ? 'project-manager' : i === 3 ? 'guest' : i === 5 ? 'admin' : 'member',
    })),
  );
  await tenantRepo.models.workspaceMemberships.create(
    [1, 2, 3].map((i) => ({ ...scope, userId: ids[i] })),
  );
  const base = `/api/v1/organizations/${org}/workspaces/${ws}/projects`;
  const project = projectSchema.parse(
    (
      await mutate(owner, base, {
        name: 'Delivery project',
        description: '',
        status: 'active',
        priority: 'high',
        cover: 'aurora',
        ownerId: ids[0],
        memberIds: [ids[2], ids[3]],
        template: 'blank',
      }).expect(201)
    ).body.data,
  );
  const path = `${base}/${project.id}`,
    endpoint = `${path}/planning`;
  const snapshot = async (extra = '') =>
    planningSnapshotSchema.parse(
      (await owner.agent.get(`${endpoint}?from=2026-10-01&to=2026-10-31${extra}`).expect(200)).body
        .data,
    );
  const taskInput: TaskInput = {
    title: 'Schedule release',
    description: 'Keep original content',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-10-10',
    ownerId: ids[2]!,
    assigneeIds: [ids[0]!, ids[2]!],
    labelIds: [],
    checklist: [{ text: 'Preserve checklist', done: false }],
    parentId: null,
  };
  const first = taskSchema.parse(
    (await mutate(member, `${path}/tasks`, taskInput).expect(201)).body.data,
  );
  const second = taskSchema.parse(
    (await mutate(member, `${path}/tasks`, { ...taskInput, title: 'Review release' }).expect(201))
      .body.data,
  );
  const row = async (id: string) => (await snapshot()).tasks.find((r) => r.task.id === id)!;
  const input = async (id: string, fields: Partial<TaskPlanInput> = {}): Promise<TaskPlanInput> => {
    const r = await row(id);
    return {
      version: r.plan.version,
      taskVersion: r.task.version,
      startDate: r.plan.startDate,
      dueDate: r.task.dueDate,
      estimateHours: r.plan.estimateHours,
      milestoneId: r.plan.milestoneId,
      sprintId: r.plan.sprintId,
      dependencyIds: [...r.plan.dependencyIds],
      ...fields,
    };
  };
  const plan = async (id: string, fields: Partial<TaskPlanInput> = {}) =>
    mutate(member, `${endpoint}/tasks/${id}`, await input(id, fields), 'patch').expect(200);
  let milestoneId = '',
    sprintId = '',
    nextSprintId = '';
  await check('planning defaults are authorized, private and retain request IDs', async () => {
    const response = await owner.agent.get(endpoint).expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.body.meta.requestId);
    const data = planningSnapshotSchema.parse(response.body.data);
    assert.equal(data.totals.total, 2);
    assert.equal(data.milestones.length, 0);
    assert.equal(data.tasks[0]!.plan.version, 0);
    assert.equal(await planning.models.plans.countDocuments({ projectId: project.id }), 0);
  });
  await check(
    'anonymous, unverified, incomplete and foreign users cannot read planning',
    async () => {
      await request(app).get(endpoint).expect(401);
      await identities[6]!.agent.get(endpoint).expect(403);
      await identities[7]!.agent.get(endpoint).expect(403);
      await outsider.agent.get(endpoint).expect(404);
      await identities[5]!.agent.get(endpoint).expect(404);
    },
  );
  await check(
    'CSRF, Origin, strict authority fields and invalid date windows are rejected',
    async () => {
      await owner.agent.post(`${endpoint}/milestones`).send({}).expect(403);
      await mutate(owner, `${endpoint}/milestones`, {
        name: 'Bad',
        description: '',
        dueDate: '2026-10-31',
        status: 'open',
        organizationId: org,
      }).expect(400);
      await owner.agent.get(`${endpoint}?from=2026-10-01&to=2027-10-01`).expect(400);
      await mutate(
        member,
        `${endpoint}/tasks/${first.id}`,
        { ...(await input(first.id)), startDate: '2026-10-20', dueDate: '2026-10-01' },
        'patch',
      ).expect(400);
    },
  );
  await check('members and guests cannot manage milestones, sprints or capacity', async () => {
    for (const actor of [member, guest]) {
      await mutate(actor, `${endpoint}/milestones`, {
        name: 'Denied',
        description: '',
        dueDate: '2026-10-31',
        status: 'open',
      }).expect(403);
      await mutate(actor, `${endpoint}/sprints`, {
        name: 'Denied',
        goal: '',
        startDate: '2026-10-01',
        endDate: '2026-10-14',
      }).expect(403);
      await mutate(
        actor,
        `${endpoint}/capacities/${ids[2]}`,
        { version: 0, weeklyHours: 20 },
        'patch',
      ).expect(403);
    }
  });
  await check(
    'managers create real milestone and sprint records with unique project names',
    async () => {
      const m = await mutate(owner, `${endpoint}/milestones`, {
        name: 'Launch',
        description: 'Ship a release',
        dueDate: '2026-10-31',
        status: 'open',
      }).expect(201);
      milestoneId = m.body.data.id;
      const s = await mutate(identities[1]!, `${endpoint}/sprints`, {
        name: 'Sprint one',
        goal: 'Release outcome',
        startDate: '2026-10-01',
        endDate: '2026-10-14',
      }).expect(201);
      sprintId = s.body.data.id;
      const n = await mutate(owner, `${endpoint}/sprints`, {
        name: 'Sprint two',
        goal: 'Follow-up',
        startDate: '2026-10-15',
        endDate: '2026-10-28',
      }).expect(201);
      nextSprintId = n.body.data.id;
      assert.equal((await snapshot()).sprints.length, 2);
      await mutate(owner, `${endpoint}/milestones`, {
        name: 'launch',
        description: '',
        dueDate: '2026-10-31',
        status: 'open',
      }).expect(422);
    },
  );
  await check('task plans update dates transactionally and preserve task content', async () => {
    await plan(first.id, {
      startDate: '2026-10-01',
      dueDate: '2026-10-12',
      estimateHours: 80,
      milestoneId,
      sprintId,
    });
    const after = await row(first.id);
    assert.equal(after.task.version, first.version + 1);
    assert.deepEqual(after.task.assigneeIds, first.assigneeIds);
    assert.deepEqual(after.task.checklist, first.checklist);
    assert.equal(after.task.description, first.description);
    assert.equal(after.plan.estimateHours, 80);
    await plan(second.id, {
      startDate: '2026-10-03',
      estimateHours: 20,
      milestoneId,
      sprintId,
      dependencyIds: [first.id],
    });
    const data = await snapshot();
    assert.equal(data.milestones[0]!.totals.total, 2);
    assert.equal(data.blocked, 1);
    assert.deepEqual(data.tasks.find((r) => r.task.id === second.id)!.scheduleConflicts, [
      first.id,
    ]);
  });
  await check('guests read actual planning but cannot schedule tasks', async () => {
    const data = planningSnapshotSchema.parse(
      (await guest.agent.get(endpoint).expect(200)).body.data,
    );
    assert.equal(data.tasks.length, 2);
    await mutate(guest, `${endpoint}/tasks/${first.id}`, await input(first.id), 'patch').expect(
      403,
    );
  });
  await check('self, duplicate and foreign task dependencies are rejected', async () => {
    await mutate(
      member,
      `${endpoint}/tasks/${first.id}`,
      await input(first.id, { dependencyIds: [first.id] }),
      'patch',
    ).expect(422);
    await mutate(
      member,
      `${endpoint}/tasks/${first.id}`,
      await input(first.id, { dependencyIds: [second.id, second.id] }),
      'patch',
    ).expect(400);
    await mutate(
      member,
      `${endpoint}/tasks/${first.id}`,
      await input(first.id, { dependencyIds: [new Types.ObjectId().toString()] }),
      'patch',
    ).expect(422);
    await mutate(
      member,
      `${endpoint}/tasks/${first.id}`,
      await input(first.id, { milestoneId: new Types.ObjectId().toString() }),
      'patch',
    ).expect(422);
  });
  await check('dependency cycles are rejected without overwriting existing edges', async () => {
    const before = await row(first.id);
    const response = await mutate(
      member,
      `${endpoint}/tasks/${first.id}`,
      await input(first.id, { dependencyIds: [second.id] }),
      'patch',
    ).expect(409);
    assert.equal(code(response.body), 'DEPENDENCY_CYCLE');
    assert.deepEqual((await row(first.id)).plan, before.plan);
  });
  await check('concurrent opposite edges commit once and cannot create a graph cycle', async () => {
    const a = taskSchema.parse(
        (await mutate(member, `${path}/tasks`, { ...taskInput, title: 'Cycle alpha' }).expect(201))
          .body.data,
      ),
      b = taskSchema.parse(
        (await mutate(member, `${path}/tasks`, { ...taskInput, title: 'Cycle beta' }).expect(201))
          .body.data,
      );
    const inputs = await Promise.all([
      input(a.id, { dependencyIds: [b.id] }),
      input(b.id, { dependencyIds: [a.id] }),
    ]);
    const responses = await Promise.all([
      mutate(member, `${endpoint}/tasks/${a.id}`, inputs[0], 'patch'),
      mutate(member, `${endpoint}/tasks/${b.id}`, inputs[1], 'patch'),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      await planning.models.plans.countDocuments({
        projectId: project.id,
        taskId: { $in: [a.id, b.id] },
      }),
      1,
    );
  });
  await check('both task and planning snapshots reject stale writers', async () => {
    const old = await input(second.id);
    await plan(second.id, { estimateHours: 24 });
    await mutate(member, `${endpoint}/tasks/${second.id}`, old, 'patch').expect(409);
    const fresh = await input(second.id);
    await mutate(member, `${path}/tasks/${second.id}/move`, {
      version: fresh.taskVersion,
      status: 'in-progress',
    }).expect(200);
    await mutate(member, `${endpoint}/tasks/${second.id}`, fresh, 'patch').expect(409);
    await plan(second.id, { estimateHours: 20 });
  });
  await check('existing task edit and move routes cannot invert planned dates', async () => {
    const r = await row(second.id);
    await mutate(member, `${path}/tasks/${second.id}/move`, {
      version: r.task.version,
      dueDate: '2026-10-01',
    }).expect(422);
    await mutate(
      member,
      `${path}/tasks/${second.id}`,
      {
        ...Object.fromEntries(Object.entries(taskInput).filter(([key]) => key !== 'parentId')),
        title: r.task.title,
        status: r.task.status,
        version: r.task.version,
        dueDate: '2026-10-01',
      },
      'patch',
    ).expect(422);
    assert.equal((await row(second.id)).task.dueDate, '2026-10-10');
  });
  await check('activity failure rolls back metadata, task dates and task versions', async () => {
    const before = await row(second.id);
    const original = repo.models.events.create;
    repo.models.events.create = (() => {
      throw new Error('Controlled event failure');
    }) as typeof original;
    try {
      const response = await mutate(
        member,
        `${endpoint}/tasks/${second.id}`,
        await input(second.id, { dueDate: '2026-10-20', estimateHours: 90 }),
        'patch',
      ).expect(503);
      assert.equal(code(response.body), 'PLANNING_UNAVAILABLE');
    } finally {
      repo.models.events.create = original;
    }
    assert.deepEqual(await row(second.id), before);
  });
  await check('weekly capacity is explicit, versioned and scaled by weekdays', async () => {
    const before = await snapshot();
    assert.equal(before.workloads.find((w) => w.userId === ids[0])!.capacityHours, null);
    await mutate(
      owner,
      `${endpoint}/capacities/${ids[0]}`,
      { version: 0, weeklyHours: 10 },
      'patch',
    ).expect(200);
    const data = await snapshot(),
      capacity = data.workloads.find((w) => w.userId === ids[0])!;
    assert.equal(capacity.capacityHours, 44);
    assert.equal(capacity.hours, 50);
    assert.equal(capacity.version, 1);
    const selected = await snapshot('&q=Review%20release');
    assert.equal(selected.workloads.find((w) => w.userId === ids[0])!.hours, 10);
    assert.equal(selected.totalMatches, 1);
    assert.equal(selected.totals.total, 4);
    await mutate(
      owner,
      `${endpoint}/capacities/${ids[0]}`,
      { version: 0, weeklyHours: 40 },
      'patch',
    ).expect(409);
    await mutate(
      owner,
      `${endpoint}/capacities/${ids[3]}`,
      { version: 0, weeklyHours: 40 },
      'patch',
    ).expect(422);
  });
  await check('concurrent capacity editors preserve one original version', async () => {
    const values = { version: 1, weeklyHours: 20 };
    const responses = await Promise.all([
      mutate(owner, `${endpoint}/capacities/${ids[0]}`, values, 'patch'),
      mutate(owner, `${endpoint}/capacities/${ids[0]}`, { ...values, weeklyHours: 30 }, 'patch'),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const current = (await snapshot()).workloads.find((w) => w.userId === ids[0])!;
    await mutate(
      owner,
      `${endpoint}/capacities/${ids[0]}`,
      { version: current.version, weeklyHours: null },
      'patch',
    ).expect(200);
    assert.equal(
      (await snapshot()).workloads.find((w) => w.userId === ids[0])!.capacityHours,
      null,
    );
  });
  await check(
    'starting a sprint freezes actual commitment and prevents a second active sprint',
    async () => {
      await mutate(owner, `${endpoint}/sprints/${sprintId}/start`, { version: 1 }).expect(200);
      const sprint = (await snapshot()).sprints.find((s) => s.id === sprintId)!;
      assert.equal(sprint.status, 'active');
      assert.equal(sprint.commitment!.total, 2);
      assert.equal(sprint.commitment!.estimateHours, 100);
      await mutate(owner, `${endpoint}/sprints/${nextSprintId}/start`, { version: 1 }).expect(409);
    },
  );
  await check(
    'completion freezes delivery and carries only unfinished work explicitly',
    async () => {
      const r = await row(first.id);
      await mutate(member, `${path}/tasks/${first.id}/move`, {
        version: r.task.version,
        status: 'done',
      }).expect(200);
      await mutate(owner, `${endpoint}/sprints/${sprintId}/complete`, {
        version: 2,
        carryTo: nextSprintId,
      }).expect(200);
      const data = await snapshot(),
        s = data.sprints.find((v) => v.id === sprintId)!;
      assert.equal(s.status, 'completed');
      assert.equal(s.delivery!.total, 2);
      assert.equal(s.delivery!.done, 1);
      assert.equal(s.commitment!.total, 2);
      assert.equal(data.tasks.find((v) => v.task.id === first.id)!.plan.sprintId, sprintId);
      assert.equal(data.tasks.find((v) => v.task.id === second.id)!.plan.sprintId, nextSprintId);
      assert.ok(s.completedAt);
    },
  );
  await check('completed sprint snapshots are immutable and completion cannot replay', async () => {
    await mutate(owner, `${endpoint}/sprints/${sprintId}/complete`, {
      version: 2,
      carryTo: null,
    }).expect(409);
    await mutate(
      owner,
      `${endpoint}/sprints/${sprintId}`,
      { version: 3, name: 'Changed', goal: '', startDate: '2026-10-01', endDate: '2026-10-14' },
      'patch',
    ).expect(409);
    await mutate(member, `${endpoint}/tasks/${first.id}`, await input(first.id), 'patch').expect(
      409,
    );
    const r = await row(first.id);
    await mutate(member, `${path}/tasks/${first.id}/move`, {
      version: r.task.version,
      status: 'todo',
    }).expect(200);
    assert.equal((await snapshot()).sprints.find((s) => s.id === sprintId)!.delivery!.done, 1);
  });
  await check(
    'milestone delivery status is explicit and never changes task completion',
    async () => {
      await mutate(
        owner,
        `${endpoint}/milestones/${milestoneId}`,
        {
          version: 1,
          name: 'Launch',
          description: 'Shipped outcome',
          dueDate: '2026-10-31',
          status: 'delivered',
        },
        'patch',
      ).expect(200);
      const data = await snapshot();
      assert.equal(data.milestones[0]!.status, 'delivered');
      assert.equal(data.milestones[0]!.totals.done, 0);
      await mutate(
        owner,
        `${endpoint}/milestones/${milestoneId}`,
        { version: 1, name: 'Stale', description: '', dueDate: '2026-10-31', status: 'open' },
        'patch',
      ).expect(409);
    },
  );
  await check('sprint carryover rejects foreign, active and self destinations', async () => {
    await mutate(owner, `${endpoint}/sprints/${nextSprintId}/start`, { version: 1 }).expect(200);
    await mutate(owner, `${endpoint}/sprints/${nextSprintId}/complete`, {
      version: 2,
      carryTo: nextSprintId,
    }).expect(422);
    await mutate(owner, `${endpoint}/sprints/${nextSprintId}/complete`, {
      version: 2,
      carryTo: new Types.ObjectId().toString(),
    }).expect(422);
    await mutate(owner, `${endpoint}/sprints/${nextSprintId}/complete`, {
      version: 2,
      carryTo: sprintId,
    }).expect(422);
    await mutate(owner, `${endpoint}/sprints/${nextSprintId}/complete`, {
      version: 2,
      carryTo: null,
    }).expect(200);
    assert.equal((await row(second.id)).plan.sprintId, null);
  });
  await check('concurrent sprint starts maintain exactly one active sprint', async () => {
    const create = async (name: string) =>
      (
        await mutate(owner, `${endpoint}/sprints`, {
          name,
          goal: '',
          startDate: '2026-11-01',
          endDate: '2026-11-14',
        }).expect(201)
      ).body.data.id;
    const a = await create('Race start A'),
      b = await create('Race start B');
    const responses = await Promise.all([
      mutate(owner, `${endpoint}/sprints/${a}/start`, { version: 1 }),
      mutate(owner, `${endpoint}/sprints/${b}/start`, { version: 1 }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const current = (await snapshot()).sprints.filter((s) => s.status === 'active');
    assert.equal(current.length, 1);
    await mutate(owner, `${endpoint}/sprints/${current[0]!.id}/complete`, {
      version: current[0]!.version,
      carryTo: null,
    }).expect(200);
  });
  await check(
    'planned sprint deletion detaches tasks while completed history is retained',
    async () => {
      const response = await mutate(owner, `${endpoint}/sprints`, {
        name: 'Disposable sprint',
        goal: '',
        startDate: '2026-11-01',
        endDate: '2026-11-14',
      }).expect(201);
      const id = response.body.data.id;
      await plan(second.id, { sprintId: id });
      await mutate(owner, `${endpoint}/sprints/${id}`, { version: 1 }, 'delete').expect(200);
      assert.equal((await row(second.id)).plan.sprintId, null);
      await mutate(owner, `${endpoint}/sprints/${sprintId}`, { version: 3 }, 'delete').expect(409);
    },
  );
  await check(
    'milestone deletion detaches plans and invalidates original planning versions',
    async () => {
      const before = await row(second.id);
      await mutate(owner, `${endpoint}/milestones/${milestoneId}`, { version: 2 }, 'delete').expect(
        200,
      );
      const after = await row(second.id);
      assert.equal(after.plan.milestoneId, null);
      assert.equal(after.plan.version, before.plan.version + 1);
      assert.equal(after.task.version, before.task.version);
    },
  );
  await check(
    'concurrent milestone and sprint creation respects the fifty-record bounds',
    async () => {
      const filter = { ...scope, projectId: project.id };
      await planning.models.milestones.create(
        Array.from({ length: 49 }, (_, i) => ({
          ...filter,
          name: `Limit milestone ${i}`,
          nameKey: `limit milestone ${i}`,
          description: '',
          dueDate: '2026-10-31',
          status: 'open',
          version: 1,
        })),
      );
      try {
        const responses = await Promise.all(
          ['A', 'B'].map((name) =>
            mutate(owner, `${endpoint}/milestones`, {
              name: `Limit race ${name}`,
              description: '',
              dueDate: '2026-10-31',
              status: 'open',
            }),
          ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 422]);
        assert.equal(await planning.models.milestones.countDocuments(filter), 50);
      } finally {
        await planning.models.milestones.deleteMany({ ...filter, nameKey: { $regex: '^limit ' } });
      }
      const count = await planning.models.sprints.countDocuments(filter);
      await planning.models.sprints.create(
        Array.from({ length: 49 - count }, (_, i) => ({
          ...filter,
          name: `Limit sprint ${i}`,
          nameKey: `limit sprint ${i}`,
          goal: '',
          startDate: '2026-11-01',
          endDate: '2026-11-14',
          status: 'planned',
          version: 1,
        })),
      );
      try {
        const responses = await Promise.all(
          ['A', 'B'].map((name) =>
            mutate(owner, `${endpoint}/sprints`, {
              name: `Limit race ${name}`,
              goal: '',
              startDate: '2026-11-01',
              endDate: '2026-11-14',
            }),
          ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 422]);
        assert.equal(await planning.models.sprints.countDocuments(filter), 50);
      } finally {
        await planning.models.sprints.deleteMany({ ...filter, nameKey: { $regex: '^limit ' } });
      }
    },
  );
  await check(
    'removed prerequisites are flagged without exposing deleted task content',
    async () => {
      const a = taskSchema.parse(
        (
          await mutate(member, `${path}/tasks`, {
            ...taskInput,
            title: 'Private removed prerequisite',
          }).expect(201)
        ).body.data,
      );
      await plan(second.id, { dependencyIds: [a.id] });
      await mutate(member, `${path}/tasks/${a.id}`, { version: a.version }, 'delete').expect(200);
      const r = await row(second.id);
      assert.deepEqual(r.blockers, [{ id: a.id, title: 'Removed prerequisite', missing: true }]);
      await plan(second.id, { dependencyIds: [] });
    },
  );
  await check(
    'server pages and filters preserve full-project totals and do not duplicate rows',
    async () => {
      const bulk = await repo.models.tasks.create(
        Array.from({ length: 105 }, (_, i) => ({
          ...scope,
          projectId: project.id,
          ...taskInput,
          title: `Bulk ${String(105 - i).padStart(3, '0')}`,
        })),
      );
      try {
        const a = await snapshot('&q=Bulk&sort=title');
        assert.equal(a.tasks.length, 100);
        assert.equal(a.totalMatches, 105);
        assert.ok(a.nextCursor);
        assert.ok(a.totals.total > 105);
        const b = await snapshot(`&q=Bulk&sort=title&cursor=${a.nextCursor}`);
        assert.equal(b.tasks.length, 5);
        assert.equal(new Set([...a.tasks, ...b.tasks].map((r) => r.task.id)).size, 105);
        assert.equal(a.tasks[0]!.task.title, 'Bulk 001');
        const backlog = await snapshot('&sprint=backlog&status=todo&priority=high');
        assert.ok(backlog.tasks.every((r) => r.plan.sprintId === null && r.task.status === 'todo'));
      } finally {
        await repo.models.tasks.deleteMany({ _id: { $in: bulk.map((t) => t._id) } });
      }
    },
  );
  await check('missing pagination anchors return a safe reload conflict', async () => {
    const response = await owner.agent
      .get(`${endpoint}?from=2026-10-01&to=2026-10-31&cursor=${new Types.ObjectId()}`)
      .expect(409);
    assert.equal(code(response.body), 'TASK_PAGE_CHANGED');
  });
  await check(
    'planning snapshots explicitly reject oversized projects rather than truncate summaries',
    async () => {
      const bulk = await repo.models.tasks.insertMany(
        Array.from({ length: 5001 }, (_, i) => ({
          ...scope,
          projectId: project.id,
          ...taskInput,
          title: `Limit ${i}`,
        })),
      );
      try {
        const response = await owner.agent.get(endpoint).expect(422);
        assert.equal(code(response.body), 'PLANNING_LIMIT');
      } finally {
        await repo.models.tasks.deleteMany({ _id: { $in: bulk.map((t) => t._id) } });
      }
    },
  );
  await check(
    'fresh database connections read durable plans, capacity and delivery snapshots',
    async () => {
      const fresh = await mongoose
        .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
        .asPromise();
      try {
        assert.equal(
          (await fresh.collection('task_plans').findOne({ taskId: new Types.ObjectId(first.id) }))
            .estimateHours,
          80,
        );
        assert.equal(
          (await fresh.collection('project_sprints').findOne({ _id: new Types.ObjectId(sprintId) }))
            .delivery.done,
          1,
        );
        assert.equal(
          (
            await fresh.collection('project_capacities').findOne({
              projectId: new Types.ObjectId(project.id),
              userId: new Types.ObjectId(ids[0]),
            })
          ).weeklyHours,
          null,
        );
      } finally {
        await fresh.close();
      }
    },
  );
  await check(
    'archived projects remain readable while all planning mutations are blocked',
    async () => {
      await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: true } });
      await snapshot();
      await mutate(owner, `${endpoint}/milestones`, {
        name: 'Denied archive',
        description: '',
        dueDate: '2026-10-31',
        status: 'open',
      }).expect(409);
      await mutate(
        member,
        `${endpoint}/tasks/${second.id}`,
        await input(second.id),
        'patch',
      ).expect(409);
      await mutate(
        owner,
        `${endpoint}/capacities/${ids[0]}`,
        { version: 3, weeklyHours: 10 },
        'patch',
      ).expect(409);
      await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: false } });
    },
  );
  await check(
    'current project and workspace revocation overrides retained planning records',
    async () => {
      await repo.models.projects.updateOne({ _id: project.id }, { $pull: { memberIds: ids[3] } });
      await guest.agent.get(endpoint).expect(404);
      await tenantRepo.models.workspaceMemberships.deleteOne({ ...scope, userId: ids[2] });
      await member.agent.get(endpoint).expect(404);
      await mutate(
        member,
        `${endpoint}/tasks/${second.id}`,
        await input(second.id),
        'patch',
      ).expect(404);
    },
  );
  await check(
    'deleted projects cannot expose retained planning, sprints or capacities',
    async () => {
      await repo.models.projects.updateOne(
        { _id: project.id },
        { $set: { deletedAt: new Date() } },
      );
      await owner.agent.get(endpoint).expect(404);
      await mutate(owner, `${endpoint}/sprints/${sprintId}/start`, { version: 3 }).expect(404);
    },
  );
  console.log(`Phase 7 integration: ${results.length} checks passed.`);
} finally {
  await connection
    .collection('sprint_burndown_observations')
    .deleteMany({ organizationId: { $in: orgs.map((id) => new mongoose.Types.ObjectId(id)) } });
  for (const model of Object.values(planning.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  for (const model of Object.values(repo.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  for (const name of ['workspaceMemberships', 'organizationMemberships', 'workspaces'] as const)
    await tenantRepo.models[name].deleteMany({ organizationId: { $in: orgs } });
  await tenantRepo.models.organizations.deleteMany({ _id: { $in: orgs } });
  await authRepo.models.sessions.deleteMany({ userId: { $in: ids } });
  await authRepo.models.users.deleteMany({ _id: { $in: ids } });
  await clearTestLoopbackLimits(connection.db);
  await cleanupBillingFixtures(uri, orgs);
  await connection.close();
}
