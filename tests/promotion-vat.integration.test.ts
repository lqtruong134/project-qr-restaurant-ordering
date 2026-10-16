import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { readBill, freezeReceipt } from '../apps/api/src/modules/payments/receipt.service.js';
import { receiptKey } from '../apps/api/src/modules/payments/completion.service.js';
import { transaction, session } from '../apps/api/src/modules/shared/core-persistence.js';
import { reverseItemCharge } from '../apps/api/src/modules/finance/ledger.service.js';
import { withTableCode } from './table-code-fixture.js';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
let host: Database, db: Database, app: ReturnType<typeof buildApp>;
const databaseName = 'thesis_promotion_' + randomBytes(6).toString('hex'),
  password = randomBytes(24).toString('hex');
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' },
  cookies: Record<string, string> = {};
async function request(
  path: string,
  body?: unknown,
  user = 'quyettruong05',
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = body === undefined ? 'GET' : 'POST',
) {
  return app.inject({
    method,
    url: path,
    headers: { ...headers, cookie: cookies[user] ?? user },
    payload: body as Record<string, unknown>,
  });
}
async function ok(
  path: string,
  body?: unknown,
  user?: string,
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE',
) {
  const r = await request(path, body, user, method);
  expect(r.statusCode, path + ' ' + r.body).toBe(200);
  return r.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  for (const dir of readdirSync('packages/database/prisma/migrations')
    .filter((x) => /^\d/.test(x))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + dir + '/migration.sql', 'utf8'),
    );
  await seed(db, password, { includeWorkforce: false });
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'p'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const user of ['quyettruong05', 'pv001', 'bep001']) {
    const r = await request('/auth/login', { username: user, password }, '');
    expect(r.statusCode).toBe(200);
    cookies[user] = r.cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_promotion_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);
async function table() {
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const t = await ok('/core/tables', {
    code: 'P-' + randomUUID().slice(0, 8),
    name: 'Bàn ưu đãi',
    areaId: area.id,
    capacity: 4,
  });
  const s = await ok('/core/tables/' + t.id + '/open', {}, 'pv001');
  return { t, s };
}
async function product(price = '49000', kind = 'DISH') {
  const category = await db.prisma.menu_category.findFirstOrThrow();
  return ok('/core/products', {
    code: 'P-' + randomUUID().slice(0, 8),
    name: 'Món ưu đãi',
    categoryId: category.id,
    price,
    stockManaged: false,
    ...(kind === 'COMBO' ? { productKind: kind } : {}),
  });
}
async function order(sid: string, pid: string, participant?: string) {
  const batch = await ok(
    '/core/sessions/' + sid + '/orders',
    { requestId: randomUUID(), lines: [{ productId: pid, quantity: 1 }] },
    'pv001',
  );
  const i = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
  if (participant)
    await db.pool.query('UPDATE order_item SET owner_participant_id=$2 WHERE id=$1', [
      i.id,
      participant,
    ]);
  return { batch, i };
}
function input(fields: Record<string, unknown> = {}) {
  return {
    name: 'Ưu đãi ' + randomUUID().slice(0, 8),
    description: 'Ưu đãi bữa ăn',
    mode: 'CODE',
    code: 'U' + randomUUID().replaceAll('-', '').slice(0, 8),
    type: 'PERCENT',
    percent: 10,
    fixedAmount: null,
    minEligibleAmount: '0',
    maxDiscountAmount: null,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    weekdays: [],
    startTime: null,
    endTime: null,
    scope: 'ALL',
    productIds: [],
    categoryIds: [],
    excludeCombos: true,
    usageLimit: null,
    status: 'ACTIVE',
    ...fields,
  };
}
const create = (fields: Record<string, unknown> = {}) =>
  ok('/core/admin/discount-programs', input(fields));
const apply = (sid: string, pid: string, requestId = randomUUID()) =>
  ok('/core/sessions/' + sid + '/promotion', { programId: pid, requestId }, 'pv001');
const bill = (sid: string) => ok('/core/sessions/' + sid + '/bill', undefined, 'pv001');
async function pay(sid: string, amount: string, fields: Record<string, unknown> = {}) {
  const pi = await ok(
    '/core/sessions/' + sid + '/payments',
    { requestId: randomUUID(), method: 'CASH', amount, ...fields },
    'pv001',
  );
  const paid = await ok(
    '/core/payments/' + pi.id + '/confirm',
    { amount, receivedAmount: '100000' },
    'pv001',
  );
  return { pi, paid };
}

it('limits basic discounts, validates conditions and role boundaries', async () => {
  expect((await request('/core/admin/discount-programs', input({ percent: 51 }))).statusCode).toBe(
    400,
  );
  expect(
    (
      await request(
        '/core/admin/discount-programs',
        input({ type: 'FIXED', fixedAmount: '30000', percent: null, minEligibleAmount: '50000' }),
      )
    ).statusCode,
  ).toBe(400);
  expect((await request('/core/admin/discount-programs', input(), 'pv001')).statusCode).toBe(403);
  expect((await request('/core/admin/tax-policies', undefined, 'pv001')).statusCode).toBe(403);
  expect(
    (
      await request(
        '/core/admin/discount-programs',
        input({ startTime: '22:00', endTime: '02:00' }),
      )
    ).statusCode,
  ).toBe(400);
});
it('extracts VAT after reduction; cash received, change and net payable remain distinct', async () => {
  const { s } = await table(),
    p = await product(),
    o = await order(s.id, p.id),
    promo = await create();
  const view = await apply(s.id, promo.id);
  expect(view.billing.payableAmount).toBe('44100');
  expect(view.billing.vatAmount).toBe('3267');
  const before = await bill(s.id);
  expect(before.account.charge_total).toBe('44100');
  expect(before.charges[0].amount).toBe('49000');
  expect(before.charges[0].discount_amount).toBe('4900');
  const { paid } = await pay(s.id, '44100');
  expect(paid.metadata.cashReceived).toBe('100000');
  expect(paid.metadata.changeGiven).toBe('55900');
  await transaction(db, async (c) => {
    await session(c, s.id, restaurantId);
    await reverseItemCharge(c, o.i.id, s.id);
  });
  const after = await bill(s.id);
  expect(after.account.refund_due_amount).toBe('44100');
  const refund = await ok('/core/sessions/' + s.id + '/refunds', {
    paymentId: paid.id,
    amount: '44100',
    reason: 'Nhà hàng hủy món',
    requestId: randomUUID(),
  });
  expect(
    (
      await request('/core/refunds/' + refund.id + '/complete', {
        amount: '44100',
        method: 'CASH',
        requestId: randomUUID(),
      })
    ).statusCode,
  ).toBe(403);
  await ok(
    '/core/refunds/' + refund.id + '/complete',
    { amount: '44100', method: 'CASH', requestId: randomUUID() },
    'pv001',
  );
  expect((await bill(s.id)).account.refund_due_amount).toBe('0');
});
it('freezes paid line snapshots, leaves new food undiscounted and retains remaining benefit after cancellation', async () => {
  const { s } = await table(),
    p = await product('60000'),
    a = await order(s.id, p.id),
    b = await order(s.id, p.id),
    promo = await create({ minEligibleAmount: '100000' });
  await apply(s.id, promo.id);
  await pay(s.id, '54000');
  const original = (
    await db.pool.query(
      'SELECT discount_amount,tax_snapshot,tax_amount FROM financial_charge WHERE order_item_id=$1',
      [b.i.id],
    )
  ).rows[0];
  await order(s.id, p.id);
  expect((await bill(s.id)).billing.discountAmount).toBe('12000');
  await transaction(db, async (c) => {
    await session(c, s.id, restaurantId);
    await reverseItemCharge(c, a.i.id, s.id);
  });
  const after = await bill(s.id);
  expect(after.billing.discountAmount).toBe('6000');
  expect(after.billing.promotion.discountAmount).toBe('6000');
  expect(after.billing.payableAmount).toBe('114000');
  expect(
    (
      await db.pool.query(
        'SELECT discount_amount,tax_snapshot,tax_amount FROM financial_charge WHERE order_item_id=$1',
        [b.i.id],
      )
    ).rows[0],
  ).toEqual(original);
  expect(
    (
      await request(
        '/core/sessions/' + s.id + '/promotion',
        { requestId: randomUUID() },
        'pv001',
        'DELETE',
      )
    ).statusCode,
  ).toBe(409);
  await expect(
    db.pool.query('UPDATE financial_charge SET discount_amount=0 WHERE order_item_id=$1', [b.i.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('revalidates minimum before payment when food is cancelled', async () => {
  const { s } = await table(),
    p = await product('60000'),
    a = await order(s.id, p.id);
  await order(s.id, p.id);
  const promo = await create({
    type: 'FIXED',
    percent: null,
    fixedAmount: '30000',
    minEligibleAmount: '100000',
  });
  await apply(s.id, promo.id);
  expect((await bill(s.id)).billing.discountAmount).toBe('30000');
  await transaction(db, async (c) => {
    await session(c, s.id, restaurantId);
    await reverseItemCharge(c, a.i.id, s.id);
  });
  const after = await bill(s.id);
  expect(after.billing.discountAmount).toBe('0');
  expect(after.account.charge_total).toBe('60000');
  expect(after.billing.promotion.reason).toContain('40.000');
});
it('blocks changes during a pending collection and allows them after cancellation', async () => {
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  const promo = await create();
  await apply(s.id, promo.id);
  const pi = await ok(
    '/core/sessions/' + s.id + '/payments',
    { requestId: randomUUID(), method: 'CASH', amount: '44100' },
    'pv001',
  );
  expect(
    (
      await request(
        '/core/sessions/' + s.id + '/promotion',
        { requestId: randomUUID() },
        'pv001',
        'DELETE',
      )
    ).statusCode,
  ).toBe(409);
  await ok('/core/payments/' + pi.id + '/cancel', {}, 'pv001');
  await ok('/core/sessions/' + s.id + '/promotion', { requestId: randomUUID() }, 'pv001', 'DELETE');
  expect((await bill(s.id)).account.charge_total).toBe('49000');
});
it('reserves the final global use concurrently and releases it on removal; replay is idempotent', async () => {
  const p = await product(),
    a = await table(),
    b = await table();
  await order(a.s.id, p.id);
  await order(b.s.id, p.id);
  const promo = await create({ usageLimit: 1 });
  const key = randomUUID(),
    results = await Promise.all([
      request(
        '/core/sessions/' + a.s.id + '/promotion',
        { programId: promo.id, requestId: key },
        'pv001',
      ),
      request(
        '/core/sessions/' + b.s.id + '/promotion',
        { programId: promo.id, requestId: randomUUID() },
        'pv001',
      ),
    ]);
  expect(results.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  const first = results[0].statusCode === 200 ? a : b,
    second = first === a ? b : a;
  if (first === a) {
    expect((await apply(first.s.id, promo.id, key)).billing.discountAmount).toBe('4900');
    expect(
      (
        await request(
          '/core/sessions/' + first.s.id + '/promotion',
          { programId: promo.id, requestId: key, code: 'OTHER' },
          'pv001',
        )
      ).statusCode,
    ).toBe(409);
  }
  await ok(
    '/core/sessions/' + first.s.id + '/promotion',
    { requestId: randomUUID() },
    'pv001',
    'DELETE',
  );
  await apply(second.s.id, promo.id);
  await pay(second.s.id, '44100');
  expect(
    (
      await request(
        '/core/sessions/' + first.s.id + '/promotion',
        { programId: promo.id, requestId: randomUUID() },
        'pv001',
      )
    ).statusCode,
  ).toBe(409);
  const programs = await ok('/core/admin/discount-programs');
  expect(programs.find((x: { id: string }) => x.id === promo.id).usedCount).toBe(1);
});
it('releases expired holds, rejects expired programs, and prevents combo value contributing to thresholds', async () => {
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  const promo = await create({ usageLimit: 1 });
  await apply(s.id, promo.id);
  await db.pool.query(
    "UPDATE session_promotion SET expires_at=now()-interval '1 second' WHERE session_id=$1",
    [s.id],
  );
  const next = await table();
  await order(next.s.id, p.id);
  await apply(next.s.id, promo.id);
  expect((await bill(s.id)).billing.discountAmount).toBe('0');
  const expired = await create({
    startsAt: new Date(Date.now() - 120000).toISOString(),
    endsAt: new Date(Date.now() - 60000).toISOString(),
  });
  expect(
    (
      await request(
        '/core/sessions/' + s.id + '/promotion',
        { programId: expired.id, requestId: randomUUID() },
        'pv001',
      )
    ).statusCode,
  ).toBe(409);
  const combo = await db.prisma.product.findFirstOrThrow({ where: { code: 'COMBO-01' } }),
    comboTable = await table();
  await order(comboTable.s.id, combo.id);
  const threshold = await create({ minEligibleAmount: '90000' });
  const response = await request(
    '/core/sessions/' + comboTable.s.id + '/promotion',
    { programId: threshold.id, requestId: randomUUID() },
    'pv001',
  );
  expect(response.statusCode).toBe(409);
  expect(response.body).toContain('Combo');
});
it('chooses the best automatic benefit, explicit code overrides it, removal suppresses it', async () => {
  const a = await create({ mode: 'AUTO', code: null, percent: 5 }),
    b = await create({ mode: 'AUTO', code: null, percent: 15 }),
    code = await create({ percent: 10 });
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  expect((await bill(s.id)).billing.promotion.id).toBe(b.id);
  await apply(s.id, code.id);
  expect((await bill(s.id)).billing.promotion.id).toBe(code.id);
  await ok('/core/sessions/' + s.id + '/promotion', { requestId: randomUUID() }, 'pv001', 'DELETE');
  expect((await bill(s.id)).billing.discountAmount).toBe('0');
  for (const program of [a, b])
    await ok(
      '/core/admin/discount-programs/' + program.id,
      { ...program, status: 'PAUSED' },
      undefined,
      'PATCH',
    );
});
it('distinguishes mixed VAT groups, exempt and zero; changing product tax does not rewrite ordered lines', async () => {
  const { s } = await table();
  const products = [];
  for (const tax of [
    { treatment: 'TAXABLE', ratePercent: 5 },
    { treatment: 'TAXABLE', ratePercent: 10 },
    { treatment: 'TAXABLE', ratePercent: 0 },
    { treatment: 'EXEMPT', ratePercent: null },
  ]) {
    const p = await product('10500');
    await ok(
      '/core/products/' + p.id + '/tax',
      { ...tax, version: p.version, reason: 'Phân loại VAT theo danh mục' },
      undefined,
      'PATCH',
    );
    await order(s.id, p.id);
    products.push(p);
  }
  const before = await bill(s.id);
  expect(before.billing.vatGroups).toHaveLength(4);
  expect(before.billing.payableAmount).toBe('42000');
  const old = before.billing.lines;
  const current = await db.prisma.product.findUniqueOrThrow({ where: { id: products[0].id } });
  await ok(
    '/core/products/' + current.id + '/tax',
    {
      treatment: 'TAXABLE',
      ratePercent: 8,
      version: current.version,
      reason: 'Phân loại cho món gọi mới',
    },
    undefined,
    'PATCH',
  );
  expect((await bill(s.id)).billing.lines).toEqual(old);
});
it('keeps closed snapshots identical and captures promotion/VAT in receipt fingerprint', async () => {
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  const keyBefore = await transaction(db, (c) => receiptKey(c, s.id));
  const promo = await create();
  await apply(s.id, promo.id);
  const keyAfter = await transaction(db, (c) => receiptKey(c, s.id));
  expect(keyBefore).not.toBe(keyAfter);
  expect(await transaction(db, (c) => receiptKey(c, s.id))).toBe(keyAfter);
  await pay(s.id, '44100');
  const admin = await db.prisma.app_user.findUniqueOrThrow({
    where: { restaurant_id_username: { restaurant_id: restaurantId, username: 'quyettruong05' } },
  });
  await transaction(db, async (c) => {
    await session(c, s.id, restaurantId);
    await c.query(
      "UPDATE table_session SET session_status='CLOSED',closed_at=now(),close_reason='Hoàn tất thanh toán' WHERE id=$1",
      [s.id],
    );
    await freezeReceipt(c, s.id, restaurantId, admin.id);
  });
  const before = await bill(s.id);
  await ok(
    '/core/admin/discount-programs/' + promo.id,
    { ...promo, percent: 20 },
    undefined,
    'PATCH',
  );
  const after = await bill(s.id);
  expect(after).toEqual(before);
  expect(
    (
      await request(
        '/core/sessions/' + s.id + '/promotion',
        { programId: promo.id, requestId: randomUUID() },
        'pv001',
      )
    ).statusCode,
  ).toBe(409);
});
it('future VAT policies have audit reasons; current prices and historical gross are not changed', async () => {
  const settings = await ok('/core/admin/tax-policies');
  expect(settings.priceIncludesVat).toBe(true);
  expect(settings.current.defaultRatePercent).toBe(8);
  expect(
    settings.policies.some(
      (x: { effectiveAt: string; defaultRatePercent: number }) =>
        x.effectiveAt === '2026-12-31T17:00:00.000Z' && x.defaultRatePercent === 10,
    ),
  ).toBe(true);
  expect(
    (
      await request('/core/admin/tax-policies', {
        effectiveAt: new Date(Date.now() - 60000).toISOString(),
        defaultRatePercent: 5,
        reason: 'Áp dụng lại lịch sử',
      })
    ).statusCode,
  ).toBe(400);
  await ok('/core/admin/tax-policies', {
    effectiveAt: new Date(Date.now() + 86400000).toISOString(),
    defaultRatePercent: 5,
    reason: 'Chính sách mới áp dụng tương lai',
  });
});
it('guest codes are checked by the server for the guest own session', async () => {
  const { t, s } = await table(),
    p = await product();
  await order(s.id, p.id);
  const qr = await ok('/core/tables/' + t.id + '/qr', {}, 'quyettruong05');
  const payload = await withTableCode(app, db, cookies.pv001!, headers, {
    token: qr.joinPath.split('#')[1],
    name: 'Khách ưu đãi',
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  const joined = await request('/guest/join', payload, '');
  expect(joined.statusCode).toBe(200);
  const guestCookie = joined.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const promo = await create();
  const applied = await ok(
    '/guest/promotion',
    { code: promo.code, requestId: randomUUID() },
    guestCookie,
  );
  expect(applied.billing.discountAmount).toBe('4900');
  expect((await ok('/guest/state', undefined, guestCookie)).account.charge_total).toBe('44100');
  expect((await request('/core/admin/discount-programs', input(), guestCookie)).statusCode).toBe(
    401,
  );
});

async function joinGuest(tid: string, name: string) {
  const qr = await ok('/core/tables/' + tid + '/qr', {}, 'quyettruong05');
  const payload = await withTableCode(app, db, cookies.pv001!, headers, {
    token: qr.joinPath.split('#')[1],
    name,
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  const response = await request('/guest/join', payload, '');
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: response.cookies.map((c) => c.name + '=' + c.value).join('; '),
    id: response.json().participantId,
  };
}
async function guestOrder(cookie: string, pid: string) {
  const state = await ok('/guest/state', undefined, cookie);
  const cart = await ok(
    '/guest/cart',
    { cartVersion: state.cart.cart_version, productId: pid, quantity: 1 },
    cookie,
  );
  const updated = await ok('/guest/state', undefined, cookie);
  return ok(
    '/guest/orders',
    { requestId: randomUUID(), cartVersion: updated.cart.cart_version, itemIds: [cart.id] },
    cookie,
  );
}
it('distributes the bill discount into participant dues and rejects another participant overpayment', async () => {
  const { s, t } = await table(),
    p = await product('49000'),
    q = await product('79000');
  const alice = await joinGuest(t.id, 'Lan'),
    bob = await joinGuest(t.id, 'Minh');
  await guestOrder(alice.cookie, p.id);
  await guestOrder(bob.cookie, q.id);
  const promo = await create();
  await apply(s.id, promo.id);
  const before = await bill(s.id);
  expect(before.billing.payableAmount).toBe('115200');
  const tooMuch = await request(
    '/core/sessions/' + s.id + '/payments',
    {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '49000',
      collectionScope: 'PARTICIPANT',
      participantId: alice.id,
    },
    'pv001',
  );
  expect(tooMuch.statusCode).toBe(409);
  await pay(s.id, '44100', { collectionScope: 'PARTICIPANT', participantId: alice.id });
  const allocations = (
    await db.pool.query(
      'SELECT i.owner_participant_id FROM payment_allocation a JOIN financial_charge f ON f.id=a.financial_charge_id JOIN order_item i ON i.id=f.order_item_id WHERE f.session_id=$1',
      [s.id],
    )
  ).rows;
  expect(allocations.every((row) => row.owner_participant_id === alice.id)).toBe(true);
  expect((await bill(s.id)).account.outstanding_amount).toBe('71100');
});
it('supports scoped benefits and gives a precise deficit excluding combo price', async () => {
  const { s } = await table(),
    p = await product('49000'),
    q = await product('60000');
  await order(s.id, p.id);
  await order(s.id, q.id);
  const promo = await create({ scope: 'PRODUCTS', productIds: [p.id], minEligibleAmount: '50000' });
  const r = await request(
    '/core/sessions/' + s.id + '/promotion',
    { programId: promo.id, requestId: randomUUID() },
    'pv001',
  );
  expect(r.statusCode).toBe(409);
  expect(r.body).toContain('1.000');
  const good = await create({ scope: 'PRODUCTS', productIds: [p.id] });
  await apply(s.id, good.id);
  expect((await bill(s.id)).billing.discountAmount).toBe('4900');
});
it('serializes simultaneous different-code selections and preserves one program per table', async () => {
  const a = await table(),
    b = await table(),
    p = await product();
  await order(a.s.id, p.id);
  await order(b.s.id, p.id);
  const first = await create(),
    second = await create({ percent: 20 });
  const results = await Promise.all([
    request(
      '/core/sessions/' + a.s.id + '/promotion',
      { programId: first.id, requestId: randomUUID() },
      'pv001',
    ),
    request(
      '/core/sessions/' + b.s.id + '/promotion',
      { programId: second.id, requestId: randomUUID() },
      'pv001',
    ),
  ]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  await apply(a.s.id, second.id);
  const count = await db.pool.query(
    'SELECT count(*)::int AS n FROM session_promotion WHERE session_id=$1',
    [a.s.id],
  );
  expect(count.rows[0].n).toBe(1);
  expect((await bill(a.s.id)).billing.discountAmount).toBe('9800');
});
it('updates unpaid quotes after admin pause or edit, but retains paid program names and benefits', async () => {
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  const promo = await create();
  await apply(s.id, promo.id);
  const changed = await ok(
    '/core/admin/discount-programs/' + promo.id,
    { ...promo, percent: 20 },
    undefined,
    'PATCH',
  );
  expect((await bill(s.id)).billing.discountAmount).toBe('9800');
  expect(
    (
      await request(
        '/core/admin/discount-programs/' + promo.id,
        { ...promo, percent: 30 },
        undefined,
        'PATCH',
      )
    ).statusCode,
  ).toBe(409);
  await pay(s.id, '39200');
  await ok(
    '/core/admin/discount-programs/' + promo.id,
    { ...changed, name: 'Tên mới', status: 'PAUSED' },
    undefined,
    'PATCH',
  );
  const saved = await bill(s.id);
  expect(saved.billing.discountAmount).toBe('9800');
  expect(saved.billing.promotion.name).toBe(promo.name);
  const history = await ok('/core/admin/discount-programs/' + promo.id + '/history');
  expect(history.versions).toHaveLength(3);
  expect(history.redemptions[0].status).toBe('USED');
});
it('SQL guards reject net over-allocation, tax snapshot rewriting and wrong-tenant program scopes', async () => {
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  const promo = await create();
  await apply(s.id, promo.id);
  const { paid } = await pay(s.id, '44100');
  const charge = (await db.pool.query('SELECT * FROM financial_charge WHERE session_id=$1', [s.id]))
    .rows[0];
  await expect(
    db.pool.query(
      "UPDATE financial_charge SET tax_snapshot=jsonb_set(tax_snapshot,'{ratePercent}','10') WHERE id=$1",
      [charge.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query(
      'INSERT INTO payment_allocation(payment_transaction_id,financial_charge_id,allocated_amount) VALUES($1,$2,$3)',
      [paid.id, charge.id, '1'],
    ),
  ).rejects.toBeDefined();
  expect(
    (
      await request(
        '/core/admin/discount-programs',
        input({ scope: 'PRODUCTS', productIds: [randomUUID()] }),
      )
    ).statusCode,
  ).toBe(409);
});
it('keeps VAT-unknown historical receipts unchanged and does not add an assumed tax line', async () => {
  const { s } = await table();
  const admin = await db.prisma.app_user.findUniqueOrThrow({
    where: { restaurant_id_username: { restaurant_id: restaurantId, username: 'quyettruong05' } },
  });
  const legacy = {
    session: { id: s.id },
    account: { charge_total: '49000' },
    payments: [],
    charges: [{ id: randomUUID(), amount: '49000', status: 'ACTIVE' }],
    generatedAt: '2026-08-01T00:00:00Z',
  };
  await db.pool.query(
    "UPDATE table_session SET session_status='CLOSED',closed_at=now(),close_reason='Phiếu cũ',receipt_snapshot=$2::jsonb,closed_by=$3,receipt_number='PT-CU-001' WHERE id=$1",
    [s.id, JSON.stringify(legacy), admin.id],
  );
  const result = await transaction(db, async (c) =>
    readBill(c, await session(c, s.id, restaurantId, false), restaurantId),
  );
  expect(result).toEqual(legacy);
  expect(result).not.toHaveProperty('billing');
});

it('appends policy versions at the same future instant while preserving superseded records', async () => {
  const effectiveAt = new Date(Date.now() + 172800000).toISOString();
  const a = await ok('/core/admin/tax-policies', {
    effectiveAt,
    defaultRatePercent: 5,
    reason: 'Chính sách dự kiến đầu tiên',
  });
  const b = await ok('/core/admin/tax-policies', {
    effectiveAt,
    defaultRatePercent: 10,
    reason: 'Thay thế chính sách dự kiến',
  });
  expect(b.version).toBeGreaterThan(a.version);
  const policies = (await ok('/core/admin/tax-policies')).policies.filter(
    (x: { effectiveAt: string }) => x.effectiveAt === effectiveAt,
  );
  expect(policies.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
  await expect(
    db.pool.query('UPDATE restaurant_tax_policy SET default_rate_percent=8 WHERE id=$1', [a.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('tax-aware sales reports distinguish menu subtotal, savings, VAT and margin', async () => {
  const { s } = await table(),
    p = await product('108000'),
    { i } = await order(s.id, p.id),
    promo = await create();
  await apply(s.id, promo.id);
  await db.pool.query("UPDATE order_item SET status='SERVED',served_at=now() WHERE id=$1", [i.id]);
  const report = await ok(
    '/core/admin/reports?view=sales&period=today&search=' + encodeURIComponent('Món ưu đãi'),
  );
  const row = report.rows.find((x: { product_id: string }) => x.product_id === p.id);
  expect(row.subtotal).toBe('108000');
  expect(row.discountAmount).toBe('10800');
  expect(row.sales).toBe('97200');
  expect(row.vat).toBe('7200');
  expect(row.beforeVatSales).toBe('90000');
  expect(row.margin).toBe('90000');
  expect(row.legacyTaxUnavailable).toBe(false);
});
it('SQL allocation cap uses discounted due even before a successful payment exists', async () => {
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  await apply(s.id, (await create()).id);
  const charge = (
    await db.pool.query('SELECT id FROM financial_charge WHERE session_id=$1', [s.id])
  ).rows[0];
  await expect(
    transaction(db, async (c) => {
      await session(c, s.id, restaurantId);
      const payment = (
        await c.query(
          "INSERT INTO payment_transaction(session_id,method,amount,currency,status,confirmed_at) VALUES($1,'CASH',49000,'VND','SUCCEEDED',now()) RETURNING id",
          [s.id],
        )
      ).rows[0];
      await c.query(
        'INSERT INTO payment_allocation(payment_transaction_id,financial_charge_id,allocated_amount) VALUES($1,$2,49000)',
        [payment.id, charge.id],
      );
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect((await bill(s.id)).account.paid_total).toBe('0');
});

it('SQL rejects explicit-null VAT snapshots and prevents changing a reserved status during collection', async () => {
  const { s } = await table(),
    p = await product();
  await order(s.id, p.id);
  await apply(s.id, (await create()).id);
  const bad = {
    version: null,
    priceIncludesVat: true,
    treatment: 'TAXABLE',
    ratePercent: null,
    policyId: null,
    policyVersion: null,
  };
  await expect(
    db.pool.query(
      "INSERT INTO financial_charge(session_id,charge_type,amount,tax_snapshot,tax_amount) VALUES($1,'ADJUSTMENT',1000,$2,0)",
      [s.id, JSON.stringify(bad)],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const pi = await ok(
    '/core/sessions/' + s.id + '/payments',
    { requestId: randomUUID(), method: 'CASH', amount: '44100' },
    'pv001',
  );
  await expect(
    db.pool.query("UPDATE session_promotion SET status='SELECTED' WHERE session_id=$1", [s.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await ok('/core/payments/' + pi.id + '/cancel', {}, 'pv001');
  await expect(
    db.pool.query(
      "INSERT INTO promotion_request(session_id,actor_type,actor_id,request_key,request_hash,response_snapshot) VALUES($1,'GUEST',$2,'bad','bad','{}')",
      [s.id, randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
