import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';

const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const mailbox = process.env.ORBIT_AUTH_MAILBOX ?? 'http://127.0.0.1:18025';
const uri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { MongoClient, ObjectId } = apiRequire('mongoose').mongo;
const { hash, argon2id } = apiRequire('argon2');
const password = `Team browser ${randomUUID()}`;
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
  for (const value of [origin, mailbox, uri])
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
  const email = `team-browser-${randomUUID()}@example.test`;
  emails.push(email);
  await database(async (db) => {
    await clearTestLoopbackLimits(db);
    await db.collection('auth_users').insertOne({
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
  return email;
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
  const recipient = await account('Jules Park');
  await signIn(page, owner);
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await page.getByLabel('Organization name', { exact: true }).fill('Northstar Studio');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Northstar Studio', exact: true })).toBeVisible();
  const orgPath = new URL(page.url()).pathname;
  const org = orgPath.split('/').at(-1)!;
  orgIds.push(org);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Product studio');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Product studio', exact: true })).toBeVisible();
  const wsPath = new URL(page.url()).pathname;
  await page.goto(`${orgPath}/team`);
  await expect(page.getByRole('heading', { name: 'Your team', exact: true })).toBeVisible();
  return { owner, recipient, orgPath, org, wsPath };
}
async function invite(page: Page, email: string, role = 'member', grant = true) {
  await page.getByRole('button', { name: 'Invite teammate', exact: true }).click();
  await page.getByLabel('Teammate email', { exact: true }).fill(email);
  await page.getByLabel('Organization role', { exact: true }).selectOption(role);
  if (grant) await page.getByLabel('Product studio', { exact: true }).check();
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByText('Invitation sent. Their access begins when they accept.'),
  ).toBeVisible();
}
async function capturedToken(email: string, route = '/invitations/accept') {
  let token = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(email)}`);
        if (!res.ok) return false;
        const data = await res.json();
        for (const message of data.messages ?? []) {
          const full = await fetch(`${mailbox}/api/v1/message/${message.ID}`).then((r) => r.json());
          const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = String(full.Text).match(new RegExp(`${escaped}#token=([a-f0-9]{64})`));
          if (match) {
            token = match[1]!;
            return true;
          }
        }
        return false;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  return token;
}
async function audit(page: Page, name: string) {
  for (const theme of ['dark', 'light'])
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page
        .getByRole('button', { name: `${theme === 'dark' ? 'Dark' : 'Light'} theme`, exact: true })
        .click();
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
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
async function auditOverlay(page: Page, name: string, triggerName: string) {
  for (const theme of ['dark', 'light'])
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page
        .getByRole('button', { name: `${theme === 'dark' ? 'Dark' : 'Light'} theme`, exact: true })
        .click();
      const trigger = page.getByRole('button', { name: triggerName, exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        expect(
          await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
        ).toBe(true);
      }
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })),
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/screenshots/${name}-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
}
test.afterEach(async () => {
  await database(async (db) => {
    const ids = (
      await db
        .collection('auth_users')
        .find({ email: { $in: emails } })
        .toArray()
    ).map((u: { _id: unknown }) => u._id);
    const orgs = orgIds.map((id) => new ObjectId(id));
    for (const collection of [
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
  for (const email of emails) {
    const data = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(email)}`).then(
      (r) => r.json(),
    );
    const ids = (data.messages ?? []).map((m: { ID: string }) => m.ID);
    if (ids.length)
      await fetch(`${mailbox}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IDs: ids }),
      });
  }
  emails.length = 0;
  orgIds.length = 0;
});

test('real SMTP invitation, deliberate acceptance, role and explicit workspace access', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const fixture = await setup(page);
  await audit(page, 'team-empty');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: 'Invite teammate', exact: true }).click();
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('email');
  await page.keyboard.press('Escape');
  await invite(page, fixture.recipient, 'project-manager');
  await audit(page, 'team-invited');
  const token = await capturedToken(fixture.recipient);
  await database(async (db) => {
    const user = await db.collection('auth_users').findOne({ email: fixture.recipient });
    expect(
      await db
        .collection('organization_memberships')
        .countDocuments({ organizationId: new ObjectId(fixture.org), userId: user._id }),
    ).toBe(0);
  });
  const context = await browser.newContext();
  const invited = await context.newPage();
  try {
    invited.on('pageerror', (e) => errors.push(e.message));
    await invited.goto(`/invitations/accept#token=${token}`);
    await expect(invited).toHaveURL(/\/invitations\/accept$/);
    await expect(
      invited.getByRole('link', { name: 'Sign in to accept', exact: true }),
    ).toBeVisible();
    await audit(invited, 'invitation-signin');
    await invited.getByRole('link', { name: 'Sign in to accept', exact: true }).click();
    await invited.getByLabel('Email address', { exact: true }).fill(fixture.recipient);
    await invited.getByLabel('Password', { exact: true }).fill(password);
    await invited.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      invited.getByRole('button', { name: 'Accept invitation', exact: true }),
    ).toBeVisible();
    await audit(invited, 'invitation-accept');
    expect(await invited.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
    expect(await invited.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(token);
    await invited.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(
      invited.getByRole('heading', { name: 'Northstar Studio', exact: true }),
    ).toBeVisible();
    await invited.goto(fixture.wsPath);
    await expect(
      invited.getByRole('heading', { name: 'Product studio', exact: true }),
    ).toBeVisible();
    await invited.goto(`${fixture.orgPath}/team`);
    await expect(
      invited.getByRole('heading', { name: 'Your access, clearly defined.' }),
    ).toBeVisible();
    await audit(invited, 'team-member');
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Jules Park', exact: true })).toBeVisible();
    await audit(page, 'team-members');
    await database(async (db) => {
      const user = await db.collection('auth_users').findOne({ email: fixture.recipient });
      expect(
        (
          await db
            .collection('organization_memberships')
            .findOne({ organizationId: new ObjectId(fixture.org), userId: user._id })
        ).role,
      ).toBe('project-manager');
      expect(
        await db
          .collection('workspace_memberships')
          .countDocuments({ organizationId: new ObjectId(fixture.org), userId: user._id }),
      ).toBe(1);
    });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('keyboard focus, responsive invitation dialog and access sheet, stale edit protection', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await setup(page);
  await auditOverlay(page, 'team-invite-dialog', 'Invite teammate');
  await page.setViewportSize({ width: 1440, height: 950 });
  await invite(page, fixture.recipient);
  const token = await capturedToken(fixture.recipient);
  const context = await browser.newContext();
  const recipient = await context.newPage();
  try {
    await signIn(recipient, fixture.recipient, '/invitations/accept');
    await recipient.goto(`/invitations/accept#token=${token}`);
    await recipient.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(recipient).toHaveURL(new RegExp(`${fixture.orgPath}$`));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Jules Park', exact: true })).toBeVisible();
    await auditOverlay(page, 'team-access-sheet', 'Edit access for Jules Park');
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole('button', { name: 'Edit access for Jules Park' }).click();
    const other = await page.context().newPage();
    await other.goto(`${fixture.orgPath}/team`);
    await other.getByRole('button', { name: 'Edit access for Jules Park' }).click();
    await other.getByLabel('Organization role').selectOption('guest');
    await other.getByRole('button', { name: 'Save access', exact: true }).click();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Organization role').selectOption('admin');
    await page.getByRole('button', { name: 'Save access', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('membership changed');
    await page.getByRole('button', { name: 'Reload latest team', exact: true }).click();
    await page.getByRole('button', { name: 'Edit access for Jules Park' }).click();
    await expect(page.getByLabel('Organization role')).toHaveValue('guest');
    await page.getByLabel('Product studio', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save access', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await recipient.goto(fixture.wsPath);
    await expect(recipient.getByRole('heading', { name: 'A small interruption.' })).toBeVisible();
    await other.close();
  } finally {
    await context.close();
  }
});

test('revoke, remove, password-protected ownership transfer and leaving use real APIs', async ({
  page,
  browser,
}) => {
  const fixture = await setup(page);
  await invite(page, fixture.recipient, 'admin', false);
  const token = await capturedToken(fixture.recipient);
  const context = await browser.newContext();
  const recipient = await context.newPage();
  try {
    await signIn(recipient, fixture.recipient);
    await recipient.goto(`/invitations/accept#token=${token}`);
    await recipient.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(recipient).toHaveURL(new RegExp(`${fixture.orgPath}$`));
    await recipient.goto(fixture.wsPath);
    await expect(recipient.getByRole('heading', { name: 'A small interruption.' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Remove Jules Park', exact: true }).click();
    await page.getByRole('button', { name: 'Remove member', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await recipient.goto(fixture.orgPath);
    await expect(recipient.getByRole('heading', { name: 'A small interruption.' })).toBeVisible();
    await invite(page, fixture.recipient, 'admin', false);
    const replacement = await capturedToken(fixture.recipient);
    expect(replacement).not.toBe(token);
    await recipient.goto(`/invitations/accept#token=${replacement}`);
    await recipient.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(recipient).toHaveURL(new RegExp(`${fixture.orgPath}$`));
    await page.reload();
    await page.getByRole('button', { name: 'Transfer ownership to Jules Park' }).click();
    await page.getByLabel('Current password', { exact: true }).fill('incorrect password');
    await page.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('password is incorrect');
    await page.getByLabel('Current password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Leave organization', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Leave organization', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Leave organization', exact: true })
      .click();
    await expect(page).toHaveURL(/\/app$/);
    await recipient.goto(`${fixture.orgPath}/team`);
    const third = await account('Rowan Ellis');
    await invite(recipient, third);
    await recipient
      .getByRole('button', { name: `Revoke invitation to ${third}`, exact: true })
      .click();
    await recipient.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
    await expect(recipient.getByRole('dialog')).toHaveCount(0);
    await expect(recipient.getByRole('list', { name: 'Pending invitations' })).toHaveCount(0);
    const leftLink = await capturedToken(third);
    const thirdPage = await context.newPage();
    await recipient.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(thirdPage, third);
    await thirdPage.goto(`/invitations/accept#token=${leftLink}`);
    await thirdPage.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(thirdPage.getByRole('alert')).toContainText('expired, revoked');
  } finally {
    await context.close();
  }
});

test('unavailable team API is truthful, retry recovers, and direct routes protect private data', async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.route('**/api/v1/organizations/*/team*', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'TEAM_UNAVAILABLE',
          message: 'Team services are unavailable. Please try again shortly.',
        },
        meta: { requestId: randomUUID() },
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A small interruption.' })).toBeVisible();
  await expect(
    page.getByText('Team services are unavailable. Please try again shortly.'),
  ).toBeVisible();
  await page.unroute('**/api/v1/organizations/*/team*');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your team', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(`${fixture.orgPath}/team`);
  await expect(page).toHaveURL(/\/auth\/login\?returnTo=/);
  await expect(page.getByRole('heading', { name: 'Your team', exact: true })).toHaveCount(0);
  await page.goto('/invitations/accept');
  await expect(page.getByRole('alert')).toContainText('Reopen the invitation link');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Reopen the invitation link');
});

test('a new invitee registers, verifies email, finishes onboarding and returns to accept', async ({
  page,
  browser,
}) => {
  const fixture = await setup(page);
  const email = `team-browser-${randomUUID()}@example.test`;
  emails.push(email);
  await invite(page, email);
  const token = await capturedToken(email);
  const context = await browser.newContext();
  const invited = await context.newPage();
  try {
    await invited.goto(`/invitations/accept#token=${token}`);
    await invited.getByRole('link', { name: 'Create an account', exact: true }).click();
    await invited.getByLabel('Full name', { exact: true }).fill('Tess Morris');
    await invited.getByLabel('Email address', { exact: true }).fill(email);
    await invited.getByLabel('Password', { exact: true }).fill(password);
    await invited.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(invited).toHaveURL(/\/onboarding\?returnTo=/);
    await expect(invited.getByRole('button', { name: 'Continue to my account' })).toBeDisabled();
    const verifyToken = await capturedToken(email, '/auth/verify-email');
    const verification = await context.newPage();
    await verification.goto(`/auth/verify-email#token=${verifyToken}`);
    await verification.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(verification.getByRole('heading', { name: 'You’re verified.' })).toBeVisible();
    await invited.getByRole('button', { name: 'I’ve verified my email', exact: true }).click();
    await expect(invited.getByRole('button', { name: 'Continue to my account' })).toBeEnabled();
    await invited.getByRole('button', { name: 'Continue to my account' }).click();
    await expect(invited).toHaveURL(/\/invitations\/accept$/);
    await invited.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invited).toHaveURL(new RegExp(`${fixture.orgPath}$`));
    await invited.goto(fixture.wsPath);
    await expect(
      invited.getByRole('heading', { name: 'Product studio', exact: true }),
    ).toBeVisible();
    await database(async (db) => {
      const user = await db.collection('auth_users').findOne({ email });
      expect(user.emailVerified).toBe(true);
      expect(user.onboardingCompleted).toBe(true);
      expect(
        await db
          .collection('organization_memberships')
          .countDocuments({ organizationId: new ObjectId(fixture.org), userId: user._id }),
      ).toBe(1);
    });
  } finally {
    await context.close();
  }
});
