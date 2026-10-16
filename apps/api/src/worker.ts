import { parseEnvironment } from './config/env.js';
import { createLogger } from './infrastructure/logger.js';
import { createDependencies } from './infrastructure/dependencies.js';
import { MongoTenantRepository } from './modules/tenants/repository.js';
import { ProjectRepository } from './modules/projects/repository.js';
import { createAuthRuntime } from './modules/auth/runtime.js';
import { AIRepository } from './modules/ai/repository.js';
import { AIService } from './modules/ai/service.js';
import { createAIProvider } from './modules/ai/provider.js';
import { createAutomationQueue } from './modules/ai/queue.js';
const env = parseEnvironment(process.env),
  logger = createLogger(env.LOG_LEVEL),
  dependencies = createDependencies(env, logger);
if (!dependencies.mongo || !dependencies.connectMongo)
  throw new Error('Mongo adapter is not configured');
createAuthRuntime(env, dependencies.mongo, dependencies.connectMongo);
const service = new AIService(
  new AIRepository(new ProjectRepository(new MongoTenantRepository(dependencies.mongo))),
  createAIProvider(env),
);
const runtime = createAutomationQueue(
  service,
  env.REDIS_URL,
  () => logger.error('Automation Redis connection unavailable'),
  { name: env.AI_QUEUE_NAME },
);
const dispatch = () => {
  void dependencies.connectMongo!()
    .then((connected) => {
      if (!connected) throw new Error('Mongo unavailable');
      return runtime.dispatch();
    })
    .catch(() => logger.error('Automation dispatch unavailable'));
};
const interval = setInterval(dispatch, 10000);
dispatch();
logger.info('ORBIT automation worker started');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  const deadline = setTimeout(() => process.exit(1), 100000).unref();
  await runtime.close();
  await dependencies.close();
  clearTimeout(deadline);
  logger.info('Automation worker stopped');
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
