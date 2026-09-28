import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { maintainCore } from '../apps/api/src/modules/notifications/maintenance.js';
import {
  ingestConnector,
  connectorSignature,
  type ConnectorEvent,
} from '../apps/api/src/modules/payments/webhooks.routes.js';
let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const name = 'thesis_core_test_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const users: Record<string, string> = {};
type Response = Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>;
const cookies = (r: Response) => r.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function request(
  url: string,
  user: string,
  payload?: unknown,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = payload === undefined ? 'GET' : 'POST',
) {
  const r = await app.inject({
    url,
    method,
    headers: { ...headers, cookie: users[user] ?? user },
    payload: payload as Record<string, unknown>,
  });
  return r;
}
async function ok(
  url: string,
  user: string,
  payload?: unknown,
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE',
) {
  const r = await request(url, user, payload, method);
  expect(r.statusCode, url + ' ' + r.body).toBe(200);
  return r.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  db = createDatabase(url.toString());
  await db.pool.query(
    readFileSync('packages/database/prisma/migrations/202609100001_c0_c1/migration.sql', 'utf8'),
  );
  const oldRestaurant = await db.pool.query(
    "INSERT INTO restaurant(name) VALUES('Dữ liệu trước nâng cấp') RETURNING id",
  );
  const oldCategory = await db.pool.query(
    "INSERT INTO menu_category(restaurant_id,code,name) VALUES($1,'OLD','Danh mục cũ') RETURNING id",
    [oldRestaurant.rows[0].id],
  );
  const oldProduct = await db.pool.query(
    "INSERT INTO product(restaurant_id,category_id,code,name,base_price) VALUES($1,$2,'OLD','Món cũ',55000) RETURNING id",
    [oldRestaurant.rows[0].id, oldCategory.rows[0].id],
  );
  const baseline = spawnSync(
    'pnpm',
    [
      '--filter',
      '@thesis/database',
      'exec',
      'prisma',
      'migrate',
      'resolve',
      '--applied',
      '202609100001_c0_c1',
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  if (baseline.status !== 0) throw new Error('Baseline migration registration failed');
  const result = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('Isolated CORE migration failed: ' + result.stderr);
  expect(
    (await db.prisma.product.findUnique({ where: { id: oldProduct.rows[0].id } }))?.base_price,
  ).toBe(55000n);
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'b'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
  });
  registerModules(app, db, restaurantId);
  app.addHook('onError', async (_r, _reply, error) => {
    if (!error.statusCode || error.statusCode >= 500)
      console.error('CORE test error:', error.message);
  });
  for (const user of ['quyettruong05', 'pv001', 'bep001'])
    users[user] = cookies(await request('/auth/login', '', { username: user, password }));
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
});
it('executes a reviewed guest order, stock consumption, split payment, snapshot and close without duplicates', async () => {
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'",
      )
    ).rows[0].n,
  ).toBe(55);
  const unit = await ok('/core/units', 'quyettruong05', {
    code: 'CORE-KG',
    name: 'Kilogram',
    dimension: 'MASS',
  });
  const ingredient = await ok('/core/ingredients', 'quyettruong05', {
    code: 'CORE-RICE',
    name: 'Gạo',
    unitId: unit.id,
  });
  const location = await ok('/core/locations', 'quyettruong05', {
    code: 'CORE-KITCHEN',
    name: 'Kho bếp',
  });
  const catalog = await ok('/core/catalog', 'quyettruong05');
  const product = catalog.products[0];
  await ok('/core/products/' + product.id + '/bom', 'quyettruong05', {
    lines: [{ ingredientId: ingredient.id, quantity: '0.2' }],
  });
  const receipt = await ok('/core/receipts', 'quyettruong05', {
    locationId: location.id,
    number: 'CORE-001',
    lines: [{ ingredientId: ingredient.id, quantity: '10', unitCost: '20000' }],
  });
  await ok('/core/receipts/' + receipt.id + '/approve', 'quyettruong05', {});
  await ok('/core/receipts/' + receipt.id + '/approve', 'quyettruong05', {});
  const tables = await ok('/core/admin/tables', 'quyettruong05');
  const table = tables[0];
  const qr = await ok('/core/tables/' + table.id + '/qr', 'quyettruong05', {});
  const join = await request('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'Khách thử',
  });
  expect(join.statusCode, join.body).toBe(200);
  users.guest = cookies(join);
  const sid = join.json().sessionId;
  const state = await ok('/guest/state', 'guest');
  const item = await ok('/guest/cart', 'guest', {
    productId: product.id,
    quantity: 2,
    cartVersion: state.cart.cart_version,
  });
  const current = await ok('/guest/state', 'guest');
  const body = {
    requestId: randomUUID(),
    cartVersion: current.cart.cart_version,
    itemIds: [item.id],
  };
  const submitted = await Promise.all([
    request('/guest/orders', 'guest', body),
    request('/guest/orders', 'guest', body),
  ]);
  for (const r of submitted) expect(r.statusCode, r.body).toBe(200);
  const batch = submitted[0]!.json();
  expect(submitted[1]!.json().id).toBe(batch.id);
  expect(batch.status).toBe('PENDING_REVIEW');
  expect((await ok('/core/kitchen', 'bep001')).length).toBe(0);
  expect(
    (await request('/core/orders/' + batch.id + '/review', 'bep001', { approve: true })).statusCode,
  ).toBe(403);
  await ok('/core/orders/' + batch.id + '/review', 'pv001', { approve: true });
  // Approving food is separate from verifying the table.
  await ok('/core/sessions/' + sid + '/verify', 'pv001', {});
  const nextState = await ok('/guest/state', 'guest');
  const nextItem = await ok('/guest/cart', 'guest', {
    productId: product.id,
    quantity: 1,
    cartVersion: nextState.cart.cart_version,
  });
  await db.pool.query(
    "UPDATE order_batch SET created_at=now()-interval '10 seconds' WHERE session_id=$1",
    [sid],
  );
  const nextStateAfterCart = await ok('/guest/state', 'guest');
  const nextBatch = await ok('/guest/orders', 'guest', {
    requestId: randomUUID(),
    cartVersion: nextStateAfterCart.cart.cart_version,
    itemIds: [nextItem.id],
  });
  expect(nextBatch.status).toBe('SUBMITTED');
  expect(
    (await ok('/core/kitchen', 'bep001')).some((o: { id: string }) => o.id === nextBatch.id),
  ).toBe(true);
  await ok('/core/orders/' + nextBatch.id + '/cancel', 'pv001', {
    reason: 'Hủy lượt kiểm thử sau khi xác nhận luồng tự động gửi bếp',
  });
  const orderItem = (
    await db.pool.query('SELECT * FROM order_item WHERE order_batch_id=$1', [batch.id])
  ).rows[0];
  await ok(
    '/core/products/' + product.id,
    'quyettruong05',
    {
      name: 'Tên mới',
      price: '99999',
      active: true,
      availability: 'AVAILABLE',
      version: product.version,
    },
    'PATCH',
  );
  expect(
    (await db.pool.query('SELECT unit_price_snapshot FROM order_item WHERE id=$1', [orderItem.id]))
      .rows[0].unit_price_snapshot,
  ).toBe(product.base_price);
  await ok('/core/orders/' + batch.id + '/accept', 'bep001', {});
  await ok('/core/items/' + orderItem.id + '/prepare', 'bep001', {});
  expect((await request('/core/items/' + orderItem.id + '/prepare', 'bep001', {})).statusCode).toBe(
    409,
  );
  await ok('/core/items/' + orderItem.id + '/ready', 'bep001', {});
  await ok('/core/items/' + orderItem.id + '/serve', 'pv001', {});
  const balance = (
    await db.pool.query('SELECT * FROM inventory_balance WHERE ingredient_id=$1', [ingredient.id])
  ).rows[0];
  expect(balance.on_hand_qty).toBe('9.600000');
  expect(balance.reserved_qty).toBe('0.000000');
  const total = BigInt(product.base_price) * 2n,
    first = total / 2n;
  for (const amount of [first, total - first]) {
    const pi = await ok('/guest/payments', 'guest', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: amount.toString(),
    });
    const confirmed = await Promise.all([
      request('/core/payments/' + pi.id + '/confirm', 'pv001', { amount: amount.toString() }),
      request('/core/payments/' + pi.id + '/confirm', 'pv001', { amount: amount.toString() }),
    ]);
    for (const r of confirmed) expect(r.statusCode, r.body).toBe(200);
    expect(confirmed[0]!.json().id).toBe(confirmed[1]!.json().id);
  }
  const bill = await ok('/core/sessions/' + sid + '/bill', 'pv001');
  expect(bill.account.outstanding_amount).toBe('0');
  expect(bill.payments.length).toBe(2);
  await ok('/core/sessions/' + sid + '/close', 'pv001', {});
  await ok('/core/tables/' + table.id + '/clean', 'pv001', {});
  expect((await request('/guest/state', 'guest')).statusCode).not.toBe(200);
}, 30000);

async function openTable() {
  const area = (await ok('/core/areas', 'quyettruong05'))[0];
  const t = await ok('/core/tables', 'quyettruong05', {
    code: randomUUID(),
    name: 'Bàn kiểm thử',
    areaId: area.id,
    capacity: 4,
  });
  const qr = await ok('/core/tables/' + t.id + '/qr', 'quyettruong05', {});
  const joined = await request('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'Khách',
  });
  expect(joined.statusCode, joined.body).toBe(200);
  return {
    sid: joined.json().sessionId as string,
    participant: joined.json().participantId as string,
    cookie: cookies(joined),
    table: t.id,
    token: qr.joinPath.split('#')[1] as string,
  };
}
async function staffOrder(sid: string, quantity = 1) {
  const product = (await ok('/core/catalog', 'quyettruong05')).products.find(
    (p: { name: string }) => p.name === 'Tên mới',
  );
  return ok('/core/sessions/' + sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: product.id, quantity }],
  });
}
it('cancels a paid unprepared order and refunds once with a reconciled zero balance', async () => {
  const t = await openTable(),
    b = await staffOrder(t.sid);
  const pi = await ok('/core/sessions/' + t.sid + '/payments', 'pv001', {
    requestId: randomUUID(),
    amount: b.total_amount,
    method: 'BANK_TRANSFER',
  });
  const pay = await ok('/core/payments/' + pi.id + '/confirm', 'pv001', {
    amount: b.total_amount,
    reference: 'TEST-BANK-001',
  });
  await ok('/core/orders/' + b.id + '/cancel', 'pv001', {
    reason: 'Khách đổi ý trước khi bếp làm',
  });
  const bill = await ok('/core/sessions/' + t.sid + '/bill', 'pv001');
  expect(bill.account.refund_due_amount).toBe(b.total_amount);
  expect((await request('/core/sessions/' + t.sid + '/close', 'pv001', {})).statusCode).toBe(409);
  const f = await ok('/core/sessions/' + t.sid + '/refunds', 'pv001', {
    paymentId: pay.id,
    amount: b.total_amount,
    reason: 'Hoàn món hủy',
  });
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', {
    method: 'BANK_TRANSFER',
    reference: 'TEST-REFUND-001',
  });
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', {
    method: 'BANK_TRANSFER',
    reference: 'TEST-REFUND-001',
  });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM refund_transaction WHERE refund_case_id=$1',
        [f.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect((await request('/core/sessions/' + t.sid + '/close', 'pv001', {})).statusCode).toBe(409);
  const alerts = (await ok('/core/alerts', 'pv001')).filter(
    (a: { session_id: string }) => a.session_id === t.sid,
  );
  for (const alert of alerts) {
    await ok('/core/alerts/' + alert.id + '/acknowledge', 'pv001', {});
    await ok('/core/alerts/' + alert.id + '/resolve', 'pv001', {
      reason: 'Đã đối chiếu và hoàn đủ tiền',
    });
  }
  await ok('/core/sessions/' + t.sid + '/close', 'pv001', {});
});
it('expires reviews and payments, releases stock and publishes the committed outbox', async () => {
  const t = await openTable(),
    state = await ok('/guest/state', t.cookie);
  const product = state.products.find((p: { name: string }) => p.name === 'Tên mới');
  const item = await ok('/guest/cart', t.cookie, {
    productId: product.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  const b = await ok('/guest/orders', t.cookie, {
    requestId: randomUUID(),
    cartVersion: state.cart.cart_version + 1,
    itemIds: [item.id],
  });
  await db.pool.query(
    "UPDATE order_review SET requested_at=now()-interval '20 minutes',expires_at=now()-interval '1 second' WHERE order_batch_id=$1",
    [b.id],
  );
  await maintainCore(db, restaurantId);
  expect(
    (await db.pool.query('SELECT status FROM order_review WHERE order_batch_id=$1', [b.id])).rows[0]
      .status,
  ).toBe('EXPIRED');
  expect(
    (
      await db.pool.query(
        'SELECT r.status FROM inventory_reservation r JOIN order_item i ON i.id=r.order_item_id WHERE i.order_batch_id=$1',
        [b.id],
      )
    ).rows.every((r) => r.status === 'RELEASED'),
  ).toBe(true);
  const normal = await staffOrder(t.sid);
  const pi = await ok('/guest/payments', t.cookie, {
    requestId: randomUUID(),
    method: 'CASH',
    amount: normal.total_amount,
  });
  await db.pool.query(
    "UPDATE payment_intent SET created_at=now()-interval '20 minutes',expires_at=now()-interval '1 second' WHERE id=$1",
    [pi.id],
  );
  await maintainCore(db, restaurantId);
  expect(
    (
      await request('/core/payments/' + pi.id + '/confirm', 'pv001', {
        amount: normal.total_amount,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await db.pool.query(
        'SELECT reserved_payment_amount FROM session_financial_account WHERE session_id=$1',
        [t.sid],
      )
    ).rows[0].reserved_payment_amount,
  ).toBe('0');
  expect(
    (await db.pool.query("SELECT count(*)::int AS n FROM outbox_event WHERE status='PENDING'"))
      .rows[0].n,
  ).toBe(0);
});
it('enforces guest ownership and version conflicts, stock rollback, revoked QR and support claiming', async () => {
  const a = await openTable(),
    other = await openTable();
  const state = await ok('/guest/state', a.cookie),
    product = state.products.find((p: { name: string }) => p.name === 'Tên mới');
  const i = await ok('/guest/cart', a.cookie, {
    productId: product.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  expect(
    (
      await request('/guest/cart', a.cookie, {
        productId: product.id,
        quantity: 1,
        cartVersion: state.cart.cart_version,
      })
    ).statusCode,
  ).toBe(409);
  const o = await ok('/guest/state', other.cookie);
  expect(
    (
      await request('/guest/orders', other.cookie, {
        requestId: randomUUID(),
        cartVersion: o.cart.cart_version,
        itemIds: [i.id],
      })
    ).statusCode,
  ).toBe(403);
  const before = await db.prisma.order_batch.count();
  const huge = await request('/core/sessions/' + a.sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: product.id, quantity: 100 }],
  });
  expect(huge.statusCode).not.toBe(200);
  expect(await db.prisma.order_batch.count()).toBe(before);
  await ok('/core/tables/' + a.table + '/qr', 'quyettruong05', {});
  expect((await request('/guest/join', '', { token: a.token, name: 'QR cũ' })).statusCode).not.toBe(
    200,
  );
  const support = await ok('/guest/support', a.cookie, { type: 'WATER' });
  const claims = await Promise.all([
    request('/core/support/' + support.id + '/claim', 'pv001', {}),
    request('/core/support/' + support.id + '/claim', 'pv001', {}),
  ]);
  expect(claims.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  await ok('/core/support/' + support.id + '/resolve', 'pv001', {
    reason: 'Đã đối chiếu và xử lý xong',
  });
  const cart = (await db.prisma.session_cart.findUnique({ where: { session_id: a.sid } }))!;
  await expect(
    db.pool.query(
      'INSERT INTO cart_item(cart_id,owner_participant_id,product_id,quantity,unit_price_preview) VALUES($1,$2,$3,1,1)',
      [cart.id, other.participant, product.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('versions policies and staff roles while never exposing password hashes', async () => {
  await ok('/core/risk', 'quyettruong05', { LINE_QTY_REVIEW: 4 });
  const risk = await ok('/core/risk', 'quyettruong05');
  expect(
    risk.policies.find((r: { config_key: string }) => r.config_key === 'LINE_QTY_REVIEW')
      .value_json,
  ).toBe(4);
  expect(
    (
      await request('/core/risk', 'quyettruong05', {
        LINE_QTY_REVIEW: 100,
        LINE_QTY_HARD_LIMIT: 20,
      })
    ).statusCode,
  ).toBe(400);
  const user = await ok('/core/users', 'quyettruong05', {
    username: 'core.employee',
    name: 'Nhân viên mới',
    password,
    role: 'STAFF',
  });
  expect(user.password_hash).toBeUndefined();
  await ok(
    '/core/users/' + user.id,
    'quyettruong05',
    { name: 'Bếp mới', role: 'KITCHEN', reason: 'Kiểm thử chuyển vai trò', status: 'ACTIVE' },
    'PATCH',
  );
  expect((await db.prisma.user_role.findMany({ where: { user_id: user.id } })).length).toBe(2);
  const list = await ok('/core/users', 'quyettruong05');
  expect(JSON.stringify(list)).not.toContain('password_hash');
  expect((await request('/core/users', 'bep001')).statusCode).toBe(403);
});
it('verifies connector signatures, deduplicates webhook events and retains late money for reconciliation', async () => {
  const t = await openTable(),
    b = await staffOrder(t.sid),
    secret = randomBytes(32).toString('hex');
  const pi = (
    await db.pool.query(
      "INSERT INTO payment_intent(session_id,method,amount,provider,client_request_id,expires_at) VALUES($1,'ONLINE',$2,'TEST_CONNECTOR',$3,now()+interval '10 minutes') RETURNING id",
      [t.sid, b.total_amount, randomUUID()],
    )
  ).rows[0];
  const event: ConnectorEvent = {
    eventId: randomUUID(),
    transactionId: randomUUID(),
    intentId: pi.id,
    amount: b.total_amount,
    currency: 'VND',
    timestamp: Date.now(),
  };
  await expect(
    ingestConnector(db, restaurantId, 'TEST_CONNECTOR', secret, event, '0'.repeat(64)),
  ).rejects.toMatchObject({ statusCode: 401 });
  const signed = () =>
    ingestConnector(
      db,
      restaurantId,
      'TEST_CONNECTOR',
      secret,
      event,
      connectorSignature(event, secret),
    );
  expect(await signed()).toEqual({ status: 'PROCESSED' });
  expect(await signed()).toEqual({ status: 'PROCESSED' });
  const retry = { ...event, timestamp: Date.now() + 1 };
  expect(
    await ingestConnector(
      db,
      restaurantId,
      'TEST_CONNECTOR',
      secret,
      retry,
      connectorSignature(retry, secret),
    ),
  ).toEqual({ status: 'PROCESSED' });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM payment_transaction WHERE payment_intent_id=$1',
        [pi.id],
      )
    ).rows[0].n,
  ).toBe(1);
  const wrong = { ...event, eventId: randomUUID(), amount: '1' };
  expect(
    await ingestConnector(
      db,
      restaurantId,
      'TEST_CONNECTOR',
      secret,
      wrong,
      connectorSignature(wrong, secret),
    ),
  ).toEqual({ status: 'REJECTED' });
  const missing = { ...event, eventId: randomUUID(), intentId: randomUUID() };
  expect(
    await ingestConnector(
      db,
      restaurantId,
      'TEST_CONNECTOR',
      secret,
      missing,
      connectorSignature(missing, secret),
    ),
  ).toEqual({ status: 'UNMATCHED' });
  const second = (
    await db.pool.query(
      "INSERT INTO payment_intent(session_id,method,amount,provider,client_request_id,created_at,expires_at,status) VALUES($1,'ONLINE',$2,'TEST_CONNECTOR',$3,now()-interval '30 minutes',now()-interval '10 minutes','EXPIRED') RETURNING id",
      [t.sid, b.total_amount, randomUUID()],
    )
  ).rows[0];
  const late = {
    ...event,
    eventId: randomUUID(),
    transactionId: randomUUID(),
    intentId: second.id,
  };
  await ingestConnector(
    db,
    restaurantId,
    'TEST_CONNECTOR',
    secret,
    late,
    connectorSignature(late, secret),
  );
  const bill = await ok('/core/sessions/' + t.sid + '/bill', 'pv001');
  expect(bill.account.refund_due_amount).toBe(b.total_amount);
  expect((await db.prisma.payment_intent.findUnique({ where: { id: second.id } }))?.status).toBe(
    'REQUIRES_RECONCILIATION',
  );
  expect((await request('/payments/webhooks/connector', '', {})).statusCode).toBe(503);
});
it('preserves ledger snapshots and guards allocation totals at the database boundary', async () => {
  const item = await db.prisma.order_item.findFirst();
  await expect(
    db.pool.query('UPDATE order_item SET unit_price_snapshot=1,line_total=quantity WHERE id=$1', [
      item!.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  const allocation = await db.prisma.payment_allocation.findFirst();
  await expect(
    db.pool.query('UPDATE payment_allocation SET allocated_amount=allocated_amount+1 WHERE id=$1', [
      allocation!.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('DELETE FROM order_item WHERE id=$1', [item!.id]),
  ).rejects.toMatchObject({ code: '23514' });
});

it('restricts debt write-off to admin and only after the kitchen has finished', async () => {
  const t = await openTable(),
    b = await staffOrder(t.sid);
  const debt = await ok('/core/sessions/' + t.sid + '/outstanding', 'pv001', {
    reason: 'LEFT_WITHOUT_PAYING',
    notes: 'Khách rời đi chưa trả tiền',
  });
  expect(
    (
      await request('/core/outstanding/' + debt.id + '/write-off', 'pv001', {
        reason: 'Không thu được',
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request('/core/outstanding/' + debt.id + '/write-off', 'quyettruong05', {
        reason: 'Không thu được',
      })
    ).statusCode,
  ).toBe(409);
  await ok('/core/orders/' + b.id + '/accept', 'bep001', {});
  const item = (await db.prisma.order_item.findFirst({ where: { order_batch_id: b.id } }))!;
  for (const action of ['prepare', 'ready'])
    await ok('/core/items/' + item.id + '/' + action, 'bep001', {});
  await ok('/core/items/' + item.id + '/serve', 'pv001', {});
  await ok('/core/outstanding/' + debt.id + '/write-off', 'quyettruong05', {
    reason: 'Đã kiểm tra, ghi nhận tổn thất',
  });
  expect((await db.prisma.table_session.findUnique({ where: { id: t.sid } }))?.session_status).toBe(
    'CLOSED',
  );
  const alert = (await db.prisma.operational_alert.findFirst({ where: { session_id: t.sid } }))!;
  await ok('/core/alerts/' + alert.id + '/acknowledge', 'pv001', {});
  await ok('/core/alerts/' + alert.id + '/resolve', 'pv001', {
    reason: 'Đã đối chiếu và xử lý xong',
  });
});
it('lets guests withdraw their own pending batch and closes only truly idle empty sessions', async () => {
  const t = await openTable(),
    state = await ok('/guest/state', t.cookie),
    product = state.products.find((p: { name: string }) => p.name === 'Tên mới');
  const item = await ok('/guest/cart', t.cookie, {
    productId: product.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  const b = await ok('/guest/orders', t.cookie, {
    requestId: randomUUID(),
    cartVersion: state.cart.cart_version + 1,
    itemIds: [item.id],
  });
  await ok('/guest/orders/' + b.id + '/cancel', t.cookie, { reason: 'Đổi ý trước khi bếp nhận' });
  expect(
    (await db.prisma.order_review.findFirst({ where: { order_batch_id: b.id } }))?.status,
  ).toBe('CANCELLED');
  const idle = await openTable();
  await db.pool.query(
    "UPDATE table_session SET opened_at=now()-interval '20 minutes' WHERE id=$1",
    [idle.sid],
  );
  await db.pool.query(
    "UPDATE session_participant SET joined_at=now()-interval '20 minutes',last_seen_at=now()-interval '20 minutes' WHERE session_id=$1",
    [idle.sid],
  );
  await maintainCore(db, restaurantId);
  expect(
    (await db.prisma.table_session.findUnique({ where: { id: idle.sid } }))?.session_status,
  ).toBe('CANCELLED');
  expect((await db.prisma.table_session.findUnique({ where: { id: t.sid } }))?.session_status).toBe(
    'ACTIVE',
  );
});

it('allows distinct employee IDs with the same name and revokes a disabled account', async () => {
  const employee = await ok('/core/users', 'quyettruong05', {
    username: 'regression.staff',
    name: 'Nguyễn Minh Anh',
    role: 'STAFF',
    password,
  });
  const login = await request('/auth/login', '', { username: 'regression.staff', password });
  expect(login.statusCode).toBe(200);
  users.disabledRegression = cookies(login);
  const update = await request(
    '/core/users/' + employee.id,
    'quyettruong05',
    {
      name: 'Nguyễn Minh Anh',
      role: 'STAFF',
      status: 'INACTIVE',
      reason: 'Khóa tài khoản kiểm thử',
    },
    'PATCH',
  );
  expect(update.statusCode, update.body).toBe(200);
  const blocked = await request('/workspaces/staff', 'disabledRegression');
  expect(blocked.statusCode).toBe(403);
  expect(blocked.json().errorCode).toBe('ACCOUNT_LOCKED');
});

it('rejects expired or inactive-area QR while allowing an existing table session to finish', async () => {
  const t = await openTable();
  await db.pool.query(
    "UPDATE table_qr_token SET issued_at=now()-interval '1 day',expires_at=now()-interval '1 second' WHERE table_id=$1 AND status='ACTIVE'",
    [t.table],
  );
  expect((await ok('/core/tables/' + t.table + '/qr', 'quyettruong05')).available).toBe(false);
  expect((await request('/guest/join', '', { token: t.token, name: 'Khách mới' })).statusCode).toBe(
    404,
  );
  const qr = await ok('/core/tables/' + t.table + '/qr', 'quyettruong05', {});
  const table = await db.prisma.dining_table.findUniqueOrThrow({ where: { id: t.table } });
  await db.pool.query('UPDATE dining_area SET is_active=false WHERE id=$1', [table.area_id]);
  try {
    expect((await ok('/core/tables/' + t.table + '/qr', 'quyettruong05')).available).toBe(false);
    expect((await request('/core/tables/' + t.table + '/qr', 'quyettruong05', {})).statusCode).toBe(
      404,
    );
    expect(
      (await request('/guest/join', '', { token: qr.joinPath.split('#')[1], name: 'Khách mới' }))
        .statusCode,
    ).toBe(404);
    expect((await ok('/guest/state', t.cookie)).session.id).toBe(t.sid);
    expect(
      (await ok('/core/tables', 'pv001')).some((row: { id: string }) => row.id === t.table),
    ).toBe(true);
  } finally {
    await db.pool.query('UPDATE dining_area SET is_active=true WHERE id=$1', [table.area_id]);
  }
});

it('keeps hidden categories consistent across menu, cart edits and order submission', async () => {
  const t = await openTable();
  const state = await ok('/guest/state', t.cookie);
  const product = state.products[0];
  const item = await ok('/guest/cart', t.cookie, {
    productId: product.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  await db.pool.query('UPDATE menu_category SET is_active=false WHERE id=$1', [
    product.category_id,
  ]);
  try {
    const hidden = await ok('/guest/state', t.cookie);
    expect(hidden.products.some((p: { id: string }) => p.id === product.id)).toBe(false);
    expect(
      (
        await request(
          '/guest/cart/' + item.id,
          t.cookie,
          { quantity: 2, cartVersion: hidden.cart.cart_version },
          'PATCH',
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request('/guest/orders', t.cookie, {
          requestId: randomUUID(),
          cartVersion: hidden.cart.cart_version,
          itemIds: [item.id],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await ok('/guest/state', t.cookie)).items.find((i: { id: string }) => i.id === item.id)
        .quantity,
    ).toBe(1);
  } finally {
    await db.pool.query('UPDATE menu_category SET is_active=true WHERE id=$1', [
      product.category_id,
    ]);
  }
});

it('can reserve one serving of every seeded dish without adding ingredients or recipes manually', async () => {
  const t = await openTable();
  const products = (await ok('/core/catalog', 'quyettruong05')).products;
  expect(products).toHaveLength(24);
  const before = await db.pool.query(
    'SELECT id,on_hand_qty,reserved_qty FROM inventory_balance ORDER BY id',
  );
  const batch = await ok('/core/sessions/' + t.sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: products.map((p: { id: string }) => ({ productId: p.id, quantity: 1 })),
  });
  expect(await db.prisma.order_item.count({ where: { order_batch_id: batch.id } })).toBe(24);
  expect(
    await db.prisma.inventory_reservation.count({
      where: { order_item: { order_batch_id: batch.id } },
    }),
  ).toBeGreaterThanOrEqual(24);
  await ok('/core/orders/' + batch.id + '/cancel', 'pv001', {
    reason: 'Hoàn tất kiểm tra toàn bộ thực đơn mẫu',
  });
  expect(
    (await db.pool.query('SELECT id,on_hand_qty,reserved_qty FROM inventory_balance ORDER BY id'))
      .rows,
  ).toEqual(before.rows);
});

it('UAT v2: item ownership, partial cancellation, individual acceptance and atomic same-session serving', async () => {
  const area = await ok('/core/areas', 'quyettruong05', {
    code: 'V2-ITEMS',
    name: 'Khu kiểm thử v2',
  });
  const table = await ok('/core/tables', 'quyettruong05', {
    areaId: area.id,
    code: 'V2-ITEMS',
    name: 'Bàn v2',
    capacity: 4,
  });
  const qr = await ok('/core/tables/' + table.id + '/qr', 'quyettruong05', {});
  const joined = await request('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'Khách v2',
  });
  expect(joined.statusCode).toBe(200);
  const cookie = cookies(joined),
    sid = joined.json().sessionId;
  const products = (await ok('/guest/state', cookie)).products.filter(
    (p: { availability_status: string }) => p.availability_status === 'AVAILABLE',
  );
  expect(products.length).toBeGreaterThan(0);
  const ids = [];
  for (let n = 0; n < 3; n++) {
    const state = await ok('/guest/state', cookie);
    ids.push(
      (
        await ok('/guest/cart', cookie, {
          productId: products[0].id,
          quantity: 1,
          note: 'Riêng ' + n,
          cartVersion: state.cart.cart_version,
        })
      ).id,
    );
  }
  const state = await ok('/guest/state', cookie);
  const batch = await ok('/guest/orders', cookie, {
    requestId: randomUUID(),
    itemIds: ids,
    cartVersion: state.cart.cart_version,
  });
  if (batch.status === 'PENDING_REVIEW')
    await ok('/core/orders/' + batch.id + '/review', 'pv001', { approve: true });
  const rows = (
    await db.pool.query('SELECT id FROM order_item WHERE order_batch_id=$1 ORDER BY id', [batch.id])
  ).rows;
  await ok('/core/items/' + rows[0].id + '/accept', 'bep001', {});
  const partial = await ok('/guest/items/cancel', cookie, { itemIds: [rows[0].id, rows[1].id] });
  expect(partial.cancelled).toEqual([rows[1].id]);
  expect(partial.skipped).toEqual([rows[0].id]);
  const retry = await ok('/guest/items/cancel', cookie, { itemIds: [rows[1].id] });
  expect(retry.cancelled).toEqual([]);
  expect(retry.alreadyCancelled).toEqual([rows[1].id]);
  await ok('/core/orders/' + batch.id + '/accept', 'bep001', {});
  for (const i of [rows[0], rows[2]]) {
    await ok('/core/items/' + i.id + '/prepare', 'bep001', {});
    expect(
      (
        await request('/core/items/cancel', 'pv001', {
          itemIds: [i.id],
          reason: 'Không được hủy như món chưa nấu',
        })
      ).statusCode,
    ).toBe(409);
    await ok('/core/items/' + i.id + '/ready', 'bep001', {});
  }
  expect(
    (await request('/core/sessions/' + sid + '/serve-items', 'bep001', { itemIds: [rows[0].id] }))
      .statusCode,
  ).toBe(403);
  const other = await ok('/core/tables', 'quyettruong05', {
    areaId: area.id,
    code: 'V2-OTHER',
    name: 'Bàn khác',
    capacity: 4,
  });
  const opened = await ok('/core/tables/' + other.id + '/open', 'pv001', {});
  const otherSid = opened.id;
  expect(
    (
      await request('/core/sessions/' + otherSid + '/serve-items', 'pv001', {
        itemIds: [rows[0].id],
      })
    ).statusCode,
  ).toBe(400);
  const results = await Promise.all(
    [1, 2].map(() =>
      request('/core/sessions/' + sid + '/serve-items', 'pv001', {
        itemIds: [rows[0].id, rows[2].id],
      }),
    ),
  );
  expect(results.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  const served = (await db.pool.query('SELECT * FROM order_item WHERE id=$1', [rows[0].id]))
    .rows[0];
  expect(served.received_at).toBeTruthy();
  expect(served.preparation_started_at).toBeTruthy();
  expect(served.ready_at).toBeTruthy();
  expect(served.served_at).toBeTruthy();
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM order_status_history WHERE order_item_id=$1 AND new_status='SERVED'",
        [rows[0].id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM financial_charge WHERE order_item_id=$1 AND status='ACTIVE'",
        [rows[1].id],
      )
    ).rows[0].n,
  ).toBe(0);
});

it('UAT v2: unmanaged menu, late cancellation retains stock and money, explicit waiver and partial refund', async () => {
  const catalog = await ok('/core/catalog', 'quyettruong05');
  expect(
    (
      await request('/core/products', 'quyettruong05', {
        categoryId: catalog.categories[0].id,
        code: 'V2-ZERO-BAD',
        name: 'Giá không hợp lệ',
        price: '0',
      })
    ).statusCode,
  ).toBe(400);
  const product = await ok('/core/products', 'quyettruong05', {
    categoryId: catalog.categories[0].id,
    code: 'V2-UNMANAGED',
    name: 'Dịch vụ không quản lý nguyên liệu',
    price: '100000',
    stockManaged: false,
  });
  const t = await openTable();
  const order = await ok('/core/sessions/' + t.sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const item = (await db.pool.query('SELECT * FROM order_item WHERE order_batch_id=$1', [order.id]))
    .rows[0];
  await ok('/core/items/' + item.id + '/accept', 'bep001', {});
  await ok('/core/items/' + item.id + '/prepare', 'bep001', {});
  const intent = await ok('/core/sessions/' + t.sid + '/payments', 'pv001', {
    requestId: randomUUID(),
    method: 'CASH',
    amount: '100000',
  });
  const pay = await ok('/core/payments/' + intent.id + '/confirm', 'pv001', { amount: '100000' });
  expect(
    (
      await request('/core/items/' + item.id + '/late-cancel', 'pv001', {
        reason: 'Không được vượt quyền',
      })
    ).statusCode,
  ).toBe(403);
  await ok('/core/items/' + item.id + '/late-cancel', 'quyettruong05', {
    reason: 'Khách không sử dụng sau khi thực hiện',
  });
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.charge_total).toBe(
    '100000',
  );
  await ok('/core/items/' + item.id + '/waive', 'quyettruong05', {
    reason: 'Quản trị đồng ý miễn riêng khoản thu',
  });
  const f = await ok('/core/sessions/' + t.sid + '/refunds', 'pv001', {
    paymentId: pay.id,
    amount: '100000',
    reason: 'Miễn khoản thu',
  });
  const key = randomUUID();
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', {
    requestId: key,
    amount: '40000',
    method: 'CASH',
  });
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', {
    requestId: key,
    amount: '40000',
    method: 'CASH',
  });
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.refund_due_amount).toBe(
    '60000',
  );
  expect(
    (
      await request('/core/refunds/' + f.id + '/complete', 'pv001', {
        requestId: randomUUID(),
        amount: '70000',
        method: 'CASH',
      })
    ).statusCode,
  ).toBe(409);
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', {
    requestId: randomUUID(),
    amount: '60000',
    method: 'CASH',
  });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM refund_transaction WHERE refund_case_id=$1',
        [f.id],
      )
    ).rows[0].n,
  ).toBe(2);
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.refund_due_amount).toBe(
    '0',
  );
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).refundTransactions).toHaveLength(
    2,
  );
  const free = await ok('/core/products', 'quyettruong05', {
    categoryId: catalog.categories[0].id,
    code: 'V2-GIFT',
    name: 'Món tặng',
    price: '0',
    stockManaged: false,
    complimentary: true,
  });
  const gift = await ok('/core/sessions/' + t.sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: free.id, quantity: 1 }],
  });
  expect(gift.total_amount).toBe('0');
});

it('hands support over only by its owner, validates service permission and records the handover', async () => {
  const t = await openTable();
  const g = t.cookie;
  const support = await ok('/guest/support', g, { type: 'OTHER', content: 'Cần bàn giao hỗ trợ' });
  await ok('/core/support/' + support.id + '/claim', 'pv001', {});
  const target = (await ok('/core/support-assignees', 'pv001')).find(
    (x: { username: string }) => x.username === 'pv002',
  );
  expect(target).toBeTruthy();
  expect(
    (await request('/core/support/' + support.id + '/reassign', 'pv001', { userId: target.id }))
      .statusCode,
  ).toBe(400);
  await ok('/core/support/' + support.id + '/reassign', 'pv001', {
    userId: target.id,
    reason: 'Kết thúc ca, bàn giao đồng nghiệp',
  });
  expect((await request('/core/support/' + support.id + '/resolve', 'pv001', {})).statusCode).toBe(
    403,
  );
  users.pv002 = cookies(await request('/auth/login', '', { username: 'pv002', password }));
  await ok('/core/support/' + support.id + '/resolve', 'pv002', {});
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM business_audit_event WHERE resource_id=$1 AND action='SUPPORT_REASSIGN'",
        [support.id],
      )
    ).rows[0].n,
  ).toBe(1);
});

it('edits draft stock receipts with version guards and cancels without posting stock', async () => {
  const inv = await ok('/core/inventory', 'quyettruong05');
  const line = { ingredientId: inv.ingredients[0].id, quantity: '2', unitCost: '1000' };
  const body = { locationId: inv.locations[0].id, number: 'DRAFT-' + randomUUID(), lines: [line] };
  expect(
    (await request('/core/receipts', 'quyettruong05', { ...body, lines: [line, line] })).statusCode,
  ).toBe(400);
  const receipt = await ok('/core/receipts', 'quyettruong05', body);
  const change = {
    ...body,
    lines: [{ ...line, quantity: '3' }],
    reason: 'Sửa số lượng kiểm đếm',
    expectedVersion: receipt.version,
  };
  const updated = await ok('/core/receipts/' + receipt.id, 'quyettruong05', change, 'PATCH');
  expect(updated.total_value).toBe('3000');
  expect(
    (await request('/core/receipts/' + receipt.id, 'quyettruong05', change, 'PATCH')).statusCode,
  ).toBe(409);
  await ok('/core/receipts/' + receipt.id + '/cancel', 'quyettruong05', {
    reason: 'Không nhận hàng',
  });
  await ok('/core/receipts/' + receipt.id + '/cancel', 'quyettruong05', { reason: 'Gửi lại' });
  expect(
    (await request('/core/receipts/' + receipt.id + '/approve', 'quyettruong05', {})).statusCode,
  ).toBe(409);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int n FROM inventory_movement WHERE goods_receipt_id=$1',
        [receipt.id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await db.pool.query('SELECT count(*)::int n FROM business_audit_event WHERE resource_id=$1', [
        receipt.id,
      ])
    ).rows[0].n,
  ).toBe(2);
});

it('records counted stock and waste exactly once, rejects stale stock and protects reserved quantities', async () => {
  const balance = (
    await db.pool.query(
      'SELECT * FROM inventory_balance WHERE available_qty>10 ORDER BY id LIMIT 1',
    )
  ).rows[0];
  const body = {
    balanceId: balance.id,
    expectedVersion: balance.version,
    requestId: randomUUID(),
    mode: 'WASTE',
    quantity: '1',
    reason: 'Nguyên liệu hỏng khi kiểm tra đầu ca',
  };
  const result = await ok('/core/inventory/adjustments', 'quyettruong05', body);
  expect(result.movement_type).toBe('WASTE');
  expect((await ok('/core/inventory/adjustments', 'quyettruong05', body)).id).toBe(result.id);
  expect(
    (await request('/core/inventory/adjustments', 'quyettruong05', { ...body, quantity: '2' }))
      .statusCode,
  ).toBe(409);
  expect(
    (await request('/core/inventory/adjustments', 'pv001', { ...body, requestId: randomUUID() }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await request('/core/inventory/adjustments', 'quyettruong05', {
        ...body,
        requestId: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  const updated = (await db.pool.query('SELECT * FROM inventory_balance WHERE id=$1', [balance.id]))
    .rows[0];
  expect(Number(updated.on_hand_qty)).toBeCloseTo(Number(balance.on_hand_qty) - 1, 6);
  expect(
    (
      await request('/core/inventory/adjustments', 'quyettruong05', {
        ...body,
        expectedVersion: updated.version,
        requestId: randomUUID(),
        quantity: String(Number(updated.on_hand_qty) + 1),
      })
    ).statusCode,
  ).toBe(409);
  const counted = await ok('/core/inventory/adjustments', 'quyettruong05', {
    ...body,
    expectedVersion: updated.version,
    requestId: randomUUID(),
    mode: 'COUNT',
    quantity: String(Number(updated.on_hand_qty) + 2),
  });
  expect(counted.movement_type).toBe('ADJUSTMENT_IN');
  expect(Number(counted.quantity)).toBe(2);
  expect(
    (
      await db.pool.query(
        "SELECT id FROM business_audit_event WHERE resource_id=$1 AND action='ADJUST_STOCK'",
        [result.id],
      )
    ).rowCount,
  ).toBe(1);
});

it('prevents counted stock below reserved stock and concurrent adjustments from stale observations', async () => {
  const b = (
    await db.pool.query(
      'SELECT * FROM inventory_balance WHERE available_qty>10 ORDER BY id LIMIT 1',
    )
  ).rows[0];
  await db.pool.query(
    'UPDATE inventory_balance SET reserved_qty=reserved_qty+1,available_qty=available_qty-1,version=version+1 WHERE id=$1',
    [b.id],
  );
  const next = (await db.pool.query('SELECT * FROM inventory_balance WHERE id=$1', [b.id])).rows[0];
  const payload = {
    balanceId: b.id,
    expectedVersion: next.version,
    requestId: randomUUID(),
    mode: 'COUNT',
    quantity: '0',
    reason: 'Kiểm kê thử',
  };
  expect((await request('/core/inventory/adjustments', 'quyettruong05', payload)).statusCode).toBe(
    409,
  );
  const concurrent = await Promise.all([
    request('/core/inventory/adjustments', 'quyettruong05', {
      ...payload,
      mode: 'WASTE',
      quantity: '1',
    }),
    request('/core/inventory/adjustments', 'quyettruong05', {
      ...payload,
      requestId: randomUUID(),
      mode: 'WASTE',
      quantity: '2',
    }),
  ]);
  expect(concurrent.map((x) => x.statusCode).sort()).toEqual([200, 409]);
});
