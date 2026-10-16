import { completePaymentHandover } from './dining-completion-fixture.js';
import { withTableCode } from './table-code-fixture.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const databaseName = 'thesis_transfer_' + randomBytes(8).toString('hex'),
  password = randomBytes(24).toString('hex');
const users: Record<string, string> = {},
  headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const cookie = (r: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>) =>
  r.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function req(url: string, user: string, body?: unknown, method?: 'GET' | 'POST' | 'DELETE') {
  if (url === '/guest/join')
    body = await withTableCode(app, db, users.pv001 ?? users.quyettruong05!, headers, body);
  return app.inject({
    url,
    method: method ?? (body === undefined ? 'GET' : 'POST'),
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
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  const migrated = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  if (migrated.status !== 0) throw Error(migrated.stderr);
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 't'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const user of ['quyettruong05', 'pv001', 'pv002', 'bep001'])
    users[user] = cookie(await req('/auth/login', '', { username: user, password }));
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
});
async function table(capacity = 4, areaId?: string) {
  const code = 'T' + randomBytes(5).toString('hex'),
    area = areaId ?? (await db.prisma.dining_area.findFirstOrThrow()).id;
  return db.prisma.dining_table.create({
    data: { restaurant_id: restaurantId, area_id: area, code, name: code, capacity },
  });
}
async function open() {
  const source = await table();
  const s = await ok('/core/tables/' + source.id + '/open', 'pv001', {});
  return { source, s };
}
const transfer = (sid: string) => '/core/sessions/' + sid + '/transfer';
const payload = (source: string, target: string, extra: Record<string, unknown> = {}) => ({
  fromTableId: source,
  tableId: target,
  partySize: 4,
  reasonCode: 'CUSTOMER_REQUEST',
  ...extra,
});
async function unchanged(sid: string, source: string) {
  expect((await db.prisma.table_session.findUniqueOrThrow({ where: { id: sid } })).table_id).toBe(
    source,
  );
  expect(await db.prisma.table_transfer_history.count({ where: { session_id: sid } })).toBe(0);
}
async function identities(sid: string) {
  const queries: Record<string, string> = {
    participants: 'SELECT id FROM session_participant WHERE session_id=$1 ORDER BY id',
    cart: 'SELECT id FROM session_cart WHERE session_id=$1',
    cartItems:
      'SELECT i.id FROM cart_item i JOIN session_cart c ON c.id=i.cart_id WHERE c.session_id=$1 ORDER BY i.id',
    batches: 'SELECT id FROM order_batch WHERE session_id=$1 ORDER BY id',
    items:
      'SELECT i.id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=$1 ORDER BY i.id',
    account: 'SELECT id FROM session_financial_account WHERE session_id=$1',
    intents: 'SELECT id FROM payment_intent WHERE session_id=$1 ORDER BY id',
    payments: 'SELECT id FROM payment_transaction WHERE session_id=$1 ORDER BY id',
    charges: 'SELECT id FROM financial_charge WHERE session_id=$1 ORDER BY id',
    support: 'SELECT id FROM support_request WHERE session_id=$1 ORDER BY id',
  };
  const entries = await Promise.all(
    Object.entries(queries).map(async ([key, sql]) => [
      key,
      (await db.pool.query(sql, [sid])).rows.map((r) => r.id),
    ]),
  );
  return Object.fromEntries(entries);
}
it('preserves session, participants, unsent cart, orders, account, payments and support; freezes the final destination on receipt', async () => {
  const { source, s } = await open(),
    target = await table(6);
  const qr = await ok('/core/tables/' + source.id + '/qr', 'quyettruong05', {});
  const joined = await req('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'An',
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  expect(joined.statusCode, joined.body).toBe(200);
  const guest = cookie(joined);
  const category = await db.prisma.menu_category.findFirstOrThrow();
  const product = await ok('/core/products', 'quyettruong05', {
    categoryId: category.id,
    code: randomUUID(),
    name: 'Nước thử chuyển bàn',
    price: '50000',
    stockManaged: false,
  });
  let state = await ok('/guest/state', guest);
  const line = await ok('/guest/cart', guest, {
    productId: product.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
    note: 'Đã gọi',
  });
  state = await ok('/guest/state', guest);
  const order = await ok('/guest/orders', guest, {
    requestId: randomUUID(),
    itemIds: [line.id],
    cartVersion: state.cart.cart_version,
  });
  if (order.status === 'PENDING_REVIEW')
    await ok('/core/orders/' + order.id + '/review', 'pv001', { approve: true });
  state = await ok('/guest/state', guest);
  const unsent = await ok('/guest/cart', guest, {
    productId: product.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
    note: 'Chưa gửi',
  });
  const support = await ok('/guest/support', guest, { type: 'WATER', content: 'Hai ly nước' });
  await ok('/core/support/' + support.id + '/claim', 'pv001', {});
  const intent = await ok('/core/sessions/' + s.id + '/payments', 'pv001', {
    requestId: randomUUID(),
    method: 'CASH',
    amount: '50000',
  });
  await ok('/core/payments/' + intent.id + '/confirm', 'pv001', {
    amount: '50000',
    receivedAmount: '50000',
  });
  const before = await identities(s.id),
    initial = await ok('/guest/state', guest);
  const moved = await ok(
    transfer(s.id),
    'pv001',
    payload(source.id, target.id, {
      partySize: 4,
      reasonCode: 'MORE_SPACE',
      note: 'Khách muốn rộng hơn',
    }),
  );
  expect(moved.sessionId).toBe(s.id);
  expect(await identities(s.id)).toEqual(before);
  const next = await ok('/guest/state', guest);
  expect(next.session.id).toBe(initial.session.id);
  expect(next.participant.id).toBe(initial.participant.id);
  expect(next.session.table_id).toBe(target.id);
  expect(next.session.table_name).toBe(target.name);
  expect(next.items[0].id).toBe(unsent.id);
  expect(next.cart.cart_version).toBe(initial.cart.cart_version);
  expect(next.account.paid_total).toBe(initial.account.paid_total);
  expect(next.support[0].status).toBe('ACKNOWLEDGED');
  expect(
    (await db.prisma.dining_table.findUniqueOrThrow({ where: { id: source.id } })).table_status,
  ).toBe('NEEDS_CLEANING');
  expect(
    (await db.prisma.dining_table.findUniqueOrThrow({ where: { id: target.id } })).table_status,
  ).toBe('OCCUPIED');
  expect((await req('/core/tables/' + source.id + '/open', 'pv001', {})).statusCode).toBe(409);
  await ok('/core/tables/' + source.id + '/clean', 'pv001', {});
  expect(
    (await db.prisma.dining_table.findUniqueOrThrow({ where: { id: source.id } })).table_status,
  ).toBe('AVAILABLE');
  const removed = await req(
    '/guest/cart/' + unsent.id,
    guest,
    { cartVersion: next.cart.cart_version },
    'DELETE',
  );
  expect(removed.statusCode, removed.body).toBe(200);
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: order.id } });
  for (const action of ['accept', 'prepare', 'ready'])
    await ok('/core/items/' + item.id + '/' + action, 'bep001', {});
  await ok('/core/items/' + item.id + '/serve', 'pv001', {});
  await ok('/core/support/' + support.id + '/resolve', 'pv001', {});
  await completePaymentHandover(app, users.pv001!, headers, s.id);
  await ok('/core/sessions/' + s.id + '/close', 'pv001', {});
  const bill = await ok('/core/sessions/' + s.id + '/bill', 'pv001');
  expect(bill.session.id).toBe(s.id);
  expect(bill.session.table_name).toBe(target.name);
  expect(bill.session.receipt_number).toMatch(/^PT-/);
  await db.pool.query("UPDATE dining_table SET name='Tên sau khi đóng' WHERE id=$1", [target.id]);
  const frozen = await ok('/core/sessions/' + s.id + '/bill', 'pv001');
  expect(frozen.session.table_name).toBe(target.name);
  expect(frozen.session.receipt_number).toBe(bill.session.receipt_number);
  expect(frozen).toEqual(bill);
});
it('rejects occupied, cleaning, inactive, inactive-area, cross-restaurant and same-table destinations without partial writes', async () => {
  const { source, s } = await open(),
    occupied = await table(),
    cleaning = await table(),
    inactive = await table();
  await ok('/core/tables/' + occupied.id + '/open', 'pv002', {});
  await db.pool.query("UPDATE dining_table SET table_status='NEEDS_CLEANING' WHERE id=$1", [
    cleaning.id,
  ]);
  await db.pool.query('UPDATE dining_table SET is_active=false WHERE id=$1', [inactive.id]);
  const area = await db.prisma.dining_area.create({
      data: {
        restaurant_id: restaurantId,
        code: randomUUID(),
        name: 'Khu ngừng hoạt động',
        is_active: false,
      },
    }),
    inactiveArea = await table(4, area.id);
  const other = await db.prisma.restaurant.create({
      data: { name: 'Nhà hàng khác' },
    }),
    otherArea = await db.prisma.dining_area.create({
      data: { restaurant_id: other.id, code: 'X', name: 'X' },
    }),
    foreign = await db.prisma.dining_table.create({
      data: { restaurant_id: other.id, area_id: otherArea.id, code: 'X', name: 'X', capacity: 4 },
    });
  for (const t of [occupied, cleaning, inactive, inactiveArea, foreign]) {
    const r = await req(transfer(s.id), 'pv001', payload(source.id, t.id));
    expect(r.statusCode, r.body).toBe(409);
    await unchanged(s.id, source.id);
  }
  expect((await req(transfer(s.id), 'pv001', payload(source.id, source.id))).statusCode).toBe(400);
  const rows = await ok('/core/tables', 'pv001');
  expect(rows.find((r: { id: string }) => r.id === inactiveArea.id).area_active).toBe(false);
});
it('enforces guest-count bounds and destination capacity with a clear message', async () => {
  const { source, s } = await open(),
    small = await table(2);
  for (const partySize of [0, 31, 1.5, '4', null])
    expect(
      (await req(transfer(s.id), 'pv001', payload(source.id, small.id, { partySize }))).statusCode,
    ).toBe(400);
  const r = await req(transfer(s.id), 'pv001', payload(source.id, small.id, { partySize: 6 }));
  expect(r.statusCode).toBe(409);
  expect(r.body).toContain('không đủ chỗ cho 6 khách');
  await unchanged(s.id, source.id);
});
it('validates coded reasons and OTHER note, stores readable text and supports the existing reason contract', async () => {
  const { source, s } = await open(),
    target = await table(),
    final = await table();
  for (const extra of [
    { reasonCode: 'OTHER', note: '' },
    { reasonCode: 'constructor' },
    { reasonCode: 'UNKNOWN' },
    { reasonCode: 'OTHER', note: 'x'.repeat(401) },
    { reasonCode: 'CUSTOMER_REQUEST', note: {} },
  ])
    expect(
      (await req(transfer(s.id), 'pv001', payload(source.id, target.id, extra))).statusCode,
    ).toBe(400);
  await unchanged(s.id, source.id);
  const moved = await ok(
    transfer(s.id),
    'pv001',
    payload(source.id, target.id, { reasonCode: 'OTHER', note: ' Khách tránh máy lạnh ' }),
  );
  expect(moved.history.reason).toBe('Lý do khác: Khách tránh máy lạnh');
  await ok(transfer(s.id), 'pv002', {
    fromTableId: target.id,
    tableId: final.id,
    partySize: 4,
    reason: 'Lý do từ client cũ',
  });
  const history = await ok('/core/sessions/' + s.id + '/transfers', 'pv001');
  expect(history).toHaveLength(2);
  expect(history[0].from_table_id).toBe(target.id);
  expect(history[1].from_table_id).toBe(source.id);
  expect(history[0].employee_name).toBeTruthy();
  expect(history[0].reason).toBe('Lý do từ client cũ');
});
it('allows exactly one of two staff moving the same session from the same source', async () => {
  const { source, s } = await open(),
    a = await table(),
    b = await table();
  const results = await Promise.all([
    req(transfer(s.id), 'pv001', payload(source.id, a.id)),
    req(transfer(s.id), 'pv002', payload(source.id, b.id)),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.body).toContain(
    'được chuyển bởi nhân viên khác',
  );
  expect(await db.prisma.table_transfer_history.count({ where: { session_id: s.id } })).toBe(1);
  const states = await db.prisma.dining_table.findMany({ where: { id: { in: [a.id, b.id] } } });
  expect(states.map((t) => t.table_status).sort()).toEqual(['AVAILABLE', 'OCCUPIED']);
});
it('allows exactly one of two active sessions moving to the same available table', async () => {
  const a = await open(),
    b = await open(),
    target = await table();
  const results = await Promise.all([
    req(transfer(a.s.id), 'pv001', payload(a.source.id, target.id)),
    req(transfer(b.s.id), 'pv002', payload(b.source.id, target.id)),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.body).toContain('vừa được sử dụng');
  expect(
    await db.prisma.table_session.count({
      where: { table_id: target.id, session_status: 'ACTIVE' },
    }),
  ).toBe(1);
  const losing = results[0].statusCode === 409 ? a : b;
  await unchanged(losing.s.id, losing.source.id);
});
it('rejects a target that gained an active session even if its status data is stale', async () => {
  const { source, s } = await open(),
    target = await table();
  await ok('/core/tables/' + target.id + '/open', 'pv002', {});
  await db.pool.query("UPDATE dining_table SET table_status='AVAILABLE' WHERE id=$1", [target.id]);
  const r = await req(transfer(s.id), 'pv001', payload(source.id, target.id));
  expect(r.statusCode).toBe(409);
  expect(r.body).toContain('vừa được sử dụng');
  await unchanged(s.id, source.id);
});
it('rejects stale source and closed sessions and denies ADMIN/KITCHEN/guest transfer', async () => {
  const { source, s } = await open(),
    target = await table(),
    next = await table();
  for (const user of ['quyettruong05', 'bep001'])
    expect((await req(transfer(s.id), user, payload(source.id, target.id))).statusCode).toBe(403);
  expect((await req(transfer(s.id), '', payload(source.id, target.id))).statusCode).toBe(401);
  await ok(transfer(s.id), 'pv001', payload(source.id, target.id));
  const stale = await req(transfer(s.id), 'pv002', payload(source.id, next.id));
  expect(stale.statusCode).toBe(409);
  expect(stale.body).toContain('được chuyển bởi nhân viên khác');
  expect(await db.prisma.table_transfer_history.count({ where: { session_id: s.id } })).toBe(1);
  await completePaymentHandover(app, users.pv001!, headers, s.id);
  await ok('/core/sessions/' + s.id + '/close', 'pv001', {});
  expect((await req(transfer(s.id), 'pv001', payload(target.id, next.id))).statusCode).toBe(409);
});
it('keeps transfer history immutable at the SQL boundary', async () => {
  const { source, s } = await open(),
    target = await table();
  const moved = await ok(transfer(s.id), 'pv001', payload(source.id, target.id));
  await expect(
    db.pool.query("UPDATE table_transfer_history SET reason='sửa' WHERE id=$1", [moved.history.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('DELETE FROM table_transfer_history WHERE id=$1', [moved.history.id]),
  ).rejects.toMatchObject({ code: '23514' });
});

it('keeps the guest credential valid when state waits behind a concurrent transfer', async () => {
  const { source, s } = await open(),
    target = await table(6);
  const qr = await ok('/core/tables/' + source.id + '/qr', 'quyettruong05', {});
  const joined = await req('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'Khách đang xem menu',
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  expect(joined.statusCode, joined.body).toBe(200);
  const guest = cookie(joined),
    initial = await ok('/guest/state', guest);
  const blocker = await db.pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM table_session WHERE id=$1 FOR UPDATE', [s.id]);
  let move: ReturnType<typeof req> | undefined, state: ReturnType<typeof req> | undefined;
  try {
    move = req(transfer(s.id), 'pv001', payload(source.id, target.id)).then((r) => r);
    const waiting = async () =>
      Number(
        (
          await db.pool.query(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM table_session WHERE id=% FOR UPDATE'",
          )
        ).rows[0].count,
      );
    await expect.poll(waiting, { timeout: 3000, interval: 20 }).toBe(1);
    state = req('/guest/state', guest).then((r) => r);
    await expect.poll(waiting, { timeout: 3000, interval: 20 }).toBe(2);
    await blocker.query('COMMIT');
    const results = await Promise.all([move, state]);
    expect(
      results.map((r) => r.statusCode),
      results.map((r) => r.body).join(' | '),
    ).toEqual([200, 200]);
    const next = results[1]!.json();
    expect(next.session.id).toBe(initial.session.id);
    expect(next.participant.id).toBe(initial.participant.id);
    expect(next.session.table_id).toBe(target.id);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.allSettled([move, state].filter(Boolean));
  }
});
