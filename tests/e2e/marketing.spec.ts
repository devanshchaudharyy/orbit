import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function settle(page: import('@playwright/test').Page) {
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

for (const theme of ['dark', 'light'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`marketing ${theme} at ${width}px: contrast, layout, and runtime`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width, height: 950 });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Make space for great work.' })).toBeVisible();
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
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({
        path: `test-results/screenshots/marketing-${theme}-${width}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}

test('interactive sample views, filtering, and task detail focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Explore ORBIT', exact: true }).click();
  await expect(page).toHaveURL(/#product$/);
  await expect(page.locator('.preview-task')).toHaveCount(5);
  await page.getByRole('button', { name: 'Design only' }).click();
  await expect(page.locator('.preview-task')).toHaveCount(2);
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await expect(page.locator('.preview-list button')).toHaveCount(2);
  const card = page.locator('.preview-list button').first();
  await card.click();
  await expect(page.getByRole('dialog')).toContainText('Product demonstration');
  await expect(page.getByRole('dialog')).toContainText('Sign in to manage actual projects');
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await page.getByRole('button', { name: 'Design only' }).click();
  await expect(page.locator('.preview-list button')).toHaveCount(5);
});

test('keyboard tour traps focus, advances, and restores its trigger', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Take the guided tour', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Start with a shared direction.');
  for (let index = 0; index < 7; index++) {
    await page.keyboard.press('Tab');
    expect(
      await page.getByRole('dialog').evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('See work your way.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('production billing is not enabled.');
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(scan.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole('dialog')).toContainText('01 OF 03');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('link', { name: 'Try the preview' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#product')).toBeFocused();
  await page.getByRole('button', { name: 'Step inside ORBIT' }).click();
  await expect(page.getByRole('dialog')).toContainText('01 OF 03');
});

test('pricing changes truthfully and selected plan opens without checkout', async ({ page }) => {
  await page.goto('/#pricing');
  await page.getByRole('button', { name: 'Yearly' }).click();
  const team = page
    .locator('.pricing-card')
    .filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) });
  await expect(team).toContainText('$10');
  await expect(team).toContainText('$120 per organization, billed yearly');
  await team.getByRole('button', { name: 'Explore Pro' }).click();
  await expect(page.getByRole('dialog')).toContainText('Pro plan preview');
  await expect(page.getByRole('dialog')).toContainText('no payment is collected');
  await expect(page.locator('.plan-modal-price')).toContainText('$10');
  await page.getByRole('button', { name: 'Keep exploring' }).click();
  await expect(team.getByRole('button', { name: 'Explore Pro' })).toBeFocused();
  await page.getByRole('button', { name: 'Monthly', exact: true }).click();
  await expect(team).toContainText('$12');
  await page.getByRole('button', { name: 'Are these the final prices?' }).click();
  await expect(
    page.getByText('There is no checkout on this marketing page', { exact: false }),
  ).toBeVisible();
});

test('mobile navigation, theme persistence, direct refresh, and 404 recovery', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Pricing' })
    .click();
  await expect(page).toHaveURL(/#pricing$/);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Light theme', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('heading', { name: 'Start small. Think big.' })).toBeVisible();
  await page.goto('/missing-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to ORBIT' }).click();
  await expect(page.getByRole('heading', { name: 'Make space for great work.' })).toBeVisible();
});

test('reduced motion and native navigation work without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make space for great work.' })).toBeVisible();
  await settle(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Why ORBIT' })
    .click();
  await expect(page).toHaveURL(/#why-orbit$/);
});
