import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: [
    '**/auth.spec.ts',
    '**/tenants.spec.ts',
    '**/teams.spec.ts',
    '**/projects.spec.ts',
    '**/views.spec.ts',
    '**/planning.spec.ts',
    '**/collaboration.spec.ts',
    '**/documents.spec.ts',
    '**/analytics.spec.ts',
  ],
  outputDir: 'test-results/foundation',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
