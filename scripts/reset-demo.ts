import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase } from '../packages/database/src/index.js';
import { seed } from '../packages/database/src/seed.js';
import { seedScenarios, verifySeed } from './demo-scenarios.js';
const url = new URL(process.env.DATABASE_URL!);
const requested = process.argv[2];
const rehearsal = requested === '--rehearse';
const originalName = decodeURIComponent(url.pathname.slice(1));
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
  'Only a local demo database may be reset.',
);
assert.equal(
  originalName,
  'qr_restaurant_ordering',
  'Refusing to reset a database other than qr_restaurant_ordering.',
);
assert.ok(
  rehearsal || requested === '--confirm=' + originalName,
  'Use --rehearse or --confirm=<exact database name>; all application rows in that database will be deleted.',
);
assert.ok(
  process.env.SEED_PASSWORD && process.env.SEED_PASSWORD.length >= 8,
  'Missing seed password.',
);
assert.ok(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32, 'Missing auth secret.');
const host = createDatabase(url.toString());
const testName = 'thesis_seedcheck_' + randomBytes(8).toString('hex');
let db = host;
try {
  if (rehearsal) {
    await host.pool.query('CREATE DATABASE ' + testName);
    url.pathname = '/' + testName;
    db = createDatabase(url.toString());
  }
  const actual = (await db.pool.query('SELECT current_database() AS name')).rows[0].name;
  assert.equal(actual, rehearsal ? testName : originalName);
  const migrated = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'inherit' },
  );
  assert.equal(migrated.status, 0, 'Migrations must succeed before reset.');
  if (!rehearsal) {
    const sessions = await db.pool.query(
      'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type=$1',
      ['client backend'],
    );
    assert.equal(
      sessions.rowCount,
      0,
      'Stop the application and other database clients before reset.',
    );
    const tables = (
      await db.pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename",
      )
    ).rows as { tablename: string }[];
    assert.equal(tables.length, 55, 'Unexpected database shape; inspect before deleting anything.');
    for (const t of tables) assert.match(t.tablename, /^[a-z_]+$/);
    // No CASCADE: an unexpected external dependency causes failure rather than wider deletion.
    await db.pool.query(
      'TRUNCATE TABLE ' +
        tables.map((t) => 'public."' + t.tablename + '"').join(',') +
        ' RESTART IDENTITY',
    );
  }
  await seed(db, process.env.SEED_PASSWORD!);
  await seedScenarios(db, process.env.SEED_PASSWORD!);
  const counts = await verifySeed(db);
  await seed(db, process.env.SEED_PASSWORD!);
  assert.deepEqual(await verifySeed(db), counts, 'Bootstrap rerun changed operational data');
  console.log(
    JSON.stringify(
      {
        database: actual,
        mode: rehearsal ? 'isolated rehearsal' : 'reset complete',
        counts,
        stockAndFinance: 'PASS',
        seedRerun: 'PASS',
      },
      null,
      2,
    ),
  );
} finally {
  if (rehearsal) {
    await db.close();
    await host.pool.query('DROP DATABASE IF EXISTS ' + testName + ' WITH (FORCE)');
  }
  await host.close();
}
