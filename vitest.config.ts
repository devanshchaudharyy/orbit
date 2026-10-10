import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'api',
          environment: 'node',
          include: ['apps/api/test/**/*.test.ts', 'packages/contracts/test/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/test/**/*.test.tsx'],
          setupFiles: ['apps/web/test/setup.ts'],
        },
      },
    ],
  },
});
