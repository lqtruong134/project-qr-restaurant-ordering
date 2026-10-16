import { writeFileSync } from 'node:fs';
import { createDatabase } from '../packages/database/src/index.js';
import { refreshRestaurantCatalog } from '../packages/database/src/seed.js';

// Preview by default; --apply is explicit and only changes presentation fields.
const db = createDatabase(process.env.DATABASE_URL!);
try {
  const result = await refreshRestaurantCatalog(db, process.argv.includes('--apply'));
  const report = process.argv.find((argument) => argument.startsWith('--report='))?.slice(9);
  if (report) writeFileSync(report, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        mode: result.applied ? 'applied' : 'preview',
        restaurant: result.changes.filter((change) => change.resource === 'RESTAURANT').length,
        categories: result.changes.filter((change) => change.resource === 'CATEGORY').length,
        products: result.changes.filter((change) => change.resource === 'PRODUCT').length,
        skippedCustomizedProductCodes: result.skippedCustomizedProductCodes,
        report: report ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
