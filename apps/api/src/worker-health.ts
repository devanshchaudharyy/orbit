import { parseEnvironment } from './config/env.js';
import { createDependencies } from './infrastructure/dependencies.js';
import { createLogger } from './infrastructure/logger.js';

const dependencies = createDependencies(parseEnvironment(process.env), createLogger('silent'));
try {
  const report = await dependencies.check();
  if (!report.mongo || !report.redis) throw new Error('prerequisites');
  const state = await dependencies.mongo!.collection('ai_worker_state').findOne({
    seenAt: { $gte: new Date(Date.now() - 30_000) },
  });
  if (!state) throw new Error('heartbeat');
  console.log('PASS automation worker: MongoDB, Redis and a recent successful dispatch heartbeat');
} catch {
  console.error('Worker unavailable: check MongoDB, Redis and the recent dispatch heartbeat.');
  process.exitCode = 1;
} finally {
  await dependencies.close();
}
