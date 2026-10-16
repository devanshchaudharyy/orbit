import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';
const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const uri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { MongoClient, ObjectId } = apiRequire('mongoose').mongo;
const { hash, argon2id } = apiRequire('argon2');
const password = `Project browser ${randomUUID()}`;
let passwordHash: string;
const emails: string[] = [];
const orgIds: string[] = [];
async function database<T>(
  operation: (db: ReturnType<InstanceType<typeof MongoClient>['db']>) => Promise<T>,
) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    return await operation(client.db());
  } finally {
    await client.close();
  }
}
test.beforeAll(async () => {
  for (const value of [origin, uri])
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(value).hostname);
  expect(new URL(uri).pathname).toMatch(/^\/orbit_test(?:_[a-z0-9]+)?$/);
  passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
});
async function account(name: string) {
  const email = `project-browser-${randomUUID()}@example.test`;
  emails.push(email);
  const id = new ObjectId();
  await database(async (db) => {
    await clearTestLoopbackLimits(db);
    await db.collection('auth_users').insertOne({
      _id: id,
      email,
      name,
      passwordHash,
      jobTitle: 'Designer',
      timezone: 'UTC',
      useCase: 'team',
      emailVerified: true,
      onboardingCompleted: true,
      authRevision: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  return { email, id: String(id) };
}
async function signIn(page: Page, email: string, returnTo = '/app') {
  await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}${url.hash}` === returnTo);
}
async function setup(page: Page) {
  const owner = await account('Morgan Reed');
  const member = await account('Jules Park');
  const guest = await account('Tess Morris');
  await signIn(page, owner.email);
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await page.getByLabel('Organization name', { exact: true }).fill('Northstar Studio');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/organizations\/[a-f0-9]{24}$/);
  await expect(
    page.getByRole('heading', { name: 'Northstar Studio', exact: true, level: 1 }),
  ).toBeVisible();
  const org = new URL(page.url()).pathname.split('/').at(-1)!;
  orgIds.push(org);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Product studio');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/[a-f0-9]{24}$/);
  await expect(
    page.getByRole('heading', { name: 'Product studio', exact: true, level: 1 }),
  ).toBeVisible();
  const wsPath = new URL(page.url()).pathname;
  const ws = wsPath.split('/').at(-1)!;
  await database(async (db) => {
    for (const person of [member, guest]) {
      await db.collection('organization_memberships').insertOne({
        organizationId: new ObjectId(org),
        userId: new ObjectId(person.id),
        role: person === member ? 'member' : 'guest',
        version: 1,
        accessRevision: 0,
      });
      await db.collection('workspace_memberships').insertOne({
        organizationId: new ObjectId(org),
        workspaceId: new ObjectId(ws),
        userId: new ObjectId(person.id),
        accessRevision: 0,
      });
    }
  });
  await page.getByRole('link', { name: 'Open projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  return { owner, member, guest, org, ws, path: `${wsPath}/projects` };
}
async function project(page: Page, name = 'Website launch', template = 'blank') {
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page
    .getByLabel('Project description', { exact: true })
    .fill('A considered launch, one clear step at a time.');
  await page.getByLabel('Cover artwork', { exact: true }).selectOption('aurora');
  await page.getByLabel('Jules ParkMember', { exact: true }).check();
  await page.getByLabel('Tess MorrisGuest', { exact: true }).check();
  await page.getByLabel('Start from', { exact: true }).selectOption(template);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9]{24}$/);
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  return new URL(page.url()).pathname;
}
async function task(page: Page, title = 'Design the release experience') {
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill(title);
  await page
    .getByLabel('Task description', { exact: true })
    .fill('Review the experience across desktop, tablet and mobile.');
  await page.getByLabel('Task owner', { exact: true }).selectOption({ label: 'Jules Park' });
  await page.getByLabel('Jules ParkMember', { exact: true }).check();
  await page.getByLabel('Morgan ReedOwner', { exact: true }).check();
  await page.getByLabel('Due date (UTC calendar day)', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Add checklist item', exact: true }).click();
  await page.getByLabel('Checklist item 1', { exact: true }).fill('Review accessible states');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[a-f0-9]{24}$/);
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  return new URL(page.url()).pathname;
}
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}
async function audit(page: Page, name: string, triggerName?: string) {
  for (const theme of ['dark', 'light'])
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page
        .getByRole('button', { name: theme === 'dark' ? 'Dark theme' : 'Light theme', exact: true })
        .click();
      const trigger = triggerName
        ? page.getByRole('button', { name: triggerName, exact: true })
        : null;
      if (trigger) {
        await trigger.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        for (let index = 0; index < 16; index++) {
          await page.keyboard.press('Tab');
          expect(
            await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
          ).toBe(true);
        }
      }
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
      if (trigger) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
    }
}
async function api(page: Page, path: string, input?: unknown, method = 'POST') {
  const session = await page.request.get('/api/v1/auth/session');
  const { data } = await session.json();
  return page.request.fetch(`/api/v1/organizations${path}`, {
    method,
    headers: { Origin: origin, 'X-CSRF-Token': data.csrfToken },
    data: input ?? {},
  });
}
test.afterEach(async () => {
  await database(async (db) => {
    const users = await db
      .collection('auth_users')
      .find({ email: { $in: emails } })
      .toArray();
    const ids = users.map((user: { _id: unknown }) => user._id);
    const orgs = orgIds.map((id) => new ObjectId(id));
    for (const collection of [
      'projects',
      'tasks',
      'project_events',
      'sprint_burndown_observations',
      'ai_runs',
      'ai_workflows',
      'ai_usage',
      'work_preferences',
      'saved_task_filters',
      'project_milestones',
      'project_sprints',
      'task_plans',
      'project_capacities',
      'collaboration_messages',
      'collaboration_notifications',
      'team_invitations',
      'workspace_memberships',
      'organization_memberships',
      'workspaces',
    ])
      await db.collection(collection).deleteMany({ organizationId: { $in: orgs } });
    await db.collection('organizations').deleteMany({ _id: { $in: orgs } });
    await db.collection('auth_sessions').deleteMany({ userId: { $in: ids } });
    await db.collection('auth_users').deleteMany({ _id: { $in: ids } });
    await clearTestLoopbackLimits(db);
  });
  emails.length = 0;
  orgIds.length = 0;
});

export { account, database, setup, project, task, audit, api, signIn, ObjectId };
