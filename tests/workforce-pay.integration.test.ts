import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';

let host: Database, db: Database, app: ReturnType<typeof buildApp>;
const databaseName = 'thesis_workforce_pay_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const cookies: Record<string, string> = {};
const origin = 'http://localhost:3100';
const policy = {
  effectiveFrom: '2025-02-01',
  nightPremiumPercent: 30,
  overtimeWeekdayPercent: 150,
  restDayPercent: 200,
  holidayPercent: 300,
};
type Period = { startsAt: string; endsAt: string; kind: 'REGULAR' | 'OVERTIME' | 'PAID_HOLIDAY' };
type Components = {
  regularMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  restDayMinutes: number;
  paidHolidayMinutes: number;
  baseAmount: string;
  nightAmount: string;
  overtimeAmount: string;
  restDayAmount: string;
  holidayAmount: string;
  paidHolidayAmount: string;
  totalAmount: string;
};
type Preview = {
  approvedMinutes: number;
  hourlyRate: string;
  amount: string;
  payComponents: Components;
  paySnapshot: Record<string, unknown>;
  paidPeriods: Period[];
};
async function request(
  path: string,
  body?: unknown,
  user = 'quyettruong05',
  method: 'GET' | 'POST' | 'DELETE' = body === undefined ? 'GET' : 'POST',
) {
  return app.inject({
    url: path,
    method,
    headers: { origin, 'x-csrf-protection': '1', cookie: cookies[user] ?? '' },
    payload: body as Record<string, unknown>,
  });
}
async function ok(
  path: string,
  body?: unknown,
  user = 'quyettruong05',
  method?: 'GET' | 'POST' | 'DELETE',
) {
  const response = await request(path, body, user, method);
  expect(response.statusCode, path + ' ' + response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  const folder = 'packages/database/prisma/migrations';
  for (const file of readdirSync(folder)
    .filter((name) => /^\d/.test(name))
    .sort())
    await db.pool.query(readFileSync(folder + '/' + file + '/migration.sql', 'utf8'));
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'p'.repeat(96),
    restaurantId,
    origins: [origin],
    secure: false,
  });
  registerModules(app, db, restaurantId);
  app.addHook('onError', async (_request, _reply, error) => {
    if (!error.statusCode || error.statusCode >= 500)
      console.error('Workforce pay test:', error.message);
  });
  for (const user of ['quyettruong05', 'pv001', 'bep001']) {
    const response = await request('/auth/login', { username: user, password }, '');
    expect(response.statusCode).toBe(200);
    cookies[user] = response.cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ');
  }
  for (const [username, hourlyRate] of [
    ['pv001', '40000'],
    ['bep001', '80000'],
  ])
    await ok('/core/workforce/pay-rates', {
      userId: await employee(username),
      effectiveFrom: '2025-01-01T00:00:00+07:00',
      hourlyRate,
      reason: 'Mức lương riêng trong cơ sở dữ liệu kiểm thử.',
    });
  // A historical policy is an isolated fixture only. The management API appends
  // policies prospectively and never rewrites production approved history.
  await db.pool.query(
    'INSERT INTO workforce_pay_policy(restaurant_id,effective_from,night_premium_percent,overtime_weekday_percent,rest_day_percent,holiday_percent,created_by) VALUES($1,$2,30,150,200,300,$3)',
    [restaurantId, policy.effectiveFrom, await employee('quyettruong05')],
  );
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
});
async function employee(username = 'pv001') {
  return (await db.pool.query('SELECT id FROM app_user WHERE username=$1', [username])).rows[0]
    .id as string;
}
const at = (day: string, time: string) => `${day}T${time}:00+07:00`;
function period(
  day: string,
  from: string,
  to: string,
  kind: Period['kind'] = 'REGULAR',
  endDay = day,
): Period {
  return { startsAt: at(day, from), endsAt: at(endDay, to), kind };
}
async function assignment(
  day: string,
  start: string,
  end: string,
  options: { employee?: string; endDay?: string; breakMinutes?: number; shiftRate?: string } = {},
) {
  let s;
  if (options.shiftRate) {
    const template = await ok('/core/workforce/templates', {
      code: randomUUID(),
      name: 'Ca có đơn giá cũ',
      startTime: start,
      endTime: end,
      endsNextDay: Boolean(options.endDay && options.endDay !== day),
      hasBreak: Boolean(options.breakMinutes),
      breakMinutes: options.breakMinutes,
      useShiftRate: true,
      hourlyRate: options.shiftRate,
      sortOrder: 0,
    });
    s = (await ok('/core/workforce/schedule', { templateIds: [template.id], from: day, to: day }))
      .shifts[0];
  } else
    s = await ok('/core/workforce/shifts', {
      code: randomUUID(),
      name: 'Ca đối chiếu tiền công',
      startsAt: at(day, start),
      endsAt: at(options.endDay ?? day, end),
      breakMinutes: options.breakMinutes ?? 0,
    });
  return ok('/core/workforce/assignments', {
    shiftId: s.id,
    userId: await employee(options.employee),
  });
}
function body(paidPeriods: Period[], minutes: number, extra = false) {
  return {
    minutes,
    paidPeriods,
    approvalMode: 'EXCEPTION',
    outcome:
      paidPeriods.length && paidPeriods.every((row) => row.kind === 'PAID_HOLIDAY')
        ? 'PAID_HOLIDAY'
        : 'MISSED_CLOCK',
    note: 'Đối chiếu giờ làm thực tế và chính sách trả lương.',
    approveExtra: extra,
  };
}
async function preview(
  id: string,
  paidPeriods: Period[],
  minutes: number,
  extra = false,
): Promise<Preview> {
  return ok(
    '/core/workforce/assignments/' + id + '/pay-preview',
    body(paidPeriods, minutes, extra),
  );
}
async function approve(id: string, paidPeriods: Period[], minutes: number, extra = false) {
  return ok('/core/workforce/assignments/' + id + '/approve', body(paidPeriods, minutes, extra));
}
async function calendar(day: string, kind = 'HOLIDAY', userId?: string) {
  return ok('/core/workforce/calendar', {
    date: day,
    kind,
    userId,
    name: kind === 'HOLIDAY' ? 'Ngày lễ đối chiếu' : 'Ngày nghỉ theo lịch nhân viên',
  });
}
let legacyAttendance: Record<string, unknown>;
let approvedNight: Record<string, unknown>;
let approvedHolidayDay: { id: string };

it('keeps pre-policy approved attendance at its original shift rate', async () => {
  const a = await assignment('2025-01-10', '22:00', '02:00', {
    endDay: '2025-01-11',
    shiftRate: '50000',
  });
  legacyAttendance = await ok('/core/workforce/assignments/' + a.id + '/approve', {
    minutes: 240,
    approvalMode: 'FULL',
    outcome: 'MISSED_CLOCK',
    note: 'Công đã duyệt trước khi áp dụng chính sách mới.',
  });
  expect(legacyAttendance).toMatchObject({
    amount: '200000',
    hourly_rate_snapshot: '50000',
    rate_source: 'SHIFT',
  });
});

it('requires admin permission and statutory minimum policies, with a distinct effective date', async () => {
  expect((await request('/core/workforce/pay-settings', undefined, 'pv001')).statusCode).toBe(403);
  expect((await request('/core/workforce/pay-policies', policy, 'pv001')).statusCode).toBe(403);
  for (const values of [
    { nightPremiumPercent: 29 },
    { overtimeWeekdayPercent: 149 },
    { restDayPercent: 199 },
    { holidayPercent: 299 },
  ])
    expect(
      (
        await request('/core/workforce/pay-policies', {
          ...policy,
          effectiveFrom: '2028-01-01',
          ...values,
        })
      ).statusCode,
    ).toBe(400);
  const futurePolicy = { ...policy, effectiveFrom: '2028-01-01' };
  await ok('/core/workforce/pay-policies', futurePolicy);
  const settings = await ok('/core/workforce/pay-settings');
  expect(
    settings.policies.some(
      (row: { effective_from: string }) => row.effective_from === '2025-02-01',
    ),
  ).toBe(true);
  expect(settings.policies[0]).toMatchObject({ effective_from: '2028-01-01' });
  expect((await request('/core/workforce/pay-policies', futurePolicy)).statusCode).toBe(409);
  expect(
    (
      await db.pool.query(
        'SELECT amount,hourly_rate_snapshot,rate_source FROM attendance_record WHERE id=$1',
        [legacyAttendance.id],
      )
    ).rows[0],
  ).toMatchObject({ amount: '200000', hourly_rate_snapshot: '50000', rate_source: 'SHIFT' });
});

it('uses each employee base rate for the same night ca, even with the old 50k shift override', async () => {
  for (const [username, base, expected] of [
    ['pv001', '40000', '208000'],
    ['bep001', '80000', '416000'],
  ]) {
    const a = await assignment('2025-02-03', '22:00', '02:00', {
      employee: username,
      endDay: '2025-02-04',
      shiftRate: '50000',
    });
    const periods = [period('2025-02-03', '22:00', '02:00', 'REGULAR', '2025-02-04')];
    const calculated = await preview(a.id, periods, 240);
    expect(calculated).toMatchObject({ hourlyRate: base, approvedMinutes: 240, amount: expected });
    expect(calculated.payComponents).toMatchObject({ nightMinutes: 240, totalAmount: expected });
    const saved = await approve(a.id, periods, 240);
    expect(saved).toMatchObject({
      hourly_rate_snapshot: base,
      amount: expected,
      rate_source: 'EMPLOYEE',
    });
    expect(saved.pay_components).toEqual(calculated.payComponents);
    if (username === 'pv001') approvedNight = saved;
  }
});

it('splits regular and night minutes precisely and excludes a declared unpaid break', async () => {
  const mixed = await assignment('2025-02-05', '20:00', '00:00', { endDay: '2025-02-06' });
  expect(
    await preview(mixed.id, [period('2025-02-05', '20:00', '00:00', 'REGULAR', '2025-02-06')], 240),
  ).toMatchObject({
    amount: '184000',
    payComponents: { nightMinutes: 120, totalAmount: '184000' },
  });
  const breaks = await assignment('2025-02-06', '20:00', '00:00', {
    endDay: '2025-02-07',
    breakMinutes: 30,
  });
  const periods = [
    period('2025-02-06', '20:00', '21:00'),
    period('2025-02-06', '21:30', '00:00', 'REGULAR', '2025-02-07'),
  ];
  const calculated = await preview(breaks.id, periods, 210);
  expect(calculated).toMatchObject({
    approvedMinutes: 210,
    amount: '164000',
    payComponents: { nightMinutes: 120 },
  });
  const missingBreak = await request('/core/workforce/assignments/' + breaks.id + '/pay-preview', {
    minutes: 210,
    approvalMode: 'FULL',
    outcome: 'MISSED_CLOCK',
    note: 'Chưa khai báo khoảng nghỉ.',
  });
  expect(missingBreak.statusCode).toBe(400);
  expect(
    (
      await request(
        '/core/workforce/assignments/' + breaks.id + '/pay-preview',
        body([period('2025-02-06', '20:00', '00:00', 'REGULAR', '2025-02-07')], 240),
      )
    ).statusCode,
  ).toBe(400);
});

it('changes day category at midnight and gives holiday night work the combined statutory premium', async () => {
  approvedHolidayDay = await calendar('2025-02-08');
  const a = await assignment('2025-02-07', '22:00', '02:00', { endDay: '2025-02-08' });
  const periods = [period('2025-02-07', '22:00', '02:00', 'REGULAR', '2025-02-08')];
  const calculated = await preview(a.id, periods, 240);
  expect(calculated).toMatchObject({
    amount: '416000',
    payComponents: { nightMinutes: 240, holidayMinutes: 120, totalAmount: '416000' },
  });
  await approve(a.id, periods, 240);
});

it('does not assume Sunday is a rest day and scopes weekly rest to the selected employee', async () => {
  const sunday = await assignment('2025-02-09', '09:00', '11:00');
  expect(await preview(sunday.id, [period('2025-02-09', '09:00', '11:00')], 120)).toMatchObject({
    amount: '80000',
    payComponents: { restDayMinutes: 0 },
  });
  await calendar('2025-02-10', 'WEEKLY_REST', await employee());
  const selected = await assignment('2025-02-10', '22:00', '00:00', { endDay: '2025-02-11' });
  expect(
    await preview(
      selected.id,
      [period('2025-02-10', '22:00', '00:00', 'REGULAR', '2025-02-11')],
      120,
    ),
  ).toMatchObject({ amount: '216000', payComponents: { restDayMinutes: 120 } });
  const other = await assignment('2025-02-10', '22:00', '00:00', {
    employee: 'bep001',
    endDay: '2025-02-11',
  });
  expect(
    await preview(other.id, [period('2025-02-10', '22:00', '00:00', 'REGULAR', '2025-02-11')], 120),
  ).toMatchObject({ amount: '208000', payComponents: { restDayMinutes: 0 } });
  expect(
    (
      await request('/core/workforce/calendar', {
        date: '2025-02-11',
        kind: 'WEEKLY_REST',
        name: 'Thiếu người nghỉ',
      })
    ).statusCode,
  ).toBe(400);
});

it('distinguishes weekday night overtime with or without preceding daytime overtime', async () => {
  const night = await assignment('2025-02-11', '22:00', '00:00', { endDay: '2025-02-12' });
  const onlyNight = [period('2025-02-11', '22:00', '00:00', 'OVERTIME', '2025-02-12')];
  expect(await preview(night.id, onlyNight, 120, true)).toMatchObject({
    amount: '160000',
    payComponents: { overtimeMinutes: 120, totalAmount: '160000' },
  });
  const daytime = await assignment('2025-02-12', '21:00', '00:00', { endDay: '2025-02-13' });
  const together = [period('2025-02-12', '21:00', '00:00', 'OVERTIME', '2025-02-13')];
  expect(await preview(daytime.id, together, 180, true)).toMatchObject({
    amount: '228000',
    payComponents: { overtimeMinutes: 180, nightMinutes: 120 },
  });
  expect(
    (
      await request(
        '/core/workforce/assignments/' + night.id + '/pay-preview',
        body(onlyNight, 120),
      )
    ).statusCode,
  ).toBe(400);
  await calendar('2025-02-13', 'WEEKLY_REST', await employee());
  const rest = await assignment('2025-02-13', '22:00', '00:00', { endDay: '2025-02-14' });
  expect(
    await preview(
      rest.id,
      [period('2025-02-13', '22:00', '00:00', 'OVERTIME', '2025-02-14')],
      120,
      true,
    ),
  ).toMatchObject({ amount: '216000' });
  await calendar('2025-02-14');
  const holiday = await assignment('2025-02-14', '22:00', '00:00', { endDay: '2025-02-15' });
  expect(
    await preview(
      holiday.id,
      [period('2025-02-14', '22:00', '00:00', 'OVERTIME', '2025-02-15')],
      120,
      true,
    ),
  ).toMatchObject({ amount: '312000' });
});

it('rejects overlapping paid periods, regular time outside the ca, inconsistent totals and missing personal rates', async () => {
  const a = await assignment('2025-02-15', '09:00', '13:00');
  for (const invalid of [
    body([period('2025-02-15', '09:00', '11:00'), period('2025-02-15', '10:00', '12:00')], 240),
    body([period('2025-02-15', '08:00', '12:00')], 240, true),
    body([period('2025-02-15', '09:00', '13:00')], 180),
  ])
    expect(
      (await request('/core/workforce/assignments/' + a.id + '/pay-preview', invalid)).statusCode,
    ).toBe(400);
  const noRate = await assignment('2025-02-15', '09:00', '13:00', { employee: 'pv003' });
  const result = await request(
    '/core/workforce/assignments/' + noRate.id + '/pay-preview',
    body([period('2025-02-15', '09:00', '13:00')], 240),
  );
  expect(result.statusCode).toBeGreaterThanOrEqual(400);
  expect(result.statusCode).toBeLessThan(500);
  expect(
    (await db.pool.query('SELECT * FROM attendance_record WHERE assignment_id=$1', [a.id]))
      .rowCount,
  ).toBe(0);
});

it('records paid holiday leave separately without fabricating clock-in or clock-out', async () => {
  await calendar('2025-02-17');
  const a = await assignment('2025-02-17', '09:00', '13:00');
  const periods = [period('2025-02-17', '09:00', '13:00', 'PAID_HOLIDAY')];
  const calculated = await preview(a.id, periods, 240);
  expect(calculated).toMatchObject({
    amount: '160000',
    payComponents: { paidHolidayMinutes: 240, paidHolidayAmount: '160000', totalAmount: '160000' },
  });
  const saved = await approve(a.id, periods, 240);
  expect(saved.checked_in_at).toBeNull();
  expect(saved.checked_out_at).toBeNull();
  expect(saved.amount).toBe('160000');
  const ordinary = await assignment('2025-02-18', '09:00', '13:00');
  expect(
    (
      await request(
        '/core/workforce/assignments/' + ordinary.id + '/pay-preview',
        body([period('2025-02-18', '09:00', '13:00', 'PAID_HOLIDAY')], 240),
      )
    ).statusCode,
  ).toBe(400);
});

it('uses approved daytime overtime across separate ca and prevents rewriting an already approved night premium', async () => {
  const firstNight = await assignment('2025-02-20', '22:00', '00:00', { endDay: '2025-02-21' });
  await approve(
    firstNight.id,
    [period('2025-02-20', '22:00', '00:00', 'OVERTIME', '2025-02-21')],
    120,
    true,
  );
  const laterDaytime = await assignment('2025-02-20', '18:00', '19:00');
  const rejected = await request(
    '/core/workforce/assignments/' + laterDaytime.id + '/approve',
    body([period('2025-02-20', '18:00', '19:00', 'OVERTIME')], 60, true),
  );
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json().userMessage).toContain('ban ngày');
  const beforeNight = await assignment('2025-02-21', '18:00', '19:00');
  await approve(beforeNight.id, [period('2025-02-21', '18:00', '19:00', 'OVERTIME')], 60, true);
  const nextNight = await assignment('2025-02-21', '22:00', '00:00', { endDay: '2025-02-22' });
  expect(
    await preview(
      nextNight.id,
      [period('2025-02-21', '22:00', '00:00', 'OVERTIME', '2025-02-22')],
      120,
      true,
    ),
  ).toMatchObject({ amount: '168000' });
});

it('freezes the calculation snapshot and refuses retrospective rate, policy or calendar changes touching approved work', async () => {
  const original = (
    await db.pool.query('SELECT * FROM attendance_record WHERE id=$1', [approvedNight.id])
  ).rows[0];
  expect(original.pay_snapshot).toBeTruthy();
  expect(original.paid_periods).toHaveLength(1);
  expect(
    (
      await request('/core/workforce/pay-rates', {
        userId: await employee(),
        effectiveFrom: '2025-02-01T00:00:00+07:00',
        hourlyRate: '90000',
        reason: 'Không được sửa ngược công đã duyệt.',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request('/core/workforce/pay-policies', {
        ...policy,
        effectiveFrom: '2025-02-02',
        nightPremiumPercent: 40,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request(
        '/core/workforce/calendar/' + approvedHolidayDay.id,
        {},
        'quyettruong05',
        'DELETE',
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request('/core/workforce/calendar', {
        date: '2025-02-03',
        kind: 'HOLIDAY',
        name: 'Không hồi tố ngày đã duyệt.',
      })
    ).statusCode,
  ).toBe(409);
  await ok('/core/workforce/pay-policies', {
    ...policy,
    effectiveFrom: '2030-01-01',
    nightPremiumPercent: 40,
  });
  await ok('/core/workforce/pay-rates', {
    userId: await employee(),
    effectiveFrom: '2030-01-01T00:00:00+07:00',
    hourlyRate: '50000',
    reason: 'Mức lương mới cho ca sau này.',
  });
  const after = (
    await db.pool.query('SELECT * FROM attendance_record WHERE id=$1', [approvedNight.id])
  ).rows[0];
  expect(after).toMatchObject({
    amount: original.amount,
    hourly_rate_snapshot: original.hourly_rate_snapshot,
    pay_snapshot: original.pay_snapshot,
    pay_components: original.pay_components,
    paid_periods: original.paid_periods,
  });
  await expect(
    db.pool.query("UPDATE attendance_record SET pay_components='{}'::jsonb WHERE id=$1", [
      approvedNight.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});

it('carries approved pay components into payroll and keeps the finalized snapshot immutable', async () => {
  const a = await assignment('2025-03-03', '22:00', '02:00', { endDay: '2025-03-04' });
  const saved = await approve(
    a.id,
    [period('2025-03-03', '22:00', '02:00', 'REGULAR', '2025-03-04')],
    240,
  );
  const run = await ok('/core/payroll', { periodStart: '2025-03-01', periodEnd: '2025-04-01' });
  const detail = await ok('/core/payroll/' + run.id);
  expect(detail.slips).toHaveLength(1);
  expect(detail.lines).toHaveLength(1);
  expect(detail.slips[0].total_amount).toBe('208000');
  expect(detail.lines[0]).toMatchObject({
    amount: '208000',
    pay_snapshot: saved.pay_snapshot,
    pay_components: saved.pay_components,
    paid_periods: saved.paid_periods,
  });
  await ok('/core/payroll/' + run.id + '/finalize', {});
  await expect(
    db.pool.query("UPDATE payroll_line SET pay_components='{}'::jsonb WHERE id=$1", [
      detail.lines[0].id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await request('/core/workforce/calendar', {
        date: '2025-03-03',
        kind: 'HOLIDAY',
        name: 'Ngày đã chốt bảng lương.',
      })
    ).statusCode,
  ).toBe(409);
  const personal = await ok('/core/payroll/me', undefined, 'pv001');
  expect(
    personal.lines.find((line: { id: string }) => line.id === detail.lines[0].id),
  ).toMatchObject({ pay_components: saved.pay_components });
});

it('normalizes actual punches with seconds to complete paid minutes without modifying the source punches', async () => {
  const a = await assignment('2025-02-23', '09:00', '15:00');
  await db.pool.query(
    'INSERT INTO attendance_record(restaurant_id,assignment_id,checked_in_at,checked_out_at) VALUES($1,$2,$3,$4)',
    [restaurantId, a.id, '2025-02-23T09:10:30+07:00', '2025-02-23T14:55:45+07:00'],
  );
  const payload = {
    ...body([period('2025-02-23', '09:11', '14:55')], 344),
    approvalMode: 'ACTUAL',
    outcome: 'WORKED',
  };
  const calculated = await ok('/core/workforce/assignments/' + a.id + '/pay-preview', payload);
  expect(calculated).toMatchObject({ approvedMinutes: 344, amount: '229333' });
  const saved = await ok('/core/workforce/assignments/' + a.id + '/approve', payload);
  expect(saved.checked_in_at).toBe('2025-02-23T02:10:30.000Z');
  expect(saved.checked_out_at).toBe('2025-02-23T07:55:45.000Z');
});

it('rejects malformed classified pay JSON at the database boundary, after a valid snapshot control succeeds', async () => {
  const a = await assignment('2025-02-24', '22:00', '02:00', { endDay: '2025-02-25' });
  const original = await preview(
    a.id,
    [period('2025-02-24', '22:00', '02:00', 'REGULAR', '2025-02-25')],
    240,
  );
  const insert =
    "INSERT INTO attendance_record(restaurant_id,assignment_id,status,approved_minutes,hourly_rate_snapshot,amount,approved_by,approved_at,review_note,outcome,approval_mode,rate_source,pay_snapshot,pay_components,paid_periods) VALUES($1,$2,'APPROVED',240,40000,208000,$3,now(),'Database guard fixture','MISSED_CLOCK','EXCEPTION','EMPLOYEE',$4,$5,$6)";
  const admin = await employee('quyettruong05');
  const values = (
    snapshot: unknown,
    components = original.payComponents,
    periods = original.paidPeriods,
  ) => [
    restaurantId,
    a.id,
    admin,
    JSON.stringify(snapshot),
    JSON.stringify(components),
    JSON.stringify(periods),
  ];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    expect((await client.query(insert, values(original.paySnapshot))).rowCount).toBe(1);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  const missingVersion = structuredClone(original.paySnapshot);
  delete missingVersion.version;
  await expect(db.pool.query(insert, values(missingVersion))).rejects.toMatchObject({
    code: '23514',
  });
  for (const key of ['startsAt', 'endsAt', 'kind']) {
    const periods = structuredClone(original.paidPeriods) as unknown as Record<string, unknown>[];
    delete periods[0]![key];
    const snapshot = { ...original.paySnapshot, periods };
    await expect(
      db.pool.query(
        insert,
        values(snapshot, original.payComponents, periods as unknown as Period[]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }
  const wrongSegments = structuredClone(original.paySnapshot);
  const segments = wrongSegments.segments as Record<string, unknown>[];
  segments[0]!.amount = String(BigInt(String(segments[0]!.amount)) + 1n);
  await expect(db.pool.query(insert, values(wrongSegments))).rejects.toMatchObject({
    code: '23514',
  });
  expect(
    (await db.pool.query('SELECT id FROM attendance_record WHERE assignment_id=$1', [a.id]))
      .rowCount,
  ).toBe(0);
});

it('requires a draft payroll line to copy the exact approved components and evidence', async () => {
  const a = await assignment('2025-04-05', '22:00', '02:00', { endDay: '2025-04-06' });
  await approve(a.id, [period('2025-04-05', '22:00', '02:00', 'REGULAR', '2025-04-06')], 240);
  const run = await ok('/core/payroll', { periodStart: '2025-04-01', periodEnd: '2025-05-01' });
  const detail = await ok('/core/payroll/' + run.id);
  const line = detail.lines[0];
  const insert =
    'INSERT INTO payroll_line(restaurant_id,payroll_slip_id,line_type,attendance_id,minutes,hourly_rate_snapshot,amount,description,pay_components,pay_snapshot,paid_periods,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)';
  const values = (components: unknown, snapshot: unknown) => [
    restaurantId,
    line.payroll_slip_id,
    line.line_type,
    line.attendance_id,
    line.minutes,
    line.hourly_rate_snapshot,
    line.amount,
    line.description,
    JSON.stringify(components),
    JSON.stringify(snapshot),
    JSON.stringify(line.paid_periods),
    line.created_by,
  ];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM payroll_line WHERE id=$1', [line.id]);
    expect(
      (await client.query(insert, values(line.pay_components, line.pay_snapshot))).rowCount,
    ).toBe(1);
    await client.query('ROLLBACK');
    for (const [components, snapshot] of [
      [{ ...line.pay_components, nightAmount: '47000' }, line.pay_snapshot],
      [line.pay_components, { ...line.pay_snapshot, version: 2 }],
    ]) {
      await client.query('BEGIN');
      await client.query('DELETE FROM payroll_line WHERE id=$1', [line.id]);
      await expect(client.query(insert, values(components, snapshot))).rejects.toMatchObject({
        code: '23514',
      });
      await client.query('ROLLBACK');
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await ok('/core/payroll/' + run.id)).lines[0]).toMatchObject(line);
});

it('does not increase midnight overtime retroactively when daytime overtime follows it later that morning', async () => {
  const first = await assignment('2025-02-26', '00:00', '01:00');
  const savedNight = await approve(
    first.id,
    [period('2025-02-26', '00:00', '01:00', 'OVERTIME')],
    60,
    true,
  );
  expect(savedNight.amount).toBe('80000');
  const after = await assignment('2025-02-26', '08:00', '09:00');
  const savedDay = await approve(
    after.id,
    [period('2025-02-26', '08:00', '09:00', 'OVERTIME')],
    60,
    true,
  );
  expect(savedDay.amount).toBe('60000');
  const unchanged = (
    await db.pool.query('SELECT amount,pay_snapshot FROM attendance_record WHERE id=$1', [
      savedNight.id,
    ])
  ).rows[0];
  expect(unchanged).toMatchObject({ amount: '80000', pay_snapshot: savedNight.pay_snapshot });
  const together = await assignment('2025-02-27', '00:00', '09:00');
  expect(
    await preview(
      together.id,
      [
        period('2025-02-27', '00:00', '01:00', 'OVERTIME'),
        period('2025-02-27', '08:00', '09:00', 'OVERTIME'),
      ],
      120,
      true,
    ),
  ).toMatchObject({ amount: '140000' });
});

it('allows next-day calendar and rate changes after a shift ending exactly at midnight without changing approved pay', async () => {
  const userId = await employee('pv004');
  await ok('/core/workforce/pay-rates', {
    userId,
    effectiveFrom: at('2025-01-01', '00:00'),
    hourlyRate: '35000',
    reason: 'Đơn giá cho kiểm thử ranh giới nửa đêm.',
  });
  const a = await assignment('2025-06-01', '20:00', '00:00', {
    employee: 'pv004',
    endDay: '2025-06-02',
  });
  const saved = await approve(
    a.id,
    [period('2025-06-01', '20:00', '00:00', 'REGULAR', '2025-06-02')],
    240,
  );
  expect(saved.amount).toBe('161000');
  const overlaps = await request('/core/workforce/calendar', {
    date: '2025-06-01',
    kind: 'WEEKLY_REST',
    userId,
    name: 'Ngày đã duyệt công',
  });
  expect(overlaps.statusCode).toBe(409);
  await ok('/core/workforce/calendar', {
    date: '2025-06-02',
    kind: 'WEEKLY_REST',
    userId,
    name: 'Ngày nghỉ sau ca',
  });
  await ok('/core/workforce/pay-rates', {
    userId,
    effectiveFrom: at('2025-06-02', '00:00'),
    hourlyRate: '40000',
    reason: 'Đơn giá mới sau khi ca trước kết thúc.',
  });
  const current = (
    await db.pool.query(
      'SELECT amount::text, pay_snapshot, pay_components FROM attendance_record WHERE assignment_id=$1',
      [a.id],
    )
  ).rows[0];
  expect(current).toMatchObject({
    amount: saved.amount,
    pay_snapshot: saved.pay_snapshot,
    pay_components: saved.pay_components,
  });
});

it('rejects approval of a stale pay preview without saving attendance and accepts the refreshed calculation', async () => {
  const userId = await employee('pv003');
  await ok('/core/workforce/pay-rates', {
    userId,
    effectiveFrom: '2025-01-01T00:00:00+07:00',
    hourlyRate: '40000',
    reason: 'Đơn giá ban đầu cho ca chưa duyệt.',
  });
  const a = await assignment('2025-05-03', '22:00', '02:00', {
    employee: 'pv003',
    endDay: '2025-05-04',
  });
  const periods = [period('2025-05-03', '22:00', '02:00', 'REGULAR', '2025-05-04')];
  const shown = await preview(a.id, periods, 240);
  expect(shown.amount).toBe('208000');
  await ok('/core/workforce/pay-rates', {
    userId,
    effectiveFrom: '2025-05-03T22:00:00+07:00',
    hourlyRate: '50000',
    reason: 'Điều chỉnh mức lương khi công chưa được duyệt.',
  });
  const stale = await request('/core/workforce/assignments/' + a.id + '/approve', {
    ...body(periods, 240),
    expectedAmount: shown.amount,
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().userMessage).toContain('Tính lại tiền dự kiến');
  expect(
    (await db.pool.query('SELECT id FROM attendance_record WHERE assignment_id=$1', [a.id]))
      .rowCount,
  ).toBe(0);
  const refreshed = await preview(a.id, periods, 240);
  expect(refreshed).toMatchObject({
    amount: '260000',
    payComponents: { baseAmount: '200000', nightAmount: '60000', totalAmount: '260000' },
  });
  const saved = await ok('/core/workforce/assignments/' + a.id + '/approve', {
    ...body(periods, 240),
    expectedAmount: refreshed.amount,
  });
  expect(saved).toMatchObject({
    amount: refreshed.amount,
    pay_snapshot: refreshed.paySnapshot,
    pay_components: refreshed.payComponents,
  });
});
