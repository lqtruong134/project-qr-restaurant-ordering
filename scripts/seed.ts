import { createDatabase } from '../packages/database/src/index.js';
import { seed } from '../packages/database/src/seed.js';
const db = createDatabase(process.env.DATABASE_URL!);
try {
  await seed(db, process.env.SEED_PASSWORD!);
  console.log('Baseline seed ready (CORE schema: 45 tables); staff / kitchen / admin; idempotent.');
} finally {
  await db.close();
}
