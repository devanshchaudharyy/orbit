import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(resolve(root, '.env.local'))) loadEnvFile(resolve(root, '.env.local'));
const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
const rootRequire = createRequire(import.meta.url);
let source;
try {
  source = new URL(process.env.MONGO_URI ?? '');
} catch {
  throw new Error('Invalid MongoDB configuration. Run pnpm setup before Compose verification.');
}
if (
  source.protocol !== 'mongodb:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname)
)
  throw new Error('Compose authentication checks require a loopback MongoDB service.');
source.pathname = '/orbit_test_auth';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  FILE_STORAGE_DRIVER: 's3',
  HOST: '127.0.0.1',
  PORT: '4001',
  APP_ORIGIN: 'http://127.0.0.1:5174',
  MONGO_URI: source.href,
  VITE_API_TARGET: 'http://127.0.0.1:4001',
  ORBIT_AUTH_ORIGIN: 'http://127.0.0.1:5174',
  ORBIT_AUTH_API: 'http://127.0.0.1:4001',
  ORBIT_AUTH_MONGO_URI: source.href,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM: 'ORBIT <fixture@orbit.local>',
  ORBIT_AUTH_MAILBOX: 'http://127.0.0.1:8025',
};
const children = [];
let stopped = false;
function stopOwnedChildren() {
  if (stopped) return;
  stopped = true;
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        /* This owned child may already have exited. */
      }
    } else child.kill('SIGTERM');
  }
}
process.once('SIGINT', () => {
  process.exitCode = 130;
  stopOwnedChildren();
});
process.once('SIGTERM', () => {
  process.exitCode = 143;
  stopOwnedChildren();
});
function start(command, args, cwd) {
  if (stopped) throw new Error('Authentication verification was interrupted.');
  const child = spawn(command, args, { env, cwd, windowsHide: true, stdio: 'inherit' });
  children.push(child);
  return child;
}
function finished(child) {
  return new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error('Authentication verification command failed.')),
    );
  });
}
async function ensureUnused(port) {
  await new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', () =>
      fail(
        new Error(
          `Authentication fixture port ${port} is occupied; existing processes were left untouched.`,
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(done));
  });
}
async function wait(url, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (stopped) throw new Error('Authentication verification was interrupted.');
    if (child.exitCode !== null)
      throw new Error('The owned authentication server stopped. Check fixture ports.');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* Local startup. */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('The authentication server did not become ready.');
}
try {
  await Promise.all([ensureUnused(4001), ensureUnused(5174)]);
  await finished(start(process.execPath, [resolve(root, 'scripts/pdf-assets.mjs')], root));
  const api = start(
    process.execPath,
    [apiRequire.resolve('tsx/cli'), 'src/server.ts'],
    resolve(root, 'apps/api'),
  );
  const vite = resolve(dirname(rootRequire.resolve('vite/package.json')), 'bin/vite.js');
  const web = start(
    process.execPath,
    [vite, '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    resolve(root, 'apps/web'),
  );
  await Promise.all([
    wait('http://127.0.0.1:4001/api/v1/health/live', api),
    wait('http://127.0.0.1:5174/', web),
  ]);
  await finished(start(process.execPath, [resolve(root, 'scripts/check-auth.mjs')], root));
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/auth-races.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [rootRequire.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.auth.config.ts'],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/tenants.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [rootRequire.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.tenants.config.ts'],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/teams.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [rootRequire.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.teams.config.ts'],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/projects.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [rootRequire.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.projects.config.ts'],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/views.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [rootRequire.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.views.config.ts'],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/planning.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [rootRequire.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.planning.config.ts'],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/collaboration.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [
        rootRequire.resolve('@playwright/test/cli'),
        'test',
        '-c',
        'playwright.collaboration.config.ts',
      ],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [apiRequire.resolve('tsx/cli'), resolve(root, 'tests/integration/documents.ts')],
      root,
    ),
  );
  await finished(
    start(
      process.execPath,
      [rootRequire.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.documents.config.ts'],
      root,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode ??= 1;
} finally {
  stopOwnedChildren();
}
