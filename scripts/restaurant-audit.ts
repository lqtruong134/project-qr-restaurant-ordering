import { mkdir, writeFile } from 'node:fs/promises';
import { createDatabase } from '../packages/database/src/index.js';
import { restaurantId } from '../packages/database/src/seed.js';

const db = createDatabase(process.env.DATABASE_URL!);
try {
  const connection = (
    await db.pool.query('SELECT current_database() AS database,version() AS version')
  ).rows[0];
  const tables = (
    await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename",
    )
  ).rows as { tablename: string }[];
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected table identifier.');
    counts[tablename] = Number(
      (await db.pool.query(`SELECT count(*) AS n FROM "${tablename}"`)).rows[0].n,
    );
  }
  const restaurantCount = Number(
    (await db.pool.query('SELECT count(*) AS n FROM restaurant')).rows[0].n,
  );
  const administrators = (
    await db.pool.query(
      `SELECT DISTINCT u.id,u.username,u.display_name,u.status FROM app_user u
       JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
       JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1 AND r.code='ADMIN'
       ORDER BY u.username`,
      [restaurantId],
    )
  ).rows;
  const products = (
    await db.pool.query(
      'SELECT code,name,product_kind,is_active,availability_status,image_url FROM product WHERE restaurant_id=$1 ORDER BY code',
      [restaurantId],
    )
  ).rows;
  const report = {
    capturedAt: new Date().toISOString(),
    connection,
    restaurantCount,
    restaurantId,
    tableCount: tables.length,
    counts,
    administrators,
    products,
    provenance:
      'Current local application state before the requested standardized data replacement.',
  };
  await mkdir('var/data', { recursive: true });
  await writeFile(
    'var/data/restaurant-audit-before-20261012.json',
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        database: connection.database,
        restaurantCount,
        tableCount: tables.length,
        counts,
        administratorCount: administrators.length,
        productCount: products.length,
        productsWithoutImages: products.filter((row) => !row.image_url).length,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
