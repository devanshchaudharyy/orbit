import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { startAIProviderFixture } from '../tests/support/ai-provider.mjs';
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
  throw new Error('AI browser fixture requires an isolated loopback test database');
const isolatedMongo = new URL(sourceMongo);
isolatedMongo.pathname = `/orbit_test_aibrowser${randomUUID().replaceAll('-', '')}`;
const mongo = isolatedMongo.href;
const origin = 'http://127.0.0.1:5175',
  fixture = await startAIProviderFixture(),
  children = [];
const env = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '4002',
  LOG_LEVEL: 'silent',
  MONGO_URI: mongo,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:16379',
  APP_ORIGIN: origin,
  VITE_API_TARGET: 'http://127.0.0.1:4002',
  AI_PROVIDER: 'ollama',
  AI_MODEL: 'orbit-test-fixture',
  AI_BASE_URL: fixture.url,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '11025',
  ORBIT_AUTH_ORIGIN: origin,
  ORBIT_AUTH_MONGO_URI: mongo,
  ORBIT_AUTH_API: 'http://127.0.0.1:4002',
};
function start(args, cwd = root) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  return child;
}
async function wait(url, child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null)
      throw new Error('Owned AI fixture process exited; existing ports were left untouched');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('AI fixture startup timed out');
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
  for (const port of [4002, 5175])
    await new Promise((done, fail) => {
      const probe = createServer();
      probe.once('error', () =>
        fail(
          new Error(`AI fixture port ${port} is occupied; existing processes were left untouched`),
        ),
      );
      probe.listen(port, '127.0.0.1', () => probe.close(done));
    });
  const apiChild = start([api.resolve('tsx/cli'), 'src/server.ts'], resolve('apps/api'));
  await wait('http://127.0.0.1:4002/api/v1/health/live', apiChild);
  const web = start(
    [
      resolve(dirname(local.resolve('vite/package.json')), 'bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5175',
      '--strictPort',
    ],
    resolve('apps/web'),
  );
  await wait(origin, web);
  const browser = start([
    local.resolve('@playwright/test/cli'),
    'test',
    '-c',
    'playwright.ai.config.ts',
  ]);
  await new Promise((done, fail) => {
    browser.once('error', fail);
    browser.once('exit', (code) =>
      code === 0 ? done() : fail(new Error('AI browser verification failed')),
    );
  });
  console.log(
    `Explicit deterministic provider transport: ${fixture.requests.length} validated browser generation requests.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
  await fixture.close();
}
