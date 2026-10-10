import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { clearTestLoopbackLimits } from '../../scripts/auth-test-support.mjs';

const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const mailbox = process.env.ORBIT_AUTH_MAILBOX ?? 'http://127.0.0.1:18025';
const mongoUri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));

test.beforeAll(async () => {
  for (const value of [origin, mailbox, mongoUri]) {
    let target: URL;
    try {
      target = new URL(value);
    } catch {
      throw new Error('Authentication browser checks require valid loopback fixture URLs.');
    }
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(target.hostname);
  }
  const { MongoClient } = requireApi('mongoose').mongo;
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    await clearTestLoopbackLimits(client.db());
  } finally {
    await client.close();
  }
});

async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

async function responsiveAudit(page: Page, name: string) {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page
        .getByRole('button', { name: `${theme === 'dark' ? 'Dark' : 'Light'} theme`, exact: true })
        .click();
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
    }
  }
}

async function capturedToken(email: string, route: string) {
  let token = '';
  await expect
    .poll(
      async () => {
        const response = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(email)}`);
        if (!response.ok) return false;
        const data = await response.json();
        for (const message of data.messages ?? []) {
          const full = await fetch(
            `${mailbox}/api/v1/message/${encodeURIComponent(message.ID)}`,
          ).then((item) => item.json());
          const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = `${full.Text ?? ''}\n${full.HTML ?? ''}`.match(
            new RegExp(`${escapedRoute}#token=([a-f0-9]{64})`),
          );
          if (match) {
            token = match[1];
            return true;
          }
        }
        return false;
      },
      { timeout: 10000, message: 'The local SMTP mailbox captures the test account email.' },
    )
    .toBe(true);
  return token;
}

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account, in orbit.' })).toBeVisible();
}

async function removeTestAccount(email: string, context?: BrowserContext) {
  const { MongoClient } = requireApi('mongoose').mongo;
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    const db = client.db();
    if (!/^orbit_test(?:_[a-z0-9]+)?$/.test(db.databaseName))
      throw new Error('Browser cleanup requires an isolated test database.');
    const user = await db.collection('auth_users').findOne({ email });
    if (user) {
      await db.collection('auth_sessions').deleteMany({ userId: user._id });
      await db.collection('auth_tokens').deleteMany({ userId: user._id });
      await db.collection('auth_users').deleteOne({ _id: user._id, email });
    }
    const response = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(email)}`);
    if (response.ok) {
      const data = await response.json();
      const ids = (data.messages ?? []).map((message: { ID: string }) => message.ID);
      if (ids.length)
        await fetch(`${mailbox}/api/v1/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: ids }),
        });
    }
  } finally {
    await client.close();
    if (context) await context.close();
  }
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`authentication ${theme} at ${width}px: readable, responsive, and connected`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width, height: 950 });
      for (const [route, title] of [
        ['register', 'Find your orbit.'],
        ['login', 'Welcome back.'],
        ['forgot-password', 'A fresh start.'],
      ] as const) {
        await page.goto(`/auth/${route}`);
        await expect(page.getByRole('heading', { name: title })).toBeVisible();
        await expect(
          page.getByRole('button', {
            name:
              route === 'register'
                ? 'Create account'
                : route === 'login'
                  ? 'Sign in'
                  : 'Send reset link',
            exact: true,
          }),
        ).toBeEnabled();
        await page
          .getByRole('button', {
            name: `${theme === 'dark' ? 'Dark' : 'Light'} theme`,
            exact: true,
          })
          .click();
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
          path: `test-results/screenshots/auth-${route}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(errors).toEqual([]);
    });
  }
}

test('real registration, verification, onboarding, profile, sessions, password change, and recovery', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 401 \(Unauthorized\)/.test(message.text()))
      runtimeErrors.push(message.text());
  });
  const email = `browser-${randomUUID()}@example.test`;
  const password = `First-${randomUUID()}`;
  const changed = `Changed-${randomUUID()}`;
  const recovered = `Recovered-${randomUUID()}`;
  const otherContext = await browser.newContext({ baseURL: origin });
  const other = await otherContext.newPage();
  try {
    await page.goto('/auth/register');
    await page.getByLabel('Full name', { exact: true }).fill('Browser test account');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('too-short');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('Use at least 12 characters.')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('button', { name: 'Continue to my account' })).toBeDisabled();
    await expect(page.getByText('Verify your email', { exact: true })).toBeVisible();
    const token = await capturedToken(email, '/auth/verify-email');
    await page.goto(`/auth/verify-email#token=${token}`);
    await expect(page).toHaveURL(/\/auth\/verify-email$/);
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'You’re verified.' })).toBeVisible();
    await page.getByRole('link', { name: 'Continue to ORBIT' }).click();
    await expect(page.getByRole('button', { name: 'Continue to my account' })).toBeEnabled();
    await responsiveAudit(page, 'onboarding');
    await page.getByLabel('Full name', { exact: true }).fill('Verified browser account');
    await page.getByLabel('Job title (optional)', { exact: true }).fill('Quality engineer');
    await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');
    await page.getByRole('radio', { name: 'For myself', exact: true }).check();
    await page.getByRole('button', { name: 'Continue to my account' }).click();
    await expect(page.getByRole('heading', { name: 'Your account, in orbit.' })).toBeVisible();
    await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(
      'Verified browser account',
    );
    await page.getByLabel('Full name', { exact: true }).fill('Saved browser profile');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Your profile has been saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(
      'Saved browser profile',
    );
    await responsiveAudit(page, 'account');
    await logIn(other, email, password);
    await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
    await expect(page.getByText('Other signed-in session', { exact: true })).toBeVisible();
    await settle(page);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: 'test-results/screenshots/account-sessions-light-1440.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Revoke session', exact: true }).click();
    await expect(page.getByText('Other signed-in session', { exact: true })).toHaveCount(0);
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await logIn(other, email, password);
    await page.getByRole('tab', { name: 'Security', exact: true }).click();
    await settle(page);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: 'test-results/screenshots/account-security-light-1440.png',
      fullPage: true,
    });
    await page.getByLabel('Current password', { exact: true }).fill('Incorrect current password');
    await page.getByLabel('New password', { exact: true }).fill(changed);
    await page.getByLabel('Confirm new password', { exact: true }).fill(changed);
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('The current password is incorrect.');
    await expect(page.getByRole('heading', { name: 'Your account, in orbit.' })).toBeVisible();
    await page.getByLabel('Current password', { exact: true }).fill(password);
    await page.getByLabel('New password', { exact: true }).fill(changed);
    await page.getByLabel('Confirm new password', { exact: true }).fill(changed);
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(page).toHaveURL(/password=changed/);
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
    await logIn(page, email, changed);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'A fresh start.', exact: true })).toBeVisible();
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(email);
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible();
    const resetToken = await capturedToken(email, '/auth/reset-password');
    await page.goto(`/auth/reset-password#token=${resetToken}`);
    await expect(page).toHaveURL(/\/auth\/reset-password$/);
    await page.getByLabel('New password', { exact: true }).fill(recovered);
    await page.getByLabel('Confirm new password', { exact: true }).fill(recovered);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page).toHaveURL(/reset=success/);
    await logIn(page, email, recovered);
    await logIn(other, email, recovered);
    await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
    await expect(page.getByText('Other signed-in session', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  } finally {
    await removeTestAccount(email, otherContext);
  }
});

test('protected-route refresh, keyboard navigation, reduced motion, and safe redirect destinations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/account');
  await expect(page).toHaveURL(/\/auth\/login\?returnTo=%2Faccount$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email address', { exact: true })).toBeFocused();
  const skip = page.getByRole('link', { name: 'Skip to content' });
  for (
    let index = 0;
    index < 10 && !(await skip.evaluate((link) => document.activeElement === link));
    index++
  )
    await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await page.goto('/auth/login?returnTo=https://untrusted.example');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.goto('/auth/reset-password');
  await expect(page.getByRole('alert')).toContainText('This reset link is incomplete.');
  await page.getByRole('link', { name: 'Request a new reset link' }).click();
  await expect(page).toHaveURL(/\/auth\/forgot-password$/);
  await page.goto('/auth/verify-email#token=malformed');
  await expect(page.getByRole('alert')).toContainText('This verification link is incomplete.');
  await expect(page).toHaveURL(/\/auth\/verify-email$/);
});

test('unavailable account services are truthful and never create a local authenticated user', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'Account services are temporarily unavailable.',
        },
        meta: { requestId: 'fixture-unavailable' },
      }),
    }),
  );
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'A small interruption.' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Account services are temporarily unavailable.',
  );
  await expect(page.getByRole('button', { name: 'Try connection again' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your account, in orbit.' })).toHaveCount(0);
  await page.goto('/auth/register');
  await expect(page.getByRole('alert')).toContainText('Your details have not been submitted.');
});
