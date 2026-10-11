import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';

const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const mongoUri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { MongoClient, ObjectId } = requireApi('mongoose').mongo;
const { hash, argon2id } = requireApi('argon2');
const password = `Tenant browser ${randomUUID()}`;
const emails: string[] = [];
let passwordHash: string;
test.beforeAll(async () => {
  let target: URL;
  try {
    target = new URL(mongoUri);
  } catch {
    throw new Error('Tenant browser tests require a valid loopback test database.');
  }
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(target.hostname);
  expect(target.pathname).toMatch(/^\/orbit_test(?:_[a-z0-9]+)?$/);
  const endpoint = new URL(origin);
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(endpoint.hostname);
  passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
});
async function database<T>(
  operation: (db: ReturnType<InstanceType<typeof MongoClient>['db']>) => Promise<T>,
) {
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    return await operation(client.db());
  } finally {
    await client.close();
  }
}
async function signIn(page: Page, email?: string) {
  const address = email ?? `tenant-browser-${randomUUID()}@example.test`;
  if (!email) {
    emails.push(address);
    await database(async (db) => {
      await clearTestLoopbackLimits(db);
      await db.collection('auth_users').insertOne({
        email: address,
        name: 'Morgan Reed',
        passwordHash,
        jobTitle: 'Product designer',
        timezone: 'UTC',
        useCase: 'team',
        emailVerified: true,
        onboardingCompleted: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        authRevision: 0,
      });
    });
  }
  await page.goto('/auth/login?returnTo=%2Fapp');
  await page.getByLabel('Email address', { exact: true }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your organizations', exact: true }),
  ).toBeVisible();
  return address;
}
test.afterEach(async () => {
  await database(async (db) => {
    const users = await db
      .collection('auth_users')
      .find({ email: { $in: emails } })
      .toArray();
    const ids = users.map((u: { _id: unknown }) => u._id);
    const orgs = await db
      .collection('organizations')
      .find({ ownerId: { $in: ids } })
      .toArray();
    const orgIds = orgs.map((o: { _id: unknown }) => o._id);
    await db
      .collection('workspace_memberships')
      .deleteMany({ $or: [{ organizationId: { $in: orgIds } }, { userId: { $in: ids } }] });
    await db.collection('workspaces').deleteMany({ organizationId: { $in: orgIds } });
    await db
      .collection('organization_memberships')
      .deleteMany({ $or: [{ organizationId: { $in: orgIds } }, { userId: { $in: ids } }] });
    await db
      .collection('organizations')
      .deleteMany({ _id: { $in: orgIds }, ownerId: { $in: ids } });
    await db.collection('auth_sessions').deleteMany({ userId: { $in: ids } });
    await db.collection('auth_users').deleteMany({ _id: { $in: ids } });
    await clearTestLoopbackLimits(db);
  });
  emails.length = 0;
});
async function audit(page: Page, name: string) {
  for (const theme of ['dark', 'light'])
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page
        .getByRole('button', { name: `${theme === 'dark' ? 'Dark' : 'Light'} theme`, exact: true })
        .click();
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: `test-results/screenshots/${name}-${theme}-${width}.png`,
        fullPage: true,
      });
    }
}
async function createOrganization(page: Page, name = 'Northstar Studio') {
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await page.getByLabel('Organization name', { exact: true }).fill(name);
  await page.getByLabel('Description (optional)').fill('A home for thoughtful, connected work.');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}
async function createWorkspace(page: Page, name = 'Product studio') {
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill(name);
  await page.getByLabel('Description (optional)').fill('A focused space for our next chapter.');
  await page.getByLabel('Workspace time zone', { exact: true }).selectOption('Asia/Calcutta');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

test('real creation, persistence, switching, refresh and responsive workspace screens', async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await signIn(page);
  await audit(page, 'organizations-empty');
  await page.setViewportSize({ width: 1440, height: 950 });
  const orgA = await createOrganization(page);
  await audit(page, 'organization');
  const wsA = await createWorkspace(page);
  await audit(page, 'workspace');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Product studio', exact: true })).toBeVisible();
  await expect(page.getByText('Asia/Calcutta', { exact: true })).toBeVisible();
  await page.goto(orgA);
  const wsB = await createWorkspace(page, 'Client delivery');
  await page.getByRole('link', { name: 'P Product studio', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(wsA + '$'));
  await page.goto('/app');
  const orgB = await createOrganization(page, 'Fieldwork');
  await createWorkspace(page, 'Research room');
  await page
    .getByLabel('Switch organization', { exact: true })
    .selectOption(orgA.split('/').at(-1)!);
  await expect(page.getByRole('heading', { name: 'Northstar Studio', exact: true })).toBeVisible();
  await expect(page.locator('.tenant-resource-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Research room', exact: true })).toHaveCount(0);
  await page.goto(wsB);
  await page.goto('/app');
  await audit(page, 'organizations');
  await database(async (db) => {
    const organization = await db
      .collection('organizations')
      .findOne({ _id: new ObjectId(orgA.split('/').at(-1)!) });
    expect(organization).toBeTruthy();
    expect(
      await db.collection('workspaces').countDocuments({ organizationId: organization._id }),
    ).toBe(2);
  });
  expect(orgA).not.toBe(orgB);
  expect(errors).toEqual([]);
});

test('settings persist and a second tab receives a truthful version conflict', async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const email = await signIn(page);
  const org = await createOrganization(page);
  const ws = await createWorkspace(page);
  await page.goto(`${ws}/settings`);
  await expect(
    page.getByRole('heading', { name: 'Workspace settings', exact: true }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(`${ws}/settings`);
  await second.getByLabel('Workspace name', { exact: true }).waitFor();
  await page.getByLabel('Workspace name', { exact: true }).fill('Design collective');
  await page.getByLabel('Workspace time zone', { exact: true }).selectOption('Europe/London');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your settings are saved.' }),
  ).toBeVisible();
  await second.getByLabel('Workspace name', { exact: true }).fill('Stale edit');
  await second.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('changed in another session');
  await second.getByRole('button', { name: 'Reload latest settings' }).click();
  await expect(second.getByLabel('Workspace name', { exact: true })).toHaveValue(
    'Design collective',
  );
  await second.close();
  await audit(page, 'workspace-settings');
  await page.reload();
  await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue('Design collective');
  await page.goto(`${org}/settings`);
  await page.getByLabel('Organization name', { exact: true }).fill('Northstar collective');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your settings are saved.' }),
  ).toBeVisible();
  await audit(page, 'organization-settings');
  await database(async (db) => {
    const user = await db.collection('auth_users').findOne({ email });
    const resource = await db.collection('organizations').findOne({ ownerId: user._id });
    expect(resource.name).toBe('Northstar collective');
    const workspace = await db.collection('workspaces').findOne({ organizationId: resource._id });
    expect(workspace.name).toBe('Design collective');
    expect(workspace.timezone).toBe('Europe/London');
  });
});

test('creation dialogs validate, trap focus, restore it and support mobile navigation', async ({
  page,
}) => {
  await signIn(page);
  const trigger = page.getByRole('button', { name: 'Create organization', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('Organization name', { exact: true }).fill('Focus studio');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await createOrganization(page);
  await createWorkspace(page);
  await page.setViewportSize({ width: 375, height: 850 });
  await page.getByRole('button', { name: 'Open workspace navigation' }).click();
  await settle(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('dialog').getByRole('link', { name: 'Organization overview' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.tenant-resource-card')
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s');
});

test('foreign identifiers and missing membership render safe errors without tenant content', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const org = await createOrganization(page, 'Private original');
  const ws = await createWorkspace(page, 'Private workspace');
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other);
  await createOrganization(other, 'Other organization');
  await other.goto(ws);
  await expect(
    other.getByRole('heading', { name: 'A small interruption.', exact: true }),
  ).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Private workspace', exact: true })).toHaveCount(
    0,
  );
  await other.goto(`${org}/settings`);
  await expect(
    other.getByRole('heading', { name: 'A small interruption.', exact: true }),
  ).toBeVisible();
  await expect(other.getByLabel('Organization name', { exact: true })).toHaveCount(0);
  await otherContext.close();
  await database(async (db) => {
    const user = await db.collection('auth_users').findOne({ email: emails[0] });
    await db.collection('workspace_memberships').deleteOne({ userId: user._id });
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'A small interruption.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Private workspace', exact: true })).toHaveCount(
    0,
  );
});

test('unavailable tenant API retries honestly and signing out clears private routes', async ({
  page,
}) => {
  await signIn(page);
  await createOrganization(page);
  await page.route('**/api/v1/organizations', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'TENANT_UNAVAILABLE',
          message: 'Organization services are unavailable. Please try again shortly.',
        },
        meta: { requestId: '37dc6e3a-356d-4321-a482-fc0ab5111c86' },
      }),
    }),
  );
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'A small interruption.', exact: true }),
  ).toBeVisible();
  await page.unroute('**/api/v1/organizations');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.tenant-resource-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/auth\/login\?returnTo=%2Fapp$/);
  await expect(page.locator('.tenant-resource-card')).toHaveCount(0);
});

test('keyboard-only creation, navigation and settings stay usable', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Create organization', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Organization name', { exact: true })).toBeFocused();
  await page.keyboard.type('Keyboard studio');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Made using the keyboard.');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Create organization', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Keyboard studio', exact: true })).toBeVisible();
  const create = page.getByRole('button', { name: 'Create workspace', exact: true });
  for (let i = 0; i < 15 && !(await create.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(create).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Workspace name', { exact: true })).toBeFocused();
  await page.keyboard.type('Keyboard workspace');
  await page.keyboard.press('Tab');
  await page.keyboard.type('A focused space.');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Keyboard workspace', exact: true }),
  ).toBeVisible();
  const settings = page.getByRole('link', { name: 'Update workspace settings', exact: true });
  for (let i = 0; i < 15 && !(await settings.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(settings).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Workspace settings', exact: true }),
  ).toBeVisible();
});
