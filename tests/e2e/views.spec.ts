import { test, expect, type Page } from '@playwright/test';
import { taskSchema, type Task } from '../../packages/contracts/src/index.js';
import { setup, project, api, database, signIn, audit, ObjectId } from './view-support';

const relative = (path: string) => path.replace('/app/organizations', '');
const endpoint = (path: string) => path.replace('/app', '/api/v1');
async function fixture(page: Page) {
  const people = await setup(page);
  const path = await project(page);
  const tasks: Task[] = [];
  for (const [title, status, dueDate, priority] of [
    ['Release design', 'todo', '2026-10-01', 'high'],
    ['Release review', 'in-progress', '2026-10-31', 'urgent'],
    ['Check blocked work', 'blocked', null, 'normal'],
    ['Completed review', 'done', '2026-09-30', 'low'],
  ] as const) {
    const response = await api(page, `${relative(path)}/tasks`, {
      title,
      status,
      priority,
      dueDate,
      description: 'Real browser fixture task',
      ownerId: people.member.id,
      assigneeIds: [people.member.id],
      labelIds: [],
      checklist: [{ text: 'Preserve this checklist', done: false }],
      parentId: null,
    });
    expect(response.status()).toBe(201);
    tasks.push(taskSchema.parse((await response.json()).data));
  }
  await page.reload();
  await expect(page.getByRole('link', { name: /^Release design/ })).toBeVisible();
  return { ...people, path, tasks };
}
async function readTask(page: Page, path: string, id: string) {
  return taskSchema.parse(
    (await (await page.request.get(`${endpoint(path)}/tasks/${id}`)).json()).data,
  );
}
async function drag(page: Page, task: Task, targetSelector: string) {
  const handle = page.locator(`#drag-${task.id}`);
  await handle.scrollIntoViewIfNeeded();
  const target = page.locator(targetSelector);
  await target.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const end = await target.boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + 20, start!.y + 20, { steps: 5 });
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height - 24, { steps: 20 });
  await page.mouse.up();
}
async function openMove(page: Page, task: Task) {
  await page.getByRole('button', { name: `Move ${task.title}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('four real views, pointer moves, saved filters, server preferences and accessible themes', async ({
  page,
  browser,
}) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const data = await fixture(page);
  const task = data.tasks[0]!;
  await audit(page, 'work-list');
  await page.getByLabel('Group tasks', { exact: true }).selectOption('status');
  await audit(page, 'work-list-grouped');
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  await expect(page.locator('[data-drop-status="todo"]')).toContainText(task.title);
  await audit(page, 'work-kanban');
  await page.setViewportSize({ width: 1440, height: 950 });
  await drag(page, task, '[data-drop-status="in-progress"]');
  await expect
    .poll(async () => (await readTask(page, data.path, task.id)).status)
    .toBe('in-progress');
  const moved = await readTask(page, data.path, task.id);
  expect(moved.assigneeIds).toEqual(task.assigneeIds);
  expect(moved.checklist).toEqual(task.checklist);
  await page.locator(`#drag-${task.id}`).scrollIntoViewIfNeeded();
  const handle = await page.locator(`#drag-${task.id}`).boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 25, handle!.y + 25, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await readTask(page, data.path, task.id)).version).toBe(moved.version);
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Calendar month', { exact: true }).fill('2026-10');
  await expect(page.locator('[data-drop-date="2026-10-01"]')).toContainText(task.title);
  await audit(page, 'work-calendar');
  await page.setViewportSize({ width: 1440, height: 950 });
  await drag(page, moved, '[data-drop-date="2026-10-02"]');
  await expect
    .poll(async () => (await readTask(page, data.path, task.id)).dueDate)
    .toBe('2026-10-02');
  await audit(page, 'work-move-dialog', `Move ${task.title}`);
  await openMove(page, task);
  await page.getByLabel('Due date (UTC calendar day)', { exact: true }).clear();
  await page.getByRole('button', { name: 'Save move', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await readTask(page, data.path, task.id)).dueDate).toBeNull();
  await expect(page.locator(`#move-${task.id}`)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Undated tasks', exact: true }).click();
  await expect(page.getByRole('link', { name: task.title, exact: true })).toBeVisible();
  await audit(page, 'work-undated');
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await page.getByLabel('Group tasks', { exact: true }).selectOption('none');
  await page.getByLabel('Sort tasks', { exact: true }).selectOption('title');
  await audit(page, 'work-table');
  await page.getByLabel('Search tasks', { exact: true }).fill('Release');
  await audit(page, 'work-saved-filter-dialog', 'Save filter');
  await page.getByRole('button', { name: 'Save filter', exact: true }).click();
  await page.getByLabel('Saved filter name', { exact: true }).fill('Release table');
  await page.getByRole('button', { name: 'Save named filter', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Apply filter', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Table', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Search tasks', { exact: true })).toHaveValue('Release');
  await audit(page, 'work-preferences-dialog', 'View preferences');
  await page.getByRole('button', { name: 'View preferences', exact: true }).click();
  await page.getByLabel('Density', { exact: true }).selectOption('compact');
  await page.getByLabel('Week starts on', { exact: true }).selectOption('sunday');
  await page.getByLabel('Labels', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await signIn(fresh, data.owner.email, data.path);
    await expect(fresh.getByRole('tab', { name: 'Table', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(fresh.locator('.work-views')).toHaveClass(/density-compact/);
    await expect(fresh.getByRole('columnheader', { name: 'Labels', exact: true })).toHaveCount(0);
    await fresh.goto(`${data.path}?view=list`);
    await expect(fresh.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await fresh.reload();
    await expect(fresh.getByRole('link', { name: new RegExp(`^${task.title}`) })).toBeVisible();
  } finally {
    await context.close();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('tab', { name: 'Table', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('stale task, preference and saved-filter snapshots surface conflicts without overwriting', async ({
  page,
}) => {
  const data = await fixture(page);
  const task = data.tasks[0]!;
  await openMove(page, task);
  expect(
    (
      await api(page, `${relative(data.path)}/tasks/${task.id}/move`, {
        version: task.version,
        status: 'done',
      })
    ).status(),
  ).toBe(200);
  await page.getByLabel('Move to status', { exact: true }).selectOption('blocked');
  await page.getByRole('button', { name: 'Save move', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Reload latest view' }),
  ).toBeVisible();
  expect((await readTask(page, data.path, task.id)).status).toBe('done');
  await page.getByRole('dialog').getByRole('button', { name: 'Reload latest view' }).click();
  await page.getByRole('button', { name: 'View preferences', exact: true }).click();
  const current = (await (await page.request.get(`${endpoint(data.path)}/view-preferences`)).json())
    .data;
  expect(
    (
      await api(
        page,
        `${relative(data.path)}/view-preferences`,
        { ...current, density: 'compact' },
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Reload latest view' }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Reload latest view' }).click();
  await page.getByRole('button', { name: 'Save filter', exact: true }).click();
  await page.getByLabel('Saved filter name', { exact: true }).fill('My list');
  await page.getByRole('button', { name: 'Save named filter', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit saved filter', exact: true }).click();
  const saved = (await (await page.request.get(`${endpoint(data.path)}/saved-filters`)).json()).data
    .filters[0];
  expect(
    (
      await api(
        page,
        `${relative(data.path)}/saved-filters/${saved.id}`,
        { name: 'Other session', criteria: saved.criteria, version: saved.version },
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Update saved filter', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Reload latest view' }),
  ).toBeVisible();
});

test('guests retain private preferences but task moves and revoked access are denied', async ({
  page,
  browser,
}) => {
  const data = await fixture(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await signIn(guest, data.guest.email, data.path);
    await guest.getByRole('tab', { name: 'Kanban', exact: true }).click();
    await expect(guest.getByRole('button', { name: /^Move Release/ })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: /^Drag / })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Save filter', exact: true }).click();
    await guest.getByLabel('Saved filter name', { exact: true }).fill('Guest board');
    await guest.getByRole('button', { name: 'Save named filter', exact: true }).click();
    await expect(guest.getByRole('dialog')).toHaveCount(0);
    expect(
      (await (await page.request.get(`${endpoint(data.path)}/saved-filters`)).json()).data.filters,
    ).toEqual([]);
    expect(
      (
        await api(guest, `${relative(data.path)}/tasks/${data.tasks[0]!.id}/move`, {
          version: 1,
          status: 'done',
        })
      ).status(),
    ).toBe(403);
    await database(async (db) => {
      const row = await db.collection('projects').findOne({
        _id: new ObjectId(data.path.split('/').at(-1)),
        organizationId: new ObjectId(data.org),
        workspaceId: new ObjectId(data.ws),
      });
      expect(row).not.toBeNull();
      const scoped = await db.collection('projects').findOne({ _id: row!._id });
      // Only this test's organization and project may be changed.
      expect(String(scoped!.organizationId)).toBe(data.org);
      await db.collection('projects').updateOne(
        { _id: row!._id, organizationId: scoped!.organizationId },
        {
          $set: {
            memberIds: scoped!.memberIds.filter((id: unknown) => String(id) !== data.guest.id),
          },
          $inc: { version: 1 },
        },
      );
    });
    await guest.reload();
    await expect(guest.getByRole('tab', { name: 'Kanban', exact: true })).toHaveCount(0);
    expect((await guest.request.get(`${endpoint(data.path)}/view-preferences`)).status()).toBe(404);
  } finally {
    await context.close();
  }
});

test('unavailable mutations preserve task state and can be explicitly retried', async ({
  page,
}) => {
  const data = await fixture(page);
  const task = data.tasks[0]!;
  const movePath = `${endpoint(data.path)}/tasks/${task.id}/move`;
  await page.route(`**${movePath}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'PROJECT_UNAVAILABLE', message: 'Task storage is temporarily unavailable.' },
        meta: { requestId: '10000000-0000-4000-8000-000000000001' },
      }),
    }),
  );
  await openMove(page, task);
  await page.getByLabel('Move to status', { exact: true }).selectOption('done');
  await page.getByRole('button', { name: 'Save move', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Task storage is temporarily unavailable.');
  expect((await readTask(page, data.path, task.id)).status).toBe('todo');
  await page.unroute(`**${movePath}`);
  await page.getByRole('button', { name: 'Save move', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await readTask(page, data.path, task.id)).status).toBe('done');
  await page.goto(`${data.path}?view=calendar&month=2026-99`);
  await expect(page.locator('.work-views')).toContainText('current month');
  await page.goto(`${data.path}?view=list&status=invalid`);
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(`^${task.title}`) })).toBeVisible();
  const preferencesPath = `${endpoint(data.path)}/view-preferences`;
  await page.route(`**${preferencesPath}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'VIEW_UNAVAILABLE', message: 'Saved views temporarily unavailable.' },
        meta: { requestId: '10000000-0000-4000-8000-000000000002' },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Saved views temporarily unavailable.');
  await page.unroute(`**${preferencesPath}`);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'List', exact: true })).toBeVisible();
  const filtersPath = `${endpoint(data.path)}/saved-filters`;
  await page.route(`**${filtersPath}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'VIEW_UNAVAILABLE', message: 'Private filters temporarily unavailable.' },
        meta: { requestId: '10000000-0000-4000-8000-000000000003' },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Private filters temporarily unavailable.');
  await expect(page.getByRole('link', { name: new RegExp(`^${task.title}`) })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save filter', exact: true })).toBeDisabled();
  await page.unroute(`**${filtersPath}`);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save filter', exact: true })).toBeEnabled();
  const record = (await (await page.request.get(endpoint(data.path))).json()).data;
  expect(
    (
      await api(page, `${relative(data.path)}/archive`, { version: record.version, archived: true })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Drag / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Move Release/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'View preferences', exact: true }).click();
  await page.getByLabel('Density', { exact: true }).selectOption('compact');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('partial collections load all pages with consistent totals and direct-route refresh', async ({
  page,
}) => {
  const data = await fixture(page);
  await database(async (db) => {
    const source = await db.collection('tasks').findOne({
      _id: new ObjectId(data.tasks[0]!.id),
      organizationId: new ObjectId(data.org),
      workspaceId: new ObjectId(data.ws),
      projectId: new ObjectId(data.path.split('/').at(-1)),
    });
    expect(String(source!.organizationId)).toBe(data.org);
    const { _id, ...fields } = source!;
    expect(String(_id)).toBe(data.tasks[0]!.id);
    await db.collection('tasks').insertMany(
      Array.from({ length: 57 }, (_, index) => ({
        ...fields,
        title: `Paged task ${String(index).padStart(2, '0')}`,
        dueDate: '2026-10-15',
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
  });
  await page.reload();
  await expect(page.locator('.work-view-summary')).toContainText('50');
  await expect(page.locator('.work-view-summary')).toContainText('61');
  await page.getByRole('button', { name: /Load more tasks/ }).click();
  await expect(page.locator('.work-view-summary')).toContainText('61');
  await expect(page.getByRole('button', { name: /Load more tasks/ })).toHaveCount(0);
  await expect(page.locator('.work-list .project-task-link')).toHaveCount(61);
  await page.getByLabel('Search tasks', { exact: true }).fill('Paged task');
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Search tasks', { exact: true })).toHaveValue('Paged task');
  await expect(page.locator('.work-view-summary')).toContainText('57');
  await expect(page.locator('.work-table tbody tr')).toHaveCount(50);
});
