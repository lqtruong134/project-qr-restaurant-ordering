import { createDatabase } from '../packages/database/src/index.js';
import { refreshRestaurantSetMenu } from '../packages/database/src/set-menu-refresh.js';

const db = createDatabase(process.env.DATABASE_URL!);
try {
  console.log(
    JSON.stringify(await refreshRestaurantSetMenu(db, process.argv.includes('--apply')), null, 2),
  );
} finally {
  await db.close();
}
