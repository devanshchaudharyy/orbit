import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
await new Promise((done, fail) => {
  const probe = createServer();
  probe.once('error', () =>
    fail(
      new Error(
        'Production verification port 4173 is occupied. Existing processes were left untouched.',
      ),
    ),
  );
  probe.listen(4173, '127.0.0.1', () => probe.close(done));
});
const server = spawn(
  process.execPath,
  [vite, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  { cwd: resolve(root, 'apps/web'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
let startupError;
server.stdout.resume();
server.stderr.resume();
server.on('error', (error) => {
  startupError = error;
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (startupError || server.exitCode !== null)
      throw new Error(
        'The owned production preview failed to start. Check that port 4173 is available.',
      );
    try {
      const response = await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Await local startup. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Production preview must start');
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of ['/', '/dev/design-system']) {
    await page.goto(`http://127.0.0.1:4173${path}`);
    await page
      .getByRole('heading', {
        name: path === '/' ? 'Make space for great work.' : 'Page not found',
        exact: true,
      })
      .waitFor();
    assert.equal(await page.locator('.lab-layout').count(), 0);
    console.log(
      `PASS production ${path === '/' ? 'marketing homepage' : 'lab route excluded'} at ${path}`,
    );
  }
  await page.goto('http://127.0.0.1:4173/auth/register');
  await page.getByRole('heading', { name: 'Find your orbit.', exact: true }).waitFor();
  await page.reload();
  await page.getByLabel('Email address', { exact: true }).waitFor();
  console.log('PASS production account registration loads on direct-route refresh');
  await page.goto('http://127.0.0.1:4173/auth/reset-password');
  await page.getByRole('alert').filter({ hasText: 'This reset link is incomplete.' }).waitFor();
  assert.equal(await page.getByLabel('New password', { exact: true }).count(), 0);
  console.log('PASS production password reset rejects an incomplete token link');
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { user: null, csrfToken: 'a'.repeat(64) },
        meta: { requestId: '37dc6e3a-356d-4321-a482-fc0ab5111c86' },
      }),
    }),
  );
  for (const path of [
    '/app',
    `/app/organizations/${'a'.repeat(24)}/team`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/settings`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}/tasks/${'d'.repeat(24)}`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}?section=collaboration`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}?section=collaboration&collaboration=inbox`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}?section=documents`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}?section=documents&document=${'d'.repeat(24)}`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}?section=documents&library=files`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}?section=analytics`,
    `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}?section=analytics&from=2026-10-01&to=2026-10-14&sprint=${'d'.repeat(24)}`,
  ]) {
    await page.goto(`http://127.0.0.1:4173${path}`);
    await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), path);
    console.log(`PASS production protected direct route ${path} requires sign-in`);
  }
  const filteredProject = `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}`;
  await page.goto(`http://127.0.0.1:4173${filteredProject}?view=kanban`);
  await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('returnTo'), filteredProject);
  console.log(
    'PASS production protected filtered project returns to its canonical project after sign-in',
  );
  await page.goto('http://127.0.0.1:4173/invitations/accept');
  await page.getByRole('alert').filter({ hasText: 'Reopen the invitation link' }).waitFor();
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'Reopen the invitation link' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).count(),
    0,
  );
  console.log('PASS production invitation direct-route refresh handles missing credentials safely');
  const files = await readdir(resolve(root, 'apps/web/dist/assets'));
  for (const file of files.filter((file) => file.endsWith('.js'))) {
    assert.ok(
      !(await readFile(resolve(root, 'apps/web/dist/assets', file), 'utf8')).includes(
        'Built for clarity.',
      ),
      'Default JavaScript must omit the lab content',
    );
  }
  console.log('PASS production JavaScript excludes lab content');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
