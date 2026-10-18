// Owned browser fixture only. Production server never reads a provider host override.
import { createRequire } from 'node:module';
import { parseEnvironment } from '../../apps/api/src/config/env.js';
import { createDependencies } from '../../apps/api/src/infrastructure/dependencies.js';
import { createLogger } from '../../apps/api/src/infrastructure/logger.js';
import { createAuthRuntime } from '../../apps/api/src/modules/auth/runtime.js';
import { MongoTenantRepository } from '../../apps/api/src/modules/tenants/repository.js';
import { TenantService } from '../../apps/api/src/modules/tenants/service.js';
import { ProjectRepository } from '../../apps/api/src/modules/projects/repository.js';
import { ProjectService } from '../../apps/api/src/modules/projects/service.js';
import { BillingRepository } from '../../apps/api/src/modules/billing/repository.js';
import { BillingService } from '../../apps/api/src/modules/billing/service.js';
import { createBillingProvider } from '../../apps/api/src/modules/billing/provider.js';
import { createApp } from '../../apps/api/src/app.js';
import { createServer } from 'node:http';
import { createRealtime } from '../../apps/api/src/modules/collaboration/realtime.js';
import { CollaborationRepository } from '../../apps/api/src/modules/collaboration/repository.js';
import { CollaborationService } from '../../apps/api/src/modules/collaboration/service.js';
const Stripe = createRequire(new URL('../../apps/api/package.json', import.meta.url))('stripe');
const env = parseEnvironment(process.env),
  logger = createLogger('silent'),
  dependencies = createDependencies(env, logger);
const url = new URL(process.env.ORBIT_STRIPE_FIXTURE_URL!);
if (
  env.NODE_ENV !== 'test' ||
  url.hostname !== '127.0.0.1' ||
  !/^\/orbit_test_/.test(new URL(env.MONGO_URI).pathname)
)
  throw new Error('Explicit loopback test fixture required');
const tenants = new TenantService(new MongoTenantRepository(dependencies.mongo!)),
  auth = createAuthRuntime(env, dependencies.mongo!, dependencies.connectMongo!),
  projects = new ProjectService(new ProjectRepository(tenants.repository));
const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  host: url.hostname,
  port: Number(url.port),
  protocol: 'http',
  timeout: 1000,
  maxNetworkRetries: 0,
});
const billing = new BillingService(
  new BillingRepository(tenants.repository),
  createBillingProvider(env, stripe),
);
const collaboration = new CollaborationService(new CollaborationRepository(projects.repository));
const server = createServer(
  createApp(
    dependencies,
    logger,
    auth,
    tenants,
    undefined,
    projects,
    collaboration,
    undefined,
    undefined,
    billing,
  ),
);
const live = createRealtime(server, auth, tenants, collaboration, logger);
server.listen(env.PORT, env.HOST);
async function close() {
  await live.close();
  await dependencies.close();
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
