import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';

let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const name = 'thesis_order_history_' + randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
const cookies: Record<string, string> = {};
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
async function request(url: string, user: string, payload?: unknown) {
  return app.inject({
    url,
    method: payload === undefined ? 'GET' : 'POST',
    headers: { ...headers, cookie: cookies[user] ?? '' },
    payload: payload as Record<string, unknown>,
  });
}
async function ok(url: string, user: string, payload?: unknown) {
  const response = await request(url, user, payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  db = createDatabase(url.toString());
  const migration = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    {
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8',
    },
  );
  if (migration.status !== 0) throw Error(migration.stderr);
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'h'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const username of ['quyettruong05', 'pv001', 'bep001']) {
    const response = await request('/auth/login', '', { username, password });
    expect(response.statusCode, response.body).toBe(200);
    cookies[username] = response.cookies
      .map((cookie) => cookie.name + '=' + cookie.value)
      .join('; ');
  }
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
});
async function fixture() {
  const tag = 'HISTORY-' + randomUUID().slice(0, 8);
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const table = await db.prisma.dining_table.create({
    data: {
      restaurant_id: restaurantId,
      area_id: area.id,
      code: tag,
      name: tag,
      capacity: 4,
    },
  });
  const session = await ok('/core/tables/' + table.id + '/open', 'pv001', {});
  const category = await db.prisma.menu_category.findFirstOrThrow({ where: { is_active: true } });
  const product = await ok('/core/products', 'quyettruong05', {
    code: tag,
    name: 'Món lịch sử ' + tag,
    categoryId: category.id,
    price: '49000',
    stockManaged: false,
    complimentary: false,
  });
  const batch = await ok('/core/sessions/' + session.id + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
  return { tag, session, item, product };
}
it('cancelled lookup retains the session, decision actor and actual partial/full refunds after closing', async () => {
  const { tag, session, item } = await fixture();
  const admin = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } });
  for (const action of ['accept', 'prepare', 'ready'])
    await ok('/core/items/' + item.id + '/' + action, 'bep001', {});
  const exceptionRows = await ok('/core/order-exceptions', 'quyettruong05');
  expect(exceptionRows.find((row: { id: string }) => row.id === item.id)).toMatchObject({
    session_status: 'ACTIVE',
    session_code: session.id.slice(0, 8).toUpperCase(),
  });
  const active = (await ok('/core/history/order-active?q=' + tag, 'quyettruong05')).rows[0];
  expect(active).toMatchObject({
    id: item.id,
    session_status: 'ACTIVE',
    session_code: session.id.slice(0, 8).toUpperCase(),
    refund_history: { scope: 'NONE', cases: [] },
  });
  const intent = await ok('/core/sessions/' + session.id + '/payments', 'pv001', {
    method: 'CASH',
    amount: '49000',
    requestId: randomUUID(),
  });
  const payment = await ok('/core/payments/' + intent.id + '/confirm', 'pv001', {
    amount: '49000',
    receivedAmount: '49000',
  });
  await ok('/core/items/' + item.id + '/late-cancel', 'quyettruong05', {
    reasonCode: 'QUALITY_ISSUE',
    note: 'Món không đạt chất lượng',
  });
  const path = '/core/history/order-cancelled?q=' + tag;
  let row = (await ok(path, 'quyettruong05')).rows[0];
  expect(row).toMatchObject({
    id: item.id,
    has_charge: false,
    session_status: 'ACTIVE',
    session_code: session.id.slice(0, 8).toUpperCase(),
    cancelled_by_name: admin.display_name,
    decision_by_name: admin.display_name,
  });
  expect(row.decision_reason).toContain('Món không đạt chất lượng');
  expect(Number.isFinite(Date.parse(row.cancelled_at))).toBe(true);
  expect(Number.isFinite(Date.parse(row.decision_at))).toBe(true);
  const refund = await ok('/core/sessions/' + session.id + '/refunds', 'quyettruong05', {
    paymentId: payment.id,
    amount: '49000',
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  row = (await ok(path, 'quyettruong05')).rows[0];
  expect(row.refund_history).toMatchObject({
    scope: 'ITEM',
    refunded_amount: '0',
    remaining_amount: '49000',
    cases: [{ id: refund.id, scope: 'ITEM' }],
  });
  await ok('/core/refunds/' + refund.id + '/complete', 'pv001', {
    method: 'CASH',
    amount: '20000',
    requestId: randomUUID(),
  });
  expect((await ok(path, 'quyettruong05')).rows[0].refund_history).toMatchObject({
    refunded_amount: '20000',
    remaining_amount: '29000',
  });
  await ok('/core/refunds/' + refund.id + '/complete', 'pv001', {
    method: 'CASH',
    amount: '29000',
    requestId: randomUUID(),
  });
  const bill = await ok('/core/sessions/' + session.id + '/bill', 'pv001');
  await ok('/core/sessions/' + session.id + '/receipt-provided', 'pv001', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: bill.completion.receiptKey,
  });
  await ok('/core/sessions/' + session.id + '/close', 'pv001', {});
  row = (await ok(path, 'quyettruong05')).rows[0];
  expect(row).toMatchObject({
    session_status: 'CLOSED',
    refund_history: { scope: 'ITEM', refunded_amount: '49000', remaining_amount: '0' },
  });
  expect((await ok('/core/history/order-active?q=' + tag, 'quyettruong05')).total).toBe(0);
  expect((await request(path, 'pv001')).statusCode).toBe(403);
  expect((await request(path, 'bep001')).statusCode).toBe(403);
});
it('unpaid staff cancellation shows its actor and does not borrow a refund from a different session', async () => {
  const { tag, session, item } = await fixture();
  const staff = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } });
  await ok('/core/items/cancel', 'pv001', {
    itemIds: [item.id],
    reasonCode: 'CUSTOMER_CHANGED_MIND',
  });
  const result = await ok('/core/history/order-cancelled?q=' + tag, 'quyettruong05');
  expect(result.total).toBe(1);
  expect(result.rows[0]).toMatchObject({
    id: item.id,
    session_code: session.id.slice(0, 8).toUpperCase(),
    cancelled_by_name: staff.display_name,
    decision_by_name: staff.display_name,
    decision_action: 'CANCEL_ITEM',
    refund_history: { scope: 'NONE', cases: [] },
  });
});
