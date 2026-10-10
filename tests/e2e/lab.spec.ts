import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('lab direct routes refresh and real API status renders', async ({ page, request }) => {
  await page.goto('/dev/design-system');
  await expect(page).toHaveURL(/\/dev\/design-system$/);
  await expect(page.getByRole('heading', { name: 'Design system.', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('API online', { exact: true })).toBeVisible();
  const ready = await request.get('/api/v1/health/ready');
  const payload = await ready.json();
  expect([200, 503]).toContain(ready.status());
  await expect(
    page
      .locator('.service-card')
      .filter({ hasText: 'Core dependencies' })
      .getByText(payload.data.status === 'ready' ? 'Ready' : 'Unavailable', { exact: true }),
  ).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`${theme} appearance is accessible and responsive at ${width}px`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('503 (Service Unavailable)'))
          errors.push(message.text());
      });
      await page.setViewportSize({ width, height: 950 });
      await page.goto('/dev/design-system');
      await page
        .getByRole('button', { name: theme === 'dark' ? 'Dark theme' : 'Light theme', exact: true })
        .click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByText('API online', { exact: true })).toBeVisible();
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        accessibility.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })),
      ).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `test-results/screenshots/lab-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

test('theme selection survives reload and responds to system preference', async ({ page }) => {
  await page.goto('/dev/design-system');
  await page.getByRole('button', { name: 'Light theme', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'System theme', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('form errors, priority, notification preference, and success work', async ({ page }) => {
  await page.goto('/dev/design-system');
  await page.getByRole('button', { name: /Validate example/ }).click();
  await expect(page.getByText('Use at least 3 characters.')).toBeVisible();
  await page.getByLabel(/Example title/).fill('ORBIT foundation');
  await page.getByRole('combobox', { name: 'Example priority' }).click();
  await page.getByRole('option', { name: 'High priority' }).click();
  await page.getByRole('switch', { name: 'Notifications' }).click();
  await page.getByRole('button', { name: /Validate example/ }).click();
  await expect(page.getByRole('button', { name: 'Validated' })).toBeVisible();
});

test('dialog traps focus and restores it; drawer updates the actual theme', async ({ page }) => {
  await page.goto('/dev/design-system');
  const trigger = page.getByRole('button', { name: /Open dialog/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Room for your next idea.' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: /Open drawer/ }).click();
  await page.getByRole('combobox', { name: 'Drawer appearance' }).click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /Done/ }).click();
  await expect(page.getByRole('button', { name: /Open drawer/ })).toBeFocused();
});

test('command palette opens from the keyboard and navigates by arrows', async ({ page }) => {
  await page.goto('/dev/design-system');
  await expect(page.getByRole('heading', { name: 'Design system.', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Jump to a section' });
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Search sections' }).fill('color');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/#colors$/);
  await expect(page.locator('#colors')).toBeFocused();
});

test('mobile navigation, menus, state patterns and table selection work', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dev/design-system');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('dialog', { name: 'Lab navigation' })
    .getByRole('link', { name: 'States & patterns' })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('tab', { name: 'Error', exact: true }).click();
  await page.getByRole('button', { name: /Try again/ }).click();
  await expect(page.getByText('You’re all set.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Button family' }).click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Button family' })).not.toBeChecked();
  await page.getByRole('button', { name: 'More example actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Duplicate example/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('clipboard receives actual current-theme tokens', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/dev/design-system');
  await page.getByRole('button', { name: 'Copy theme tokens' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('--background: #0d0f15');
});

test('reduced motion removes continuing animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/design-system');
  await page.getByRole('tab', { name: 'Loading', exact: true }).click();
  const duration = await page
    .locator('.orbit-skeleton')
    .first()
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
