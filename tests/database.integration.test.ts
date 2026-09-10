import { it, expect } from 'vitest';
import { createDatabase } from '../packages/database/src/index.js';
import { buildApp } from '../apps/api/src/app.js';
it('readiness succeeds against the actual PostgreSQL database', async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const database = createDatabase(process.env.DATABASE_URL);
  const app = buildApp(database);
  try { expect((await app.inject('/health/ready')).statusCode).toBe(200); }
  finally { await app.close(); await database.close(); }
});
