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
  await expect(page).toHaveURL(new RegExp(`${returnTo}$`));
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

test('real project/task/subtask/assignment/label/filter/history flows across themes and viewports', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const fixture = await setup(page);
  await audit(page, 'projects-empty');
  await audit(page, 'project-create-dialog', 'Create project');
  await page.setViewportSize({ width: 1440, height: 950 });
  const projectPath = await project(page);
  await audit(page, 'project-empty');
  await page.getByRole('button', { name: 'Add project label', exact: true }).click();
  await page.getByLabel('Label name', { exact: true }).fill('Design');
  await page.getByRole('button', { name: 'Create label', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const taskPath = await task(page);
  await audit(page, 'task-detail');
  await audit(page, 'task-edit-sheet', 'Edit task');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'Create subtask', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Review mobile navigation');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review mobile navigation', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open parent task', exact: true }).click();
  await expect(
    page.getByRole('link').filter({ hasText: 'Review mobile navigation' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await page.getByLabel('Task status', { exact: true }).selectOption('done');
  await page.getByLabel('Complete checklist item 1', { exact: true }).check();
  await page.getByLabel('Design', { exact: true }).check();
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Design the release experience', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Review accessible states', { exact: true })).toHaveClass(
    /completed/,
  );
  await page.goto(projectPath);
  await expect(page.getByRole('heading', { name: 'Website launch', exact: true })).toBeVisible();
  await expect(page.getByText('of 2 tasks & subtasks complete', { exact: true })).toBeVisible();
  await audit(page, 'project-populated');
  await page.getByLabel('Status', { exact: true }).selectOption('done');
  await page.getByLabel('Label', { exact: true }).selectOption({ label: 'Design' });
  await expect(page.getByRole('link').filter({ hasText: 'Review mobile navigation' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('link').filter({ hasText: 'Design the release experience' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('done');
  await expect(page.getByLabel('Label', { exact: true })).not.toHaveValue('');
  await audit(page, 'project-filtered');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity history', exact: true })).toBeVisible();
  await expect(page.getByText('todo → done', { exact: true })).toBeVisible();
  await page.goto(fixture.path);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await audit(page, 'projects-populated');
  await database(async (db) => {
    const record = await db
      .collection('tasks')
      .findOne({ _id: new ObjectId(taskPath.split('/').at(-1)!) });
    expect(record.status).toBe('done');
    expect(record.assigneeIds).toHaveLength(2);
    expect(record.checklist[0].done).toBe(true);
  });
  expect(errors).toEqual([]);
});
test('two-tab stale task and project edits require reloading and preserve newer writes', async ({
  page,
  context,
}) => {
  const fixture = await setup(page);
  const projectPath = await project(page);
  const taskPath = await task(page);
  const other = await context.newPage();
  await other.goto(taskPath);
  await expect(
    other.getByRole('heading', { name: 'Design the release experience', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Stale title');
  await other.getByRole('button', { name: 'Edit task', exact: true }).click();
  await other.getByLabel('Task title', { exact: true }).fill('Latest task title');
  await other.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  await page.getByRole('button', { name: 'Reload latest record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Latest task title', exact: true })).toBeVisible();
  await page.goto(projectPath);
  await other.goto(projectPath);
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Stale project');
  await other.getByRole('button', { name: 'Project settings', exact: true }).click();
  await other.getByLabel('Project name', { exact: true }).fill('Latest project');
  await other.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  await page.getByRole('button', { name: 'Reload latest record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Latest project', exact: true })).toBeVisible();
  await other.close();
  expect(fixture.org).toHaveLength(24);
});
test('members need explicit project grants and guests remain read-only after direct refresh', async ({
  page,
  browser,
}) => {
  const fixture = await setup(page);
  const projectPath = await project(page);
  const memberContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const member = await memberContext.newPage();
    const guest = await guestContext.newPage();
    await signIn(member, fixture.member.email, projectPath);
    await expect(member.getByRole('button', { name: 'Create task', exact: true })).toBeVisible();
    await expect(member.getByRole('button', { name: 'Project settings', exact: true })).toHaveCount(
      0,
    );
    await signIn(guest, fixture.guest.email, projectPath);
    await guest.reload();
    await expect(guest.getByText('Read-only access', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Create task', exact: true })).toHaveCount(0);
    const id = projectPath.split('/').at(-1)!;
    const response = await api(
      guest,
      `/${fixture.org}/workspaces/${fixture.ws}/projects/${id}/tasks`,
      {
        title: 'Forged write',
        description: '',
        status: 'todo',
        priority: 'normal',
        dueDate: null,
        ownerId: null,
        assigneeIds: [],
        labelIds: [],
        checklist: [],
        parentId: null,
      },
    );
    expect(response.status()).toBe(403);
    await page.getByRole('button', { name: 'Project settings', exact: true }).click();
    await page.getByLabel('Jules ParkMember', { exact: true }).uncheck();
    await page.getByLabel('Tess MorrisGuest', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await member.reload();
    await expect(
      member.getByRole('heading', { name: 'A small interruption.', exact: true }),
    ).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole('heading', { name: 'A small interruption.', exact: true }),
    ).toBeVisible();
  } finally {
    await memberContext.close();
    await guestContext.close();
  }
});
test('availability failure supports truthful retry and invalid/private direct routes', async ({
  page,
}) => {
  const fixture = await setup(page);
  const projectPath = await project(page);
  await page.route('**/api/v1/organizations/**/projects/*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PROJECT_UNAVAILABLE',
          message: 'Project services are unavailable. Please try again shortly.',
        },
        meta: { requestId: '37dc6e3a-356d-4321-a482-fc0ab5111c86' },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.unroute('**/api/v1/organizations/**/projects/*');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Website launch', exact: true })).toBeVisible();
  await page.goto(`${fixture.path}/${'a'.repeat(24)}/tasks/${'b'.repeat(24)}`);
  await expect(
    page.getByRole('heading', { name: 'A small interruption.', exact: true }),
  ).toBeVisible();
  await page.goto(projectPath);
  await page.getByLabel('Search tasks', { exact: true }).fill('No matching task');
  await expect(
    page.getByRole('heading', { name: 'No tasks match these filters.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
});
test('templates, archive/restore and cascading deletions persist through the API', async ({
  page,
}) => {
  const fixture = await setup(page);
  const projectPath = await project(page, 'Launch checklist', 'launch');
  await expect(
    page.getByRole('link').filter({ hasText: 'Define the launch outcome' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Archive project', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('This project is archived.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create task', exact: true })).toHaveCount(0);
  await audit(page, 'project-archived');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Restore project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create task', exact: true })).toBeVisible();
  await page.getByRole('link').filter({ hasText: 'Define the launch outcome' }).click();
  await page.getByRole('button', { name: 'Create subtask', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('A small checklist step');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('link', { name: 'Open parent task', exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Launch checklist', exact: true })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: 'Define the launch outcome' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete project', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.goto(projectPath);
  await expect(
    page.getByRole('heading', { name: 'A small interruption.', exact: true }),
  ).toBeVisible();
  expect(fixture.ws).toHaveLength(24);
});
