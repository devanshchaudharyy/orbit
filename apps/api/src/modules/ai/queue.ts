import { Queue, Worker } from 'bullmq';
import type { AIService } from './service.js';
import { hash } from './calculations.js';
import { randomUUID } from 'node:crypto';
export function redisConnection(value: string) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
export function createAutomationQueue(
  service: AIService,
  redisUrl: string,
  onError: () => void,
  options: { name?: string; projectId?: string } = {},
) {
  const instance = randomUUID(),
    connection = redisConnection(redisUrl),
    queue = new Queue(options.name ?? 'orbit-ai-workflows', {
      connection: { ...connection, maxRetriesPerRequest: 1 },
    });
  queue.on('error', onError);
  const worker = new Worker<{ workflowId: string; version: number; due: string }>(
    options.name ?? 'orbit-ai-workflows',
    async (job) => {
      const { workflowId, version, due } = job.data;
      if (
        !/^[a-f0-9]{24}$/.test(workflowId) ||
        !Number.isSafeInteger(version) ||
        !Number.isFinite(Date.parse(due))
      )
        throw new Error('Invalid automation identifier');
      await service.executeWorkflow(workflowId, version, due);
    },
    { connection, concurrency: 1 },
  );
  worker.on('error', onError);
  worker.on('failed', (job) => {
    if (job && job.attemptsMade >= 3) {
      const { workflowId, version, due } = job.data;
      void service.workerFailure(workflowId, version, due).catch(onError);
    }
  });
  let dispatching = false;
  async function dispatch() {
    if (dispatching) return;
    dispatching = true;
    try {
      await service.ready();
      await worker.waitUntilReady();
      const rows = await service.repository.models.workflows
        .find({
          ...(options.projectId ? { projectId: options.projectId } : {}),
          enabled: true,
          deletedAt: null,
          nextRunAt: { $lte: service.repository.clock() },
        })
        .sort({ nextRunAt: 1, _id: 1 })
        .limit(100)
        .lean();
      for (const row of rows) {
        const data = {
          workflowId: String(row._id),
          version: row.version,
          due: row.nextRunAt.toISOString(),
        };
        const jobId = hash(data),
          existing = await queue.getJob(jobId);
        if (existing && (await existing.getState()) === 'failed') {
          await service.workerFailure(data.workflowId, data.version, data.due);
          continue;
        }
        await queue.add('draft', data, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 500 },
        });
      }
      await service.repository.models.workers.updateOne(
        { _id: instance },
        { $set: { seenAt: service.repository.clock() } },
        { upsert: true },
      );
    } finally {
      dispatching = false;
    }
  }
  return {
    instance,
    queue,
    worker,
    dispatch,
    async close() {
      await worker.close();
      await queue.close();
      await service.repository.models.workers.deleteOne({ _id: instance });
    },
  };
}
