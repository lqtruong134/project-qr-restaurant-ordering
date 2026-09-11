import { createDatabase } from '../packages/database/src/index.js';
if (!process.env.DATABASE_URL) throw new Error('Run pnpm setup first.');
const database = createDatabase(process.env.DATABASE_URL);
try {
  await database.ping();
  console.log('PostgreSQL connection OK (SELECT 1).');
} catch {
  console.error('Database unavailable. Check pnpm db:up and local .env.');
  process.exitCode = 1;
} finally {
  await database.close();
}
