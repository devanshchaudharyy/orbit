import { test, expect, type Page } from '@playwright/test';
import { setup, project, api, audit, database, signIn, ObjectId } from './view-support';
import {
  aiRunSchema,
  aiDashboardSchema,
  taskSchema,
  type AIMode,
} from '../../packages/contracts/src/index.js';
const relative = (path: string) => path.replace('/app/organizations', ''),
  apiPath = (path: string) => path.replace('/app', '/api/v1');
const taskInput = {
  title: 'Verify launch accessibility',
  description: 'Component demonstration for real API/database verification.',
  status: 'todo',
  priority: 'normal',
  dueDate: null,
  ownerId: null,
  assigneeIds: [],
  labelIds: [],
  checklist: [],
  parentId: null,
};
async function fixture(page: Page) {
  const people = await setup(page),
    path = await project(page);
  await page.getByRole('link', { name: 'AI assistance', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Think through the next move.', exact: true }),
  ).toBeVisible();
  return { ...people, path };
}
async function generate(page: Page, mode: AIMode, prompt = 'Help with the recorded work.') {
  await page.getByLabel('How can ORBIT help?', { exact: true }).selectOption(mode);
  await page.getByPlaceholder('What would help move this project forward?').fill(prompt);
  const response = page.waitForResponse(
    (response) => response.url().endsWith('/ai/runs') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Generate private draft', exact: true }).click();
  const completed = await response,
    body = await completed.json();
  expect(completed.status(), body.error?.code ?? 'AI generation HTTP status').toBe(200);
  const run = aiRunSchema.parse(body.data);
  expect(run.status).toBe('ready');
  await expect(page.getByRole('article', { name: 'Private AI draft' })).toContainText(
    'deterministic test-provider',
  );
  return run;
}
test('real private AI drafts, all eight modes, edited task/subtask/priority confirmation and responsive accessibility', async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (entry.type() === 'error') errors.push(entry.text());
  });
  const people = await fixture(page),
    path = people.path;
  await expect(
    page.getByText('No drafts yet. Start with a question about your project.', { exact: true }),
  ).toBeVisible();
  await audit(page, 'ai-empty');
  await page.getByRole('button', { name: 'Generate private draft', exact: true }).click();
  await expect(page.getByPlaceholder('What would help move this project forward?')).toBeFocused();
  await expect(page.getByText('Describe what you need.', { exact: true })).toBeVisible();
  const created = taskSchema.parse(
    (await (await api(page, `${relative(path)}/tasks`, taskInput)).json()).data,
  );
  await page.reload();
  await generate(page, 'tasks', 'Propose verification tasks for this project.');
  await page
    .getByLabel('Proposed title 1', { exact: true })
    .fill('Review the actual accessibility evidence');
  await page.getByLabel('Include proposal 2', { exact: true }).uncheck();
  await audit(page, 'ai-task-draft');
  await audit(page, 'ai-confirm', 'Review selected changes');
  await page.getByRole('button', { name: 'Review selected changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Review the actual accessibility evidence');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Review selected changes', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Review selected changes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Changes applied', exact: true })).toBeVisible();
  const current = await (await page.request.get(`${apiPath(path)}/tasks`)).json();
  expect(current.data.tasks.map((row: { title: string }) => row.title)).toContain(
    'Review the actual accessibility evidence',
  );
  expect(current.data.tasks).toHaveLength(2);
  await generate(page, 'summary');
  await audit(page, 'ai-summary');
  await generate(page, 'assistant');
  await generate(page, 'risks');
  await generate(page, 'weekly-report');
  await page.getByLabel('Context scope', { exact: true }).selectOption(created.id);
  await generate(page, 'subtasks');
  await audit(page, 'ai-subtasks');
  await page.getByLabel('Include proposal 2', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Review selected changes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Changes applied', exact: true })).toBeVisible();
  await generate(page, 'priorities');
  await audit(page, 'ai-priorities');
  await page.getByRole('button', { name: 'Review selected changes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Changes applied', exact: true })).toBeVisible();
  expect(
    (await (await page.request.get(`${apiPath(path)}/tasks/${created.id}`)).json()).data.priority,
  ).toBe('high');
  await page.getByLabel('Context scope', { exact: true }).selectOption('');
  await generate(page, 'search', 'Find launch verification tasks.');
  await expect(page.getByRole('list', { name: 'Search matches' }).getByRole('link')).toHaveCount(3);
  await audit(page, 'ai-search');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your draft history', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('manager workflow create, explicit enable/pause, manual run, deletion and focus restoration', async ({
  page,
}) => {
  test.setTimeout(150000);
  await fixture(page);
  await audit(page, 'ai-workflow-dialog', 'Create draft workflow');
  await page.getByRole('button', { name: 'Create draft workflow', exact: true }).click();
  await page.getByLabel('Workflow name', { exact: true }).fill('Weekly evidence');
  await page
    .getByLabel('I authorize private draft generation using my current project access.', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await expect(
    page.getByText('Workflow saved. Scheduled execution requires a running worker.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Paused · Monday/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit Weekly evidence', exact: true }).click();
  await page.getByLabel('Enable this schedule', { exact: true }).check();
  await page
    .getByLabel('I authorize private draft generation using my current project access.', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await expect(page.getByText(/Enabled · Monday/)).toBeVisible();
  await audit(page, 'ai-workflows');
  await page.getByRole('button', { name: 'Run now: Weekly evidence', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Private AI draft' })).toContainText(
    'deterministic test-provider weekly-report',
  );
  await page.getByRole('button', { name: 'Edit Weekly evidence', exact: true }).click();
  await page.getByLabel('Enable this schedule', { exact: true }).uncheck();
  await page
    .getByLabel('I authorize private draft generation using my current project access.', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await expect(page.getByText(/Paused · Monday/)).toBeVisible();
  await page.getByRole('button', { name: 'Delete Weekly evidence', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Delete Weekly evidence', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Delete Weekly evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await expect(page.getByText('Workflow deleted.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Weekly evidence', exact: true })).toHaveCount(
    0,
  );
});
test('guest private history, read-only proposals, archive access and live grant revocation', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const people = await fixture(page);
  await api(page, `${relative(people.path)}/tasks`, taskInput);
  await generate(page, 'summary');
  const context = await browser.newContext({
    baseURL: process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5175',
  });
  try {
    const guest = await context.newPage();
    await signIn(guest, people.guest.email, `${people.path}?section=ai`);
    await expect(
      guest.getByText('No drafts yet. Start with a question about your project.', { exact: true }),
    ).toBeVisible();
    await generate(guest, 'tasks', 'Propose tasks for read-only review.');
    await expect(
      guest.getByText('You have read-only access. Drafts cannot change this project.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      guest.getByRole('button', { name: 'Review selected changes', exact: true }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole('button', { name: 'Create draft workflow', exact: true }),
    ).toHaveCount(0);
    await audit(guest, 'ai-readonly');
    const projectData = (await (await page.request.get(apiPath(people.path))).json()).data;
    // Exercise the actual lifecycle endpoint, preserving all existing project fields.
    expect(
      (
        await api(page, `${relative(people.path)}/archive`, {
          version: projectData.version,
          archived: true,
        })
      ).status(),
    ).toBe(200);
    await guest.reload();
    await expect(
      guest.getByRole('heading', { name: 'Think through the next move.', exact: true }),
    ).toBeVisible();
    await database(async (db) => {
      await db.collection('workspace_memberships').deleteOne({
        organizationId: new ObjectId(people.org),
        workspaceId: new ObjectId(people.ws),
        userId: new ObjectId(people.guest.id),
      });
    });
    await expect(
      guest.getByRole('heading', { name: 'Think through the next move.', exact: true }),
    ).toHaveCount(0);
    await expect(guest.getByRole('article', { name: 'Private AI draft' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
test('truthful retry, reduced motion, direct refresh and stale proposal feedback preserve reviewed edits', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const people = await fixture(page),
    endpoint = `${apiPath(people.path)}/ai`;
  await page.route(`**${endpoint}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AI_UNAVAILABLE',
          message: 'AI assistance is temporarily unavailable. Please retry.',
        },
        meta: { requestId: 'test-ai-unavailable' },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry AI workspace', exact: true })).toBeVisible();
  await audit(page, 'ai-unavailable');
  await page.unroute(`**${endpoint}`);
  await page.getByRole('button', { name: 'Retry AI workspace', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Generate private draft', exact: true }),
  ).toBeVisible();
  const task = taskSchema.parse(
    (await (await api(page, `${relative(people.path)}/tasks`, taskInput)).json()).data,
  );
  const run = await generate(page, 'tasks', 'Propose a review plan.');
  await page.getByLabel('Proposed title 1', { exact: true }).fill('Preserve this reviewed draft');
  expect(
    (
      await api(
        page,
        `${relative(people.path)}/tasks/${task.id}`,
        { ...taskInput, parentId: undefined, version: task.version, priority: 'urgent' },
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Review selected changes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Project context changed. Generate a fresh draft before applying.',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Proposed title 1', { exact: true })).toHaveValue(
    'Preserve this reviewed draft',
  );
  await audit(page, 'ai-stale');
  const data = aiDashboardSchema.parse((await (await page.request.get(endpoint)).json()).data);
  expect(data.runs.find((row) => row.id === run.id)?.status).toBe('ready');
  expect(
    (await (await page.request.get(`${apiPath(people.path)}/tasks`)).json()).data.tasks,
  ).toHaveLength(1);
});
