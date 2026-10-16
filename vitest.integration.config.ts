import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    // Each integration suite owns a temporary PostgreSQL database. Bound memory/connections.
    maxWorkers: 2,
  },
});
