import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import {
  generateRestaurantHistory,
  historyDutyRoster,
  validateRestaurantHistory,
} from '../scripts/restaurant-history.js';
import { planRestaurantCleanup } from '../scripts/restaurant-cleanup-plan.js';

let host: Database, db: Database;
const databaseName = 'thesis_history_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const options = {
  restaurantId,
  from: '2026-08-01',
  through: '2026-08-04',
  now: new Date('2026-08-04T16:00:00Z'),
  datasetKey: 'history-integration-v1',
  minSessions: 25,
  maxSessions: 30,
};
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  for (const folder of readdirSync('packages/database/prisma/migrations')
    .filter((name) => /^\d/.test(name))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
    );
  await seed(db, password, {
    startsAt: new Date('2026-08-01T00:00:00+07:00'),
    includeWorkforce: false,
  });
}, 60000);
afterAll(async () => {
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_history_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);
it('rotates a weekly rest day and supplies both historical shifts without off-duty actors', () => {
  const ids = Array.from({ length: 8 }, (_, i) => 'person-' + i),
    assigned = new Set<string>();
  for (let day = 1; day <= 7; day++) {
    const roster = historyDutyRoster(ids, '2026-08-' + String(day).padStart(2, '0'));
    expect(roster.morning.length).toBeGreaterThan(0);
    expect(roster.evening.length).toBeGreaterThan(0);
    expect(new Set([...roster.morning, ...roster.evening, ...roster.off]).size).toBe(ids.length);
    roster.off.forEach((id) => assigned.add(id));
    expect(
      roster.morning.some((id) => roster.evening.includes(id) || roster.off.includes(id)),
    ).toBe(false);
  }
  expect(assigned.size).toBe(ids.length);
});
it('creates historical role grants, recipe parts and the immutable pay policy at the baseline', async () => {
  const baseline = '2026-08-01T00:00:00+07:00';
  for (const table of [
    'role',
    'permission',
    'role_permission',
    'user_role',
    'recipe_bom_item',
    'workforce_pay_policy',
  ]) {
    const counts = (
      await db.pool.query(
        'SELECT count(*)::int AS total,count(*) FILTER(WHERE created_at>$1::timestamptz)::int AS late FROM ' +
          table,
        [baseline],
      )
    ).rows[0];
    expect(counts.total, table).toBeGreaterThan(0);
    expect(counts.late, table).toBe(0);
  }
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM user_role WHERE assigned_at>$1::timestamptz',
        [baseline],
      )
    ).rows[0].n,
  ).toBe(0);
});
it('previews deterministically without creating sessions and ignores future restaurant dates', async () => {
  const a = await generateRestaurantHistory(db, options),
    b = await generateRestaurantHistory(db, options);
  expect(a.applied).toBe(false);
  expect(a.manifest).toEqual(b.manifest);
  expect(Number((await db.pool.query('SELECT count(*) AS n FROM table_session')).rows[0].n)).toBe(
    0,
  );
  const truncated = await generateRestaurantHistory(db, {
    ...options,
    through: '2026-08-09',
    now: new Date('2026-08-02T10:00:00Z'),
  });
  expect(Object.keys(truncated.manifest.dayCounts).every((day) => day <= '2026-08-02')).toBe(true);
  expect(a.manifest.counts.order_item).toBeGreaterThan(600);
});
it('plans the complete operating period with several thousand sessions and diverse menu items', async () => {
  const result = await generateRestaurantHistory(db, {
    ...options,
    minSessions: 40,
    maxSessions: 70,
    through: '2026-10-12',
    now: new Date('2026-10-12T16:00:00Z'),
    datasetKey: 'history-full-period-preview',
  });
  expect(result.applied).toBe(false);
  expect(result.manifest.counts.table_session).toBeGreaterThan(3500);
  expect(result.manifest.counts.order_item).toBeGreaterThan(25000);
  expect(Object.keys(result.manifest.dayCounts).length).toBe(73);
  expect(Object.keys(result.manifest.scenarioCounts)).toEqual(
    expect.arrayContaining([
      'PARTIAL',
      'PREPAID_CANCEL',
      'PREPAID_WAIVE',
      'WAIVE',
      'GUEST_CANCEL',
      'KITCHEN_UNAVAILABLE',
    ]),
  );
  expect(Number((await db.pool.query('SELECT count(*) AS n FROM table_session')).rows[0].n)).toBe(
    0,
  );
}, 60000);
it('imports settled sessions with frozen combo contents, approved refunds, cash change and balanced inventory', async () => {
  const result = await generateRestaurantHistory(db, { ...options, apply: true });
  expect(result.applied).toBe(true);
  expect(Object.values(result.checks!)).toEqual(Array(Object.keys(result.checks!).length).fill(0));
  expect(result.checks).toMatchObject({
    approvedChargeChronology: 0,
    roleAssignmentChronology: 0,
    recipePartsChronology: 0,
    payPolicyChronology: 0,
  });
  const reviewed = (
    await db.pool.query(
      "SELECT count(*)::int AS n FROM financial_charge f JOIN order_item i ON i.id=f.order_item_id JOIN order_review r ON r.order_batch_id=i.order_batch_id WHERE r.status='APPROVED' AND f.created_at=r.decided_at AND f.created_at>i.created_at",
    )
  ).rows[0].n;
  expect(reviewed).toBeGreaterThan(0);
  for (const table of [
    'refund_transaction',
    'goods_receipt_item',
    'order_review',
    'operational_alert',
    'support_request',
    'payment_allocation',
    'inventory_reservation',
    'order_item_ingredient_snapshot',
    'order_status_history',
  ])
    expect(
      Number((await db.pool.query('SELECT count(*) AS n FROM ' + table)).rows[0].n),
      table,
    ).toBeGreaterThan(0);
  expect(
    Number(
      (
        await db.pool.query(
          "SELECT count(*) AS n FROM order_item WHERE product_kind_snapshot='COMBO' AND jsonb_array_length(combo_components_snapshot)>=2",
        )
      ).rows[0].n,
    ),
  ).toBeGreaterThan(0);
  expect(
    Number(
      (
        await db.pool.query(
          "SELECT count(*) AS n FROM table_session WHERE session_status='CLOSED' AND receipt_snapshot IS NOT NULL",
        )
      ).rows[0].n,
    ),
  ).toBe(result.manifest.counts.table_session);
  expect(
    Number(
      (
        await db.pool.query(
          "SELECT count(*) AS n FROM table_session WHERE receipt_snapshot->'session'->>'table_code' IS NULL",
        )
      ).rows[0].n,
    ),
  ).toBe(0);
  expect(
    Number(
      (
        await db.pool.query(
          "SELECT count(*) AS n FROM inventory_reservation WHERE status='RELEASED'",
        )
      ).rows[0].n,
    ),
  ).toBeGreaterThan(0);
  const c = await db.pool.connect();
  try {
    const checks = await validateRestaurantHistory(c, restaurantId, options.now);
    expect(Object.values(checks).every((n) => n === 0)).toBe(true);
  } finally {
    c.release();
  }
}, 120000);
it('reruns the same dataset without rewriting append-only history', async () => {
  const before = (await db.pool.query('SELECT count(*) AS n FROM order_item')).rows[0].n;
  const result = await generateRestaurantHistory(db, { ...options, apply: true });
  expect(result.alreadyApplied).toBe(true);
  expect(result.applied).toBe(false);
  expect((await db.pool.query('SELECT count(*) AS n FROM order_item')).rows[0].n).toBe(before);
});
it('detects an inconsistent stored account and restores it by transaction rollback', async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'UPDATE session_financial_account SET charge_total=charge_total+1 WHERE session_id=(SELECT id FROM table_session LIMIT 1)',
    );
    const checks = await validateRestaurantHistory(c, restaurantId, options.now);
    expect(checks.financialTotals).toBe(1);
    expect(checks.receiptSnapshots).toBe(1);
    await c.query('ROLLBACK');
    const after = await validateRestaurantHistory(c, restaurantId, options.now);
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
  } finally {
    c.release();
  }
});
it('rejects late role grants and recipe parts without weakening append-only policy guards', async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      "UPDATE user_role SET assigned_at='2026-10-13T00:00:00+07:00' WHERE user_id=(SELECT actor_user_id FROM order_status_history WHERE actor_user_id IS NOT NULL LIMIT 1)",
    );
    await c.query(
      "UPDATE recipe_bom_item SET created_at='2026-10-13T00:00:00+07:00' WHERE id=(SELECT p.id FROM recipe_bom_item p JOIN order_item_ingredient_snapshot x ON x.recipe_bom_id=p.recipe_bom_id AND x.ingredient_id=p.ingredient_id LIMIT 1)",
    );
    const checks = await validateRestaurantHistory(c, restaurantId, options.now);
    expect(checks.roleAssignmentChronology).toBeGreaterThan(0);
    expect(checks.recipePartsChronology).toBeGreaterThan(0);
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await expect(c.query('UPDATE workforce_pay_policy SET created_at=now()')).rejects.toThrow();
    await c.query('ROLLBACK');
    const restored = await validateRestaurantHistory(c, restaurantId, options.now);
    expect(Object.values(restored).every((count) => count === 0)).toBe(true);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('refuses a different dataset when operational sessions already exist', async () => {
  const before = (await db.pool.query('SELECT count(*) AS n FROM order_item')).rows[0].n;
  await expect(
    generateRestaurantHistory(db, { ...options, apply: true, datasetKey: 'history-other-dataset' }),
  ).rejects.toThrow('empty canonical candidate');
  expect((await db.pool.query('SELECT count(*) AS n FROM order_item')).rows[0].n).toBe(before);
});
it('plans tenant-scoped retention and protects the administrator without changing any data', async () => {
  const admin = await db.prisma.app_user.findFirstOrThrow({
    where: { restaurant_id: restaurantId, username: 'quyettruong05' },
  });
  const codes = async (table: string, field = 'code') =>
    (
      await db.pool.query(
        'SELECT ' + field + ' AS code FROM ' + table + ' WHERE restaurant_id=$1',
        [restaurantId],
      )
    ).rows.map((row) => row.code as string);
  const before = (await db.pool.query('SELECT count(*) AS n FROM business_audit_event')).rows[0].n;
  const plan = await planRestaurantCleanup(db, restaurantId, admin.id, {
    productCodes: await codes('product'),
    ingredientCodes: await codes('ingredient'),
    usernames: await codes('app_user', 'username'),
    tableCodes: await codes('dining_table'),
    categoryCodes: await codes('menu_category'),
    areaCodes: await codes('dining_area'),
    locationCodes: await codes('stock_location'),
    shiftTemplateCodes: await codes('shift_template'),
  });
  expect(plan.dryRun).toBe(true);
  expect(plan.tables.find((table) => table.table === 'order_item')?.removeRows).toBeGreaterThan(
    600,
  );
  expect(plan.tables.find((table) => table.table === 'app_user')?.removeRows).toBe(0);
  expect((await db.pool.query('SELECT count(*) AS n FROM business_audit_event')).rows[0].n).toBe(
    before,
  );
});
