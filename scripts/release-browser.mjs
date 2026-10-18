import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function verifyRelease(origin, mailbox, email, evidenceDirectory) {
  assert.equal(origin, 'https://localhost:8443');
  const browser = await chromium.launch();
  const results = [];
  const pass = (name) => {
    results.push(name);
    console.log(`PASS release ${name}`);
  };
  const artifacts = resolve('test-results/release');
  await mkdir(artifacts, { recursive: true });
  try {
    const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const response = await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Make space for great work.' })).toBeVisible();
    const headers = response.headers();
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert(headers['strict-transport-security'].includes('31536000'));
    assert(headers['content-security-policy'].includes("script-src 'self';"));
    assert(!headers['content-security-policy'].includes('unsafe-eval'));
    pass('HTTPS headers, CSP and uncached HTML');
    const script = await page.locator('script[type="module"]').getAttribute('src');
    const asset = await context.request.get(script, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(asset.status(), 200);
    assert(asset.headers()['cache-control'].includes('immutable'));
    assert.equal(asset.headers()['content-encoding'], 'gzip');
    assert.equal((await context.request.get('/assets/missing.js')).status(), 404);
    assert.equal((await context.request.get('/.env')).status(), 404);
    assert.equal((await context.request.get('/assets/missing.js.map')).status(), 404);
    pass('gzip, immutable assets and private/missing file denial');
    for (const state of ['live', 'ready']) {
      const health = await context.request.get(`/api/v1/health/${state}`);
      assert.equal(health.status(), 200);
      assert.equal(health.headers()['cache-control'], 'no-store');
      assert.equal((await health.json()).meta.requestId, health.headers()['x-request-id']);
    }
    pass('production API liveness and real MongoDB/Redis readiness');
    let session = (await (await context.request.get('/api/v1/auth/session')).json()).data;
    const cookies = await context.cookies();
    const cookie = cookies.find((c) => c.name === '__Host-orbit_session');
    assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/');
    pass('host-only Secure HttpOnly SameSite production cookie');
    async function mutate(path, data, method = 'POST', expected = 200) {
      const res = await context.request.fetch(`/api/v1${path}`, {
        method,
        headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
        data,
      });
      assert.equal(res.status(), expected, `Unexpected response to ${method} ${path}`);
      return (await res.json()).data;
    }
    const denied = await context.request.post('/api/v1/auth/register', {
      headers: { Origin: origin },
      data: {},
    });
    assert.equal(denied.status(), 403);
    const foreign = await context.request.post('/api/v1/auth/register', {
      headers: { Origin: 'https://foreign.example', 'X-CSRF-Token': session.csrfToken },
      data: {},
    });
    assert.equal(foreign.status(), 403);
    pass('missing CSRF and foreign Origin fail closed');
    const password = `Release acceptance ${crypto.randomUUID()}`;
    session = await mutate(
      '/auth/register',
      { name: 'Release verifier', email, password },
      'POST',
      201,
    );
    let verification;
    await expect
      .poll(
        async () => {
          const data = await fetch(
            `${mailbox}/api/v1/search?query=${encodeURIComponent(email)}`,
          ).then((r) => r.json());
          for (const message of data.messages ?? []) {
            const full = await fetch(
              `${mailbox}/api/v1/message/${encodeURIComponent(message.ID)}`,
            ).then((r) => r.json());
            const match = `${full.Text ?? ''}\n${full.HTML ?? ''}`.match(
              /\/auth\/verify-email#token=([a-f0-9]{64})/,
            );
            if (match) {
              verification = match[1];
              return true;
            }
          }
          return false;
        },
        { timeout: 10000 },
      )
      .toBe(true);
    await mutate('/auth/verify-email', { token: verification });
    await mutate('/auth/onboarding', {
      name: 'Release verifier',
      jobTitle: 'Tester',
      timezone: 'UTC',
      useCase: 'team',
    });
    pass('real registration, captured email, verification and onboarding');
    await page.goto('/app');
    await expect(
      page.getByRole('button', { name: 'Create organization', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Create organization', exact: true }).click();
    await page.getByLabel('Organization name', { exact: true }).fill('Release acceptance');
    await page.getByRole('button', { name: 'Create organization', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/organizations\/[a-f0-9]{24}$/);
    const organizationPath = new URL(page.url()).pathname;
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Release acceptance', exact: true, level: 1 }),
    ).toBeVisible();
    pass('browser mutation, durable organization and direct-route refresh');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByLabel('Workspace name', { exact: true }).fill('Release workspace');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces\/[a-f0-9]{24}$/);
    await page.getByRole('link', { name: 'Open projects', exact: true }).click();
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Release project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Release project', exact: true, level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await page
      .getByLabel('Task title', { exact: true })
      .fill('Release <img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: 'Release <img src=x onerror=alert(1)>',
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    pass('workspace, project and task transaction through production UI; escaped text');
    const taskRoute = new URL(page.url()).pathname;
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: 'Release <img src=x onerror=alert(1)>',
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    pass('saved task survives fresh production route');
    let scans = 0;
    for (const [name, path] of [
      ['marketing', '/'],
      ['workspace', organizationPath],
      ['task', taskRoute],
    ]) {
      await page.goto(path);
      for (const theme of ['dark', 'light'])
        for (const width of [375, 768, 1440]) {
          await page.setViewportSize({ width, height: 950 });
          await page
            .getByRole('button', {
              name: theme === 'dark' ? 'Dark theme' : 'Light theme',
              exact: true,
            })
            .click();
          await page.evaluate(() => document.fonts.ready);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const scan = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          assert.deepEqual(
            scan.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
            [],
          );
          scans++;
          await page.screenshot({
            path: resolve(artifacts, `release-${name}-${theme}-${width}.png`),
            fullPage: true,
          });
        }
    }
    pass('18 responsive axe scans: dark/light at 375/768/1440 with reduced motion');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#workspace-main')).toBeFocused();
    pass('persisted theme and keyboard skip navigation');
    const privateContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
    const privatePage = await privateContext.newPage();
    await privatePage.goto(taskRoute);
    await expect(
      privatePage.getByRole('heading', { name: 'Welcome back.', exact: true }),
    ).toBeVisible();
    assert.equal(new URL(privatePage.url()).searchParams.get('returnTo'), taskRoute);
    await privateContext.close();
    pass('unsigned visitor cannot open private task');
    await page.goto('/dev/design-system');
    await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
    pass('design lab excluded from release');
    assert.deepEqual(errors, [], 'Production browser must have no console/runtime/CSP errors');
    pass('no unexpected console, runtime or CSP errors');
    await context.close();
    const navigation = await page.evaluate(() => {
      const timing = performance.getEntriesByType('navigation')[0];
      return timing
        ? {
            domContentLoadedMs: Math.round(timing.domContentLoadedEventEnd),
            loadMs: Math.round(timing.loadEventEnd),
          }
        : null;
    });
    const report = {
      checks: results.length,
      axeScans: scans,
      screenshots: scans,
      finalRouteNavigation: navigation,
      results,
    };
    await writeFile(resolve(artifacts, 'summary.json'), JSON.stringify(report, null, 2));
    await writeFile(resolve(evidenceDirectory, 'summary.json'), JSON.stringify(report, null, 2));
    console.log(`All ${results.length} release checks passed; ${scans} axe scans and screenshots.`);
  } finally {
    await browser.close();
  }
}
