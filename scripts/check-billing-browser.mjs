import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { startStripeFixture, stripeFixtureEnvironment } from '../tests/support/stripe-provider.mjs';
import { randomUUID } from 'node:crypto';
const root = process.cwd(),
  api = createRequire(resolve('apps/api/package.json')),
  local = createRequire(resolve('package.json'));
const sourceMongo =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(sourceMongo).hostname) ||
  !/^\/orbit_test(?:_[a-z0-9]+)?$/.test(new URL(sourceMongo).pathname)
)
  throw new Error('Billing browser fixture requires an isolated loopback test database');
const isolatedMongo = new URL(sourceMongo);
isolatedMongo.pathname = `/orbit_test_billingbrowser${randomUUID().replaceAll('-', '')}`;
const mongo = isolatedMongo.href;
const origin = 'http://127.0.0.1:5176',
  fixture = await startStripeFixture(),
  children = [];
const env = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '4003',
  LOG_LEVEL: 'silent',
  MONGO_URI: mongo,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:16379',
  APP_ORIGIN: origin,
  VITE_API_TARGET: 'http://127.0.0.1:4003',
  ...stripeFixtureEnvironment,
  ORBIT_STRIPE_FIXTURE_URL: fixture.url,
  AI_PROVIDER: 'disabled',

  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '11025',
  ORBIT_AUTH_ORIGIN: origin,
  ORBIT_AUTH_MONGO_URI: mongo,
  ORBIT_AUTH_API: 'http://127.0.0.1:4003',
};
function start(args, cwd = root) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  return child;
}
async function wait(url, child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null)
      throw new Error('Owned Billing fixture process exited; existing ports were left untouched');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('Billing fixture startup timed out');
}
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        /* already closed */
      }
    } else child.kill('SIGTERM');
  }
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const { createServer } = await import('node:net');
  for (const port of [4003, 5176])
    await new Promise((done, fail) => {
      const probe = createServer();
      probe.once('error', () =>
        fail(
          new Error(
            `Billing fixture port ${port} is occupied; existing processes were left untouched`,
          ),
        ),
      );
      probe.listen(port, '127.0.0.1', () => probe.close(done));
    });
  const apiChild = start(
    [api.resolve('tsx/cli'), resolve(root, 'tests/support/billing-api.ts')],
    resolve('apps/api'),
  );
  await wait('http://127.0.0.1:4003/api/v1/health/live', apiChild);
  const web = start(
    [
      resolve(dirname(local.resolve('vite/package.json')), 'bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5176',
      '--strictPort',
    ],
    resolve('apps/web'),
  );
  await wait(origin, web);
  const browser = start([
    local.resolve('@playwright/test/cli'),
    'test',
    '-c',
    'playwright.billing.config.ts',
    ...process.argv.slice(2),
  ]);
  await new Promise((done, fail) => {
    browser.once('error', fail);
    browser.once('exit', (code) =>
      code === 0 ? done() : fail(new Error('Billing browser verification failed')),
    );
  });
  console.log(`Explicit Stripe HTTP test fixture: ${fixture.requests.length} SDK requests.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
  await fixture.close();
}
