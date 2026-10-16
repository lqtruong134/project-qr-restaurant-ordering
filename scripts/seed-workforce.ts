import { createDatabase } from '../packages/database/src/index.js';
import { restaurantId } from '../packages/database/src/seed.js';
import { generateWorkforceHistory } from './restaurant-workforce-history.js';

const argument = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(name + '='))?.slice(name.length + 1) ?? fallback;
if (process.argv.includes('--replace-old-demo'))
  throw new Error(
    'This command does not remove existing workforce records. Use the reviewed restaurant refresh procedure.',
  );
const from = argument('--from', '2026-09-01'),
  through = argument('--through', '2026-09-30');
const db = createDatabase(process.env.DATABASE_URL!);
try {
  const result = await generateWorkforceHistory(db, {
    restaurantId,
    from,
    through,
    now: new Date(),
    datasetKey: argument('--dataset', 'workforce-' + from + '-' + through),
    apply: process.argv.includes('--apply'),
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.close();
}
