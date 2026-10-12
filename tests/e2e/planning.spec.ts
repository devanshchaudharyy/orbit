import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  planningSnapshotSchema,
  taskSchema,
  type PlanningTask,
  type TaskPlanInput,
} from '../../packages/contracts/src/index.js';
import { setup, project, api, database, signIn, audit, ObjectId } from './view-support';
const relative = (path: string) => path.replace('/app/organizations', '');
const endpoint = (path: string) => path.replace('/app', '/api/v1');
const route = (path: string) => `${path}?section=planning&pfrom=2026-10-01&pto=2026-10-31`;
async function snapshot(page: Page, path: string) {
  return planningSnapshotSchema.parse(
    (
      await (
        await page.request.get(`${endpoint(path)}/planning?from=2026-10-01&to=2026-10-31`)
      ).json()
    ).data,
  );
}
function payload(row: PlanningTask, values: Partial<TaskPlanInput> = {}): TaskPlanInput {
  return {
    version: row.plan.version,
    taskVersion: row.task.version,
    startDate: row.plan.startDate,
    dueDate: row.task.dueDate,
    estimateHours: row.plan.estimateHours,
    milestoneId: row.plan.milestoneId,
    sprintId: row.plan.sprintId,
    dependencyIds: [...row.plan.dependencyIds],
    ...values,
  };
}
async function fixture(page: Page, empty = false) {
  const people = await setup(page);
  const path = await project(page);
  const tasks = [];
  if (!empty)
    for (const title of ['Release design', 'Release review']) {
      const response = await api(page, `${relative(path)}/tasks`, {
        title,
        description: 'Real planning fixture',
        status: 'todo',
        priority: 'high',
        dueDate: '2026-10-10',
        ownerId: people.member.id,
        assigneeIds: [people.owner.id, people.member.id],
        labelIds: [],
        checklist: [{ text: 'Retain task content', done: false }],
        parentId: null,
      });
      expect(response.status()).toBe(201);
      tasks.push(taskSchema.parse((await response.json()).data));
    }
  await page.goto(route(path));
  await expect(
    page.getByRole('heading', { name: 'Delivery planning', exact: true, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText(`Showing ${tasks.length} of ${tasks.length} matching tasks`, { exact: true }),
  ).toBeVisible();
  return { ...people, path, tasks };
}
async function resources(page: Page, path: string) {
  const m = await api(page, `${relative(path)}/planning/milestones`, {
    name: 'Launch',
    description: 'Ship the release',
    dueDate: '2026-10-31',
    status: 'open',
  });
  expect(m.status()).toBe(201);
  const s = await api(page, `${relative(path)}/planning/sprints`, {
    name: 'Sprint one',
    goal: 'Release delivery',
    startDate: '2026-10-01',
    endDate: '2026-10-14',
  });
  expect(s.status()).toBe(201);
  return { milestoneId: (await m.json()).data.id, sprintId: (await s.json()).data.id };
}
async function openPlan(page: Page, title: string) {
  await page.getByRole('button', { name: new RegExp(`^Plan ${title}(,|$)`) }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function savePlan(page: Page) {
  await page.getByRole('button', { name: 'Save task plan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Task plan saved.', { exact: true })).toBeVisible();
}
async function movePointer(page: Page, id: string, targetStatus: string) {
  const handle = page.locator(`#drag-${id}`),
    target = page.locator(`[data-drop-status="${targetStatus}"]`);
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const a = await handle.boundingBox(),
    b = await target.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(a!.x + 15, a!.y + 15, { steps: 4 });
  await page.mouse.move(b!.x + b!.width / 2, b!.y + 70, { steps: 20 });
  await page.mouse.up();
}
test('actual schedules, dependencies, sprint delivery, workload and accessible responsive planning', async ({
  page,
}) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const data = await fixture(page, true);
  await audit(page, 'planning-empty');
  await audit(page, 'plan-milestone-dialog', 'New milestone');
  await page.getByRole('button', { name: 'New milestone', exact: true }).click();
  await page.getByLabel('Milestone name', { exact: true }).fill('Launch');
  await page
    .getByLabel('Milestone description', { exact: true })
    .fill('Ship a considered release.');
  await page.getByLabel('Target date (UTC)', { exact: true }).fill('2026-10-31');
  await page.getByRole('button', { name: 'Create milestone', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await audit(page, 'plan-sprint-dialog', 'New sprint');
  await page.getByRole('button', { name: 'New sprint', exact: true }).click();
  await page.getByLabel('Sprint name', { exact: true }).fill('Sprint one');
  await page.getByLabel('Sprint goal', { exact: true }).fill('Deliver the launch.');
  await page.getByLabel('Sprint starts (UTC)', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Sprint ends (UTC)', { exact: true }).fill('2026-10-14');
  await page.getByRole('button', { name: 'Create sprint', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const tasks = [];
  for (const title of ['Release design', 'Release review']) {
    const response = await api(page, `${relative(data.path)}/tasks`, {
      title,
      description: 'Real planning fixture task',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-10-10',
      ownerId: data.member.id,
      assigneeIds: [data.owner.id, data.member.id],
      labelIds: [],
      checklist: [{ text: 'Retain checklist', done: false }],
      parentId: null,
    });
    expect(response.status()).toBe(201);
    tasks.push(taskSchema.parse((await response.json()).data));
  }
  await page.reload();
  await expect(page.getByText('Showing 2 of 2 matching tasks', { exact: true })).toBeVisible();
  await openPlan(page, 'Release design');
  await page.getByLabel('Planned start (UTC)', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Estimate (hours)', { exact: true }).fill('80');
  await page.getByLabel('Milestone', { exact: true }).selectOption({ label: 'Launch' });
  await page.getByLabel('Sprint', { exact: true }).selectOption({ label: 'Sprint one · planned' });
  await savePlan(page);
  await openPlan(page, 'Release review');
  await page.getByLabel('Planned start (UTC)', { exact: true }).fill('2026-10-03');
  await page.getByLabel('Estimate (hours)', { exact: true }).fill('20');
  await page.getByLabel('Milestone', { exact: true }).selectOption({ label: 'Launch' });
  await page.getByLabel('Sprint', { exact: true }).selectOption({ label: 'Sprint one · planned' });
  await page.getByRole('checkbox', { name: 'Release design', exact: true }).check();
  await savePlan(page);
  await expect(page.getByText('1 unresolved prerequisite', { exact: true })).toBeVisible();
  await audit(page, 'plan-timeline');
  await audit(page, 'plan-task-dialog', 'Plan Release design, 2026-10-01 to 2026-10-10');
  const stored = await snapshot(page, data.path);
  expect(stored.blocked).toBe(1);
  expect(stored.tasks[0]!.task.checklist).toEqual(tasks[0]!.checklist);
  await page.getByRole('tab', { name: 'Milestones', exact: true }).click();
  await audit(page, 'plan-milestones');
  await expect(page.getByText('0 / 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Launch', exact: true }).click();
  await page.getByLabel('Delivery status', { exact: true }).selectOption('delivered');
  await page.getByRole('button', { name: 'Save milestone', exact: true }).click();
  await expect(
    page.getByText('Marked delivered with 2 linked tasks remaining.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Workload', exact: true }).click();
  await expect(page.getByText('Capacity unspecified', { exact: true }).first()).toBeVisible();
  await audit(page, 'plan-capacity-dialog', 'Set capacity for Morgan Reed');
  await page.getByRole('button', { name: 'Set capacity for Morgan Reed', exact: true }).click();
  await page.getByLabel('Weekly capacity (hours)', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Save capacity', exact: true }).click();
  await expect(page.getByText('44 h capacity · over capacity', { exact: true })).toBeVisible();
  await audit(page, 'plan-workload');
  await page.getByRole('tab', { name: 'Sprints', exact: true }).click();
  await page.getByRole('button', { name: 'Start Sprint one', exact: true }).click();
  await page.getByRole('button', { name: 'Start sprint', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Sprint one board', exact: true }).click();
  await expect(page.getByLabel('Sprint filter', { exact: true })).toHaveValue(
    stored.sprints[0]!.id,
  );
  await audit(page, 'plan-sprints');
  await page.setViewportSize({ width: 1440, height: 950 });
  await movePointer(page, tasks[0]!.id, 'in-progress');
  await expect
    .poll(
      async () =>
        (await snapshot(page, data.path)).tasks.find((r) => r.task.id === tasks[0]!.id)!.task
          .status,
    )
    .toBe('in-progress');
  await page.getByRole('button', { name: 'Move Release design', exact: true }).click();
  await page.getByLabel('Move to status', { exact: true }).selectOption('done');
  await page.getByRole('button', { name: 'Save move', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await snapshot(page, data.path)).tasks.find((r) => r.task.id === tasks[0]!.id)!.task
          .status,
    )
    .toBe('done');
  await audit(page, 'plan-complete-dialog', 'Complete Sprint one');
  await page.getByRole('button', { name: 'Complete Sprint one', exact: true }).click();
  await page.getByLabel('Carry unfinished work to', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Complete sprint', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const completed = await snapshot(page, data.path);
  expect(completed.sprints[0]!.delivery).toMatchObject({ total: 2, done: 1 });
  expect(completed.tasks.find((r) => r.task.id === tasks[1]!.id)!.plan.sprintId).toBe(null);
  await page.getByRole('tab', { name: 'Delivery', exact: true }).click();
  await audit(page, 'plan-delivery');
  await expect(page.getByText('1 of 2 tasks delivered · 1 carried', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Delivery', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('1 of 2 tasks delivered · 1 carried', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Delivery', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Timeline / Gantt', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Delivery', exact: true })).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.plan-tabs button')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s');
  expect(errors).toEqual([]);
});
test('original planning, milestone and capacity versions prevent stale dialog overwrites', async ({
  page,
}) => {
  const data = await fixture(page);
  const refs = await resources(page, data.path);
  await page.reload();
  await openPlan(page, 'Release design');
  await page.getByLabel('Estimate (hours)', { exact: true }).fill('80');
  const original = (await snapshot(page, data.path)).tasks.find(
    (r) => r.task.id === data.tasks[0]!.id,
  )!;
  expect(
    (
      await api(
        page,
        `${relative(data.path)}/planning/tasks/${original.task.id}`,
        payload(original, { estimateHours: 120 }),
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Save task plan', exact: true }).click();
  await expect(
    page.getByText('Planning changed in another session. Reload before saving.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Estimate (hours)', { exact: true })).toHaveValue('80');
  expect(
    (await snapshot(page, data.path)).tasks.find((r) => r.task.id === original.task.id)!.plan
      .estimateHours,
  ).toBe(120);
  await page.getByRole('button', { name: 'Reload latest planning', exact: true }).click();
  await openPlan(page, 'Release design');
  await expect(page.getByLabel('Estimate (hours)', { exact: true })).toHaveValue('120');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Milestones', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Launch', exact: true }).click();
  await page.getByLabel('Milestone description', { exact: true }).fill('My draft');
  expect(
    (
      await api(
        page,
        `${relative(data.path)}/planning/milestones/${refs.milestoneId}`,
        {
          version: 1,
          name: 'Launch',
          description: 'Another writer',
          dueDate: '2026-10-31',
          status: 'open',
        },
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Save milestone', exact: true }).click();
  await expect(
    page.getByText('Planning changed in another session. Reload before saving.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Milestone description', { exact: true })).toHaveValue('My draft');
  await page.getByRole('button', { name: 'Reload latest planning', exact: true }).click();
  expect((await snapshot(page, data.path)).milestones[0]!.description).toBe('Another writer');
  await page.getByRole('tab', { name: 'Workload', exact: true }).click();
  await page.getByRole('button', { name: 'Set capacity for Morgan Reed', exact: true }).click();
  await page.getByLabel('Weekly capacity (hours)', { exact: true }).fill('20');
  expect(
    (
      await api(
        page,
        `${relative(data.path)}/planning/capacities/${data.owner.id}`,
        { version: 0, weeklyHours: 30 },
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Save capacity', exact: true }).click();
  await expect(
    page.getByText('Planning changed in another session. Reload before saving.', { exact: true }),
  ).toBeVisible();
  expect(
    (await snapshot(page, data.path)).workloads.find((w) => w.userId === data.owner.id)!
      .weeklyHours,
  ).toBe(30);
});
test('dependency cycle feedback preserves drafts and removed task focus falls back to the view', async ({
  page,
}) => {
  const data = await fixture(page);
  let s = await snapshot(page, data.path);
  const second = s.tasks.find((r) => r.task.id === data.tasks[1]!.id)!;
  expect(
    (
      await api(
        page,
        `${relative(data.path)}/planning/tasks/${second.task.id}`,
        payload(second, { dependencyIds: [data.tasks[0]!.id] }),
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.reload();
  await openPlan(page, 'Release design');
  await page.getByRole('checkbox', { name: 'Release review', exact: true }).check();
  await page.getByRole('button', { name: 'Save task plan', exact: true }).click();
  await expect(
    page.getByText('This dependency would create a cycle.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Release review', exact: true })).toBeChecked();
  s = await snapshot(page, data.path);
  expect(s.tasks.find((r) => r.task.id === data.tasks[0]!.id)!.plan.dependencyIds).toEqual([]);
  await page.keyboard.press('Escape');
  await openPlan(page, 'Release design');
  await page.getByLabel('Planned due (UTC)', { exact: true }).fill('2026-11-15');
  await savePlan(page);
  await expect(page.getByRole('tab', { name: 'Timeline / Gantt', exact: true })).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Plan Release design', exact: true }),
  ).toBeVisible();
});
test('guests and revoked grants stay private, archives stay readable and immutable', async ({
  page,
  browser,
}) => {
  const data = await fixture(page);
  await resources(page, data.path);
  await page.reload();
  const guest = await browser.newPage();
  try {
    await signIn(guest, data.guest.email, data.path);
    await guest.goto(route(data.path));
    await expect(
      guest.getByRole('heading', { name: 'Delivery planning', exact: true, level: 2 }),
    ).toBeVisible();
    await expect(guest.getByRole('button', { name: 'New milestone', exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: /^Plan Release design,/ })).toBeDisabled();
    const row = (await snapshot(page, data.path)).tasks[0]!;
    expect(
      (
        await api(
          guest,
          `${relative(data.path)}/planning/tasks/${row.task.id}`,
          payload(row),
          'PATCH',
        )
      ).status(),
    ).toBe(403);
    await database((db) =>
      db
        .collection('projects')
        .updateOne(
          { _id: new ObjectId(data.path.split('/').at(-1)!) },
          { $pull: { memberIds: new ObjectId(data.guest.id) } },
        ),
    );
    await guest.reload();
    await expect(
      guest.getByRole('heading', { name: 'A small interruption.', exact: true }),
    ).toBeVisible();
    await expect(guest.getByText('Release design', { exact: true })).toHaveCount(0);
  } finally {
    await guest.close();
  }
  const projectResponse = await page.request.get(endpoint(data.path));
  const projectData = (await projectResponse.json()).data;
  expect(
    (
      await api(page, `${relative(data.path)}/archive`, {
        version: projectData.version,
        archived: true,
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Delivery planning', exact: true, level: 2 }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'New sprint', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Plan Release design,/ })).toBeDisabled();
  expect(
    (
      await api(page, `${relative(data.path)}/planning/milestones`, {
        name: 'Denied',
        description: '',
        dueDate: '2026-10-31',
        status: 'open',
      })
    ).status(),
  ).toBe(409);
});
test('unavailable planning retains edits, explicit retry recovers and bad windows are truthful', async ({
  page,
}) => {
  const data = await fixture(page);
  const pattern = new RegExp(`/planning/tasks/${data.tasks[0]!.id}$`);
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'PLANNING_UNAVAILABLE', message: 'Planning temporarily unavailable.' },
        meta: { requestId: randomUUID() },
      }),
    }),
  );
  await openPlan(page, 'Release design');
  await page.getByLabel('Estimate (hours)', { exact: true }).fill('36');
  await page.getByRole('button', { name: 'Save task plan', exact: true }).click();
  await expect(page.getByText('Planning temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Estimate (hours)', { exact: true })).toHaveValue('36');
  expect((await snapshot(page, data.path)).tasks[0]!.plan.estimateHours).toBe(null);
  await page.unroute(pattern);
  await savePlan(page);
  expect((await snapshot(page, data.path)).tasks[0]!.plan.estimateHours).toBe(36);
  const getPattern = /\/planning(?:\?|$)/;
  await page.route(getPattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'PLANNING_UNAVAILABLE', message: 'Planning temporarily unavailable.' },
        meta: { requestId: randomUUID() },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByText('Planning temporarily unavailable.', { exact: true })).toBeVisible();
  await page.unroute(getPattern);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Showing 2 of 2 matching tasks', { exact: true })).toBeVisible();
  await page.goto(`${data.path}?section=planning&pfrom=2026-10-31&pto=2026-10-01`);
  await expect(
    page.getByRole('heading', { name: 'A small interruption.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Showing 2 of 2 matching tasks', { exact: true })).toBeVisible();
  const restored = new URL(page.url());
  await expect(page.getByLabel('Window starts (UTC)', { exact: true })).toHaveValue(
    restored.searchParams.get('pfrom')!,
  );
  await expect(page.getByLabel('Window ends (UTC)', { exact: true })).toHaveValue(
    restored.searchParams.get('pto')!,
  );
});
test('planning paginates actual matches, sorts consistently and refreshes direct links', async ({
  page,
}) => {
  const data = await fixture(page);
  const parts = data.path.split('/');
  await database((db) =>
    db.collection('tasks').insertMany(
      Array.from({ length: 105 }, (_, i) => ({
        organizationId: new ObjectId(parts[3]!),
        workspaceId: new ObjectId(parts[5]!),
        projectId: new ObjectId(parts[7]!),
        title: `Bulk ${String(105 - i).padStart(3, '0')}`,
        description: '',
        status: 'todo',
        priority: 'high',
        dueDate: '2026-10-10',
        ownerId: new ObjectId(data.member.id),
        parentId: null,
        assigneeIds: [new ObjectId(data.member.id)],
        labelIds: [],
        checklist: [],
        version: 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    ),
  );
  await page.reload();
  await page.getByLabel('Search planning tasks', { exact: true }).fill('Bulk');
  await page.getByLabel('Planning sort', { exact: true }).selectOption('title');
  await expect(page.getByLabel('Search planning tasks', { exact: true })).toHaveValue('Bulk');
  await expect(page).toHaveURL(/q=Bulk.*sort=title/);
  await expect(page.getByText('Showing 100 of 105 matching tasks', { exact: true })).toBeVisible();
  await expect(page.locator('.plan-gantt-copy a').first()).toHaveText('Bulk 001');
  await page.getByRole('button', { name: 'Load more planning tasks', exact: true }).click();
  await expect(page.getByText('Showing 105 of 105 matching tasks', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Search planning tasks', { exact: true })).toHaveValue('Bulk');
  expect(new Set(await page.locator('.plan-gantt-copy a').allTextContents()).size).toBe(105);
  await page.reload();
  await expect(page.getByLabel('Search planning tasks', { exact: true })).toHaveValue('Bulk');
  await expect(page.getByText('Showing 100 of 105 matching tasks', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Delivery', exact: true }).click();
  await expect(page.getByText('0 / 107', { exact: true })).toBeVisible();
});
