import { createDatabase } from '../packages/database/src/index.js';
import { seed } from '../packages/database/src/seed.js';
const db = createDatabase(process.env.DATABASE_URL!);
try {
  await seed(db, process.env.SEED_PASSWORD!);
  console.log(
    'Demo seed ready: 8 employees, 16 tables, 24 dishes with recipes and 32 ingredients. Existing data preserved.',
  );
} finally {
  await db.close();
}
