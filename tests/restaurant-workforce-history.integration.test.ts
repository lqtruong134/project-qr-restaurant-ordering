import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { seedWorkforce } from '../packages/database/src/workforce-seed.js';
import { generateRestaurantHistory } from '../scripts/restaurant-history.js';
import {
  generateWorkforceHistory,
  validateWorkforceHistory,
} from '../scripts/restaurant-workforce-history.js';

let host: Database, db: Database;
const databaseName = 'thesis_workforce_history_' + randomBytes(6).toString('hex');
const options = {
  restaurantId,
  from: '2026-08-01',
  through: '2026-10-08',
  now: new Date('2026-10-09T08:00:00+07:00'),
  datasetKey: 'workforce-history-integration-v1',
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
  await seed(db, randomBytes(24).toString('hex'), {
    startsAt: new Date('2026-08-01T00:00:00+07:00'),
    includeWorkforce: false,
  });
  await generateRestaurantHistory(db, {
    ...options,
    through: '2026-08-04',
    datasetKey: 'workforce-order-fixture',
    minSessions: 25,
    maxSessions: 30,
    apply: true,
  });
}, 120000);
afterAll(async () => {
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_workforce_history_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);

it('bootstrap retains personal hierarchy and policy premiums instead of a flat night-shift rate', async () => {
  await expect(
    db.prisma.$transaction(
      async (tx) => {
        await seedWorkforce(tx, restaurantId);
        const templates = await tx.shift_template.findMany({ orderBy: { sort_order: 'asc' } });
        expect(templates.map((t) => t.code)).toEqual(['CA-SANG', 'CA-CHIEU', 'CA-TOI', 'CA-DEM']);
        expect(templates.every((t) => t.hourly_rate_override === null)).toBe(true);
        const rates = await tx.employee_pay_rate.findMany({
          include: { app_user_employee_pay_rate_user_id_restaurant_idToapp_user: true },
        });
        const rate = (username: string) =>
          rates.find(
            (r) =>
              r.app_user_employee_pay_rate_user_id_restaurant_idToapp_user.username === username,
          )?.hourly_rate;
        expect(rate('bep001')).toBe(65000n);
        expect(rate('bep002')).toBe(42000n);
        expect(rate('pv001')).toBe(45000n);
        expect(rate('pv002')).toBe(35000n);
        expect(await tx.attendance_record.count()).toBe(0);
        expect(await tx.payroll_payment.count()).toBe(0);
        throw new Error('rollback-bootstrap-fixture');
      },
      { timeout: 60000 },
    ),
  ).rejects.toThrow('rollback-bootstrap-fixture');
});

it('previews using database guards, rolls back everything, and truncates operational work at the supplied clock', async () => {
  const beforePolicy = await db.prisma.workforce_pay_policy.count();
  const c = await db.pool.connect();
  try {
    expect(
      (await validateWorkforceHistory(c, restaurantId, options.from, '2026-08-04T16:00:00Z'))
        .customerActionsOutsideApprovedWork,
    ).toBeGreaterThan(0);
  } finally {
    c.release();
  }
  const result = await generateWorkforceHistory(db, {
    ...options,
    through: '2026-08-09',
    now: new Date('2026-08-02T17:00:00+07:00'),
    datasetKey: 'workforce-clock-preview',
  });
  expect(result.applied).toBe(false);
  expect(result.counts.work_shift).toBe(3);
  expect(Object.values(result.invariants).every((n) => n === 0)).toBe(true);
  expect(await db.prisma.shift_assignment.count()).toBe(0);
  expect(await db.prisma.workforce_pay_policy.count()).toBe(beforePolicy);
  expect(await db.prisma.payroll_run.count()).toBe(0);
}, 60000);

it('calculates historical attendance with holiday and night premiums, retains exceptions, and agrees with staff actions', async () => {
  const result = await generateWorkforceHistory(db, { ...options, apply: true });
  expect(result.applied).toBe(true);
  expect(result.counts.attendance_record).toBeGreaterThan(700);
  expect(Object.values(result.invariants).every((n) => n === 0)).toBe(true);
  const rows = (
    await db.pool.query(
      `SELECT t.*,u.username,(a.starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day,s.code FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id JOIN work_shift s ON s.id=a.shift_id JOIN app_user u ON u.id=a.user_id`,
    )
  ).rows;
  const holiday = rows.filter((r) => r.day === '2026-09-02');
  expect(holiday.length).toBeGreaterThan(8);
  expect(holiday.every((r) => BigInt(r.pay_components.holidayAmount) > 0n)).toBe(true);
  const night = rows.find(
    (r) => r.code.endsWith('CA-TOI') && r.day !== '2026-09-02' && r.approval_mode === 'FULL',
  )!;
  expect(night.pay_components.nightMinutes).toBe(60);
  expect(BigInt(night.pay_components.nightAmount)).toBe(
    (BigInt(night.hourly_rate_snapshot) * 30n) / 100n,
  );
  expect(rows.some((r) => r.username === 'bep001' && r.hourly_rate_snapshot === '65000')).toBe(
    true,
  );
  expect(rows.some((r) => r.username === 'bep002' && r.hourly_rate_snapshot === '42000')).toBe(
    true,
  );
  expect(
    rows.some(
      (r) =>
        r.approval_mode === 'ACTUAL' &&
        r.approved_minutes === (r.code.endsWith('CA-SANG') ? 460 : 400),
    ),
  ).toBe(true);
  const missing = rows.filter((r) => r.outcome === 'MISSED_CLOCK');
  expect(missing.length).toBeGreaterThan(0);
  expect(
    missing.every(
      (r) =>
        r.checked_out_at === null &&
        r.approval_mode === 'EXCEPTION' &&
        r.review_note.includes('đối chiếu'),
    ),
  ).toBe(true);
  expect(
    rows.some(
      (r) =>
        r.paid_periods.some((p: { kind: string }) => p.kind === 'OVERTIME') &&
        BigInt(r.pay_components.overtimeAmount) > 0n,
    ),
  ).toBe(true);
  expect(
    rows.every(
      (r) =>
        r.pay_snapshot.version === 1 &&
        r.pay_snapshot.components.totalAmount === r.amount &&
        r.pay_snapshot.periods.length >= 2,
    ),
  ).toBe(true);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM business_audit_event WHERE action='APPROVE_ATTENDANCE'",
      )
    ).rows[0].n,
  ).toBe(rows.length);
}, 120000);

it('pays closed August and September slips individually while October remains a draft with exact pay snapshots', async () => {
  const runs = (
    await db.pool.query(
      'SELECT period_start::text,status,finalized_at,paid_at FROM payroll_run ORDER BY period_start',
    )
  ).rows;
  expect(runs.map((r) => [r.period_start, r.status])).toEqual([
    ['2026-08-01', 'PAID'],
    ['2026-09-01', 'PAID'],
    ['2026-10-01', 'DRAFT'],
  ]);
  expect(runs[2].finalized_at).toBeNull();
  expect(runs[2].paid_at).toBeNull();
  expect(await db.prisma.payroll_payment.count()).toBe(28);
  expect(await db.prisma.payroll_line.count({ where: { line_type: 'DEDUCTION' } })).toBe(0);
  expect(await db.prisma.payroll_line.count({ where: { line_type: 'BONUS' } })).toBe(4);
  const c = await db.pool.connect();
  try {
    expect(
      Object.values(
        await validateWorkforceHistory(c, restaurantId, options.from, '2026-10-08T16:59:59.999Z'),
      ).every((n) => n === 0),
    ).toBe(true);
  } finally {
    c.release();
  }
});

it('reruns idempotently and refuses to overwrite immutable attendance or finalized payroll evidence', async () => {
  const before = await db.prisma.business_audit_event.count();
  const result = await generateWorkforceHistory(db, { ...options, apply: true });
  expect(result.alreadyApplied).toBe(true);
  expect(result.applied).toBe(false);
  expect(await db.prisma.business_audit_event.count()).toBe(before);
  await expect(
    generateWorkforceHistory(db, { ...options, datasetKey: 'conflicting-history', apply: true }),
  ).rejects.toThrow('empty candidate assignment range');
  await expect(
    db.pool.query(
      'UPDATE attendance_record SET amount=amount+1 WHERE id=(SELECT id FROM attendance_record LIMIT 1)',
    ),
  ).rejects.toThrow('immutable');
  await expect(
    db.pool.query(
      "UPDATE payroll_line SET amount=amount+1 WHERE id=(SELECT id FROM payroll_line WHERE line_type='WORK' LIMIT 1)",
    ),
  ).rejects.toThrow();
});

it('rejects future ranges and preserves consistent employee evidence after replay', async () => {
  await expect(
    generateWorkforceHistory(db, {
      ...options,
      from: '2026-11-01',
      through: '2026-11-02',
      now: options.now,
      datasetKey: 'future',
    }),
  ).rejects.toThrow('future');
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const checks = await validateWorkforceHistory(
      c,
      restaurantId,
      '2026-08-01',
      '2026-08-04T16:00:00Z',
    );
    expect(checks.customerActionsOutsideApprovedWork).toBe(0);
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
});
