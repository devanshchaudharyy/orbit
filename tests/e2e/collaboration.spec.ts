import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { conversationMessageSchema } from '../../packages/contracts/src/index.js';
import { setup, project, task, api, database, signIn, audit, ObjectId } from './view-support';
const relative = (path: string) => path.replace('/app/organizations', '');
const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const route = (path: string) => `${path}?section=collaboration`;
const inbox = (path: string) => `${route(path)}&collaboration=inbox`;
async function connected(page: Page) {
  await expect(page.getByText('Live updates connected', { exact: true })).toBeVisible({
    timeout: 15000,
  });
}
async function post(page: Page, body: string, mention?: string) {
  await page.getByLabel('Message', { exact: true }).fill(body);
  if (mention) await page.getByLabel(mention, { exact: true }).check();
  await page.getByRole('button', { name: 'Post message', exact: true }).click();
  await expect(page.getByText('Message saved.', { exact: true })).toBeVisible();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
}
async function saved(
  page: Page,
  path: string,
  body: string,
  mentionIds: string[] = [],
  taskId?: string,
) {
  const response = await api(
    page,
    `${relative(path)}/collaboration/messages${taskId ? `?taskId=${taskId}` : ''}`,
    { body, mentionIds, clientId: randomUUID() },
  );
  expect(response.status()).toBe(201);
  return conversationMessageSchema.parse((await response.json()).data);
}

test('real discussion, task comments, mentions, private inbox, live presence and accessible layouts', async ({
  page,
  browser,
}) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const people = await setup(page),
    path = await project(page);
  await page.getByRole('link', { name: 'Collaboration', exact: true }).click();
  await connected(page);
  await expect(
    page.getByRole('heading', { name: 'Project discussion', exact: true }),
  ).toBeVisible();
  await audit(page, 'collaboration-discussion-empty');
  await page.getByRole('link', { name: 'My project inbox', exact: true }).click();
  await expect(page.getByText('You’re all caught up.', { exact: true })).toBeVisible();
  await audit(page, 'collaboration-inbox-empty');
  await page.goto(path);
  const taskPath = await task(page);
  await connected(page);
  await audit(page, 'collaboration-comments-empty');
  await post(page, 'Ready for the accessibility review.', 'Jules Park');
  await audit(page, 'collaboration-comments');
  await audit(page, 'collaboration-edit-dialog', 'Edit message by Morgan Reed');
  await audit(page, 'collaboration-remove-dialog', 'Remove message by Morgan Reed');
  const context = await browser.newContext({ baseURL: origin });
  const memberPage = await context.newPage();
  try {
    await signIn(memberPage, people.member.email, route(path));
    await connected(memberPage);
    await expect(page.getByText('2 viewing this project', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'People viewing this project' })
        .getByRole('listitem')
        .filter({ hasText: 'Jules Park' }),
    ).toBeVisible();
    await page.goto(route(path));
    await connected(page);
    await post(page, 'Review is scheduled for tomorrow.', 'Jules Park');
    await expect(
      memberPage.getByText('Review is scheduled for tomorrow.', { exact: true }),
    ).toBeVisible();
    await post(memberPage, 'I will bring the review notes.');
    await expect(page.getByText('I will bring the review notes.', { exact: true })).toBeVisible();
    await audit(page, 'collaboration-discussion');
    await memberPage.getByRole('link', { name: 'My project inbox', exact: true }).click();
    await expect(memberPage.getByText('2 unread', { exact: true })).toBeVisible();
    await audit(memberPage, 'collaboration-inbox');
    const notice = memberPage
      .locator('.collab-notifications>li')
      .filter({ hasText: 'Ready for the accessibility review.' });
    await notice.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(memberPage.getByText('1 unread', { exact: true })).toBeVisible();
    await notice.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await expect(memberPage.getByText('2 unread', { exact: true })).toBeVisible();
    await notice.getByRole('link', { name: 'Open conversation' }).click();
    await expect(memberPage).toHaveURL(new RegExp(`${taskPath}#message-`));
    await expect(
      memberPage.getByText('Ready for the accessibility review.', { exact: true }),
    ).toBeVisible();
    await memberPage.reload();
    await expect(
      memberPage.getByText('Ready for the accessibility review.', { exact: true }),
    ).toBeVisible();
    await page.goto(inbox(path));
    await expect(page.getByText('You’re all caught up.', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('live task and planning updates refresh other sessions without replacing an open draft', async ({
  page,
  browser,
}) => {
  const people = await setup(page),
    path = await project(page),
    taskPath = await task(page, 'Release review');
  const taskId = taskPath.split('/').at(-1)!;
  const context = await browser.newContext({ baseURL: origin }),
    other = await context.newPage();
  try {
    await signIn(other, people.member.email, taskPath);
    await connected(page);
    await connected(other);
    await page.getByRole('button', { name: 'Edit task', exact: true }).click();
    await page.getByLabel('Task title', { exact: true }).fill('Unsaved local draft');
    const response = await other.request.get(taskPath.replace('/app', '/api/v1'));
    const current = (await response.json()).data;
    const update = await api(
      other,
      `${relative(path)}/tasks/${taskId}`,
      {
        ...Object.fromEntries(
          [
            'title',
            'description',
            'status',
            'priority',
            'dueDate',
            'ownerId',
            'assigneeIds',
            'labelIds',
            'checklist',
            'version',
          ].map((key) => [key, current[key]]),
        ),
        title: 'Remote saved title',
      },
      'PATCH',
    );
    expect(update.status()).toBe(200);
    await expect(
      other.getByRole('heading', { name: 'Remote saved title', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Unsaved local draft');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('heading', { name: 'Remote saved title', exact: true }),
    ).toBeVisible();
    await page.goto(`${path}?section=planning&pview=milestones`);
    await connected(page);
    await other.goto(`${path}?section=planning&pview=milestones`);
    await connected(other);
    const milestone = await api(page, `${relative(path)}/planning/milestones`, {
      name: 'Live delivery',
      description: 'Committed planning update',
      dueDate: '2026-10-31',
      status: 'open',
    });
    expect(milestone.status()).toBe(201);
    await expect(
      page.getByRole('heading', { name: 'Live delivery', exact: true, level: 3 }),
    ).toBeVisible();
    await expect(
      other.getByRole('heading', { name: 'Live delivery', exact: true, level: 3 }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('stale comment edits retain their draft and deletion restores keyboard focus', async ({
  page,
}) => {
  await setup(page);
  const path = await project(page);
  await page.goto(route(path));
  const record = await saved(page, path, 'Original decision');
  await expect(page.getByText('Original decision', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit message by Morgan Reed', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Edit message', exact: true })
    .fill('Retained local edit');
  const response = await api(
    page,
    `${relative(path)}/collaboration/messages/${record.id}`,
    { body: 'Changed in another session', mentionIds: [], version: 1 },
    'PATCH',
  );
  expect(response.status()).toBe(200);
  await page.getByRole('button', { name: 'Save message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another session');
  await expect(page.getByRole('textbox', { name: 'Edit message', exact: true })).toHaveValue(
    'Retained local edit',
  );
  await page.getByRole('button', { name: 'Reload conversation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Changed in another session', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove message by Morgan Reed', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm remove message', exact: true }).click();
  await expect(page.locator(`#message-${record.id}`)).toHaveText(/Message removed/);
  await expect(
    page.getByRole('heading', { name: 'Project discussion', exact: true }),
  ).toBeFocused();
  expect(
    await page.request
      .get(`${path.replace('/app', '/api/v1')}/collaboration/messages`)
      .then((r) => r.status()),
  ).toBe(200);
});

test('read-only guests, archived projects and revoked subscriptions expose truthful access', async ({
  page,
  browser,
}) => {
  const people = await setup(page),
    path = await project(page);
  await saved(page, path, 'Shared read-only context');
  const context = await browser.newContext({ baseURL: origin }),
    guest = await context.newPage();
  try {
    await signIn(guest, people.guest.email, route(path));
    await connected(guest);
    await expect(guest.getByText('Shared read-only context', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Post message', exact: true })).toHaveCount(0);
    await expect(
      guest.getByRole('button', { name: 'Edit message by Morgan Reed', exact: true }),
    ).toHaveCount(0);
    await audit(guest, 'collaboration-readonly');
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
    await expect(page.getByRole('button', { name: 'Post message', exact: true })).toHaveCount(0);
    await audit(page, 'collaboration-archived');
    await database(async (db) => {
      await db
        .collection('projects')
        .updateOne(
          { _id: new ObjectId(path.split('/').at(-1)!) },
          { $pull: { memberIds: new ObjectId(people.guest.id) } },
        );
    });
    await expect(guest.getByText('Shared read-only context', { exact: true })).toHaveCount(0);
    await expect(
      guest.getByRole('heading', { name: 'Project discussion', exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('offline connection feedback, preserved drafts and explicit reconnect resynchronize missed work', async ({
  page,
  browser,
}) => {
  const people = await setup(page),
    path = await project(page);
  await page.goto(route(path));
  await connected(page);
  const context = await browser.newContext({ baseURL: origin }),
    other = await context.newPage();
  try {
    await signIn(other, people.member.email, route(path));
    await connected(other);
    await page.getByLabel('Message', { exact: true }).fill('Unsent draft');
    await page.context().setOffline(true);
    await expect(page.getByText('Live updates disconnected', { exact: true })).toBeVisible();
    await post(other, 'Saved while the other tab was offline.');
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Reconnect live updates', exact: true }).click();
    await connected(page);
    await expect(
      page.getByText('Saved while the other tab was offline.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Unsent draft');
  } finally {
    await page.context().setOffline(false);
    await context.close();
  }
});

test('failed and lost responses preserve retry identity without duplicate messages or inbox entries', async ({
  page,
}) => {
  const people = await setup(page),
    path = await project(page);
  await page.goto(route(path));
  await page.getByLabel('Message', { exact: true }).fill('Retry this message');
  await page.getByLabel('Jules Park', { exact: true }).check();
  let captured: string | undefined;
  await page.route('**/collaboration/messages', async (route) => {
    if (route.request().method() === 'POST') {
      captured = route.request().postDataJSON().clientId;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'COLLABORATION_UNAVAILABLE',
            message: 'Collaboration is temporarily unavailable.',
          },
          meta: { requestId: randomUUID() },
        }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Post message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Retry this message');
  expect(captured).toBeTruthy();
  await page.unroute('**/collaboration/messages');
  const committed = await api(page, `${relative(path)}/collaboration/messages`, {
    body: 'Retry this message',
    mentionIds: [people.member.id],
    clientId: captured,
  });
  expect(committed.status()).toBe(201);
  await page.getByRole('button', { name: 'Post message', exact: true }).click();
  await expect(page.getByText('Message saved.', { exact: true })).toBeVisible();
  expect(
    await page.locator('.collab-message-body').filter({ hasText: 'Retry this message' }).count(),
  ).toBe(1);
  await database(async (db) => {
    const projectId = new ObjectId(path.split('/').at(-1)!);
    expect(
      await db
        .collection('collaboration_messages')
        .countDocuments({ projectId, clientId: captured }),
    ).toBe(1);
    expect(
      await db
        .collection('collaboration_notifications')
        .countDocuments({ projectId, userId: new ObjectId(people.member.id) }),
    ).toBe(1);
  });
});

test('notification links open messages beyond the first page and reduced motion remains usable', async ({
  page,
}) => {
  const people = await setup(page),
    path = await project(page);
  await database(async (db) => {
    await db.collection('collaboration_messages').insertMany(
      Array.from({ length: 55 }, (_, i) => ({
        organizationId: new ObjectId(people.org),
        workspaceId: new ObjectId(people.ws),
        projectId: new ObjectId(path.split('/').at(-1)!),
        taskId: null,
        authorId: new ObjectId(people.owner.id),
        body: `Earlier decision ${i}`,
        mentionIds: [],
        clientId: randomUUID(),
        inputHash: 'fixture',
        version: 1,
        deletedAt: null,
        edited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
  });
  const record = await saved(page, path, 'Linked after the first page');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${route(path)}#message-${record.id}`);
  await expect(page.getByText('Linked after the first page', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Linked after the first page', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open full conversation', exact: true }).click();
  await expect(page.getByText('Earlier decision 0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more messages', exact: true }).click();
  await expect(page.getByText('Linked after the first page', { exact: true })).toBeVisible();
});

test('revoked workspace membership closes an open task overlay and clears private content', async ({
  page,
  browser,
}) => {
  const people = await setup(page);
  await project(page);
  const taskPath = await task(page, 'Private review');
  const context = await browser.newContext({ baseURL: origin }),
    member = await context.newPage();
  try {
    await signIn(member, people.member.email, taskPath);
    await connected(member);
    await member.getByRole('button', { name: 'Edit task', exact: true }).click();
    await member.getByLabel('Task title', { exact: true }).fill('Private unsent edit');
    await database(async (db) => {
      await db.collection('workspace_memberships').deleteOne({
        organizationId: new ObjectId(people.org),
        workspaceId: new ObjectId(people.ws),
        userId: new ObjectId(people.member.id),
      });
    });
    // Authorization sweeps run every five seconds, then transport/render must finish.
    await expect(member.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
    await expect(member.getByRole('heading', { name: 'Private review', exact: true })).toHaveCount(
      0,
    );
    await expect(member.getByRole('textbox', { name: 'Task title', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
