import { parseEnvironment } from '../apps/api/src/config/env.js';
import { createPrivateStorage } from '../apps/api/src/modules/documents/storage.js';
import { DocumentRepository } from '../apps/api/src/modules/documents/repository.js';
import { DocumentService } from '../apps/api/src/modules/documents/service.js';
import { ProjectRepository } from '../apps/api/src/modules/projects/repository.js';
import { MongoTenantRepository } from '../apps/api/src/modules/tenants/repository.js';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const mongoose = require('mongoose');
const localEnvironment = new URL('../.env.local', import.meta.url);
if (existsSync(localEnvironment)) loadEnvFile(localEnvironment);
const env = parseEnvironment(process.env),
  connection = await mongoose
    .createConnection(env.MONGO_URI, { serverSelectionTimeoutMS: env.DEPENDENCY_TIMEOUT_MS })
    .asPromise();
try {
  const service = new DocumentService(
    new DocumentRepository(new ProjectRepository(new MongoTenantRepository(connection))),
    createPrivateStorage(env),
  );
  await service.ready();
  console.log(JSON.stringify(await service.reconcile()));
} finally {
  await connection.close();
}
