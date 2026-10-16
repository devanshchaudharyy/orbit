import { parseEnvironment } from '../apps/api/src/config/env.js';
import { createDependencies } from '../apps/api/src/infrastructure/dependencies.js';
import { createLogger } from '../apps/api/src/infrastructure/logger.js';
const env = parseEnvironment(process.env),
  dependencies = createDependencies(env, createLogger('silent'));
try {
  const report = await dependencies.check();
  if (!report.mongo || !report.redis)
    throw new Error('Worker prerequisites unavailable: MongoDB and Redis must both be reachable.');
  const state = await dependencies
    .mongo!.collection('ai_worker_state')
    .findOne({ seenAt: { $gte: new Date(Date.now() - 30000) } });
  if (!state)
    throw new Error('No recent automation worker heartbeat. Start pnpm worker and retry.');
  console.log('PASS automation worker: MongoDB, Redis and a recent successful dispatch heartbeat');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Worker check failed');
  process.exitCode = 1;
} finally {
  await dependencies.close();
}
