import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { verifyRelease } from './release-browser.mjs';

if (existsSync('.env.local')) loadEnvFile('.env.local');
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { MongoClient } = requireApi('mongoose').mongo;
const token = randomUUID().replaceAll('-', '');
const directory = resolve('.local', 'release-smoke', token);
const source = new URL(process.env.MONGO_URI ?? '');
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname),
  'Release smoke requires loopback MongoDB',
);
source.pathname = `/orbit_test_release${token}`;
const localUri = source.href;
const email = `release-${token}@example.test`;
const mailbox = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(mailbox).hostname));
const composeFile = 'infra/release/compose.yaml';
const releaseEnv = resolve(directory, 'runtime.env');
const childEnv = {
  ...process.env,
  ORBIT_RELEASE_ENV: releaseEnv,
  ORBIT_TLS_DIRECTORY: directory,
  ORBIT_RELEASE_TAG: 'verify',
};
let started = false;
const queueName = `orbit-release-${token}`;
function run(command, args, quiet = false) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      env: childEnv,
      windowsHide: true,
      stdio: quiet ? 'ignore' : 'inherit',
    });
    child.once('error', () => fail(new Error(`Required executable is unavailable: ${command}`)));
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${command} verification failed (${code})`)),
    );
  });
}
const override = resolve(directory, 'dependencies.yaml');
const compose = (...args) =>
  run('docker', [
    'compose',
    '-f',
    composeFile,
    ...(existsSync(override) ? ['-f', override] : []),
    '-p',
    `orbit-verify-${token}`,
    ...args,
  ]);
function containerUrl(value, hostname) {
  const url = new URL(value);
  assert(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'Smoke dependencies must be loopback services',
  );
  url.hostname = hostname;
  return url.href;
}
try {
  // Docker/WSL are never installed by this command. No public port or image push.
  await run('docker', ['version'], true);
  await mkdir(directory, { recursive: true });
  const configuration = {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://localhost:8443',
    MONGO_URI: containerUrl(localUri, 'mongo'),
    REDIS_URL: containerUrl(process.env.REDIS_URL, 'redis'),
    FILE_STORAGE_DRIVER: 's3',
    S3_ENDPOINT: containerUrl(process.env.S3_ENDPOINT, 'garage'),
    S3_REGION: process.env.S3_REGION,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
    SMTP_HOST: 'mailpit',
    SMTP_PORT: process.env.SMTP_PORT ?? '1025',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'ORBIT <release@orbit.local>',
    LOG_LEVEL: 'warn',
    AI_PROVIDER: 'disabled',
    AI_QUEUE_NAME: queueName,
    BILLING_MODE: 'disabled',
  };
  for (const value of Object.values(configuration))
    assert(
      typeof value === 'string' && !/[\r\n]/.test(value),
      'Missing or invalid smoke configuration',
    );
  // Compose env files accept single-quoted literal values. Never echo their contents.
  await writeFile(
    releaseEnv,
    Object.entries(configuration)
      .map(([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`)
      .join('\n'),
    { mode: 0o600 },
  );
  await run(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      resolve(directory, 'privkey.pem'),
      '-out',
      resolve(directory, 'fullchain.pem'),
    ],
    true,
  );
  // Self-signed synthetic smoke key only; real keys must use group/owner access for nginx.
  await chmod(resolve(directory, 'privkey.pem'), 0o644);
  await compose('build');
  // Join only the existing owned local Compose network; published services stay loopback-only.
  await writeFile(
    override,
    'services:\n  api:\n    networks:\n      dependencies: {}\n  worker:\n    networks:\n      dependencies: {}\nnetworks:\n  dependencies:\n    external: true\n    name: orbit-local_default\n',
  );
  started = true;
  await run('docker', [
    'compose',
    '-f',
    composeFile,
    '-f',
    override,
    '-p',
    `orbit-verify-${token}`,
    '--profile',
    'worker',
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '90',
  ]);
  await compose(
    'exec',
    '-T',
    'api',
    'node',
    '--input-type=module',
    '-e',
    "import assert from 'node:assert/strict';import{existsSync}from'node:fs';assert(process.getuid()>0);await import('argon2');await import('@orbit/contracts');assert(!existsSync('/app/apps/api/src'));assert(!existsSync('/app/apps/api/test'));assert(!existsSync('/app/.env.local'));let absent=false;try{await import('tsx')}catch{absent=true}assert(absent);",
  );
  await compose('exec', '-T', 'web', 'sh', '-c', 'test "$(id -u)" != 0');
  console.log('PASS release non-root API/web images and worker readiness');
  await verifyRelease('https://localhost:8443', mailbox, email, directory);
} catch (error) {
  if (started) {
    await compose('ps', '--all').catch(() => {});
    await compose('logs', '--no-color', '--tail', '20', 'web').catch(() => {});
  }
  // Process/driver errors can contain configuration. Keep the report content-free.
  console.error(
    error instanceof assert.AssertionError ||
      error?.message?.startsWith('Required executable is unavailable:')
      ? error.message
      : 'Release verification could not complete; check Docker, services and the preceding failing step.',
  );
  process.exitCode = 1;
} finally {
  if (started)
    await compose('down', '--remove-orphans').catch(() => {
      process.exitCode = 1;
    });
  // Drop only this uniquely generated database and this exact account's captured mail.
  if (started) {
    const client = new MongoClient(localUri, { serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      assert.equal(client.db().databaseName, `orbit_test_release${token}`);
      await client.db().dropDatabase();
      const { Queue } = requireApi('bullmq');
      const { Redis } = requireApi('ioredis');
      const redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
      });
      const queue = new Queue(queueName, { connection: redis });
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
        redis.disconnect();
      }
      const response = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(email)}`);
      assert(response.ok);
      const data = await response.json();
      const IDs = (data.messages ?? []).map((message) => message.ID);
      if (IDs.length)
        assert(
          (
            await fetch(`${mailbox}/api/v1/messages`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ IDs }),
            })
          ).ok,
        );
    } catch {
      console.error('Owned release fixture cleanup requires attention.');
      process.exitCode = 1;
    } finally {
      await client.close();
    }
  }
}
