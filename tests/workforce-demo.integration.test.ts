import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { seedWorkforce } from '../packages/database/src/workforce-seed.js';

let host: Database, db: Database;
const name = 'thesis_workforce_bootstrap_' + randomBytes(6).toString('hex');
const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const bootstrapOptions = { now: new Date(Date.now() - 60000), startDay: tomorrow, dayCount: 14 };
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  db = createDatabase(url.toString());
  for (const folder of readdirSync('packages/database/prisma/migrations')
    .filter((f) => /^\d/.test(f))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
    );
  await seed(db, randomBytes(24).toString('hex'), {
    startsAt: new Date('2026-08-01T00:00:00+07:00'),
    includeWorkforce: false,
  });
  await db.prisma.$transaction((tx) => seedWorkforce(tx, restaurantId, bootstrapOptions), {
    timeout: 60000,
  });
}, 60000);
afterAll(async () => {
  if (db) await db.close();
  if (host) {
    expect(name).toMatch(/^thesis_workforce_bootstrap_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);

it('creates four reusable ca with personal pay, a bounded future schedule and no invented attendance', async () => {
  const rows = (
    await db.pool.query(
      'SELECT code,start_time::text,end_time::text,break_minutes,hourly_rate_override::text,ends_next_day FROM shift_template ORDER BY sort_order',
    )
  ).rows;
  expect(
    rows.map((r) => [
      r.code,
      r.start_time,
      r.end_time,
      r.break_minutes,
      r.hourly_rate_override,
      r.ends_next_day,
    ]),
  ).toEqual([
    ['CA-SANG', '07:00:00', '16:00:00', 60, null, false],
    ['CA-CHIEU', '14:00:00', '20:00:00', 30, null, false],
    ['CA-TOI', '15:00:00', '23:00:00', 60, null, false],
    ['CA-DEM', '22:00:00', '02:00:00', 0, null, true],
  ]);
  expect(await db.prisma.work_shift.count()).toBe(28);
  expect(await db.prisma.attendance_record.count()).toBe(0);
  expect(await db.prisma.payroll_run.count()).toBe(0);
  expect(await db.prisma.payroll_payment.count()).toBe(0);
  const rates = (
    await db.pool.query(
      'SELECT u.username,r.hourly_rate::text FROM employee_pay_rate r JOIN app_user u ON u.id=r.user_id ORDER BY u.username',
    )
  ).rows;
  expect(rates.find((r) => r.username === 'bep001')?.hourly_rate).toBe('65000');
  expect(rates.find((r) => r.username === 'bep002')?.hourly_rate).toBe('42000');
  expect(rates.find((r) => r.username === 'pv001')?.hourly_rate).toBe('45000');
  expect(rates.find((r) => r.username === 'pv002')?.hourly_rate).toBe('35000');
  expect(
    (
      await db.pool.query('SELECT count(*)::int AS n FROM work_shift WHERE ends_at<=$1', [
        bootstrapOptions.now,
      ])
    ).rows[0].n,
  ).toBe(0);
  expect(await db.prisma.work_shift.count({ where: { scheduled_date: new Date(tomorrow) } })).toBe(
    2,
  );
});

it('does not assign administrators or overlapping ca and replay preserves the planned schedule', async () => {
  const admin = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } });
  expect(await db.prisma.shift_assignment.count({ where: { user_id: admin.id } })).toBe(0);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM shift_assignment a JOIN shift_assignment b ON a.user_id=b.user_id AND a.id<b.id AND a.starts_at<b.ends_at AND a.ends_at>b.starts_at AND a.status='ASSIGNED' AND b.status='ASSIGNED'",
      )
    ).rows[0].n,
  ).toBe(0);
  const counts = async () =>
    Promise.all([
      db.prisma.shift_template.count(),
      db.prisma.work_shift.count(),
      db.prisma.shift_assignment.count(),
      db.prisma.employee_pay_rate.count(),
      db.prisma.workforce_pay_policy.count(),
    ]);
  const before = await counts();
  await db.prisma.$transaction((tx) => seedWorkforce(tx, restaurantId, bootstrapOptions), {
    timeout: 60000,
  });
  expect(await counts()).toEqual(before);
});

it('preserves a later agreed personal rate instead of resetting it on bootstrap replay', async () => {
  const admin = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } });
  const person = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv008' } });
  const rate = await db.prisma.employee_pay_rate.create({
    data: {
      restaurant_id: restaurantId,
      user_id: person.id,
      effective_from: new Date('2026-10-01T00:00:00+07:00'),
      hourly_rate: 38000n,
      reason: 'Điều chỉnh đơn giá theo thỏa thuận.',
      created_by: admin.id,
    },
  });
  await db.prisma.$transaction((tx) => seedWorkforce(tx, restaurantId, bootstrapOptions), {
    timeout: 60000,
  });
  expect(
    (await db.prisma.employee_pay_rate.findUniqueOrThrow({ where: { id: rate.id } })).hourly_rate,
  ).toBe(38000n);
  expect(await db.prisma.employee_pay_rate.count({ where: { user_id: person.id } })).toBe(2);
});

it('skips an ended ca when planning from today and never creates fake clock evidence', async () => {
  const asOfDay = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const afterMorning = new Date(asOfDay + 'T17:00:00+07:00');
  await db.prisma.$transaction(
    async (tx) => {
      const before = await tx.attendance_record.count();
      await seedWorkforce(tx, restaurantId, { now: afterMorning, dayCount: 1 });
      const planned = await tx.work_shift.findMany({
        where: { scheduled_date: new Date(asOfDay) },
      });
      expect(planned).toHaveLength(1);
      expect(planned[0]!.code).toBe(asOfDay + '-CA-TOI');
      expect(planned[0]!.ends_at.getTime()).toBeGreaterThan(afterMorning.getTime());
      expect(await tx.attendance_record.count()).toBe(before);
      expect(await tx.payroll_payment.count()).toBe(0);
    },
    { timeout: 60000 },
  );
  await expect(
    db.prisma.$transaction((tx) => seedWorkforce(tx, restaurantId, { startDay: '2026-01-01' })),
  ).rejects.toThrow('hôm nay');
});
