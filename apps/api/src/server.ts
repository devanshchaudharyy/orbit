import { parseEnvironment } from './config/env.js';
import { createLogger } from './infrastructure/logger.js';
import { createDependencies } from './infrastructure/dependencies.js';
import { createApp } from './app.js';
import { createAuthRuntime } from './modules/auth/runtime.js';
import { MongoTenantRepository } from './modules/tenants/repository.js';
import { TenantService } from './modules/tenants/service.js';

const env = parseEnvironment(process.env);
const logger = createLogger(env.LOG_LEVEL);
const dependencies = createDependencies(env, logger);
if (!dependencies.mongo || !dependencies.connectMongo)
  throw new Error('Mongo adapter is not configured');
const auth = createAuthRuntime(env, dependencies.mongo, dependencies.connectMongo);
const tenants = new TenantService(new MongoTenantRepository(dependencies.mongo));
const server = createApp(dependencies, logger, auth, tenants).listen(env.PORT, env.HOST, () =>
  logger.info({ port: env.PORT }, 'ORBIT API listening'),
);
server.on('error', (error) => {
  logger.fatal({ code: (error as NodeJS.ErrnoException).code }, 'API failed to listen');
  process.exitCode = 1;
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down API');
  const deadline = setTimeout(() => process.exit(1), 5000).unref();
  server.close(async () => {
    await dependencies.close();
    clearTimeout(deadline);
    process.exitCode = 0;
  });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
