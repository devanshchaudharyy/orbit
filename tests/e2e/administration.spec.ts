import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setup, project, audit, api, database, ObjectId, signIn } from './view-support';
const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
test('search loads subsequent pages and resets pagination when type or archive filters change', async ({
  page,
}) => {
  test.setTimeout(120000);
  const people = await fixture(page);
  await database(async (db) => {
    const first = await db.collection('tasks').findOne({ _id: new ObjectId(people.task.id) });
    expect(first).toBeTruthy();
    await db.collection('tasks').insertMany(
      Array.from({ length: 31 }, (_, i) => ({
        ...first,
        _id: new ObjectId(),
        title: `Discovery page ${i}`,
      })),
    );
  });
  await page.goto('/app/search?q=Discovery&kind=task');
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(25);
  await page.getByRole('button', { name: 'Load more results', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(32);
  const links = await page
    .getByRole('navigation', { name: 'Search results' })
    .getByRole('link')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  expect(new Set(links).size).toBe(32);
  await page.getByLabel('Type', { exact: true }).selectOption('project');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load more results', exact: true })).toHaveCount(0);
  expect(
    (await api(page, `${relative(people.path)}/archive`, { version: 1, archived: true })).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No matches in your spaces.', exact: true }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include archived projects', exact: true }).check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: 'Include archived projects', exact: true }),
  ).toBeChecked();
});
const relative = (path: string) => path.replace('/app/organizations', '');
async function change(page: Page, path: string, data: object) {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()).data;
  return page.request.patch('/api/v1/discovery' + path, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
    data,
  });
}
async function fixture(page: Page) {
  const people = await setup(page),
    path = await project(page, 'Discovery launch'),
    taskResponse = await api(page, `${relative(path)}/tasks`, {
      title: 'Discovery deadline, résumé; 🌙',
      description: 'Private task body is not exported',
      status: 'todo',
      priority: 'normal',
      dueDate: '2026-12-31',
      ownerId: people.member.id,
      assigneeIds: [people.member.id],
      labelIds: [],
      checklist: [],
      parentId: null,
    });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()).data;
  return { ...people, path, task };
}
test('real global search, direct links, filters and keyboard command palette across responsive themes', async ({
  page,
}) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => {
    if (event.type() === 'error') errors.push(event.text());
  });
  const people = await fixture(page);
  const doc = await api(page, `${relative(people.path)}/documents`, {
    title: 'Discovery guide',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private document body' }] }],
    },
    clientId: randomUUID(),
  });
  expect(doc.status()).toBe(201);
  await page.goto('/app/search');
  await expect(page.getByRole('heading', { name: 'Find your orbit.', exact: true })).toBeVisible();
  await audit(page, 'discovery-empty');
  await page.getByLabel('Search your work', { exact: true }).fill('Discovery');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(3);
  await audit(page, 'discovery-results');
  await page.reload();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(3);
  await page.getByLabel('Type', { exact: true }).selectOption('task');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Search results' }).getByRole('link').click();
  await expect(page).toHaveURL(people.path + '/tasks/' + people.task.id);
  await audit(page, 'discovery-palette', 'Search and commands');
  await audit(page, 'discovery-command-results', 'Search and commands', async (current) => {
    await current.getByLabel('Search your work', { exact: true }).fill('Discovery');
    await expect(
      current
        .getByRole('dialog')
        .getByRole('navigation', { name: 'Search results' })
        .getByRole('link'),
    ).toHaveCount(3);
  });
  const trigger = page.getByRole('button', { name: 'Search and commands', exact: true });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Search your work', { exact: true }).fill('Discovery');
  await expect(
    page.getByRole('dialog').getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(3);
  await page.getByLabel('Search your work', { exact: true }).press('ArrowDown');
  await expect(
    page
      .getByRole('dialog')
      .getByRole('navigation', { name: 'Search results' })
      .getByRole('link')
      .first(),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Search your work', { exact: true })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
test('notification controls persist, suppress actual inbox entries and preserve stale drafts until explicit reload', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const people = await fixture(page),
    context = await browser.newContext({ baseURL: origin }),
    member = await context.newPage();
  try {
    await signIn(member, people.member.email, '/app/preferences');
    const mentions = member.getByRole('checkbox', { name: /When someone mentions me/ }),
      comments = member.getByRole('checkbox', { name: /Comments on my assigned tasks/ });
    await expect(mentions).toBeChecked();
    await mentions.uncheck();
    await member
      .getByRole('button', { name: 'Save notification preferences', exact: true })
      .click();
    await expect(
      member.getByText('Your notification preferences have been saved.', { exact: true }),
    ).toBeVisible();
    await member.reload();
    await expect(mentions).not.toBeChecked();
    await audit(member, 'discovery-preferences');
    const posted = await api(page, `${relative(people.path)}/collaboration/messages`, {
      body: 'A private test mention',
      mentionIds: [people.member.id],
      clientId: randomUUID(),
    });
    expect(posted.status()).toBe(201);
    await database(async (db) => {
      expect(
        await db
          .collection('collaboration_notifications')
          .countDocuments({ userId: new ObjectId(people.member.id) }),
      ).toBe(0);
    });
    const current = (await (await member.request.get('/api/v1/discovery/preferences')).json()).data;
    expect((await change(member, '/preferences', { ...current, mentions: true })).status()).toBe(
      200,
    );
    await comments.uncheck();
    await member
      .getByRole('button', { name: 'Save notification preferences', exact: true })
      .click();
    await expect(member.getByRole('alert')).toContainText('changed');
    await expect(comments).not.toBeChecked();
    await member.getByRole('button', { name: 'Reload notification settings', exact: true }).click();
    await expect(comments).toBeChecked();
    await expect(mentions).toBeChecked();
  } finally {
    await context.close();
  }
});
test('administration shows real counts, private audit pagination and explicit versioned calendar settings', async ({
  page,
}) => {
  test.setTimeout(300000);
  const people = await fixture(page);
  for (let i = 0; i < 28; i++) {
    const result = await api(page, `${relative(people.path)}/tasks`, {
      title: `Audit record ${i}`,
      description: '',
      status: 'todo',
      priority: 'none',
      dueDate: null,
      ownerId: null,
      assigneeIds: [],
      labelIds: [],
      checklist: [],
      parentId: null,
    });
    expect(result.status()).toBe(201);
  }
  await page.goto(`/app/organizations/${people.org}/administration`);
  await expect(
    page.getByRole('heading', { name: 'Keep your orbit in order.', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Organization usage')).toContainText('29');
  await audit(page, 'discovery-usage');
  await page.getByRole('tab', { name: 'Audit log', exact: true }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(25);
  await audit(page, 'discovery-audit');
  await page.getByRole('button', { name: 'Load older records', exact: true }).click();
  await expect.poll(() => page.getByRole('table').locator('tbody tr').count()).toBeGreaterThan(25);
  await expect(page.getByRole('table')).not.toContainText('Private task body');
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
  await audit(page, 'discovery-integrations');
  await page.getByRole('checkbox', { name: /Allow authenticated calendar export/ }).check();
  await page.getByRole('button', { name: 'Save calendar settings', exact: true }).click();
  await expect(page.getByText(/Current state: enabled/)).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: /Allow authenticated calendar export/ }),
  ).toBeChecked();
});
test('calendar uses an actual authenticated download, correct deadlines and private disabled/revoked feedback', async ({
  page,
}) => {
  test.setTimeout(180000);
  const people = await fixture(page);
  expect(
    (
      await change(page, `/organizations/${people.org}/integration`, {
        calendarEnabled: true,
        version: 0,
      })
    ).status(),
  ).toBe(200);
  await audit(page, 'discovery-calendar', 'Export calendar');
  await page.getByRole('button', { name: 'Export calendar', exact: true }).click();
  await page.getByLabel('From (inclusive)', { exact: true }).fill('2026-12-01');
  await page.getByLabel('To (inclusive)', { exact: true }).fill('2026-12-31');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download calendar file', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('orbit-deadlines.ics');
  const text = await readFile((await file.path())!, 'utf8');
  expect(text).toContain('DTEND;VALUE=DATE:20270101');
  expect(text).toContain('SUMMARY:Discovery deadline\\, résumé\\; 🌙');
  expect(text).not.toContain('Private task body');
  await expect(page.getByRole('button', { name: 'Export calendar', exact: true })).toBeFocused();
  expect(
    (
      await change(page, `/organizations/${people.org}/integration`, {
        calendarEnabled: false,
        version: 1,
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Export calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Download calendar file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('enable calendar export');
  await page.keyboard.press('Escape');
});
test('guest search and administrative access stay private after explicit grants are revoked', async ({
  page,
  browser,
}) => {
  const people = await fixture(page),
    context = await browser.newContext({ baseURL: origin }),
    guest = await context.newPage();
  try {
    await signIn(guest, people.guest.email, '/app/search?q=Discovery');
    await expect(
      guest.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
    ).toHaveCount(2);
    await database(async (db) => {
      await db
        .collection('projects')
        .updateOne(
          { _id: new ObjectId(people.path.split('/').at(-1)!) },
          { $pull: { memberIds: new ObjectId(people.guest.id) } },
        );
    });
    await guest.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      guest.getByRole('heading', { name: 'No matches in your spaces.', exact: true }),
    ).toBeVisible();
    await expect(guest.locator('.discovery-result')).toHaveCount(0);
    await guest.goto(`/app/organizations/${people.org}/administration`);
    await expect(guest.getByRole('alert')).toContainText('owner or admin');
    await expect(guest.getByRole('tab', { name: 'Audit log', exact: true })).toHaveCount(0);
    await guest.goto('/app/search?q=x');
    await expect(guest.getByRole('alert')).toContainText('Check this search link');
  } finally {
    await context.close();
  }
});
test('unavailable search is truthful, explicit retry recovers and reduced-motion direct refresh remains usable', async ({
  page,
}) => {
  test.setTimeout(150000);
  await fixture(page);
  await page.route('**/api/v1/discovery/search?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Search is temporarily unavailable.' },
        meta: { requestId: randomUUID() },
      }),
    }),
  );
  await page.goto('/app/search?q=Discovery');
  await expect(page.getByRole('alert')).toContainText('Search is temporarily unavailable.');
  await audit(page, 'discovery-unavailable');
  await page.unroute('**/api/v1/discovery/search?**');
  await page.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(
    page.getByRole('navigation', { name: 'Search results' }).getByRole('link'),
  ).toHaveCount(2);
});
