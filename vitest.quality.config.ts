import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['apps/api/src/**/*.test.ts', 'tests/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'apps/api/src/app.ts',
        'apps/api/src/auth.ts',
        'apps/api/src/config.ts',
        'apps/api/src/modules/**/*.ts',
        'apps/api/src/shared/**/*.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 70 },
    },
  },
});
