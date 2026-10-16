import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startAIProviderFixture } from '../support/ai-provider.mjs';
import { MongoAuthRepository } from '../../apps/api/src/modules/auth/repository.js';
import { MongoTenantRepository } from '../../apps/api/src/modules/tenants/repository.js';
import { ProjectRepository } from '../../apps/api/src/modules/projects/repository.js';
import { AIRepository } from '../../apps/api/src/modules/ai/repository.js';
import { AIService } from '../../apps/api/src/modules/ai/service.js';
import { createAutomationQueue } from '../../apps/api/src/modules/ai/queue.js';
import type { AIProvider } from '../../apps/api/src/modules/ai/provider.js';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url)),
  mongoose = require('mongoose'),
  { Redis } = require('ioredis');
const uri =
    process.env.ORBIT_AUTH_MONGO_URI ??
    'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true',
  redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:16379';
for (const value of [uri, redisUrl])
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname));
assert(/^\/orbit_test(?:_[a-z0-9]+)?$/.test(new URL(uri).pathname));
const redis = new Redis(redisUrl, {
  lazyConnect: true,
  connectTimeout: 1000,
  commandTimeout: 1000,
  retryStrategy: () => null,
  maxRetriesPerRequest: 0,
});
redis.on('error', () => {});
try {
  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');
} catch {
  throw new Error(
    'Real Redis is required for worker verification. Start Compose and run pnpm test:ai:worker with the isolated test MongoDB URI.',
  );
} finally {
  redis.disconnect();
}
const isolatedUri = new URL(uri),
  tag = randomUUID();
isolatedUri.pathname = `/orbit_test_aiworker${tag.replaceAll('-', '')}`;
const connection = await mongoose
    .createConnection(isolatedUri.href, { serverSelectionTimeoutMS: 3000 })
    .asPromise(),
  auth = new MongoAuthRepository(connection, async () => true),
  tenants = new MongoTenantRepository(connection),
  projects = new ProjectRepository(tenants),
  repo = new AIRepository(projects);
let calls = 0;
const provider: AIProvider = {
  name: 'Deterministic worker test provider',
  model: 'orbit-test-fixture',
  configured: true,
  generate: async () => {
    calls++;
    return {
      output: {
        answer: 'Explicit deterministic worker test draft.',
        references: [],
        tasks: [],
        priorities: [],
        matches: [],
      },
      inputTokens: 10,
      outputTokens: 10,
    };
  },
};
const service = new AIService(repo, provider),
  owner = String(new mongoose.Types.ObjectId()),
  orgs: string[] = [],
  results: string[] = [];
let runtime: ReturnType<typeof createAutomationQueue> | undefined;
async function check(name: string, operation: () => Promise<void>) {
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Worker result timed out');
}
try {
  await auth.ready();
  await repo.ready();
  await auth.models.users.create({
    _id: owner,
    email: `ai-worker-${tag}@example.test`,
    name: 'Worker fixture author',
    passwordHash: 'not-a-login-credential',
    emailVerified: true,
    onboardingCompleted: true,
  });
  const organization = await tenants.createOrganization(owner, {
    name: 'Isolated worker verification',
    description: '',
  });
  orgs.push(organization.id);
  const workspace = await tenants.createWorkspace(owner, organization.id, {
      name: 'Worker workspace',
      description: '',
      timezone: 'UTC',
    }),
    scope = { organizationId: organization.id, workspaceId: workspace.id };
  const project = await projects.create(owner, scope, {
    name: 'Worker fixture project',
    description: 'No product seed.',
    status: 'active',
    priority: 'normal',
    cover: 'orbit',
    ownerId: owner,
    memberIds: [],
    template: 'blank',
  });
  const workflow = await repo.saveWorkflow(owner, scope, project.id, {
    name: 'Scheduled briefing',
    mode: 'weekly-report',
    frequency: 'weekly',
    weekday: 1,
    hour: 9,
    enabled: true,
    confirmed: true,
  });
  const name = `orbit-ai-test-${tag}`,
    due = new Date(Date.now() - 1000);
  await repo.models.workflows.updateOne({ _id: workflow.id }, { $set: { nextRunAt: due } });
  runtime = createAutomationQueue(service, redisUrl, () => {}, { name, projectId: project.id });
  await check(
    'real Redis dispatch carries only identifiers and deduplicates a durable scheduled run',
    async () => {
      await runtime!.dispatch();
      await runtime!.dispatch();
      await eventually(
        async () => !!(await repo.models.workflows.findById(workflow.id).lean())?.lastRunId,
      );
      assert.equal(calls, 1);
      const jobs = await runtime!.queue.getJobs(['completed', 'active', 'waiting']);
      assert(jobs.length >= 1);
      assert.deepEqual(Object.keys(jobs[0]!.data).sort(), ['due', 'version', 'workflowId']);
      assert.equal((await repo.list(owner, scope, project.id)).workerOnline, true);
    },
  );
  await check(
    'closing and recreating the worker preserves MongoDB delivery state and avoids duplicate output',
    async () => {
      await runtime!.close();
      runtime = createAutomationQueue(service, redisUrl, () => {}, { name, projectId: project.id });
      await runtime.dispatch();
      await new Promise((done) => setTimeout(done, 300));
      assert.equal(calls, 1);
      assert.equal(
        await repo.models.runs.countDocuments({ projectId: project.id, source: 'automation' }),
        1,
      );
    },
  );
  await check(
    'paused workflow jobs are harmless even when an older identifier remains in Redis',
    async () => {
      await repo.models.workflows.updateOne(
        { _id: workflow.id },
        { $set: { enabled: false }, $inc: { version: 1 } },
      );
      const job = await runtime!.queue.add(
        'draft',
        { workflowId: workflow.id, version: 1, due: due.toISOString() },
        { jobId: `paused-${tag}`, removeOnComplete: { count: 20 } },
      );
      await eventually(async () => (await job.getState()) === 'completed');
      assert.equal(calls, 1);
    },
  );
  await check(
    'revoked workspace membership prevents a queued workflow from calling the provider',
    async () => {
      const nextDue = new Date(Date.now() - 1000);
      await repo.models.workflows.updateOne(
        { _id: workflow.id },
        { $set: { enabled: true, nextRunAt: nextDue } },
      );
      await tenants.models.workspaceMemberships.deleteOne({ ...scope, userId: owner });
      await runtime!.dispatch();
      await eventually(
        async () => !!(await repo.models.workflows.findById(workflow.id).lean())?.lastError,
      );
      assert.equal(calls, 1);
      assert((await repo.models.workflows.findById(workflow.id).lean())!.nextRunAt > new Date());
    },
  );
  await check('graceful close removes the worker heartbeat', async () => {
    const instance = runtime!.instance;
    await eventually(async () => (await runtime!.queue.getActiveCount()) === 0);
    await runtime!.queue.obliterate({ force: true });
    await runtime!.close();
    runtime = undefined;
    assert.equal(await repo.models.workers.countDocuments({ _id: instance }), 0);
  });
  await check(
    'separate persistent worker boots, produces a validated SDK draft and passes its operational check',
    async () => {
      await tenants.models.workspaceMemberships.create({ ...scope, userId: owner });
      const due = new Date(Date.now() - 1000),
        before = String((await repo.models.workflows.findById(workflow.id).lean())!.lastRunId);
      await repo.models.workflows.updateOne(
        { _id: workflow.id },
        { $set: { enabled: true, nextRunAt: due, lastError: null } },
      );
      const fixture = await startAIProviderFixture(),
        env = {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
          MONGO_URI: isolatedUri.href,
          REDIS_URL: redisUrl,
          FILE_STORAGE_DRIVER: 'disk',
          AI_PROVIDER: 'ollama',
          AI_MODEL: 'orbit-test-fixture',
          AI_BASE_URL: fixture.url,
          AI_QUEUE_NAME: `orbit-ai-process-test-${tag}`,
        };
      const child = spawn(
        process.execPath,
        [require.resolve('tsx/cli'), resolve('apps/api/src/worker.ts')],
        { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let diagnostic = '';
      child.stderr?.on('data', (chunk) => {
        diagnostic += String(chunk);
      });
      try {
        await eventually(async () => {
          if (child.exitCode !== null)
            throw new Error(
              `Owned worker exited ${child.exitCode}; ${diagnostic.replaceAll(isolatedUri.href, '[test-db]')}`,
            );
          const current = await repo.models.workflows.findById(workflow.id).lean();
          return !!current?.lastRunId && String(current.lastRunId) !== before;
        });
        assert.equal(fixture.requests.length, 1);
        const record = await repo.models.runs
          .findOne({ projectId: project.id, model: 'orbit-test-fixture', status: 'ready' })
          .sort({ _id: -1 })
          .lean();
        assert(record);
        assert.equal(record.provider, 'Deterministic test fixture');
        const probe = spawn(
          process.execPath,
          [require.resolve('tsx/cli'), resolve('scripts/worker-check.ts')],
          { env, windowsHide: true, stdio: 'ignore' },
        );
        await new Promise<void>((done, fail) => {
          probe.once('error', fail);
          probe.once('exit', (code) =>
            code === 0 ? done() : fail(new Error('Separate worker operational check failed')),
          );
        });
      } finally {
        if (child.exitCode === null) {
          if (process.platform === 'win32')
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          else {
            child.kill('SIGTERM');
            await new Promise<void>((done, fail) => {
              const deadline = setTimeout(() => {
                child.kill('SIGKILL');
                fail(new Error('Owned worker did not shut down'));
              }, 10000);
              child.once('exit', () => {
                clearTimeout(deadline);
                done();
              });
            });
          }
        }
        await fixture.close();
        const cleaner = createAutomationQueue(service, redisUrl, () => {}, {
          name: env.AI_QUEUE_NAME,
          projectId: project.id,
        });
        await cleaner.queue.obliterate({ force: true });
        await cleaner.close();
      }
    },
  );
  console.log(`Phase 11 real Redis worker: ${results.length} checks passed.`);
} finally {
  if (runtime) {
    await runtime.queue.obliterate({ force: true }).catch(() => {});
    await runtime.close();
  }
  for (const model of [repo.models.runs, repo.models.workflows, repo.models.usage])
    await model.deleteMany({ organizationId: { $in: orgs } });
  for (const model of Object.values(projects.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  for (const model of Object.values(repo.planning.models))
    await model.deleteMany({ organizationId: { $in: orgs } });
  await connection
    .collection('sprint_burndown_observations')
    .deleteMany({ organizationId: { $in: orgs.map((id) => new mongoose.Types.ObjectId(id)) } });
  for (const key of ['workspaceMemberships', 'organizationMemberships', 'workspaces'] as const)
    await tenants.models[key].deleteMany({ organizationId: { $in: orgs } });
  await tenants.models.organizations.deleteMany({ _id: { $in: orgs } });
  await auth.models.users.deleteOne({ _id: owner });
  await connection.close();
}
