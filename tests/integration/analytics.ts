import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  analyticsReportSchema,
  projectSchema,
  taskSchema,
  businessDaysBetween,
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
import { AnalyticsRepository } from '../../apps/api/src/modules/analytics/repository.js';
import { AnalyticsService } from '../../apps/api/src/modules/analytics/service.js';
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
  repo = new ProjectRepository(tenantRepo),
  projects = new ProjectService(repo),
  analytics = new AnalyticsRepository(repo),
  service = new AnalyticsService(analytics);
const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174',
  run = randomUUID();
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
const users = Array.from({ length: 6 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    email: `analytics-${run}-${index}@example.test`,
    name: `Analytics author ${index}`,
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
      .send({ email: users[index]!.email, password: `Analytics ${run}` })
      .expect(200);
  return { agent, csrf: response.body.data.csrfToken };
}
const mutate = (
  actor: Identity,
  path: string,
  input: unknown,
  method: 'post' | 'patch' | 'delete' = 'post',
) => actor.agent[method](path).set('Origin', origin).set('X-CSRF-Token', actor.csrf).send(input);
async function check(name: string, operation: () => Promise<void>) {
  await clearTestLoopbackLimits(connection.db);
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
const now = new Date(),
  today = now.toISOString().slice(0, 10),
  date = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
      .toISOString()
      .slice(0, 10),
  window = { from: date(-6), to: today };
try {
  await authRepo.ready();
  await analytics.ready();
  const passwordHash = await hashPassword(`Analytics ${run}`);
  await authRepo.models.users.create(
    users.map((user, index) => ({
      ...user,
      passwordHash,
      emailVerified: index !== 4,
      onboardingCompleted: index !== 5,
    })),
  );
  const identities: Identity[] = [];
  for (let index = 0; index < 6; index++) identities.push(await login(index));
  const [owner, member, guest, outsider, unverified, incomplete] = identities as [
    Identity,
    Identity,
    Identity,
    Identity,
    Identity,
    Identity,
  ];
  const org = String(
    (
      await mutate(owner, '/api/v1/organizations', {
        name: 'Analytics verification',
        description: '',
      }).expect(201)
    ).body.data.id,
  );
  orgs.push(org);
  const ws = String(
      (
        await mutate(owner, `/api/v1/organizations/${org}/workspaces`, {
          name: 'Metrics workspace',
          timezone: 'UTC',
          description: '',
        }).expect(201)
      ).body.data.id,
    ),
    scope = { organizationId: org, workspaceId: ws };
  for (const index of [1, 2]) {
    await tenantRepo.models.organizationMemberships.create({
      organizationId: org,
      userId: ids[index],
      role: index === 2 ? 'guest' : 'member',
    });
    await tenantRepo.models.workspaceMemberships.create({ ...scope, userId: ids[index] });
  }
  const base = `/api/v1/organizations/${org}/workspaces/${ws}/projects`,
    projectInput = {
      name: 'Evidence project',
      description: 'Real analytics',
      status: 'active',
      priority: 'normal',
      cover: 'orbit',
      ownerId: ids[0],
      memberIds: [ids[1], ids[2]],
      template: 'blank',
    };
  const project = projectSchema.parse(
      (await mutate(owner, base, projectInput).expect(201)).body.data,
    ),
    path = `${base}/${project.id}`,
    endpoint = `${path}/analytics`,
    query = new URLSearchParams(window).toString();
  const report = async (actor = owner, extra = '') =>
    analyticsReportSchema.parse(
      (await actor.agent.get(`${endpoint}?${query}${extra}`).expect(200)).body.data,
    );
  await check(
    'empty metrics use actual zero counts, unknown completion and unavailable historical data',
    async () => {
      const value = await report();
      assert.equal(value.summary.total, 0);
      assert.equal(value.summary.completionPercent, null);
      assert(value.activity.every((row) => row.changes >= 0));
      assert(value.burndown.days.every((row) => row.remaining === null));
      const response = await owner.agent.get(endpoint).expect(200);
      assert.match(response.headers['x-request-id'], /^[a-f0-9-]{36}$/);
      assert.match(response.headers['cache-control'], /no-store/);
    },
  );
  await check(
    'anonymous, incomplete, unverified, foreign and mixed-parent reads/exports are denied',
    async () => {
      await request(app).get(endpoint).expect(401);
      await unverified.agent.get(endpoint).expect(403);
      await incomplete.agent.get(endpoint).expect(403);
      await outsider.agent.get(endpoint).expect(404);
      await outsider.agent.get(`${endpoint}/export?dataset=tasks`).expect(404);
      await owner.agent
        .get(
          `/api/v1/organizations/${org}/workspaces/${new mongoose.Types.ObjectId()}/projects/${project.id}/analytics`,
        )
        .expect(404);
    },
  );
  await check(
    'malformed dates, excessive windows, unknown keys, datasets and foreign sprint selection are rejected',
    async () => {
      for (const suffix of [
        'from=2026-02-29&to=2026-03-01',
        'from=2026-01-01&to=2026-12-31',
        `from=${today}&to=${date(-1)}`,
        'unknown=true',
      ])
        await owner.agent.get(`${endpoint}?${suffix}`).expect(400);
      await owner.agent.get(`${endpoint}?from=${today}&to=${date(1)}`).expect(422);
      await owner.agent.get(`${endpoint}/export?dataset=users`).expect(400);
      await owner.agent
        .get(`${endpoint}?${query}&sprint=${new mongoose.Types.ObjectId()}`)
        .expect(404);
    },
  );
  const taskInput = (
    title: string,
    status: TaskInput['status'] = 'todo',
    dueDate: string | null = date(-1),
    assigneeIds: string[] = ids.slice(0, 2),
  ): TaskInput => ({
    title,
    description: 'Actual metrics input',
    status,
    priority: 'normal',
    dueDate,
    ownerId: ids[0]!,
    assigneeIds,
    labelIds: [],
    checklist: [],
    parentId: null,
  });
  const first = taskSchema.parse(
      (await mutate(owner, `${path}/tasks`, taskInput('Overdue launch')).expect(201)).body.data,
    ),
    second = taskSchema.parse(
      (await mutate(owner, `${path}/tasks`, taskInput('Completed evidence', 'done')).expect(201))
        .body.data,
    ),
    third = taskSchema.parse(
      (
        await mutate(
          owner,
          `${path}/tasks`,
          taskInput('Unestimated backlog', 'todo', null, []),
        ).expect(201)
      ).body.data,
    ),
    child = taskSchema.parse(
      (
        await mutate(owner, `${path}/tasks`, {
          ...taskInput('Overdue subtask', 'todo', date(-1), [ids[1]!]),
          parentId: first.id,
        }).expect(201)
      ).body.data,
    );
  const planningBase = `${path}/planning`;
  const milestone = String(
    (
      await mutate(owner, `${planningBase}/milestones`, {
        name: 'Evidence milestone',
        description: 'Linked actual tasks',
        dueDate: date(1),
        status: 'open',
      }).expect(201)
    ).body.data.id,
  );
  const sprint = String(
    (
      await mutate(owner, `${planningBase}/sprints`, {
        name: 'Observed sprint',
        goal: 'Record delivery',
        startDate: date(-6),
        endDate: today,
      }).expect(201)
    ).body.data.id,
  );
  async function plan(
    taskId: string,
    estimate: number | null,
    sprintId: string | null = sprint,
    milestoneId: string | null = null,
  ) {
    const record = taskSchema.parse(
        (await owner.agent.get(`${path}/tasks/${taskId}`).expect(200)).body.data,
      ),
      existing = await analytics.planning.models.plans
        .findOne({ projectId: project.id, taskId })
        .lean();
    return mutate(
      owner,
      `${planningBase}/tasks/${taskId}`,
      {
        taskVersion: record.version,
        version: existing?.version ?? 0,
        startDate: estimate === null ? null : date(-1),
        dueDate: record.dueDate,
        estimateHours: estimate,
        sprintId,
        milestoneId,
        dependencyIds: [],
      },
      'patch',
    ).expect(200);
  }
  await plan(first.id, 8, sprint, milestone);
  await plan(second.id, 5, sprint, milestone);
  await plan(third.id, null);
  await plan(child.id, 3);
  // Capacity is a PATCH operation and is versioned independently from task plans.
  await mutate(
    owner,
    `${planningBase}/capacities/${ids[0]}`,
    { weeklyHours: 40, version: 0 },
    'patch',
  ).expect(200);
  await mutate(
    owner,
    `${planningBase}/capacities/${ids[1]}`,
    { weeklyHours: 20, version: 0 },
    'patch',
  ).expect(200);
  await check(
    'snapshot statistics count active tasks/subtasks and current UTC overdue work accurately',
    async () => {
      const value = await report();
      assert.equal(value.summary.total, 4);
      assert.equal(value.summary.done, 1);
      assert.equal(value.summary.completionPercent, 25);
      assert.equal(value.summary.overdue, 2);
      assert.equal(value.summary.undated, 1);
      assert.equal(value.tasks.find((row) => row.id === child.id)!.parentId, first.id);
    },
  );
  await check(
    'workload splits actual entered estimates, retains unknown/unassigned work and business-day capacity',
    async () => {
      const value = await report(),
        a = value.workloads.find((row) => row.userId === ids[0])!,
        b = value.workloads.find((row) => row.userId === ids[1])!,
        unassigned = value.workloads.find((row) => row.userId === null)!;
      assert.equal(a.hours, 4);
      assert.equal(b.hours, 7);
      assert.equal(a.capacityHours, (40 * businessDaysBetween(window.from, window.to)) / 5);
      assert.equal(unassigned.unestimated, 1);
      assert.equal(unassigned.unscheduled, 1);
      assert.equal(value.milestones[0]!.totals.total, 2);
      assert.equal(value.milestones[0]!.totals.done, 1);
      assert.equal(value.milestones[0]!.status, 'open');
    },
  );
  await check(
    'read-only guests receive authorized reports and actual private CSV without creating observations',
    async () => {
      const before = await analytics.observations.countDocuments({ projectId: project.id });
      const value = await report(guest);
      assert.equal(value.tasks.length, 4);
      const response = await guest.agent
        .get(`${endpoint}/export?${query}&dataset=tasks`)
        .expect(200);
      assert.match(response.headers['content-type'], /text\/csv/);
      assert.match(response.headers['content-disposition'], /attachment/);
      assert.match(response.text, /Overdue subtask/);
      assert.equal(await analytics.observations.countDocuments({ projectId: project.id }), before);
    },
  );
  await mutate(owner, `${planningBase}/sprints/${sprint}/start`, { version: 1 }).expect(200);
  await check(
    'sprint start records actual committed remaining work atomically, leaving earlier dates unknown',
    async () => {
      const rows = await analytics.observations.find({ sprintId: sprint }).lean();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.total, 4);
      assert.equal(rows[0]!.remaining, 3);
      assert.equal(rows[0]!.remainingHours, 11);
      assert.equal(rows[0]!.unestimated, 1);
      const value = await report();
      assert(value.burndown.firstObservedAt);
      assert.equal(value.burndown.days.at(-1)!.remaining, 3);
      assert(value.burndown.days.slice(0, -1).every((row) => row.remaining === null));
    },
  );
  async function move(taskId: string, status: TaskInput['status']) {
    const current = taskSchema.parse(
      (await owner.agent.get(`${path}/tasks/${taskId}`).expect(200)).body.data,
    );
    return mutate(owner, `${path}/tasks/${taskId}/move`, {
      version: current.version,
      status,
    }).expect(200);
  }
  await move(first.id, 'done');
  await check(
    'task completion records lower remaining work and unchanged project comments do not add fake observations',
    async () => {
      const value = await report();
      assert.equal(value.burndown.days.at(-1)!.remaining, 2);
      const before = await analytics.observations.countDocuments({ sprintId: sprint });
      await mutate(owner, `${path}/collaboration/messages`, {
        body: 'Metrics review',
        mentionIds: [],
        clientId: randomUUID(),
      }).expect(201);
      assert.equal(await analytics.observations.countDocuments({ sprintId: sprint }), before);
    },
  );
  await check(
    'observation failures roll back task status, project activity and partial metrics together',
    async () => {
      const before = await analytics.observations.countDocuments({ sprintId: sprint }),
        events = await repo.models.events.countDocuments({ projectId: project.id }),
        record = taskSchema.parse(
          (await owner.agent.get(`${path}/tasks/${child.id}`).expect(200)).body.data,
        ),
        create = analytics.observations.create;
      analytics.observations.create = async () => {
        throw new Error('controlled metric failure');
      };
      try {
        await mutate(owner, `${path}/tasks/${child.id}/move`, {
          version: record.version,
          status: 'done',
        }).expect(503);
      } finally {
        analytics.observations.create = create;
      }
      assert.equal((await repo.models.tasks.findById(child.id).lean())!.status, 'todo');
      assert.equal(await analytics.observations.countDocuments({ sprintId: sprint }), before);
      assert.equal(await repo.models.events.countDocuments({ projectId: project.id }), events);
    },
  );
  await move(first.id, 'todo');
  await move(first.id, 'done');
  await move(third.id, 'done');
  await plan(child.id, 6);
  await check(
    'reopened work and estimate changes produce actual increased or changed curves',
    async () => {
      const rows = await analytics.observations.find({ sprintId: sprint }).sort({ _id: 1 }).lean();
      assert(rows.some((row) => row.remaining === 3));
      const value = await report();
      assert.equal(value.burndown.days.at(-1)!.remaining, 1);
      assert.equal(value.burndown.days.at(-1)!.remainingHours, 6);
      assert.equal(value.burndown.days.at(-1)!.unestimated, 0);
    },
  );
  const extra = taskSchema.parse(
    (await mutate(owner, `${path}/tasks`, taskInput('Added sprint scope')).expect(201)).body.data,
  );
  await plan(extra.id, 2);
  await check(
    'scope additions/removals change recorded totals without assuming a monotone burndown',
    async () => {
      assert.equal((await report()).burndown.days.at(-1)!.scope, 5);
      const record = taskSchema.parse(
        (await owner.agent.get(`${path}/tasks/${extra.id}`).expect(200)).body.data,
      );
      await mutate(
        owner,
        `${path}/tasks/${extra.id}`,
        { version: record.version },
        'delete',
      ).expect(200);
      assert.equal((await report()).burndown.days.at(-1)!.scope, 4);
    },
  );
  const carry = String(
    (
      await mutate(owner, `${planningBase}/sprints`, {
        name: 'Next sprint',
        goal: 'Carry unfinished work',
        startDate: date(1),
        endDate: date(7),
      }).expect(201)
    ).body.data.id,
  );
  await mutate(owner, `${planningBase}/sprints/${sprint}/complete`, {
    version: 2,
    carryTo: carry,
  }).expect(200);
  await check(
    'completion freezes known completed effort/unknown counts and captures final scope before carryover',
    async () => {
      const value = await report(),
        velocity = value.velocity.find((row) => row.id === sprint)!;
      assert.equal(velocity.completed, 3);
      assert.equal(velocity.completedEstimateHours, 13);
      assert.equal(velocity.unestimatedCompleted, 1);
      assert.equal(velocity.scopeAtClose, 4);
      assert.equal(value.burndown.days.at(-1)!.remaining, 1);
      assert.equal(value.burndown.days.at(-1)!.remainingHours, 6);
      assert.equal(
        String(
          (await analytics.planning.models.plans.findOne({ taskId: child.id }).lean())!.sprintId,
        ),
        carry,
      );
    },
  );
  await move(first.id, 'todo');
  await check(
    'later task edits cannot rewrite completed sprint velocity or final recorded history',
    async () => {
      const value = await report();
      assert.equal(value.velocity.find((row) => row.id === sprint)!.completed, 3);
      assert.equal(value.summary.done, 2);
      assert.equal(value.burndown.days.at(-1)!.remaining, 1);
    },
  );
  const legacy = String(
    (
      await mutate(owner, `${planningBase}/sprints`, {
        name: 'Legacy snapshot',
        goal: 'Compatibility fixture',
        startDate: date(-4),
        endDate: today,
      }).expect(201)
    ).body.data.id,
  );
  await analytics.planning.models.sprints.updateOne(
    { _id: legacy },
    {
      $set: {
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        commitment: { total: 2, done: 0, estimateHours: 7, unestimated: 0 },
        delivery: { total: 2, done: 1, estimateHours: 7, unestimated: 0 },
      },
    },
  );
  await check(
    'legacy sprint snapshots expose unknown completed hours and no fabricated burndown baseline',
    async () => {
      const value = await report(owner, `&sprint=${legacy}`);
      assert.equal(value.velocity.find((row) => row.id === legacy)!.completedEstimateHours, null);
      assert.equal(value.burndown.firstObservedAt, null);
      assert(value.burndown.days.every((row) => row.remaining === null));
      assert.equal(await analytics.observations.countDocuments({ sprintId: legacy }), 0);
    },
  );
  await check(
    'date windows select actual sprint close dates and actual recorded activity only',
    async () => {
      const value = analyticsReportSchema.parse(
        (await owner.agent.get(`${endpoint}?from=${date(-6)}&to=${date(-1)}`).expect(200)).body
          .data,
      );
      assert.equal(value.velocity.length, 0);
      assert(value.activity.every((row) => row.changes === 0));
    },
  );
  await check(
    'CSV handles formulas, Unicode, commas and quoted content while each dataset stays scoped',
    async () => {
      await mutate(owner, `${path}/tasks`, taskInput('=SUM(1,2)')).expect(201);
      await mutate(owner, `${path}/tasks`, taskInput('नमस्ते, "review"')).expect(201);
      for (const dataset of [
        'tasks',
        'workload',
        'milestones',
        'sprints',
        'activity',
        'burndown',
      ]) {
        const response = await owner.agent
          .get(`${endpoint}/export?${query}&dataset=${dataset}`)
          .expect(200);
        assert.match(response.text, /ORBIT report/);
        assert.match(response.headers['cache-control'], /no-store/);
        if (dataset === 'tasks') {
          assert.match(response.text, /'=SUM\(1,2\)/);
          assert.match(response.text, /नमस्ते, ""review""/);
        }
      }
    },
  );
  await check(
    'reports and exports include records beyond frontend pages without silent truncation',
    async () => {
      await repo.models.tasks.insertMany(
        Array.from({ length: 105 }, (_, index) => ({
          ...scope,
          projectId: project.id,
          ...taskInput(`Paged analytics ${index}`),
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
      const value = await report();
      assert(value.tasks.length > 100);
      assert.equal(
        value.summary.total,
        await repo.models.tasks.countDocuments({ projectId: project.id, deletedAt: null }),
      );
      const response = await owner.agent
        .get(`${endpoint}/export?${query}&dataset=tasks`)
        .expect(200);
      assert.match(response.text, /Paged analytics 104/);
    },
  );
  await check(
    'fresh connections read durable observations and immutable delivery snapshots',
    async () => {
      const fresh = await mongoose
        .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
        .asPromise();
      try {
        const freshAuth = new MongoAuthRepository(fresh, async () => true);
        await freshAuth.ready();
        const freshRepo = new AnalyticsRepository(
          new ProjectRepository(new MongoTenantRepository(fresh)),
        );
        await freshRepo.ready();
        assert.equal(
          (await freshRepo.report(ids[0]!, scope, project.id, window)).velocity.find(
            (row) => row.id === sprint,
          )!.completedEstimateHours,
          13,
        );
      } finally {
        await fresh.close();
      }
    },
  );
  await check(
    'permission revoked after snapshot generation prevents returning CSV bytes',
    async () => {
      const original = analytics.report.bind(analytics);
      analytics.report = async (...args) => {
        const value = await original(...args);
        await tenantRepo.models.workspaceMemberships.deleteOne({ ...scope, userId: ids[1] });
        return value;
      };
      try {
        await assert.rejects(service.export(ids[1]!, scope, project.id, window, 'tasks'));
      } finally {
        analytics.report = original;
        await tenantRepo.models.workspaceMemberships.create({ ...scope, userId: ids[1] });
      }
    },
  );
  await check('archived projects allow current read-only reports and exports', async () => {
    await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: true } });
    assert((await report(guest)).summary.total > 0);
    await guest.agent.get(`${endpoint}/export?${query}&dataset=tasks`).expect(200);
    await repo.models.projects.updateOne({ _id: project.id }, { $set: { archived: false } });
  });
  await check(
    'current workspace/project grant revocation denies both metrics and exports',
    async () => {
      await tenantRepo.models.workspaceMemberships.deleteOne({ ...scope, userId: ids[1] });
      await member.agent.get(endpoint).expect(404);
      await member.agent.get(`${endpoint}/export?dataset=tasks`).expect(404);
      const value = await report();
      assert(!value.workloads.some((row) => row.name === users[1]!.name));
    },
  );
  await check(
    'resource limits reject oversized task snapshots instead of returning partial metrics',
    async () => {
      const current = await repo.models.tasks.countDocuments({
        projectId: project.id,
        deletedAt: null,
      });
      const bulk = await repo.models.tasks.insertMany(
        Array.from({ length: 5001 - current }, (_, index) => ({
          ...scope,
          projectId: project.id,
          ...taskInput(`Limit task ${index}`),
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
      try {
        await owner.agent.get(`${endpoint}?${query}`).expect(422);
      } finally {
        await repo.models.tasks.deleteMany({ _id: { $in: bulk.map((row) => row._id) } });
      }
    },
  );
  await check(
    'activity limits reject excessive selected history while smaller date ranges remain usable',
    async () => {
      const existing = await repo.models.events.countDocuments({
        projectId: project.id,
        createdAt: { $gte: new Date(`${today}T00:00:00Z`) },
      });
      const rows = await repo.models.events.insertMany(
        Array.from({ length: 20001 - existing }, () => ({
          ...scope,
          projectId: project.id,
          actorId: ids[0],
          actorName: 'Bounded fixture',
          action: 'controlled activity limit',
          targetName: 'Synthetic bound',
          detail: '',
          createdAt: new Date(),
        })),
      );
      try {
        await owner.agent.get(`${endpoint}?${query}`).expect(422);
        await owner.agent.get(`${endpoint}?from=${date(-2)}&to=${date(-1)}`).expect(200);
      } finally {
        await repo.models.events.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
      }
    },
  );
  await check(
    'burndown bounds apply to the selected window, preserving smaller-range reports',
    async () => {
      const rows = await analytics.observations.insertMany(
        Array.from({ length: 10001 }, (_, index) => ({
          ...scope,
          projectId: project.id,
          sprintId: sprint,
          source: `bound:${index}`,
          observedAt: new Date(),
          total: 4,
          done: 3,
          remaining: 1,
          remainingHours: 6,
          unestimated: 0,
        })),
      );
      try {
        await owner.agent.get(`${endpoint}?${query}&sprint=${sprint}`).expect(422);
        await owner.agent
          .get(`${endpoint}?from=${date(-2)}&to=${date(-1)}&sprint=${sprint}`)
          .expect(200);
      } finally {
        await analytics.observations.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
      }
    },
  );
  await check('deleted parents cannot expose retained task or observation reports', async () => {
    await repo.models.projects.updateOne({ _id: project.id }, { $set: { deletedAt: new Date() } });
    await owner.agent.get(endpoint).expect(404);
    await owner.agent.get(`${endpoint}/export?dataset=burndown`).expect(404);
  });
  console.log(`Phase 10 integration: ${results.length} checks passed.`);
} finally {
  await analytics.observations.deleteMany({ organizationId: { $in: orgs } });
  for (const model of Object.values(analytics.planning.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  for (const model of Object.values(repo.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  await connection
    .collection('collaboration_messages')
    .deleteMany({ organizationId: { $in: orgs.map((id) => new mongoose.Types.ObjectId(id)) } });
  for (const name of ['workspaceMemberships', 'organizationMemberships', 'workspaces'] as const)
    await tenantRepo.models[name].deleteMany({ organizationId: { $in: orgs } });
  await tenantRepo.models.organizations.deleteMany({ _id: { $in: orgs } });
  await authRepo.models.sessions.deleteMany({ userId: { $in: ids } });
  await authRepo.models.users.deleteMany({ _id: { $in: ids } });
  await clearTestLoopbackLimits(connection.db);
  await connection.close();
}
