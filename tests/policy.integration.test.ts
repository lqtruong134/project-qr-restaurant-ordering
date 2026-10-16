import { completePaymentHandover } from './dining-completion-fixture.js';
import { withTableCode } from './table-code-fixture.js';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const name = 'thesis_policy_' + randomBytes(8).toString('hex'),
  password = randomBytes(24).toString('hex');
const users: Record<string, string> = {},
  headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const jar = (r: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>) =>
  r.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function req(url: string, user: string, body?: unknown) {
  if (url === '/guest/join')
    body = await withTableCode(app, db, users.pv001 ?? users.quyettruong05!, headers, body);
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
  const migration = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  if (migration.status !== 0) throw new Error(migration.stderr);
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'r'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const user of ['quyettruong05', 'pv001', 'bep001'])
    users[user] = jar(await req('/auth/login', '', { username: user, password }));
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
});
async function table() {
  const code = 'R' + randomBytes(3).toString('hex');
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const t = await db.prisma.dining_table.create({
    data: { restaurant_id: restaurantId, area_id: area.id, code, name: code, capacity: 4 },
  });
  const s = await ok('/core/tables/' + t.id + '/open', 'pv001', {});
  return { table: t, sid: s.id };
}
async function dish(sid: string, serve = true) {
  const p = await db.prisma.product.findFirstOrThrow({ where: { code: 'DRINK-07' } });
  const b = await ok('/core/sessions/' + sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: p.id, quantity: 1 }],
  });
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: b.id } });
  if (serve) {
    for (const action of ['accept', 'prepare', 'ready'])
      await ok('/core/items/' + item.id + '/' + action, 'bep001', {});
    await ok('/core/items/' + item.id + '/serve', 'pv001', {});
  }
  return { item, amount: p.base_price.toString() };
}
async function pay(sid: string, amount: string) {
  const i = await ok('/core/sessions/' + sid + '/payments', 'pv001', {
    requestId: randomUUID(),
    method: 'CASH',
    amount,
  });
  return ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount });
}
import { digest } from '../apps/api/src/modules/shared/core-persistence.js';
async function joinTable(sid: string, tableId: string, accept = true) {
  const qr = await ok('/core/tables/' + tableId + '/qr', 'quyettruong05', {});
  const token = qr.joinPath.split('#')[1];
  const response = await req('/guest/join', '', {
    token,
    name: 'Khách chính sách',
    ...(accept ? { acceptedPolicyVersion: restaurantPolicy.version } : {}),
  });
  return { response, token, cookie: jar(response), sid };
}
async function prepared(sid: string, ready = false) {
  const d = await dish(sid, false);
  await ok('/core/items/' + d.item.id + '/accept', 'bep001', {});
  await ok('/core/items/' + d.item.id + '/prepare', 'bep001', {});
  if (ready) await ok('/core/items/' + d.item.id + '/ready', 'bep001', {});
  return d;
}
async function ownDish(cookie: string, sid: string) {
  const product = await db.prisma.product.findFirstOrThrow({ where: { code: 'DRINK-07' } });
  let state = await ok('/guest/state', cookie);
  await ok('/guest/cart', cookie, {
    productId: product.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  state = await ok('/guest/state', cookie);
  const batch = await ok('/guest/orders', cookie, {
    requestId: randomUUID(),
    cartVersion: state.cart.cart_version,
    itemIds: state.items.map((i: { id: string }) => i.id),
  });
  const current = await db.prisma.order_batch.findUniqueOrThrow({ where: { id: batch.id } });
  if (current.status === 'PENDING_REVIEW')
    await ok('/core/orders/' + batch.id + '/review', 'pv001', { approve: true });
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
  expect(current.session_id).toBe(sid);
  return { item, amount: product.base_price.toString() };
}
async function inventoryEvidence(itemId: string) {
  return {
    balances: await db.prisma.inventory_balance.findMany({ orderBy: { id: 'asc' } }),
    snapshots: await db.prisma.order_item_ingredient_snapshot.findMany({
      where: { order_item_id: itemId },
      orderBy: { id: 'asc' },
    }),
    reservations: await db.prisma.inventory_reservation.findMany({
      where: { order_item_id: itemId },
      orderBy: { id: 'asc' },
    }),
    movements: (
      await db.pool.query('SELECT * FROM inventory_movement WHERE order_item_id=$1 ORDER BY id', [
        itemId,
      ])
    ).rows,
  };
}
it('requires the current policy on new join, rejects before insertion and exposes the same public policy', async () => {
  const unjoined = await req('/guest/state', '');
  expect(unjoined.statusCode).toBe(401);
  expect(unjoined.json().errorCode).toBe('GUEST_SESSION_EXPIRED');
  expect(unjoined.json().userMessage).toContain('quét QR');
  expect(unjoined.json().userMessage).not.toContain('đăng nhập');
  const t = await table();
  const j = await joinTable(t.sid, t.table.id, false);
  expect(j.response.statusCode).toBe(400);
  expect(await db.prisma.session_participant.count({ where: { session_id: t.sid } })).toBe(0);
  const bad = await req('/guest/join', '', {
    token: j.token,
    name: 'Khách',
    acceptedPolicyVersion: '2025-v1',
  });
  expect(bad.statusCode).toBe(409);
  const ctrl = await req('/guest/join', '', {
    token: j.token,
    name: 'Tên\u0001',
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  expect(ctrl.statusCode).toBe(400);
  expect(await db.prisma.session_participant.count({ where: { session_id: t.sid } })).toBe(0);
  expect(await ok('/guest/policy', '')).toEqual(restaurantPolicy);
});
it('stores server acceptance time and immutable version without demanding acceptance on active state/profile access', async () => {
  const t = await table();
  const since = Date.now();
  const j = await joinTable(t.sid, t.table.id);
  expect(j.response.statusCode, j.response.body).toBe(200);
  const p = await db.prisma.session_participant.findFirstOrThrow({ where: { session_id: t.sid } });
  expect(p.accepted_policy_version).toBe(restaurantPolicy.version);
  expect(p.accepted_policy_at!.getTime()).toBeGreaterThanOrEqual(since);
  await expect(
    db.pool.query("UPDATE session_participant SET accepted_policy_version='2027-v2' WHERE id=$1", [
      p.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('UPDATE session_participant SET accepted_policy_at=NULL WHERE id=$1', [p.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await app.inject({
    method: 'PATCH',
    url: '/guest/profile',
    headers: { ...headers, cookie: j.cookie },
    payload: { name: 'Tên mới' },
  });
  const state = await ok('/guest/state', j.cookie);
  expect(state.participant.acceptedPolicyVersion).toBe(restaurantPolicy.version);
  expect((await ok('/guest/qr-info', j.cookie, { token: j.token })).already_joined).toBe(true);
  const other = await table();
  const otherQr = await ok('/core/tables/' + other.table.id + '/qr', 'quyettruong05', {});
  expect(
    (await ok('/guest/qr-info', j.cookie, { token: otherQr.joinPath.split('#')[1] }))
      .already_joined,
  ).toBe(false);
  const repeat = await req('/guest/join', j.cookie, {
    token: j.token,
    name: 'Tên lặp',
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  expect(repeat.statusCode).toBe(200);
  expect(await db.prisma.session_participant.count({ where: { session_id: t.sid } })).toBe(1);
  expect(
    (await db.prisma.session_participant.findUniqueOrThrow({ where: { id: p.id } }))
      .accepted_policy_at,
  ).toEqual(p.accepted_policy_at);
});
it('preserves legacy participant evidence as unknown and leaves its live session usable', async () => {
  const t = await table();
  const credential = randomBytes(24).toString('hex');
  const p = await db.prisma.session_participant.create({
    data: {
      session_id: t.sid,
      guest_id: randomUUID(),
      credential_hash: digest(credential),
      display_name: 'Khách trước chính sách',
    },
  });
  const state = await ok('/guest/state', 'guest=' + credential);
  expect(state.participant.acceptedPolicyVersion).toBeNull();
  await expect(
    db.pool.query(
      'UPDATE session_participant SET accepted_policy_version=$2,accepted_policy_at=now() WHERE id=$1',
      [p.id, restaurantPolicy.version],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('keeps leave behavior: deletes only unsent own cart, retains orders, acceptance and debt, clears cookie', async () => {
  const t = await table();
  const j = await joinTable(t.sid, t.table.id);
  expect(j.response.statusCode).toBe(200);
  const p = await db.prisma.product.findFirstOrThrow({ where: { code: 'DRINK-07' } });
  let state = await ok('/guest/state', j.cookie);
  await ok('/guest/cart', j.cookie, {
    productId: p.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  state = await ok('/guest/state', j.cookie);
  const batch = await ok('/guest/orders', j.cookie, {
    requestId: randomUUID(),
    cartVersion: state.cart.cart_version,
    itemIds: state.items.map((i: { id: string }) => i.id),
  });
  if (batch.status === 'PENDING_REVIEW')
    await ok('/core/orders/' + batch.id + '/review', 'pv001', { approve: true });
  state = await ok('/guest/state', j.cookie);
  await ok('/guest/cart', j.cookie, {
    productId: p.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  const leave = await req('/guest/leave', j.cookie, {});
  expect(leave.statusCode).toBe(200);
  expect(leave.cookies.find((c) => c.name === 'guest')?.value).toBe('');
  const participant = await db.prisma.session_participant.findFirstOrThrow({
    where: { session_id: t.sid },
  });
  expect(participant.status).toBe('LEFT');
  expect(participant.accepted_policy_version).toBe(restaurantPolicy.version);
  expect(await db.prisma.cart_item.count({ where: { owner_participant_id: participant.id } })).toBe(
    0,
  );
  expect(await db.prisma.order_item.count({ where: { order_batch_id: batch.id } })).toBe(1);
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.outstanding_amount).toBe(
    '15000',
  );
  expect((await req('/guest/state', j.cookie)).statusCode).toBe(403);
});
it('guest cancels only own submitted items, and staff cancels accepted items with release, reversal and audit', async () => {
  const t = await table();
  const j = await joinTable(t.sid, t.table.id);
  expect(j.response.statusCode).toBe(200);
  const foreign = await dish(t.sid, false);
  const participant = await db.prisma.session_participant.findFirstOrThrow({
    where: { session_id: t.sid },
  });
  expect(
    (
      await req('/guest/items/cancel', j.cookie, {
        itemIds: [foreign.item.id],
        reasonCode: 'CUSTOMER_CHANGED_MIND',
      })
    ).statusCode,
  ).toBe(403);
  await ok('/core/items/cancel', 'pv001', {
    itemIds: [foreign.item.id],
    reasonCode: 'CUSTOMER_CHANGED_MIND',
  });
  const d = await ownDish(j.cookie, t.sid);

  const before = await inventoryEvidence(d.item.id);
  await ok('/guest/items/cancel', j.cookie, {
    itemIds: [d.item.id],
    reasonCode: 'CUSTOMER_CHANGED_MIND',
  });
  expect(
    (await db.prisma.financial_charge.findFirstOrThrow({ where: { order_item_id: d.item.id } }))
      .status,
  ).toBe('REVERSED');
  expect(
    (
      await db.prisma.order_status_history.findFirstOrThrow({
        where: { order_item_id: d.item.id, new_status: 'CANCELLED' },
      })
    ).actor_participant_id,
  ).toBe(participant.id);
  const balances = await db.prisma.inventory_balance.findMany({ orderBy: { id: 'asc' } });
  expect(balances.map((b) => b.on_hand_qty)).toEqual(before.balances.map((b) => b.on_hand_qty));
  expect(
    await db.prisma.inventory_reservation.count({
      where: { order_item_id: d.item.id, status: { in: ['PROVISIONAL', 'ACTIVE'] } },
    }),
  ).toBe(0);
  const d2 = await dish(t.sid, false);
  await ok('/core/items/' + d2.item.id + '/accept', 'bep001', {});
  expect(
    (
      await req('/core/items/cancel', 'pv001', {
        itemIds: [d2.item.id],
        reasonCode: 'QUALITY_ISSUE',
        note: 'Thử vượt quyền',
      })
    ).statusCode,
  ).toBe(403);
  await ok('/core/items/cancel', 'pv001', {
    itemIds: [d2.item.id],
    reasonCode: 'CUSTOMER_CHANGED_MIND',
  });
  const audit = await db.prisma.business_audit_event.findFirstOrThrow({
    where: { resource_id: d2.item.id, action: 'CANCEL_ITEM' },
  });
  expect(audit.details).toMatchObject({
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    previousStatus: 'ACCEPTED',
    chargeRetained: false,
  });
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.charge_total).toBe('0');
});
it('kitchen out-of-stock is allowed before preparation only and does not consume stock or charge twice', async () => {
  const t = await table();
  const d = await dish(t.sid, false);
  await ok('/core/items/' + d.item.id + '/accept', 'bep001', {});
  const before = await inventoryEvidence(d.item.id);
  const body = { reasonCode: 'OUT_OF_STOCK', note: 'Đối chiếu nguyên liệu không đủ' };
  await ok('/core/items/' + d.item.id + '/unavailable', 'bep001', body);
  await ok('/core/items/' + d.item.id + '/unavailable', 'bep001', body);
  expect((await db.prisma.order_item.findUniqueOrThrow({ where: { id: d.item.id } })).status).toBe(
    'UNAVAILABLE',
  );
  expect((await inventoryEvidence(d.item.id)).balances.map((b) => b.on_hand_qty)).toEqual(
    before.balances.map((b) => b.on_hand_qty),
  );
  expect((await inventoryEvidence(d.item.id)).movements).toHaveLength(0);
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: d.item.id, action: 'ITEM_UNAVAILABLE' },
    }),
  ).toBe(1);
  expect(
    (await db.prisma.product.findUniqueOrThrow({ where: { id: d.item.product_id } }))
      .availability_status,
  ).toBe('UNAVAILABLE');
  await db.prisma.product.update({
    where: { id: d.item.product_id },
    data: { availability_status: 'AVAILABLE' },
  });
  const d2 = await prepared(t.sid);
  expect((await req('/core/items/' + d2.item.id + '/unavailable', 'bep001', body)).statusCode).toBe(
    409,
  );
});
it.each(['IN_PREPARATION', 'READY'])(
  'restaurant fault at %s retains stock/COGS, needs admin and reverses paid money once in one decision',
  async (status) => {
    const t = await table();
    const j = await joinTable(t.sid, t.table.id);
    expect(j.response.statusCode).toBe(200);
    const d = await ownDish(j.cookie, t.sid);
    await ok('/core/items/' + d.item.id + '/accept', 'bep001', {});
    await ok('/core/items/' + d.item.id + '/prepare', 'bep001', {});
    if (status === 'READY') await ok('/core/items/' + d.item.id + '/ready', 'bep001', {});
    expect(
      (
        await req('/guest/items/cancel', j.cookie, {
          itemIds: [d.item.id],
          reasonCode: 'CUSTOMER_CHANGED_MIND',
        })
      ).statusCode,
    ).toBe(409);
    const payment = await pay(t.sid, d.amount);
    const before = await inventoryEvidence(d.item.id);
    const body = { reasonCode: 'KITCHEN_ERROR', note: 'Món lỗi khi chế biến, quản trị đối chiếu' };
    expect(
      (await req('/core/items/' + d.item.id + '/report-issue', 'pv001', body)).statusCode,
    ).toBe(403);
    for (const invalid of [
      { reasonCode: 'CUSTOMER_CHANGED_MIND', note: 'Không được giảm tiền' },
      { reasonCode: 'OTHER' },
      { reasonCode: 'INVALID', note: 'Không hợp lệ' },
      { ...body, note: 'x'.repeat(501) },
    ]) {
      const res = await req('/core/items/' + d.item.id + '/report-issue', 'bep001', invalid);
      expect([400, 403]).toContain(res.statusCode);
    }
    await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', body);
    await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', body);
    expect(
      (await db.prisma.financial_charge.findFirstOrThrow({ where: { order_item_id: d.item.id } }))
        .status,
    ).toBe('ACTIVE');
    expect(
      (await ok('/guest/state', j.cookie)).orders.find(
        (i: { item_id: string }) => i.item_id === d.item.id,
      ).awaiting_admin,
    ).toBe(true);
    expect(await inventoryEvidence(d.item.id)).toEqual(before);
    const alerts = await ok('/core/alerts', 'pv001');
    const alert = alerts.find(
      (a: { requires_admin: boolean; session_id: string }) =>
        a.requires_admin && a.session_id === t.sid,
    );
    expect(alert.item_name).toBe(d.item.product_name_snapshot);
    await ok('/core/alerts/' + alert.id + '/acknowledge', 'pv001', {});
    expect(
      (
        await req('/core/alerts/' + alert.id + '/resolve', 'pv001', {
          reason: 'Không có quyền bỏ qua',
        })
      ).statusCode,
    ).toBe(403);
    expect((await req('/core/sessions/' + t.sid + '/close', 'pv001', {})).statusCode).toBe(409);
    expect(
      (await req('/core/items/' + d.item.id + '/late-cancel', 'bep001', body)).statusCode,
    ).toBe(403);
    await ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', body);
    await ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', body);
    expect(await inventoryEvidence(d.item.id)).toEqual(before);
    const bill = await ok('/core/sessions/' + t.sid + '/bill', 'pv001');
    expect(bill.account).toMatchObject({
      charge_total: '0',
      paid_total: d.amount,
      refund_due_amount: d.amount,
    });
    expect(
      await db.prisma.business_audit_event.count({
        where: { resource_id: d.item.id, action: 'RESTAURANT_FAULT_CONFIRMED' },
      }),
    ).toBe(1);
    expect(
      await db.prisma.business_audit_event.count({
        where: { resource_id: d.item.id, action: 'WAIVE_ITEM' },
      }),
    ).toBe(0);
    const audit = await db.prisma.business_audit_event.findFirstOrThrow({
      where: { resource_id: d.item.id, action: 'LATE_CANCEL' },
    });
    expect(audit.details).toMatchObject({
      reasonCode: 'KITCHEN_ERROR',
      previousStatus: status,
      awaitingAdmin: true,
    });
    expect(
      (await db.prisma.operational_alert.findUniqueOrThrow({ where: { id: alert.id } })).status,
    ).toBe('RESOLVED');
    expect(
      await db.prisma.operational_alert.count({
        where: { session_id: t.sid, alert_type: 'REFUND_REQUIRED', status: { not: 'RESOLVED' } },
      }),
    ).toBe(1);
    const allocations = await db.prisma.payment_allocation.findMany({
      where: { payment_transaction_id: payment.id },
    });
    expect(allocations.length).toBeGreaterThan(0);
    for (const a of allocations) expect(a.reversed_amount).toBe(a.allocated_amount);
    const guestItem = (await ok('/guest/state', j.cookie)).orders.find(
      (i: { item_id: string }) => i.item_id === d.item.id,
    );
    expect(guestItem).toMatchObject({
      charge_status: 'REVERSED',
      original_amount: d.amount,
      awaiting_admin: false,
    });
    expect(guestItem.finance_reason).toContain('Lỗi chế biến');
    const refund = await ok('/core/sessions/' + t.sid + '/refunds', 'quyettruong05', {
      requestId: randomUUID(),
      paymentId: payment.id,
      amount: d.amount,
      reason: 'Hoàn món lỗi đã xác nhận',
    });
    await ok('/core/refunds/' + refund.id + '/complete', 'pv001', {
      requestId: randomUUID(),
      amount: d.amount,
      method: 'CASH',
    });
    expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.refund_due_amount).toBe(
      '0',
    );
    expect(
      (await ok('/core/alerts', 'pv001')).some(
        (a: { session_id: string; alert_type: string }) =>
          a.session_id === t.sid && a.alert_type === 'REFUND_REQUIRED',
      ),
    ).toBe(false);
    const guestNotice = (await ok('/core/alerts', 'pv001')).find(
      (a: { session_id: string; guest_notice: boolean }) =>
        a.session_id === t.sid && a.guest_notice,
    );
    await ok('/core/alerts/' + guestNotice.id + '/guest-notified', 'pv001', {});
    await completePaymentHandover(app, users.pv001!, headers, t.sid);
    await ok('/core/sessions/' + t.sid + '/close', 'pv001', {});
  },
);
it('admin can stop an unreported faulty dish with one operation and no waiver', async () => {
  const t = await table();
  const d = await prepared(t.sid);
  const before = await inventoryEvidence(d.item.id);
  await ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', {
    reasonCode: 'QUALITY_ISSUE',
    note: 'Quản trị đối chiếu món không đạt',
  });
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.charge_total).toBe('0');
  expect(await inventoryEvidence(d.item.id)).toEqual(before);
});
it('late customer change retains charge; rejecting a kitchen claim records the managerial decision', async () => {
  for (const pending of [false, true]) {
    const t = await table();
    const d = await prepared(t.sid);
    const before = await inventoryEvidence(d.item.id);
    if (pending)
      await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', {
        reasonCode: 'WRONG_ITEM',
        note: 'Bếp nghi ngờ làm nhầm',
      });
    await ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', {
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      note: 'Đối chiếu khách đổi ý, món đúng yêu cầu',
    });
    expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.charge_total).toBe(
      d.amount,
    );
    expect(await inventoryEvidence(d.item.id)).toEqual(before);
    if (pending) {
      expect(
        await db.prisma.business_audit_event.count({
          where: { resource_id: d.item.id, action: 'RESTAURANT_FAULT_DECLINED' },
        }),
      ).toBe(1);
      expect(
        (await ok('/core/order-exceptions', 'quyettruong05')).find(
          (i: { id: string }) => i.id === d.item.id,
        ).reported_issue,
      ).toBe(false);
    }
  }
});
it('served complaint needs admin waiver, retains lifecycle and COGS, and reduces served net sales without changing cash history', async () => {
  const t = await table();
  const d = await dish(t.sid);
  const before = await inventoryEvidence(d.item.id);
  await pay(t.sid, d.amount);
  const reports = await ok('/core/reports', 'quyettruong05');
  const previous = reports.sales.find(
    (s: { product_id: string }) => s.product_id === d.item.product_id,
  );
  const body = { reasonCode: 'QUALITY_ISSUE', note: 'Phản hồi sau phục vụ' };
  expect((await req('/core/items/' + d.item.id + '/report-issue', 'bep001', body)).statusCode).toBe(
    409,
  );
  expect(
    (await req('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', body)).statusCode,
  ).toBe(409);
  expect((await req('/core/items/' + d.item.id + '/waive', 'pv001', body)).statusCode).toBe(403);
  await ok('/core/items/' + d.item.id + '/waive', 'quyettruong05', {
    reasonCode: 'CUSTOMER_COMPLAINT',
    note: 'Quản trị giải quyết chất lượng sau phục vụ',
  });
  expect((await db.prisma.order_item.findUniqueOrThrow({ where: { id: d.item.id } })).status).toBe(
    'SERVED',
  );
  expect(await inventoryEvidence(d.item.id)).toEqual(before);
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.refund_due_amount).toBe(
    d.amount,
  );
  const after = (await ok('/core/reports', 'quyettruong05')).sales.find(
    (s: { product_id: string }) => s.product_id === d.item.product_id,
  );
  expect(BigInt(previous.sales) - BigInt(after.sales)).toBe(BigInt(d.amount));
  expect(after.cost).toBe(previous.cost);
});

it('kitchen reason alone creates two durable tasks; staff communication never waives money', async () => {
  const t = await table(),
    d = await prepared(t.sid);
  const before = await inventoryEvidence(d.item.id);
  await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', { reasonCode: 'QUALITY_ISSUE' });
  await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', { reasonCode: 'QUALITY_ISSUE' });
  const alerts = (await ok('/core/alerts', 'pv001')).filter(
    (a: { session_id: string }) => a.session_id === t.sid,
  );
  expect(alerts).toHaveLength(2);
  const notice = alerts.find((a: { guest_notice: boolean }) => a.guest_notice),
    review = alerts.find((a: { requires_admin: boolean }) => a.requires_admin);
  expect(notice.issue_reason_code).toBe('QUALITY_ISSUE');
  expect(
    (await req('/core/alerts/' + notice.id + '/guest-notified', 'bep001', {})).statusCode,
  ).toBe(403);
  expect(
    (await req('/core/alerts/' + notice.id + '/resolve', 'pv001', { reason: 'Bỏ qua' })).statusCode,
  ).toBe(403);
  await Promise.all([
    ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {}),
    ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {}),
  ]);
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.charge_total).toBe(
    d.amount,
  );
  expect(
    (await db.prisma.operational_alert.findUniqueOrThrow({ where: { id: review.id } })).status,
  ).not.toBe('RESOLVED');
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: d.item.id, action: 'GUEST_NOTIFIED_OF_DISH_ISSUE' },
    }),
  ).toBe(1);
  expect(await inventoryEvidence(d.item.id)).toEqual(before);
});
it('concurrent admin approval adopts the saved kitchen reason once and preserves the separate guest task', async () => {
  const t = await table(),
    d = await prepared(t.sid);
  await pay(t.sid, d.amount);
  await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', { reasonCode: 'WRONG_ITEM' });
  const report = (await ok('/core/order-exceptions?pending=true', 'quyettruong05')).find(
    (i: { id: string }) => i.id === d.item.id,
  );
  expect(report).toMatchObject({
    reported_reason_code: 'WRONG_ITEM',
    reported_note: '',
    guest_notified: false,
  });
  const body = {
    useReportedReason: true,
    expectedReportId: report.report_id,
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    note: 'không được thay thế lý do bếp',
  };
  expect((await req('/core/items/' + d.item.id + '/late-cancel', 'pv001', body)).statusCode).toBe(
    403,
  );
  expect(
    (
      await req('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', {
        ...body,
        expectedReportId: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  await Promise.all([
    ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', body),
    ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', body),
  ]);
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: d.item.id, action: 'RESTAURANT_FAULT_CONFIRMED' },
    }),
  ).toBe(1);
  const bill = await ok('/core/sessions/' + t.sid + '/bill', 'pv001');
  expect(bill.account).toMatchObject({
    charge_total: '0',
    paid_total: d.amount,
    refunded_total: '0',
    refund_due_amount: d.amount,
  });
  expect(bill.charges[0]).toMatchObject({
    finance_reason_code: 'WRONG_ITEM',
    cancel_reason_code: 'WRONG_ITEM',
  });
  expect(bill.charges[0].finance_reason).toBe('Nhà hàng làm nhầm món');
  expect(
    (await ok('/core/alerts', 'pv001')).some(
      (a: { session_id: string; guest_notice: boolean }) =>
        a.session_id === t.sid && a.guest_notice,
    ),
  ).toBe(true);
});
it('admin first, staff second: unresolved guest communication blocks close until confirmed and freezes a correct bill', async () => {
  const t = await table(),
    d = await prepared(t.sid);
  await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', { reasonCode: 'KITCHEN_ERROR' });
  const report = (await ok('/core/order-exceptions?pending=true', 'quyettruong05')).find(
    (i: { id: string }) => i.id === d.item.id,
  );
  await ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', {
    useReportedReason: true,
    expectedReportId: report.report_id,
  });
  expect((await req('/core/sessions/' + t.sid + '/close', 'pv001', {})).statusCode).toBe(409);
  const notice = (await ok('/core/alerts', 'pv001')).find(
    (a: { session_id: string; guest_notice: boolean }) => a.session_id === t.sid && a.guest_notice,
  );
  await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {});
  await completePaymentHandover(app, users.pv001!, headers, t.sid);
  await ok('/core/sessions/' + t.sid + '/close', 'pv001', {});
  const bill = await ok('/core/sessions/' + t.sid + '/bill', 'pv001');
  expect(bill.session.session_status).toBe('CLOSED');
  expect(
    bill.cancelledItems.find((i: { id: string }) => i.id === d.item.id).cancel_reason_code,
  ).toBe('KITCHEN_ERROR');
  expect(
    (await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {})).alreadyProcessed,
  ).toBe(true);
});
it('an already declined kitchen report cannot later be approved with a stale quick action', async () => {
  const t = await table(),
    d = await prepared(t.sid);
  await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', { reasonCode: 'WRONG_ITEM' });
  const report = (await ok('/core/order-exceptions?pending=true', 'quyettruong05')).find(
    (i: { id: string }) => i.id === d.item.id,
  );
  await ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', {
    reasonCode: 'CUSTOMER_CHANGED_MIND',
  });
  expect(
    (
      await req('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', {
        useReportedReason: true,
        expectedReportId: report.report_id,
      })
    ).statusCode,
  ).toBe(409);
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'pv001')).account.charge_total).toBe(
    d.amount,
  );
});
it('pending kitchen reports are not hidden by more than 200 recent normal items', async () => {
  const t = await table(),
    d = await prepared(t.sid);
  await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', { reasonCode: 'KITCHEN_ERROR' });
  await db.prisma.order_item.createMany({
    data: Array.from({ length: 205 }, () => ({
      order_batch_id: d.item.order_batch_id,
      product_id: d.item.product_id,
      product_name_snapshot: 'Món kiểm tra giới hạn hàng đợi',
      quantity: 1,
      unit_price_snapshot: 1n,
      line_total: 1n,
      status: 'SERVED',
    })),
  });
  const rows = await ok('/core/order-exceptions', 'quyettruong05');
  expect(
    rows.some(
      (i: { id: string; reported_issue: boolean }) => i.id === d.item.id && i.reported_issue,
    ),
  ).toBe(true);
  const pending = await ok('/core/order-exceptions?pending=true', 'quyettruong05');
  expect(pending.every((i: { reported_issue: boolean }) => i.reported_issue)).toBe(true);
});

it('admin creates and approves refund documents while only staff executes the actual return', async () => {
  const t = await table(),
    d = await prepared(t.sid),
    payment = await pay(t.sid, d.amount);
  await ok('/core/items/' + d.item.id + '/report-issue', 'bep001', { reasonCode: 'QUALITY_ISSUE' });
  const report = (await ok('/core/order-exceptions?pending=true', 'quyettruong05')).find(
    (i: { id: string }) => i.id === d.item.id,
  );
  await ok('/core/items/' + d.item.id + '/late-cancel', 'quyettruong05', {
    useReportedReason: true,
    expectedReportId: report.report_id,
  });
  expect(
    (await ok('/core/alerts', 'quyettruong05')).some(
      (a: { alert_type: string; session_id: string }) =>
        a.session_id === t.sid && a.alert_type === 'REFUND_REQUIRED',
    ),
  ).toBe(true);
  expect(
    (await ok('/core/sessions/' + t.sid + '/bill', 'quyettruong05')).account.refund_due_amount,
  ).toBe(d.amount);
  expect((await req('/core/sessions/' + t.sid + '/bill', 'bep001')).statusCode).toBe(403);
  expect((await req('/core/alerts', 'bep001')).statusCode).toBe(403);
  expect((await req('/core/orders', 'quyettruong05')).statusCode).toBe(403);
  const body = {
    paymentId: payment.id,
    amount: d.amount,
    reason: 'Hoàn tiền món không tính tiền đã duyệt',
    requestId: randomUUID(),
  };
  expect((await req('/core/sessions/' + t.sid + '/refunds', 'bep001', body)).statusCode).toBe(403);
  const refund = await ok('/core/sessions/' + t.sid + '/refunds', 'quyettruong05', body);
  expect(
    (await ok('/core/sessions/' + t.sid + '/bill', 'quyettruong05')).account.refunded_total,
  ).toBe('0');
  const complete = { amount: d.amount, method: 'CASH', requestId: randomUUID() };
  expect(
    (await req('/core/refunds/' + refund.id + '/complete', 'bep001', complete)).statusCode,
  ).toBe(403);
  expect(
    (await req('/core/refunds/' + refund.id + '/complete', 'quyettruong05', complete)).statusCode,
  ).toBe(403);
  expect(await db.prisma.refund_transaction.count({ where: { refund_case_id: refund.id } })).toBe(
    0,
  );
  await Promise.all([
    ok('/core/refunds/' + refund.id + '/complete', 'pv001', complete),
    ok('/core/refunds/' + refund.id + '/complete', 'pv001', complete),
  ]);
  expect(
    (await req('/core/refunds/' + refund.id + '/complete', 'quyettruong05', complete)).statusCode,
  ).toBe(403);
  const staff = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } });
  const transactions = await db.prisma.refund_transaction.findMany({
    where: { refund_case_id: refund.id },
  });
  expect(transactions).toHaveLength(1);
  expect(transactions).toMatchObject([{ processed_by: staff.id }]);
  expect((await ok('/core/sessions/' + t.sid + '/bill', 'quyettruong05')).account).toMatchObject({
    paid_total: d.amount,
    refunded_total: d.amount,
    refund_due_amount: '0',
  });
});
