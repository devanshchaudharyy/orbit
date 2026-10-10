import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const server = spawn(
  process.execPath,
  [vite, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  { cwd: resolve(root, 'apps/web'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
let announced = false;
let startupError;
server.stdout.on('data', (data) => {
  if (data.toString().includes('http://127.0.0.1:4173')) announced = true;
});
server.on('error', (error) => {
  startupError = error;
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (startupError || server.exitCode !== null)
      throw new Error(
        'The owned production preview failed to start. Check that port 4173 is available.',
      );
    try {
      const response = await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(500) });
      if (announced && response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Await local startup. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
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
