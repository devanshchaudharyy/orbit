import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setup, project, task, api, database, signIn, audit, ObjectId } from './view-support';
const relative = (path: string) => path.replace('/app/organizations', '');
const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const library = (path: string) => `${path}?section=documents`;
const plain = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRk8AAAAASUVORK5CYII=',
  'base64',
);
function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['ORBIT document verification', 'Private second page'].map((text) => {
      const stream = `BT /F1 18 Tf 35 220 Td (${text}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let value = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(value));
    value += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('');
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}
async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await page.getByLabel('Choose file', { exact: true }).setInputFiles({ name, mimeType, buffer });
  await page.getByRole('button', { name: 'Upload selected file', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Preview ${name}`, exact: true })).toBeVisible();
}
const keys: string[] = [],
  orgs: string[] = [];
test.afterEach(async () => {
  // Only uniquely owned test objects; the shared helper cleans tenant rows afterwards.
  for (const key of keys.splice(0)) {
    if (!/^objects\/[a-f0-9]{24}\/[a-f0-9]{24}$/.test(key)) throw new Error('Unsafe test key');
    if (process.env.FILE_STORAGE_DRIVER !== 's3')
      await unlink(resolve('.local/files', key)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    else {
      const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
      const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const client = new S3Client({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? 'garage',
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY!,
          secretAccessKey: process.env.S3_SECRET_KEY!,
        },
      });
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'orbit-private', Key: key }),
        );
      } finally {
        client.destroy();
      }
    }
  }
  if (orgs.length)
    await database(async (db) => {
      for (const collection of ['project_documents', 'document_revisions', 'project_files'])
        await db
          .collection(collection)
          .deleteMany({ organizationId: { $in: orgs.map((id) => new ObjectId(id)) } });
    });
  orgs.length = 0;
});
async function remember(org: string) {
  await database(async (db) => {
    const rows = await db
      .collection('project_files')
      .find({ organizationId: new ObjectId(org) })
      .toArray();
    keys.push(...rows.map((row: { objectKey: string }) => row.objectKey));
  });
}

test('rich documents, immutable history, private previews, actual download, and accessible responsive layouts', async ({
  page,
}) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const people = await setup(page),
    path = await project(page);
  orgs.push(people.org);
  try {
    await page.getByRole('link', { name: 'Documents & files', exact: true }).click();
    await audit(page, 'documents-empty');
    await audit(page, 'documents-create', 'Create document');
    await page.getByRole('button', { name: 'Create document', exact: true }).click();
    await page.getByLabel('Document title', { exact: true }).fill('Release decisions');
    const editor = page.getByRole('textbox', { name: 'Document content', exact: true });
    await editor.fill('Accessible releases begin with shared context.');
    await editor.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    await page.getByLabel('Link address', { exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('valid');
    await page.getByLabel('Link address', { exact: true }).fill('https://example.com/release');
    await page.getByRole('button', { name: 'Save link', exact: true }).click();
    await page.getByRole('button', { name: 'Create document', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Release decisions', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Document content', exact: true }).locator('strong'),
    ).toContainText('Accessible');
    await audit(page, 'documents-reading');
    await audit(page, 'documents-edit', 'Edit document');
    await page.getByRole('button', { name: 'Edit document', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Document content', exact: true })
      .fill('Second saved decision.');
    await page.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(page.getByText('Second saved decision.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Document history', exact: true }).click();
    await page.getByRole('button', { name: 'View revision 1', exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'Revision 1 content', exact: true }),
    ).toContainText('Accessible releases');
    await page.getByRole('button', { name: 'Restore revision 1', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm restore revision 1', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/Revision 3 · updated/)).toBeVisible();
    await audit(page, 'documents-history', 'Document history');
    const docURL = page.url();
    await page.reload();
    await expect(page).toHaveURL(docURL);
    await expect(editor).toContainText('Accessible releases');
    await upload(page, 'notes.txt', 'text/plain', Buffer.from('Actual private text attachment.'));
    await audit(page, 'documents-attachment');
    await audit(page, 'documents-text-preview', 'Preview notes.txt');
    await audit(page, 'documents-rename', 'Rename notes.txt');
    await page.getByRole('button', { name: 'Rename notes.txt', exact: true }).click();
    await page.getByLabel('Filename', { exact: true }).fill('release-notes.txt');
    await page.getByRole('button', { name: 'Save filename', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download release-notes.txt', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('release-notes.txt');
    expect((await readFile((await download.path())!)).toString()).toBe(
      'Actual private text attachment.',
    );
    await upload(page, 'pixel.png', 'image/png', png);
    await page.getByRole('button', { name: 'Preview pixel.png', exact: true }).click();
    await expect(
      page.getByRole('img', { name: 'Preview of pixel.png', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'Preview of pixel.png', exact: true })
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(1);
    await page.keyboard.press('Escape');
    await upload(page, 'review.pdf', 'application/pdf', pdf());
    await page.getByRole('button', { name: 'Preview review.pdf', exact: true }).click();
    await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await audit(page, 'documents-pdf-preview', 'Preview review.pdf');
    await audit(page, 'documents-remove-file', 'Remove release-notes.txt');
    await page.getByRole('button', { name: 'Remove release-notes.txt', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm file removal', exact: true }).click();
    await expect(page.getByText('File removed.', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Preview release-notes.txt', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'All project files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Project files', exact: true })).toBeVisible();
    await page.getByLabel('File type', { exact: true }).selectOption('pdf');
    await expect(
      page.getByRole('button', { name: 'Preview review.pdf', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview pixel.png', exact: true })).toHaveCount(
      0,
    );
    await audit(page, 'documents-files-filtered');
    await page.goto(path);
    const taskPath = await task(page);
    await upload(
      page,
      'task.md',
      'text/markdown',
      Buffer.from('# Task evidence\nReal task attachment'),
    );
    await expect(page.getByRole('heading', { name: 'Attachments', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Preview task.md', exact: true })).toBeVisible();
    await page.goto(`${library(path)}&library=files`);
    await page.getByRole('link', { name: 'Open attached task', exact: true }).click();
    await expect(page).toHaveURL(taskPath);
    expect(errors).toEqual([]);
  } finally {
    await remember(people.org);
  }
});

test('shared editing preserves stale drafts, original versions, explicit reloads and guest permissions', async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const people = await setup(page),
    path = await project(page);
  orgs.push(people.org);
  const response = await api(page, `${relative(path)}/documents`, {
    title: 'Shared decisions',
    content: plain('First decision'),
    clientId: randomUUID(),
  });
  expect(response.status()).toBe(201);
  const record = (await response.json()).data;
  const url = `${library(path)}&document=${record.id}`;
  await page.goto(url);
  await page.getByRole('button', { name: 'Edit document', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Document content', exact: true })
    .fill('Unsaved owner draft');
  const context = await browser.newContext({ baseURL: origin }),
    memberPage = await context.newPage();
  try {
    await signIn(memberPage, people.member.email, url);
    await memberPage.getByRole('button', { name: 'Edit document', exact: true }).click();
    await memberPage
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Document content', exact: true })
      .fill('Member saved decision');
    await memberPage.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(memberPage.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByText('A newer document version is available. Your current draft is preserved.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Reload latest document', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('textbox', { name: 'Document content', exact: true }),
    ).toContainText('Unsaved owner draft');
    await page.getByRole('button', { name: 'Reload latest document', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('textbox', { name: 'Document content', exact: true }),
    ).toContainText('Member saved decision');
    await page.keyboard.press('Escape');
    await context.clearCookies();
    await signIn(memberPage, people.guest.email, url);
    await expect(
      memberPage.getByRole('button', { name: 'Edit document', exact: true }),
    ).toHaveCount(0);
    await expect(memberPage.getByRole('button', { name: 'Upload file', exact: true })).toHaveCount(
      0,
    );
    await memberPage.getByRole('button', { name: 'Document history', exact: true }).click();
    await memberPage.getByRole('button', { name: 'View revision 1', exact: true }).click();
    await expect(
      memberPage.getByRole('button', { name: 'Restore revision 1', exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('real bounded document pagination, literal search and truthful unavailable feedback', async ({
  page,
}) => {
  test.setTimeout(180000);
  const people = await setup(page),
    path = await project(page);
  orgs.push(people.org);
  for (let i = 0; i < 52; i++) {
    const response = await api(page, `${relative(path)}/documents`, {
      title: `Review note ${String(i).padStart(2, '0')}`,
      content: plain('Persisted pagination evidence'),
      clientId: randomUUID(),
    });
    expect(response.status()).toBe(201);
  }
  await page.goto(library(path));
  await expect(page.getByText('50 loaded / 52 matching documents', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more documents', exact: true }).click();
  await expect(page.getByText('52 loaded / 52 matching documents', { exact: true })).toBeVisible();
  await page.getByLabel('Search documents', { exact: true }).fill('Review note 17');
  await page.getByRole('button', { name: 'Find documents', exact: true }).click();
  await expect(page.getByText('1 loaded / 1 matching documents', { exact: true })).toBeVisible();
  await page.route('**/documents?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'LIBRARY_UNAVAILABLE',
          message: 'Private library is temporarily unavailable.',
        },
        meta: { requestId: randomUUID() },
      }),
    }),
  );
  await page.getByLabel('Search documents', { exact: true }).fill('unavailable');
  await page.getByRole('button', { name: 'Find documents', exact: true }).click();
  await expect(
    page.getByText('Private library is temporarily unavailable.', { exact: true }),
  ).toBeVisible();
  await page.unroute('**/documents?*');
  await page.getByRole('button', { name: 'Retry documents', exact: true }).click();
  await expect(
    page.getByText('No current documents match this search.', { exact: true }),
  ).toBeVisible();
});

test('unconfirmed uploads retry without duplicates, previews retry and stale filenames reload explicitly', async ({
  page,
}) => {
  test.setTimeout(150000);
  const people = await setup(page),
    path = await project(page);
  orgs.push(people.org);
  try {
    await page.goto(`${library(path)}&library=files`);
    let lost = false;
    await page.route('**/files?*', async (route) => {
      if (route.request().method() !== 'POST' || lost) return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      lost = true;
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Upload file', exact: true }).click();
    await page.getByLabel('Choose file', { exact: true }).setInputFiles({
      name: 'retry.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Private retry evidence'),
    });
    await page.getByRole('button', { name: 'Upload selected file', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(page.getByText(/retry.txt ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Upload selected file', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.unroute('**/files?*');
    const rows = await database(async (db) =>
      db
        .collection('project_files')
        .find({ organizationId: new ObjectId(people.org), name: 'retry.txt' })
        .toArray(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ready');
    await page.route('**/files/*/content', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'FILE_UNAVAILABLE', message: 'Storage unavailable' },
          meta: { requestId: randomUUID() },
        }),
      }),
    );
    await page.getByRole('button', { name: 'Preview retry.txt', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Retry file preview', exact: true }),
    ).toBeVisible();
    await page.unroute('**/files/*/content');
    await page.getByRole('button', { name: 'Retry file preview', exact: true }).click();
    await expect(page.getByText('Private retry evidence', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rename retry.txt', exact: true }).click();
    await page.getByLabel('Filename', { exact: true }).fill('unsaved.txt');
    const response = await api(
      page,
      `${relative(path)}/files/${String(rows[0]._id)}`,
      { name: 'current.txt', version: 1 },
      'PATCH',
    );
    expect(response.status()).toBe(200);
    await page.getByRole('button', { name: 'Save filename', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Reload latest file', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Filename', { exact: true })).toHaveValue('unsaved.txt');
    await page.getByRole('button', { name: 'Reload latest file', exact: true }).click();
    await expect(page.getByLabel('Filename', { exact: true })).toHaveValue('current.txt');
    await page.keyboard.press('Escape');
  } finally {
    await remember(people.org);
  }
});

test('archive read-only access and live workspace revocation clear an open document draft', async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const people = await setup(page),
    path = await project(page);
  orgs.push(people.org);
  const response = await api(page, `${relative(path)}/documents`, {
    title: 'Private reference',
    content: plain('Authorized context'),
    clientId: randomUUID(),
  });
  expect(response.status()).toBe(201);
  const record = (await response.json()).data,
    url = `${library(path)}&document=${record.id}`;
  const context = await browser.newContext({ baseURL: origin }),
    member = await context.newPage();
  try {
    await signIn(member, people.member.email, url);
    await member.getByRole('button', { name: 'Edit document', exact: true }).click();
    await member
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Document content', exact: true })
      .fill('Private unsaved draft');
    await database(async (db) => {
      await db.collection('workspace_memberships').deleteOne({
        organizationId: new ObjectId(people.org),
        workspaceId: new ObjectId(people.ws),
        userId: new ObjectId(people.member.id),
      });
    });
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await expect(
      member.getByRole('heading', { name: 'Private reference', exact: true }),
    ).toHaveCount(0);
    await page.goto(url);
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
    await expect(
      page.getByRole('textbox', { name: 'Document content', exact: true }),
    ).toContainText('Authorized context');
    await expect(page.getByRole('button', { name: 'Edit document', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await audit(page, 'documents-archived');
  } finally {
    await context.close();
  }
});
