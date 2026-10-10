import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/dev/design-system');
  await page.getByText('API online', { exact: true }).waitFor();
  await mkdir('test-results/audit', { recursive: true });
  for (const theme of ['dark', 'light']) {
    await page
      .getByRole('button', { name: `${theme === 'dark' ? 'Dark' : 'Light'} theme`, exact: true })
      .click();
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    const report = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    await writeFile(`test-results/audit/${theme}.json`, JSON.stringify(report.violations, null, 2));
    console.log(
      JSON.stringify({
        theme,
        violations: report.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      }),
    );
    await page.screenshot({ path: `test-results/audit/${theme}.png`, fullPage: true });
  }
} finally {
  await browser.close();
}
