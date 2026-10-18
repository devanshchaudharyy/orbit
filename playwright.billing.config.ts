import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'billing.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 120000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/billing' }]],
  outputDir: 'test-results/billing',
  use: {
    actionTimeout: 15000,
    baseURL: process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
