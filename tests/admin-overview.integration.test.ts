import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const name = 'thesis_admin_overview_' + randomBytes(8).toString('hex'),
  password = randomBytes(24).toString('hex');
const media = mkdtempSync(join(tmpdir(), 'thesis-payment-proof-')),
  oldMedia = process.env.PAYMENT_PROOF_DIR;
const users: Record<string, string> = {},
  headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const jar = (r: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>) =>
  r.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function req(url: string, user: string, body?: unknown) {
  return app.inject({
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, cookie: users[user] ?? user },
    payload: body as Record<string, unknown>,
  });
}
async function ok(url: string, user: string, body?: unknown) {
  const r = await req(url, user, body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  db = createDatabase(url.toString());
  const m = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  if (m.status !== 0) throw Error(m.stderr);
  await seed(db, password);
  process.env.PAYMENT_PROOF_DIR = media;
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'p'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const user of ['quyettruong05', 'pv001', 'pv002', 'bep001'])
    users[user] = jar(await req('/auth/login', '', { username: user, password }));
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
  if (oldMedia === undefined) delete process.env.PAYMENT_PROOF_DIR;
  else process.env.PAYMENT_PROOF_DIR = oldMedia;
  rmSync(media, { recursive: true, force: true });
});
const snapshot = async () => ok('/core/admin/overview', 'quyettruong05');
const statistics = async (period = 'week') =>
  ok('/core/admin/overview/statistics?period=' + period, 'quyettruong05');
async function table(extra: Record<string, unknown> = {}) {
  const area = await db.prisma.dining_area.findFirstOrThrow({ where: { is_active: true } });
  const code = 'OV-' + randomUUID().slice(0, 8);
  return db.prisma.dining_table.create({
    data: {
      restaurant_id: restaurantId,
      area_id: area.id,
      code,
      name: code,
      capacity: 4,
      ...extra,
    },
  });
}
it('limits the operating snapshot to ADMIN, including role permission boundaries', async () => {
  expect((await req('/core/admin/overview', '')).statusCode).toBe(401);
  for (const user of ['pv001', 'bep001'])
    expect((await req('/core/admin/overview', user)).statusCode).toBe(403);
  expect((await snapshot()).timezone).toBe('Asia/Ho_Chi_Minh');
});
it('counts usable tables only and separates ready, occupied and cleaning', async () => {
  const before = await snapshot();
  await table({ table_status: 'NEEDS_CLEANING' });
  await table({ is_active: false, table_status: 'OCCUPIED' });
  const code = 'OFF-' + randomUUID().slice(0, 8);
  const area = await db.prisma.dining_area.create({
    data: { restaurant_id: restaurantId, code, name: code, is_active: false },
  });
  await table({ area_id: area.id, table_status: 'OCCUPIED' });
  const after = await snapshot();
  expect(after.tables.total).toBe(before.tables.total + 1);
  expect(after.tables.cleaning).toBe(before.tables.cleaning + 1);
  expect(after.tables.occupied).toBe(before.tables.occupied);
});
it('uses open-session finance without subtracting refunds from gross collections or mutating balances', async () => {
  const before = await snapshot();
  const activeTable = await table(),
    closedTable = await table();
  const active = await db.prisma.table_session.create({ data: { table_id: activeTable.id } });
  const closed = await db.prisma.table_session.create({
    data: {
      table_id: closedTable.id,
      session_status: 'CLOSED',
      opened_at: new Date(Date.now() - 1000),
      closed_at: new Date(),
      close_reason: 'NORMAL',
    },
  });
  await db.prisma.session_financial_account.create({
    data: {
      session_id: active.id,
      charge_total: 40000n,
      paid_total: 90000n,
      refunded_total: 10000n,
      outstanding_amount: 0n,
      refund_due_amount: 40000n,
    },
  });
  await db.prisma.session_financial_account.create({
    data: { session_id: closed.id, charge_total: 9000000n, paid_total: 9000000n },
  });
  const accountBefore = await db.prisma.session_financial_account.findUniqueOrThrow({
    where: { session_id: active.id },
  });
  const after = await snapshot();
  expect(BigInt(after.finance.payable) - BigInt(before.finance.payable)).toBe(40000n);
  expect(BigInt(after.finance.collected) - BigInt(before.finance.collected)).toBe(90000n);
  expect(BigInt(after.finance.refunded) - BigInt(before.finance.refunded)).toBe(10000n);
  expect(BigInt(after.finance.refundDue) - BigInt(before.finance.refundDue)).toBe(40000n);
  await snapshot();
  expect(
    await db.prisma.session_financial_account.findUnique({ where: { session_id: active.id } }),
  ).toEqual(accountBefore);
});
it('counts clock-ins and open support, never treating active accounts as staff on duty', async () => {
  const before = await snapshot(),
    t = await table();
  const s = await db.prisma.table_session.create({ data: { table_id: t.id } });
  const user = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } });
  await db.prisma.support_request.createMany({
    data: [
      { session_id: s.id, request_type: 'WATER' },
      {
        session_id: s.id,
        request_type: 'UTENSILS',
        status: 'ACKNOWLEDGED',
        acknowledged_by: user.id,
        acknowledged_at: new Date(),
      },
      {
        session_id: s.id,
        request_type: 'OTHER',
        status: 'RESOLVED',
        acknowledged_by: user.id,
        acknowledged_at: new Date(),
        resolved_by: user.id,
        resolved_at: new Date(),
      },
    ],
  });
  const admin = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } });
  // Seeded staff can already have a shift at the current clock time.
  const employee = await db.prisma.app_user.create({
    data: {
      restaurant_id: restaurantId,
      username: 'ov-' + randomUUID(),
      password_hash: user.password_hash,
      display_name: 'Nhân viên kiểm thử chấm công',
    },
  });
  const role = await db.prisma.role.findUniqueOrThrow({ where: { code: 'STAFF' } });
  await db.prisma.user_role.create({ data: { user_id: employee.id, role_id: role.id } });
  const shift = await db.prisma.work_shift.create({
    data: {
      restaurant_id: restaurantId,
      code: 'OV-' + randomUUID(),
      name: 'Ca kiểm thử',
      starts_at: new Date(Date.now() - 3600000),
      ends_at: new Date(Date.now() + 3600000),
      created_by: admin.id,
    },
  });
  const a = await db.prisma.shift_assignment.create({
    data: {
      restaurant_id: restaurantId,
      shift_id: shift.id,
      user_id: employee.id,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      assigned_by: admin.id,
    },
  });
  await db.prisma.attendance_record.create({
    data: {
      restaurant_id: restaurantId,
      assignment_id: a.id,
      checked_in_at: new Date(Date.now() - 1000),
    },
  });
  const after = await snapshot();
  expect(after.support.new).toBe(before.support.new + 1);
  expect(after.support.inProgress).toBe(before.support.inProgress + 1);
  const expected = await db.pool.query(
    "SELECT count(DISTINCT a.user_id)::int AS n FROM shift_assignment a JOIN attendance_record n ON n.assignment_id=a.id WHERE a.restaurant_id=$1 AND a.status='ASSIGNED' AND n.checked_in_at<=now() AND n.checked_out_at IS NULL AND n.status<>'APPROVED'",
    [restaurantId],
  );
  expect(after.workforce.clockedIn).toBe(expected.rows[0].n);
});
it('counts an ingredient once across warehouses and applies the existing minimum-stock setting', async () => {
  const before = await snapshot();
  const unit = await db.prisma.unit_of_measure.findFirstOrThrow();
  const i = await db.prisma.ingredient.create({
    data: {
      restaurant_id: restaurantId,
      code: 'OV-' + randomUUID(),
      name: 'Nguyên liệu kiểm thử',
      base_unit_id: unit.id,
      min_stock: 10,
    },
  });
  const locations = await db.prisma.stock_location.findMany({
    where: { is_active: true },
    take: 2,
  });
  for (const l of locations)
    await db.pool.query(
      'INSERT INTO inventory_balance(location_id,ingredient_id,on_hand_qty,reserved_qty,available_qty) VALUES($1,$2,0,0,0)',
      [l.id, i.id],
    );
  expect((await snapshot()).inventory.unavailable).toBe(before.inventory.unavailable + 1);
  await db.pool.query(
    'UPDATE inventory_balance SET on_hand_qty=5,available_qty=5 WHERE location_id=$1 AND ingredient_id=$2',
    [locations[0]!.id, i.id],
  );
  const after = await snapshot();
  expect(after.inventory.unavailable).toBe(before.inventory.unavailable);
  expect(after.inventory.low).toBe(before.inventory.low + 1);
});
it('shows at most five served products for the restaurant day, excluding yesterday and future items', async () => {
  const t = await table(),
    s = await db.prisma.table_session.create({ data: { table_id: t.id } });
  const p = await db.prisma.product.findFirstOrThrow(),
    u = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } });
  const day = (
    await db.pool.query(
      'SELECT ((now() AT TIME ZONE timezone)::date::timestamp AT TIME ZONE timezone) AS start FROM restaurant WHERE id=$1',
      [restaurantId],
    )
  ).rows[0].start;
  const b = await db.prisma.order_batch.create({
    data: {
      session_id: s.id,
      created_by_type: 'USER',
      created_by_user_id: u.id,
      client_request_id: randomUUID(),
      subtotal: 1n,
      total_amount: 1n,
    },
  });
  const create = async (name: string, offset: number) => {
    const i = await db.prisma.order_item.create({
      data: {
        order_batch_id: b.id,
        product_id: p.id,
        product_name_snapshot: name,
        quantity: 1,
        unit_price_snapshot: 999000000n,
        line_total: 999000000n,
        status: 'SERVED',
        served_at: new Date(day.getTime() + offset),
      },
    });
    await db.prisma.financial_charge.create({
      data: { session_id: s.id, order_item_id: i.id, charge_type: 'ITEM', amount: 999000000n },
    });
  };
  for (let n = 0; n < 6; n++) await create('Hôm nay ' + n, 1000 + n);
  await create('Hôm qua — không được xuất hiện', -1);
  await create('Ngày mai — không được xuất hiện', 86400000);
  const data = await snapshot();
  expect(data.topSales).toHaveLength(5);
  expect(data.topSales.every((row: { name: string }) => row.name.startsWith('Hôm nay'))).toBe(true);
});

it('protects period statistics and rejects unsupported ranges without exposing technical errors', async () => {
  const url = '/core/admin/overview/statistics';
  expect((await req(url, '')).statusCode).toBe(401);
  for (const user of ['pv001', 'bep001']) expect((await req(url, user)).statusCode).toBe(403);
  const invalid = await req(url + '?period=year', 'quyettruong05');
  expect(invalid.statusCode).toBe(400);
  expect(invalid.body).toContain('7 ngày qua');
  const data = await ok(url, 'quyettruong05');
  expect(data.period).toBe('week');
  expect(data.series).toHaveLength(7);
});

it('uses confirmation and refund dates, including previous-day payments, pending/future exclusion and negative net collections', async () => {
  const before = await statistics('today');
  const user = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } });
  const t = await table();
  const s = await db.prisma.table_session.create({ data: { table_id: t.id } });
  const bounds = (
    await db.pool.query(
      `SELECT ((now() AT TIME ZONE timezone)::date-1)::timestamp AT TIME ZONE timezone AS yesterday,
      ((now() AT TIME ZONE timezone)::date+1)::timestamp AT TIME ZONE timezone AS tomorrow
      FROM restaurant WHERE id=$1`,
      [restaurantId],
    )
  ).rows[0];
  const confirmed = new Date(bounds.yesterday.getTime() + 1);
  const payment = await db.prisma.payment_transaction.create({
    data: {
      session_id: s.id,
      method: 'CASH',
      amount: 500000n,
      status: 'SUCCEEDED',
      confirmed_by: user.id,
      confirmed_at: confirmed,
      created_at: confirmed,
      metadata: { tenderedAmount: '1000000', changeAmount: '500000' },
    },
  });
  await db.prisma.payment_transaction.createMany({
    data: [
      {
        session_id: s.id,
        method: 'CASH',
        amount: 999000n,
        status: 'SUCCEEDED',
        confirmed_at: bounds.tomorrow,
      },
      { session_id: s.id, method: 'CASH', amount: 888000n, status: 'PENDING' },
    ],
  });
  const refund = await db.prisma.refund_case.create({
    data: {
      session_id: s.id,
      source_payment_transaction_id: payment.id,
      amount: 5000n,
      reason: 'Quản trị xác nhận lỗi nhà hàng',
    },
  });
  await db.prisma.refund_transaction.create({
    data: {
      refund_case_id: refund.id,
      amount: 5000n,
      method: 'CASH',
      status: 'SUCCEEDED',
      processed_by: user.id,
      processed_at: new Date(),
    },
  });
  await db.prisma.session_financial_account.create({ data: { session_id: s.id } });
  const accountBefore = await db.prisma.session_financial_account.findUnique({
    where: { session_id: s.id },
  });
  const after = await statistics('today');
  expect(BigInt(after.current.collected) - BigInt(before.current.collected)).toBe(0n);
  expect(BigInt(after.current.refunded) - BigInt(before.current.refunded)).toBe(5000n);
  expect(BigInt(after.current.net) - BigInt(before.current.net)).toBe(-5000n);
  expect(BigInt(after.previous.collected) - BigInt(before.previous.collected)).toBe(500000n);
  expect(
    after.series.reduce((sum: bigint, row: { refunded: string }) => sum + BigInt(row.refunded), 0n),
  ).toBe(BigInt(after.current.refunded));
  expect(
    after.series.reduce(
      (sum: bigint, row: { collected: string }) => sum + BigInt(row.collected),
      0n,
    ),
  ).toBe(BigInt(after.current.collected));
  await statistics('month');
  expect(
    await db.prisma.session_financial_account.findUnique({ where: { session_id: s.id } }),
  ).toEqual(accountBefore);
});

it('counts actual submitted batches separately from opened sessions, retaining later-cancelled submissions', async () => {
  const before = await statistics('today');
  const t = await table(),
    s = await db.prisma.table_session.create({ data: { table_id: t.id } });
  const user = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } });
  for (const status of ['SUBMITTED', 'CANCELLED'])
    await db.prisma.order_batch.create({
      data: {
        session_id: s.id,
        created_by_type: 'USER',
        created_by_user_id: user.id,
        client_request_id: randomUUID(),
        subtotal: 1000n,
        total_amount: 1000n,
        status,
        submitted_at: new Date(),
        created_at: new Date(Date.now() - 172800000),
      },
    });
  await db.prisma.order_batch.create({
    data: {
      session_id: s.id,
      created_by_type: 'USER',
      created_by_user_id: user.id,
      client_request_id: randomUUID(),
      subtotal: 1000n,
      total_amount: 1000n,
    },
  });
  const after = await statistics('today');
  expect(after.current.orders - before.current.orders).toBe(2);
  expect(after.current.sessions - before.current.sessions).toBe(1);
  expect(after.series.reduce((n: number, p: { orders: number }) => n + p.orders, 0)).toBe(
    after.current.orders,
  );
});

it('builds bounded hourly/daily points and equal-length comparison windows in the restaurant timezone', async () => {
  const restaurant = await db.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
  try {
    await db.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { timezone: 'Pacific/Kiritimati' },
    });
    const clock = (
      await db.pool.query(
        `SELECT (now() AT TIME ZONE timezone)::date::text AS day,
      extract(hour FROM now() AT TIME ZONE timezone)::int AS hour FROM restaurant WHERE id=$1`,
        [restaurantId],
      )
    ).rows[0];
    const today = await statistics('today'),
      week = await statistics('week'),
      month = await statistics('month');
    expect(today.startDay).toBe(clock.day);
    expect(today.endDay).toBe(clock.day);
    expect(today.granularity).toBe('hour');
    expect(today.series).toHaveLength(clock.hour + 1);
    expect(week.granularity).toBe('day');
    expect(week.series).toHaveLength(7);
    expect(month.startDay).toBe(clock.day.slice(0, 8) + '01');
    expect(month.series).toHaveLength(Number(clock.day.slice(8)));
    for (const data of [today, week, month]) {
      const days = (Date.parse(data.endDay) - Date.parse(data.startDay)) / 86400000 + 1;
      expect(
        (Date.parse(data.previousEndDay) - Date.parse(data.previousStartDay)) / 86400000 + 1,
      ).toBe(days);
      expect(data.timezone).toBe('Pacific/Kiritimati');
    }
  } finally {
    await db.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { timezone: restaurant.timezone },
    });
  }
});
