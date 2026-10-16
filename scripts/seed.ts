import { createDatabase } from '../packages/database/src/index.js';
import { seed } from '../packages/database/src/seed.js';
import {
  restaurantIngredients,
  restaurantMenu,
  restaurantStaff,
  restaurantCombos,
} from '../packages/database/src/restaurant-data.js';
const db = createDatabase(process.env.DATABASE_URL!);
try {
  await seed(db, process.env.SEED_PASSWORD!);
  console.log(
    `Restaurant bootstrap ready: ${restaurantStaff.length} accounts, 24 tables, ${restaurantMenu.length} dishes and ${restaurantCombos.length} combos with recipes, ${restaurantIngredients.length} ingredients, 3 stock locations and 14 days of planned shifts. Existing data preserved.`,
  );
} finally {
  await db.close();
}
