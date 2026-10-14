import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  analyticsReportSchema,
  taskSchema,
  type Task,
} from '../../packages/contracts/src/index.js';
import { setup, project, api, database, signIn, audit, ObjectId } from './view-support';
const relative = (path: string) => path.replace('/app/organizations', ''),
  endpoint = (path: string) => path.replace('/app', '/api/v1'),
  origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const now = new Date(),
  today = now.toISOString().slice(0, 10),
  date = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
      .toISOString()
      .slice(0, 10),
  window = { from: date(-6), to: today };
const route = (path: string) => `${path}?section=analytics&${new URLSearchParams(window)}`;
async function report(page: Page, path: string) {
  return analyticsReportSchema.parse(
    (
      await (
        await page.request.get(`${endpoint(path)}/analytics?${new URLSearchParams(window)}`)
      ).json()
    ).data,
  );
}
async function fixture(page: Page) {
  const people = await setup(page),
    path = await project(page);
  return { ...people, path };
}
async function tasks(page: Page, people: Awaited<ReturnType<typeof fixture>>) {
  const rows: Task[] = [];
  for (const [index, title] of [
    'Release design',
    'Completed review',
    'Unknown effort',
    'Mobile subtask',
  ].entries()) {
    const response = await api(page, `${relative(people.path)}/tasks`, {
      title,
      description: 'Real analytics fixture',
      status: index === 1 ? 'done' : 'todo',
      priority: 'high',
      dueDate: index === 2 ? null : date(-1),
      ownerId: people.owner.id,
      assigneeIds:
        index === 2 ? [] : index === 3 ? [people.member.id] : [people.owner.id, people.member.id],
      labelIds: [],
      checklist: [],
      parentId: index === 3 ? rows[0]!.id : null,
    });
    expect(response.status()).toBe(201);
    rows.push(taskSchema.parse((await response.json()).data));
  }
  return rows;
}
async function resources(page: Page, path: string, rows: Task[]) {
  const m = await api(page, `${relative(path)}/planning/milestones`, {
    name: 'Launch checkpoint',
    description: 'Real milestone',
    dueDate: date(1),
    status: 'open',
  });
  expect(m.status()).toBe(201);
  const milestone = (await m.json()).data.id;
  const s = await api(page, `${relative(path)}/planning/sprints`, {
    name: 'Evidence sprint',
    goal: 'Record actual delivery',
    startDate: date(-6),
    endDate: today,
  });
  expect(s.status()).toBe(201);
  const sprint = (await s.json()).data.id;
  for (const [index, task] of rows.entries()) {
    const response = await api(
      page,
      `${relative(path)}/planning/tasks/${task.id}`,
      {
        version: 0,
        taskVersion: task.version,
        startDate: index === 2 ? null : date(-1),
        dueDate: task.dueDate,
        estimateHours: [8, 5, null, 3][index],
        milestoneId: index < 2 ? milestone : null,
        sprintId: sprint,
        dependencyIds: [],
      },
      'PATCH',
    );
    expect(response.status()).toBe(200);
  }
  return { milestone, sprint };
}
async function move(page: Page, path: string, taskId: string, status: string) {
  const current = taskSchema.parse(
    (await (await page.request.get(`${endpoint(path)}/tasks/${taskId}`)).json()).data,
  );
  const response = await api(page, `${relative(path)}/tasks/${taskId}/move`, {
    version: current.version,
    status,
  });
  expect(response.status()).toBe(200);
}
async function csvDownload(page: Page, dataset: string) {
  await page.getByLabel('Report dataset', { exact: true }).selectOption(dataset);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain(`orbit-${dataset}-`);
  const content = (await readFile((await download.path())!)).toString('utf8');
  await expect(page.getByText('Private CSV report downloaded.', { exact: true })).toBeVisible();
  return content;
}
function parseCsv(value: string) {
  const rows: string[][] = [],
    row: string[] = [];
  let cell = '',
    quoted = false;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (ch === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && !quoted && value[index + 1] === '\n') {
      row.push(cell);
      rows.push([...row]);
      row.length = 0;
      cell = '';
      index++;
    } else cell += ch;
  }
  return rows;
}

test('real analytics, observed burndown, immutable velocity, CSV and accessible responsive charts', async ({
  page,
}) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const people = await fixture(page),
    path = people.path;
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Delivery, in view.', exact: true }),
  ).toBeVisible();
  await audit(page, 'analytics-empty');
  const rows = await tasks(page, people),
    { sprint } = await resources(page, path, rows);
  await page.goto(route(path));
  await expect(page.getByText('1 of 4 tasks & subtasks done', { exact: true })).toBeVisible();
  await expect(page.getByText('25%', { exact: true })).toBeVisible();
  await audit(page, 'analytics-overview');
  const activity = page.getByRole('group', { name: 'Recorded activity chart', exact: true });
  await activity.getByRole('application').focus();
  await page.keyboard.press('ArrowRight');
  await expect(activity.getByRole('application')).toBeFocused();
  await page.getByRole('button', { name: 'All project changes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'All project changes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  const summary = page.getByText('Show recorded activity data table', { exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Recorded activity data table', exact: true }),
  ).toBeVisible();
  await audit(page, 'analytics-activity-table');
  const start = await api(page, `${relative(path)}/planning/sprints/${sprint}/start`, {
    version: 1,
  });
  expect(start.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Sprint burndown', exact: true })).toBeVisible();
  await audit(page, 'analytics-burndown');
  await page.getByRole('button', { name: 'Show remaining estimate hours', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Known remaining estimate hours', exact: true }),
  ).toBeVisible();
  await audit(page, 'analytics-burndown-hours');
  await move(page, path, rows[0]!.id, 'done');
  await move(page, path, rows[2]!.id, 'done');
  await expect(page.getByText('3 of 4 tasks & subtasks done', { exact: true })).toBeVisible();
  const complete = await api(page, `${relative(path)}/planning/sprints/${sprint}/complete`, {
    version: 2,
    carryTo: null,
  });
  expect(complete.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Sprint velocity', exact: true })).toBeVisible();
  await audit(page, 'analytics-velocity');
  await page.getByRole('button', { name: 'Show completed estimate hours', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Known completed estimate hours', exact: true }),
  ).toBeVisible();
  await audit(page, 'analytics-velocity-hours');
  const actual = await report(page, path);
  expect(actual.velocity[0]?.completedEstimateHours).toBe(13);
  expect(actual.velocity[0]?.unestimatedCompleted).toBe(1);
  expect(actual.burndown.days.at(-1)?.remaining).toBe(1);
  await audit(page, 'analytics-export');
  const content = await csvDownload(page, 'tasks'),
    csv = parseCsv(content.replace(/^\uFEFF/, ''));
  expect(csv).toHaveLength(5);
  expect(new Set(csv.map((row) => row.length)).size).toBe(1);
  expect(content).toContain('Mobile subtask');
  expect(content).toContain(people.member.id ? 'Jules Park' : '');
  for (const dataset of ['workload', 'milestones', 'sprints', 'activity', 'burndown']) {
    const text = await csvDownload(page, dataset);
    expect(text).toContain('ORBIT report project');
  }
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByText('3 of 4 tasks & subtasks done', { exact: true })).toBeVisible();
  await page.getByLabel('From (UTC)', { exact: true }).fill(today);
  await page.getByLabel('To (UTC)', { exact: true }).fill(date(-1));
  await page.getByRole('button', { name: 'Apply report dates', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ordered');
  await expect(page.getByLabel('From (UTC)', { exact: true })).toBeFocused();
  await audit(page, 'analytics-date-validation');
  await page.getByLabel('From (UTC)', { exact: true }).fill(date(-2));
  await page.getByLabel('To (UTC)', { exact: true }).fill(date(-1));
  await page.getByRole('button', { name: 'Apply report dates', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`from=${date(-2)}&to=${date(-1)}`));
  await expect(
    page.getByRole('heading', { name: 'No completed sprints in these dates', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('3 of 4 tasks & subtasks done', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('To (UTC)', { exact: true })).toHaveValue(today);
  expect(errors).toEqual([]);
});

test('guest/archive reports, private exports and live revocation respect current grants', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const people = await fixture(page),
    path = people.path;
  await tasks(page, people);
  const context = await browser.newContext({ baseURL: origin }),
    guest = await context.newPage();
  try {
    await signIn(guest, people.guest.email, route(path));
    await expect(guest.getByText('1 of 4 tasks & subtasks done', { exact: true })).toBeVisible();
    await audit(guest, 'analytics-readonly');
    expect(await csvDownload(guest, 'tasks')).toContain('Release design');
    await page.goto(route(path));
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive project', exact: true })
      .click();
    await expect(
      page.getByText('This project is archived. Its work and history are read-only.', {
        exact: true,
      }),
    ).toBeVisible();
    await audit(page, 'analytics-archived');
    await database(async (db) => {
      await db.collection('workspace_memberships').deleteOne({
        organizationId: new ObjectId(people.org),
        workspaceId: new ObjectId(people.ws),
        userId: new ObjectId(people.guest.id),
      });
    });
    await expect(
      guest.getByRole('heading', { name: 'Delivery, in view.', exact: true }),
    ).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Download CSV', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('unavailable report/export feedback retries truthfully and reduced motion remains usable', async ({
  page,
}) => {
  test.setTimeout(120000);
  const people = await fixture(page),
    path = people.path;
  await tasks(page, people);
  await page.route('**/analytics?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'ANALYTICS_UNAVAILABLE',
          message: 'Analytics are temporarily unavailable. Please retry shortly.',
        },
        meta: { requestId: '37dc6e3a-356d-4321-a482-fc0ab5111c86' },
      }),
    }),
  );
  await page.goto(route(path));
  await expect(page.getByRole('button', { name: 'Retry analytics', exact: true })).toBeVisible();
  await audit(page, 'analytics-unavailable');
  await page.unroute('**/analytics?*');
  await page.getByRole('button', { name: 'Retry analytics', exact: true }).click();
  await expect(page.getByText('1 of 4 tasks & subtasks done', { exact: true })).toBeVisible();
  await page.route('**/analytics/export?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'ANALYTICS_UNAVAILABLE',
          message: 'This export is temporarily unavailable.',
        },
        meta: { requestId: '37dc6e3a-356d-4321-a482-fc0ab5111c86' },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  await expect(
    page.getByText('This export is temporarily unavailable.', { exact: true }),
  ).toBeVisible();
  await page.unroute('**/analytics/export?*');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await csvDownload(page, 'tasks')).toContain('Release design');
  await page.getByRole('button', { name: 'Task change actions', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Task change actions', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('legacy snapshots remain unknown and private report export contains all pages safely', async ({
  page,
}) => {
  test.setTimeout(150000);
  const people = await fixture(page),
    path = people.path;
  await database(async (db) => {
    const parent = {
      organizationId: new ObjectId(people.org),
      workspaceId: new ObjectId(people.ws),
      projectId: new ObjectId(path.split('/').at(-1)!),
    };
    await db.collection('tasks').insertMany(
      Array.from({ length: 105 }, (_, index) => ({
        ...parent,
        title: index === 104 ? '=SUM(1,2)' : `Report task ${index}`,
        description: 'Actual bounded fixture',
        status: 'todo',
        priority: 'normal',
        dueDate: date(-1),
        parentId: null,
        ownerId: new ObjectId(people.owner.id),
        assigneeIds: [],
        labelIds: [],
        checklist: [],
        version: 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    await db.collection('project_sprints').insertOne({
      ...parent,
      name: 'Legacy delivery',
      nameKey: 'legacy delivery',
      goal: 'Historical compatibility',
      startDate: date(-6),
      endDate: today,
      status: 'completed',
      version: 1,
      commitment: { total: 3, done: 0, estimateHours: 7, unestimated: 0 },
      delivery: { total: 3, done: 2, estimateHours: 7, unestimated: 0 },
      startedAt: new Date(),
      completedAt: new Date(),
    });
  });
  await page.goto(route(path));
  await expect(page.getByText('0 of 105 tasks & subtasks done', { exact: true })).toBeVisible();
  await expect(page.getByText('50 / 105 overdue tasks shown', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more overdue tasks', exact: true }).click();
  await expect(page.getByText('100 / 105 overdue tasks shown', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more overdue tasks', exact: true }).click();
  await expect(page.getByText('105 / 105 overdue tasks shown', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Burndown history is not available yet', exact: true }),
  ).toBeVisible();
  const parsed = parseCsv((await csvDownload(page, 'tasks')).replace(/^\uFEFF/, ''));
  expect(parsed).toHaveLength(106);
  expect(parsed.some((row) => row.includes("'=SUM(1,2)"))).toBe(true);
  const value = await report(page, path);
  expect(value.velocity[0]?.completedEstimateHours).toBeNull();
  await page.getByRole('button', { name: 'Show completed estimate hours', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Sprint delivery snapshots', exact: true })
      .getByText('Unavailable', { exact: true }),
  ).toHaveCount(2);
});
