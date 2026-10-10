import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import type { Environment } from '../config/env.js';
import type { Logger } from 'pino';

export type DependencyReport = { mongo: boolean; redis: boolean };
export interface Dependencies {
  check(): Promise<DependencyReport>;
  close(): Promise<void>;
  mongo?: mongoose.Connection;
  connectMongo?: () => Promise<boolean>;
}

export function createDependencies(env: Environment, logger: Logger): Dependencies {
  const mongo = mongoose.createConnection();
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: env.DEPENDENCY_TIMEOUT_MS,
    commandTimeout: env.DEPENDENCY_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => logger.debug('Redis dependency unavailable'));
  let inFlight: Promise<DependencyReport> | undefined;
  let mongoInFlight: Promise<boolean> | undefined;

  async function attemptMongo(): Promise<boolean> {
    try {
      if (mongo.readyState !== 1) {
        await mongo.openUri(env.MONGO_URI, {
          serverSelectionTimeoutMS: env.DEPENDENCY_TIMEOUT_MS,
          connectTimeoutMS: env.DEPENDENCY_TIMEOUT_MS,
          socketTimeoutMS: env.DEPENDENCY_TIMEOUT_MS,
        });
      }
      await mongo.db?.admin().ping({ maxTimeMS: env.DEPENDENCY_TIMEOUT_MS });
      return mongo.readyState === 1;
    } catch {
      logger.debug('MongoDB dependency unavailable');
      return false;
    }
  }

  function checkMongo(): Promise<boolean> {
    mongoInFlight ??= attemptMongo().finally(() => {
      mongoInFlight = undefined;
    });
    return mongoInFlight;
  }

  async function checkRedis(): Promise<boolean> {
    try {
      if (['wait', 'end'].includes(redis.status)) await redis.connect();
      return (await redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  return {
    mongo,
    connectMongo: checkMongo,
    check() {
      if (!inFlight) {
        inFlight = Promise.all([checkMongo(), checkRedis()])
          .then(([mongoReady, redisReady]) => ({ mongo: mongoReady, redis: redisReady }))
          .finally(() => {
            inFlight = undefined;
          });
      }
      return inFlight;
    },
    async close() {
      redis.disconnect();
      await mongo.close();
    },
  };
}
