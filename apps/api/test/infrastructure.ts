import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import '../src/config/env.js';

const localHost = (value: string) => ['localhost', '127.0.0.1', '[::1]'].includes(value);
const localURL = z.url().refine((value) => {
  try {
    return localHost(new URL(value).hostname);
  } catch {
    return false;
  }
}, 'Infrastructure checks require loopback endpoints');
export const infrastructureSchema = z.object({
  MONGO_URI: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'mongodb:' && localHost(url.hostname) && url.port === '27017';
    } catch {
      return false;
    }
  }, 'Use the generated local MongoDB URI'),
  MONGO_TEST_DATABASE: z
    .string()
    .regex(/^orbit_test(?:_[a-z0-9]+)?$/)
    .default('orbit_test'),
  REDIS_URL: localURL,
  S3_ENDPOINT: localURL,
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().startsWith('orbit-'),
  SMTP_HOST: z.string().refine(localHost, 'Email checks require a loopback SMTP server'),
  SMTP_PORT: z.coerce.number().int().positive(),
  MAILPIT_URL: localURL,
});

export async function checkInfrastructure() {
  const result = infrastructureSchema.safeParse(process.env);
  if (!result.success) {
    console.error(
      'Infrastructure configuration is missing or unsafe. Run pnpm setup. Only local endpoints and orbit_test databases are allowed.',
    );
    return false;
  }
  const env = result.data;
  const runId = randomUUID();
  const timeout = 4000;
  const checks: [string, () => Promise<void>][] = [
    [
      'MongoDB: transaction commit, rollback, and reconnect persistence',
      async () => {
        const connection = await mongoose
          .createConnection(env.MONGO_URI, {
            dbName: env.MONGO_TEST_DATABASE,
            serverSelectionTimeoutMS: timeout,
            socketTimeoutMS: timeout,
          })
          .asPromise();
        const db = connection.db!;
        const collection = db.collection('phase0_smoke');
        await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        const session = await connection.startSession();
        try {
          await session.withTransaction(async () => {
            await collection.insertOne(
              { runId, kind: 'commit', expiresAt: new Date(Date.now() + 300000) },
              { session },
            );
          });
          session.startTransaction();
          await collection.insertOne(
            { runId, kind: 'rollback', expiresAt: new Date(Date.now() + 300000) },
            { session },
          );
          await session.abortTransaction();
          assert.equal(await collection.countDocuments({ runId, kind: 'commit' }), 1);
          assert.equal(await collection.countDocuments({ runId, kind: 'rollback' }), 0);
        } finally {
          await session.endSession();
          await connection.close();
        }
        const reconnect = await mongoose
          .createConnection(env.MONGO_URI, {
            dbName: env.MONGO_TEST_DATABASE,
            serverSelectionTimeoutMS: timeout,
            socketTimeoutMS: timeout,
          })
          .asPromise();
        try {
          assert.equal(
            await reconnect
              .db!.collection('phase0_smoke')
              .countDocuments({ runId, kind: 'commit' }),
            1,
          );
        } finally {
          await reconnect.db!.collection('phase0_smoke').deleteMany({ runId });
          await reconnect.close();
        }
      },
    ],
    [
      'Redis: isolated key round-trip and reconnect persistence',
      async () => {
        const options = {
          lazyConnect: true,
          connectTimeout: timeout,
          commandTimeout: timeout,
          retryStrategy: () => null,
          maxRetriesPerRequest: 0,
        };
        const key = `orbit:test:phase0:${runId}`;
        const redis = new Redis(env.REDIS_URL, options);
        redis.on('error', () => {});
        try {
          await redis.connect();
          await redis.set(key, runId, 'EX', 300);
          assert.equal(await redis.get(key), runId);
        } finally {
          redis.disconnect();
        }
        const reconnect = new Redis(env.REDIS_URL, options);
        reconnect.on('error', () => {});
        try {
          await reconnect.connect();
          assert.equal(await reconnect.get(key), runId);
          await reconnect.del(key);
        } finally {
          reconnect.disconnect();
        }
      },
    ],
    [
      'S3: private object upload, download, and deletion',
      async () => {
        const client = new S3Client({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
          forcePathStyle: true,
          maxAttempts: 1,
        });
        const object = { Bucket: env.S3_BUCKET, Key: `phase0-tests/${runId}.txt` };
        const options = () => ({ abortSignal: AbortSignal.timeout(timeout) });
        let uploaded = false;
        try {
          await client.send(
            new PutObjectCommand({ ...object, Body: runId, ContentType: 'text/plain' }),
            options(),
          );
          uploaded = true;
          const read = await client.send(new GetObjectCommand(object), options());
          assert.equal(await read.Body?.transformToString(), runId);
          const anonymous = await fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${object.Key}`, {
            signal: AbortSignal.timeout(timeout),
          });
          assert.ok([401, 403].includes(anonymous.status), 'Anonymous access must be denied');
          await client.send(new DeleteObjectCommand(object), options());
          uploaded = false;
          await assert.rejects(
            client.send(new HeadObjectCommand(object), options()),
            (error: unknown) =>
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ===
              404,
          );
        } finally {
          if (uploaded)
            await client
              .send(new DeleteObjectCommand(object), options())
              .catch(() =>
                console.warn(
                  'S3 cleanup failed; remove this run’s phase0-tests artifact after restoring the service.',
                ),
              );
          client.destroy();
        }
      },
    ],
    [
      'Mailpit: local SMTP submission and captured message content',
      async () => {
        const transport = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: false,
          connectionTimeout: timeout,
          greetingTimeout: timeout,
          socketTimeout: timeout,
        });
        try {
          await transport.sendMail({
            from: 'ORBIT Lab <lab@orbit.test>',
            to: 'smoke@example.test',
            subject: `ORBIT phase0 ${runId}`,
            text: `Local infrastructure check ${runId}`,
          });
        } finally {
          transport.close();
        }
        let captured: { ID: string } | undefined;
        for (let attempt = 0; attempt < 8 && !captured; attempt++) {
          const search = await fetch(
            `${env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`subject:${runId}`)}`,
            { signal: AbortSignal.timeout(timeout) },
          );
          assert.equal(search.status, 200);
          const body = (await search.json()) as { messages: { ID: string }[] };
          captured = body.messages[0];
          if (!captured) await new Promise((resolve) => setTimeout(resolve, 200));
        }
        assert.ok(
          captured && typeof captured.ID === 'string' && captured.ID.length > 0,
          'The submitted message must have a valid Mailpit ID',
        );
        try {
          const message = await fetch(`${env.MAILPIT_URL}/api/v1/message/${captured.ID}`, {
            signal: AbortSignal.timeout(timeout),
          });
          const content = (await message.json()) as { Text: string };
          assert.ok(content.Text.includes(runId));
        } finally {
          const deletion = await fetch(`${env.MAILPIT_URL}/api/v1/messages`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ IDs: [captured.ID] }),
            signal: AbortSignal.timeout(timeout),
          });
          assert.equal(deletion.status, 200);
        }
      },
    ],
  ];
  const results = await Promise.allSettled(
    checks.map(async ([label, check]) => {
      await check();
      console.log(`PASS ${label}`);
    }),
  );
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    if (result.status === 'rejected') {
      const error = result.reason as { code?: string; name?: string };
      console.error(
        `FAIL ${checks[index]![0]} (${error.code ?? error.name ?? 'service unavailable'})`,
      );
    }
  }
  const passed = results.every((result) => result.status === 'fulfilled');
  console.log(
    passed
      ? 'All local infrastructure checks passed.'
      : 'Infrastructure verification failed. Install/start Docker Desktop and run pnpm infra:up. No failed check counts as passed.',
  );
  return passed;
}
