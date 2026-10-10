import type { Environment } from '../../config/env.js';
import type { Connection } from 'mongoose';
import { MongoAuthRepository } from './repository.js';
import { createAuthMailer } from './mail.js';
import { AuthService } from './service.js';

export function createAuthRuntime(
  env: Environment,
  connection: Connection,
  connect: () => Promise<boolean>,
) {
  return new AuthService(new MongoAuthRepository(connection, connect), createAuthMailer(env), env);
}
