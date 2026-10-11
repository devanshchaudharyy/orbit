import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'projects.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/projects' }]],
  outputDir: 'test-results/projects',
  use: {
    actionTimeout: 15000,
    baseURL: process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
