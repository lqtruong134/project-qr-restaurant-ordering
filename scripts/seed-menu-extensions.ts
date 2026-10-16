import { createDatabase } from '../packages/database/src/index.js';
import { addRestaurantMenuExtensions } from '../packages/database/src/menu-extensions.js';

const db = createDatabase(process.env.DATABASE_URL!);
try {
  console.log(
    JSON.stringify(
      await addRestaurantMenuExtensions(
        db,
        process.argv.includes('--apply'),
        process.argv.includes('--opening-stock'),
      ),
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
