import { parseEnvironment } from './config/env.js';
import { createLogger } from './infrastructure/logger.js';
import { createDependencies } from './infrastructure/dependencies.js';
import { createApp } from './app.js';
import { createAuthRuntime } from './modules/auth/runtime.js';
import { MongoTenantRepository } from './modules/tenants/repository.js';
import { TenantService } from './modules/tenants/service.js';
import { TeamRepository } from './modules/teams/repository.js';
import { createInvitationMailer } from './modules/teams/mail.js';
import { TeamService } from './modules/teams/service.js';
import { ProjectRepository } from './modules/projects/repository.js';
import { ProjectService } from './modules/projects/service.js';
import { createServer } from 'node:http';
import { CollaborationRepository } from './modules/collaboration/repository.js';
import { CollaborationService } from './modules/collaboration/service.js';
import { createRealtime } from './modules/collaboration/realtime.js';
import { DocumentRepository } from './modules/documents/repository.js';
import { DocumentService } from './modules/documents/service.js';
import { createPrivateStorage } from './modules/documents/storage.js';

const env = parseEnvironment(process.env);
const logger = createLogger(env.LOG_LEVEL);
const dependencies = createDependencies(env, logger);
if (!dependencies.mongo || !dependencies.connectMongo)
  throw new Error('Mongo adapter is not configured');
const auth = createAuthRuntime(env, dependencies.mongo, dependencies.connectMongo);
const tenants = new TenantService(new MongoTenantRepository(dependencies.mongo));
const teams = new TeamService(new TeamRepository(tenants.repository), createInvitationMailer(env));
const projects = new ProjectService(new ProjectRepository(tenants.repository));
const collaboration = new CollaborationService(new CollaborationRepository(projects.repository));
const documents = new DocumentService(
  new DocumentRepository(projects.repository),
  createPrivateStorage(env),
);
const server = createServer(
  createApp(dependencies, logger, auth, tenants, teams, projects, collaboration, documents),
);
const live = createRealtime(server, auth, tenants, collaboration, logger);
server.listen(env.PORT, env.HOST, () => logger.info({ port: env.PORT }, 'ORBIT API listening'));
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
  await live.close();
  await dependencies.close();
  clearTimeout(deadline);
  process.exitCode = 0;
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
