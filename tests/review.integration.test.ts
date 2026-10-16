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
const name = 'thesis_review_' + randomBytes(8).toString('hex'),
  password = randomBytes(24).toString('hex');
const users: Record<string, string> = {},
  headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const jar = (r: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>) =>
  r.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function guestTable() {
  const t = await table();
  const qr = await ok('/core/tables/' + t.table.id + '/qr', 'quyettruong05', {});
  return { ...t, token: qr.joinPath.split('#')[1] as string };
}
const joinGuest = (token: string, name: string, cookie = '') =>
  req('/guest/join', cookie, { token, name, acceptedPolicyVersion: restaurantPolicy.version });
const renameGuest = (cookie: string, name: string) =>
  app.inject({
    method: 'PATCH',
    url: '/guest/profile',
    headers: { ...headers, cookie },
    payload: { name },
  });
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
it('reserves exact guest names per session ignoring case, Unicode representation and extra spaces', async () => {
  const t = await guestTable();
  const first = await joinGuest(t.token, '  Trường  ');
  expect(first.statusCode, first.body).toBe(200);
  for (const name of ['trường', 'TRƯỜNG', 'Trường'.normalize('NFD')]) {
    const duplicate = await joinGuest(t.token, name);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().userMessage).toContain('Tên này đã được dùng');
    expect(duplicate.cookies.find((c) => c.name === 'guest')).toBeUndefined();
  }
  const distinct = await joinGuest(t.token, '  Lữ   Trường  ');
  expect(distinct.statusCode, distinct.body).toBe(200);
  expect((await ok('/guest/state', jar(distinct))).participant.displayName).toBe('Lữ Trường');
  expect((await joinGuest(t.token, 'lữ trường')).statusCode).toBe(409);
  expect(await db.prisma.session_participant.count({ where: { session_id: t.sid } })).toBe(2);
  const other = await guestTable();
  expect((await joinGuest(other.token, 'trường')).statusCode).toBe(200);
});
it('serializes simultaneous guest joins competing for the same name', async () => {
  const t = await guestTable();
  const results = await Promise.all([
    joinGuest(t.token, 'Đồng Thời'),
    joinGuest(t.token, 'đồng thời'),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await db.prisma.session_participant.count({ where: { session_id: t.sid } })).toBe(1);
});
it('keeps the same participant on QR reuse and returns only names from the current session', async () => {
  const t = await guestTable();
  const first = await joinGuest(t.token, 'Trường');
  const second = await joinGuest(t.token, 'Lữ Trường');
  const current = jar(first);
  const repeated = await joinGuest(t.token, 'Lữ Trường', current);
  expect(repeated.statusCode, repeated.body).toBe(200);
  expect(repeated.json()).toEqual(first.json());
  expect((await ok('/guest/qr-info', current, { token: t.token })).already_joined).toBe(true);
  const other = await guestTable();
  await joinGuest(other.token, 'Khách bàn khác');
  const state = await ok('/guest/state', current);
  expect(state.participant.displayName).toBe('Trường');
  expect(state.participants).toHaveLength(2);
  expect(state.participants.map((p: { id: string }) => p.id).sort()).toEqual(
    [first.json().participantId, second.json().participantId].sort(),
  );
  for (const member of state.participants)
    expect(Object.keys(member).sort()).toEqual(['display_name', 'id', 'joined_at']);
});
it('rejects duplicate profile changes and retains identity and dishes when renaming', async () => {
  const t = await guestTable();
  const first = await joinGuest(t.token, 'Trường');
  const second = await joinGuest(t.token, 'Lan');
  const current = jar(first);
  const initial = await ok('/guest/state', current);
  const product = initial.products.find((p: { code: string }) => p.code === 'DRINK-07');
  const item = await ok('/guest/cart', current, {
    productId: product.id,
    quantity: 1,
    cartVersion: initial.cart.cart_version,
  });
  expect((await renameGuest(current, 'LAN')).statusCode).toBe(409);
  expect((await renameGuest(current, '  Lữ   Trường  ')).statusCode).toBe(200);
  expect((await renameGuest(current, 'LỮ TRƯỜNG')).statusCode).toBe(200);
  const next = await ok('/guest/state', current);
  expect(next.participant.id).toBe(first.json().participantId);
  expect(next.participant.displayName).toBe('LỮ TRƯỜNG');
  expect(next.items.find((i: { id: string }) => i.id === item.id).owner_participant_id).toBe(
    first.json().participantId,
  );
  const seen = await ok('/guest/state', jar(second));
  expect(
    seen.participants.some((p: { display_name: string }) => p.display_name === 'LỮ TRƯỜNG'),
  ).toBe(true);
});
it('serializes a profile rename against a new join requesting the same name', async () => {
  const t = await guestTable();
  const first = await joinGuest(t.token, 'Người đầu tiên');
  const results = await Promise.all([renameGuest(jar(first), 'Mai'), joinGuest(t.token, 'mai')]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const people = await db.prisma.session_participant.findMany({ where: { session_id: t.sid } });
  expect(people.filter((p) => p.display_name?.toLocaleLowerCase('vi-VN') === 'mai')).toHaveLength(
    1,
  );
});
it('hides guests who left from the roster while reserving their name for the session history', async () => {
  const t = await guestTable();
  const first = await joinGuest(t.token, 'Trường');
  const second = await joinGuest(t.token, 'Lan');
  await ok('/guest/leave', jar(first), {});
  const state = await ok('/guest/state', jar(second));
  expect(state.participants).toHaveLength(1);
  expect(state.participants[0].display_name).toBe('Lan');
  expect((await joinGuest(t.token, 'trường')).statusCode).toBe(409);
  expect((await joinGuest(t.token, 'Trường mới')).statusCode).toBe(200);
});
it('allows a previously used name in a new serving session after closing and cleaning', async () => {
  const t = await guestTable();
  await joinGuest(t.token, 'Trường');
  await completePaymentHandover(app, users.pv001!, headers, t.sid);
  await ok('/core/sessions/' + t.sid + '/close', 'pv001', {});
  await ok('/core/tables/' + t.table.id + '/clean', 'pv001', {});
  const next = await joinGuest(t.token, 'trường');
  expect(next.statusCode, next.body).toBe(200);
  expect(next.json().sessionId).not.toBe(t.sid);
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
it('keeps edited master data when bootstrap seed is repeated', async () => {
  const u = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv008' } });
  const t = await db.prisma.dining_table.findFirstOrThrow({ where: { code: 'A12' } });
  await db.prisma.app_user.update({
    where: { id: u.id },
    data: { display_name: 'Tên đã chỉnh bởi quản trị' },
  });
  await db.prisma.dining_table.update({
    where: { id: t.id },
    data: { name: 'Bàn nhìn ra vườn', capacity: 6 },
  });
  await seed(db, password);
  expect((await db.prisma.app_user.findUniqueOrThrow({ where: { id: u.id } })).display_name).toBe(
    'Tên đã chỉnh bởi quản trị',
  );
  const after = await db.prisma.dining_table.findUniqueOrThrow({ where: { id: t.id } });
  expect(after.name).toBe('Bàn nhìn ra vườn');
  expect(after.capacity).toBe(6);
});
it('prevents moving parent entities across restaurants and changing the base unit behind stock history', async () => {
  const other = await db.prisma.restaurant.create({ data: { name: 'Nhà hàng độc lập' } });
  const ingredient = await db.prisma.ingredient.findFirstOrThrow();
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const unit = await db.prisma.unit_of_measure.findFirstOrThrow({
    where: { id: { not: ingredient.base_unit_id } },
  });
  await expect(
    db.pool.query('UPDATE ingredient SET restaurant_id=$2 WHERE id=$1', [ingredient.id, other.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('UPDATE dining_area SET restaurant_id=$2 WHERE id=$1', [area.id, other.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('UPDATE ingredient SET base_unit_id=$2 WHERE id=$1', [ingredient.id, unit.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('expires stale guest credentials and hides recipes using inactive ingredients or no ingredients', async () => {
  const stale = await req('/guest/state', 'guest=nonexistent-credential');
  expect(stale.statusCode).toBe(401);
  expect(stale.cookies.find((c) => c.name === 'guest')?.value).toBe('');
  const t = await table();
  const qr = await ok('/core/tables/' + t.table.id + '/qr', 'quyettruong05', {});
  const joined = await req('/guest/join', '', {
    acceptedPolicyVersion: restaurantPolicy.version,
    token: qr.joinPath.split('#')[1],
    name: 'Khách kiểm tra',
  });
  expect(joined.statusCode, joined.body).toBe(200);
  const guest = jar(joined);
  const ingredient = await db.prisma.ingredient.findFirstOrThrow({
    where: { code: 'BOTTLEDWATER' },
  });
  await db.prisma.ingredient.update({ where: { id: ingredient.id }, data: { is_active: false } });
  let state = await ok('/guest/state', guest);
  expect(
    state.products.find((p: { code: string }) => p.code === 'DRINK-07').availability_status,
  ).toBe('UNAVAILABLE');
  await db.prisma.ingredient.update({ where: { id: ingredient.id }, data: { is_active: true } });
  const cat = await db.prisma.menu_category.findFirstOrThrow();
  const product = await db.prisma.product.create({
    data: {
      restaurant_id: restaurantId,
      category_id: cat.id,
      code: 'EMPTY-BOM',
      name: 'Công thức rỗng',
      base_price: 10000n,
    },
  });
  await db.prisma.recipe_bom.create({
    data: { product_id: product.id, version_no: 1, status: 'ACTIVE', yield_quantity: 1 },
  });
  state = await ok('/guest/state', guest);
  expect(state.products.find((p: { id: string }) => p.id === product.id).availability_status).toBe(
    'UNAVAILABLE',
  );
  await completePaymentHandover(app, users.pv001!, headers, t.sid);
  await ok('/core/sessions/' + t.sid + '/close', 'pv001', {});
  expect((await req('/guest/state', guest)).statusCode).toBe(401);
});
it('requires outstanding service work before write-off and closes only the debt alert with an audit record', async () => {
  const t = await table();
  await dish(t.sid);
  const debt = await ok('/core/sessions/' + t.sid + '/outstanding', 'pv001', {
    reason: 'LEFT_WITHOUT_PAYING',
    notes: 'Tình huống kiểm thử',
  });
  const support = await db.prisma.support_request.create({
    data: { session_id: t.sid, request_type: 'ASSISTANCE' },
  });
  expect(
    (
      await req('/core/outstanding/' + debt.id + '/write-off', 'quyettruong05', {
        reason: 'Không thu hồi được',
      })
    ).statusCode,
  ).toBe(409);
  await ok('/core/support/' + support.id + '/claim', 'pv001', {});
  await ok('/core/support/' + support.id + '/resolve', 'pv001', {});
  await ok('/core/outstanding/' + debt.id + '/write-off', 'quyettruong05', {
    reason: 'Không thu hồi được',
  });
  expect(
    (await db.prisma.table_session.findUniqueOrThrow({ where: { id: t.sid } })).session_status,
  ).toBe('CLOSED');
  expect(
    await db.prisma.operational_alert.count({
      where: { session_id: t.sid, status: { not: 'RESOLVED' } },
    }),
  ).toBe(0);
  const event = await db.prisma.business_audit_event.findFirstOrThrow({
    where: { resource_id: debt.id, action: 'WRITE_OFF_BALANCE' },
  });
  expect(event.details).toMatchObject({ writtenOffAmount: '15000' });
});
it('comps a served item without falsifying its lifecycle or restoring consumed stock, and includes it on the frozen receipt', async () => {
  const t = await table(),
    d = await dish(t.sid);
  const before = await db.prisma.inventory_balance.findMany({ orderBy: { id: 'asc' } });
  await ok('/core/items/' + d.item.id + '/waive', 'quyettruong05', {
    reason: 'Chăm sóc khách vì chờ lâu',
  });
  expect((await db.prisma.order_item.findUniqueOrThrow({ where: { id: d.item.id } })).status).toBe(
    'SERVED',
  );
  expect(await db.prisma.inventory_balance.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  await completePaymentHandover(app, users.pv001!, headers, t.sid);
  await ok('/core/sessions/' + t.sid + '/close', 'pv001', {});
  const bill = await ok('/core/sessions/' + t.sid + '/bill', 'pv001');
  expect(bill.account.charge_total).toBe('0');
  expect(bill.waivedItems).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: d.item.id })]),
  );
});
it('rejects refunds pointing to another session item or another source allocation at the SQL boundary', async () => {
  const a = await table(),
    b = await table();
  const da = await dish(a.sid),
    dbItem = await dish(b.sid);
  const payment = await pay(a.sid, da.amount);
  await expect(
    db.pool.query(
      'INSERT INTO refund_case(session_id,source_payment_transaction_id,order_item_id,amount,reason) VALUES($1,$2,$3,1,$4)',
      [a.sid, payment.id, dbItem.item.id, 'Kiểm tra liên kết sai'],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const pb = await pay(b.sid, dbItem.amount);
  const alloc = await db.prisma.payment_allocation.findFirstOrThrow({
    where: { payment_transaction_id: pb.id },
  });
  await expect(
    db.pool.query(
      'INSERT INTO refund_case(session_id,source_payment_transaction_id,source_allocation_id,amount,reason) VALUES($1,$2,$3,1,$4)',
      [a.sid, payment.id, alloc.id, 'Kiểm tra phân bổ sai'],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('deduplicates outgoing bank references across refund cases and records each refund only once', async () => {
  const t = await table(),
    d = await dish(t.sid),
    payment = await pay(t.sid, d.amount);
  await ok('/core/items/' + d.item.id + '/waive', 'quyettruong05', {
    reason: 'Miễn tiền để kiểm tra hoàn',
  });
  const refunds = [];
  for (let n = 0; n < 2; n++)
    refunds.push(
      await ok('/core/sessions/' + t.sid + '/refunds', 'quyettruong05', {
        paymentId: payment.id,
        amount: '5000',
        reason: 'Hoàn từng phần',
        requestId: randomUUID(),
      }),
    );
  const reference = 'BANK-' + randomUUID();
  await ok('/core/refunds/' + refunds[0].id + '/complete', 'pv001', {
    method: 'BANK_TRANSFER',
    reference,
    amount: '5000',
    requestId: randomUUID(),
  });
  expect(
    (
      await req('/core/refunds/' + refunds[1].id + '/complete', 'pv001', {
        method: 'BANK_TRANSFER',
        reference,
        amount: '5000',
        requestId: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    await db.prisma.refund_transaction.count({ where: { refund_case_id: refunds[1].id } }),
  ).toBe(0);
});
