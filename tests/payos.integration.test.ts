import {
  ingestConnector,
  connectorSignature,
} from '../apps/api/src/modules/payments/webhooks.routes.js';
import { restaurantPolicy, type GuestOnlinePayment } from '../packages/contracts/src/index.js';
import { readGuestOnlinePayments } from '../apps/api/src/modules/sessions/guest-payment-view.js';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WebhookData } from '../apps/api/src/modules/payments/payos-adapter.js';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { PayosService } from '../apps/api/src/modules/payments/payos.service.js';
import { maintainCore } from '../apps/api/src/modules/notifications/maintenance.js';
import { config, signature, FakeProvider } from './helpers/payos-provider-fixture.js';
let host: Database, db: Database, app: ReturnType<typeof buildApp>, service: PayosService;
const provider = new FakeProvider();
const name = 'thesis_payos_' + randomBytes(7).toString('hex'),
  password = randomBytes(24).toString('hex'),
  image = mkdtempSync(join(tmpdir(), 'thesis-payos-')),
  oldImage = process.env.MENU_UPLOAD_DIR;
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' },
  cookies: Record<string, string> = {};
async function request(
  url: string,
  body?: Record<string, unknown>,
  user = 'pv001',
  method: 'GET' | 'POST' | 'PATCH' = body ? 'POST' : 'GET',
) {
  return app.inject({
    url,
    method,
    headers: { ...headers, cookie: cookies[user] ?? user },
    payload: body,
  });
}
async function ok(
  url: string,
  body?: Record<string, unknown>,
  user = 'pv001',
  method?: 'GET' | 'POST' | 'PATCH',
) {
  const r = await request(url, body, user, method);
  expect(r.statusCode, url + ':' + r.body).toBe(200);
  return r.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error(
      'payOS integration fixtures require the isolated local development PostgreSQL host.',
    );
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  db = createDatabase(url.toString());
  for (const m of readdirSync('packages/database/prisma/migrations')
    .filter((n) => /^\d/.test(n))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + m + '/migration.sql', 'utf8'),
    );
  process.env.MENU_UPLOAD_DIR = image;
  await seed(db, password, { includeWorkforce: false });
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'q'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId, false, { config, provider });
  service = new PayosService(db, restaurantId, { config, provider });
  for (const u of ['quyettruong05', 'pv001', 'pv002', 'bep001']) {
    const r = await request('/auth/login', { username: u, password }, '');
    expect(r.statusCode, r.body).toBe(200);
    cookies[u] = r.cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(name).toMatch(/^thesis_payos_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
  if (oldImage === undefined) delete process.env.MENU_UPLOAD_DIR;
  else process.env.MENU_UPLOAD_DIR = oldImage;
  rmSync(image, { recursive: true, force: true });
});
async function party(price = '450000') {
  const area = await db.prisma.dining_area.findFirstOrThrow(),
    category = await db.prisma.menu_category.findFirstOrThrow();
  const table = await ok(
    '/core/tables',
    { code: 'PO-' + randomUUID().slice(0, 7), name: 'Bàn online', areaId: area.id, capacity: 4 },
    'quyettruong05',
  );
  const s = await ok('/core/tables/' + table.id + '/open', {});
  const product = await ok(
    '/core/products',
    {
      code: 'PO-' + randomUUID().slice(0, 7),
      name: 'Món online',
      categoryId: category.id,
      price,
      stockManaged: false,
    },
    'quyettruong05',
  );
  const batch = await ok('/core/sessions/' + s.id + '/orders', {
    requestId: randomUUID(),
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
  return { sid: s.id, table, item, product };
}
const bill = (sid: string) => ok('/core/sessions/' + sid + '/bill');
const create = (sid: string, amount: string, extra: Record<string, unknown> = {}) =>
  ok('/core/sessions/' + sid + '/payments', {
    requestId: randomUUID(),
    method: 'ONLINE',
    amount,
    ...extra,
  });
async function webhook(i: Record<string, unknown>, amount: number, mutate?: Partial<WebhookData>) {
  const orderCode = Number((i.online as { orderCode: string }).orderCode),
    bank = provider.add(orderCode, amount),
    link = provider.links.get(orderCode)!;
  const data: WebhookData = {
    orderCode,
    amount,
    description: bank.description,
    accountNumber: bank.accountNumber,
    reference: bank.reference,
    transactionDateTime: bank.transactionDateTime,
    currency: 'VND',
    paymentLinkId: link.id,
    code: '00',
    desc: 'Thành công',
    ...mutate,
  };
  const signed = signature(data);
  return { code: '00', desc: 'success', success: true, data, signature: signed };
}
const deliver = (payload: unknown) =>
  app.inject({
    url: '/payments/webhooks/payos',
    method: 'POST',
    payload: payload as Record<string, unknown>,
  });
it('creates online only for STAFF, owns amount/net/URLs and persists safe QR after refresh', async () => {
  const p = await party('49000');
  const i = await create(p.sid, '49000');
  expect(i).toMatchObject({
    method: 'ONLINE',
    status: 'PENDING',
    provider: 'PAYOS',
    online: { provider: 'PAYOS', status: 'PENDING', paidAmount: '0', remainingAmount: '49000' },
  });
  expect(i.online.qrCode).toMatch(/^FAKE_QR_/);
  const b = await bill(p.sid);
  expect(b.paymentCapabilities.online).toBe(true);
  expect(b.intents[0].online).toEqual(i.online);
  expect(JSON.stringify(b)).not.toContain(config.apiKey);
  expect(
    (
      await request(
        '/core/sessions/' + p.sid + '/payments',
        { requestId: randomUUID(), method: 'ONLINE', amount: '1' },
        'bep001',
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        '/guest/payments',
        { requestId: randomUUID(), method: 'ONLINE', amount: '1' },
        '',
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (await request('/core/payments/' + i.id + '/confirm', { amount: '49000' })).statusCode,
  ).toBe(403);
});
it('rejects invalid, over outstanding, reserved overlap and forged participant scope', async () => {
  const p = await party('10000');
  for (const amount of ['0', '10001', '1.2', '-1'])
    expect(
      (
        await request('/core/sessions/' + p.sid + '/payments', {
          requestId: randomUUID(),
          method: 'ONLINE',
          amount,
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
  await create(p.sid, '8000');
  expect(
    (
      await request('/core/sessions/' + p.sid + '/payments', {
        requestId: randomUUID(),
        method: 'CASH',
        amount: '3000',
      })
    ).statusCode,
  ).toBe(409);
  const other = await party('10000');
  expect(
    (
      await request('/core/sessions/' + other.sid + '/payments', {
        requestId: randomUUID(),
        method: 'ONLINE',
        amount: '1000',
        collectionScope: 'PARTICIPANT',
        participantId: randomUUID(),
      })
    ).statusCode,
  ).toBe(404);
});
it('idempotent create retries recover one provider order and rejects changed request content', async () => {
  const p = await party('10000'),
    key = randomUUID(),
    body = { requestId: key, method: 'ONLINE', amount: '10000' },
    before = provider.creates;
  const first = await ok('/core/sessions/' + p.sid + '/payments', body);
  const second = await ok('/core/sessions/' + p.sid + '/payments', body);
  expect(second.id).toBe(first.id);
  expect(provider.creates - before).toBe(1);
  expect(
    (await request('/core/sessions/' + p.sid + '/payments', { ...body, amount: '9999' }))
      .statusCode,
  ).toBe(409);
});
it('cash200k + payOS150k + payOS100k settle450k without manual online confirm', async () => {
  const p = await party();
  const cash = await ok('/core/sessions/' + p.sid + '/payments', {
    requestId: randomUUID(),
    method: 'CASH',
    amount: '200000',
  });
  await ok('/core/payments/' + cash.id + '/confirm', {
    amount: '200000',
    receivedAmount: '200000',
  });
  const a = await create(p.sid, '150000');
  expect((await deliver(await webhook(a, 150000))).statusCode).toBe(200);
  expect((await bill(p.sid)).account.outstanding_amount).toBe('100000');
  const b = await create(p.sid, '100000');
  expect((await deliver(await webhook(b, 100000))).statusCode).toBe(200);
  const last = await bill(p.sid);
  expect(last.account).toMatchObject({
    paid_total: '450000',
    reserved_payment_amount: '0',
    outstanding_amount: '0',
  });
  expect(last.payments).toHaveLength(3);
  expect(
    last.payments
      .filter((x: { method: string }) => x.method === 'ONLINE')
      .every((x: { confirmed_by: unknown }) => x.confirmed_by === null),
  ).toBe(true);
});
it('UNDERPAID credits actual bank receipts and reserves only remaining, then fully succeeds', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  await deliver(await webhook(i, 3000));
  let b = await bill(p.sid);
  expect(b.account).toMatchObject({
    paid_total: '3000',
    outstanding_amount: '7000',
    reserved_payment_amount: '7000',
  });
  expect(b.intents[0].online).toMatchObject({
    status: 'UNDERPAID',
    paidAmount: '3000',
    remainingAmount: '7000',
  });
  expect(b.intents[0].status).toBe('PENDING');
  await deliver(await webhook(i, 7000));
  b = await bill(p.sid);
  expect(b.payments).toHaveLength(2);
  expect(b.intents[0].status).toBe('SUCCEEDED');
  expect(b.account.outstanding_amount).toBe('0');
});
it('duplicate/retry/concurrent valid webhooks record each bank reference once', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000'),
    payload = await webhook(i, 10000);
  const replies = await Promise.all(Array.from({ length: 10 }, () => deliver(payload)));
  expect(replies.every((r) => r.statusCode === 200)).toBe(true);
  const b = await bill(p.sid);
  expect(b.payments).toHaveLength(1);
  expect(b.account.paid_total).toBe('10000');
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM payment_webhook_event WHERE provider='PAYOS' AND provider_event_id=$1",
        [payload.data.reference],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('invalid signature and signed wrong link/currency cannot credit money', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  const data = await webhook(i, 10000);
  expect((await deliver({ ...data, signature: '0'.repeat(64) })).statusCode).toBe(400);
  const wrong = { ...data.data, paymentLinkId: 'wrong-link' };
  const r = await deliver({ ...data, data: wrong, signature: signature(wrong) });
  expect(r.statusCode).toBe(200);
  expect((await bill(p.sid)).account.paid_total).toBe('0');
});
it('valid unknown registration probe is durable UNMATCHED without ledger credit', async () => {
  const data = {
    orderCode: 0,
    amount: 3000,
    description: 'test',
    accountNumber: '12345678',
    reference: randomUUID(),
    transactionDateTime: '2023-02-04 18:25:00',
    currency: 'VND',
    paymentLinkId: 'test-link',
    code: '00',
    desc: 'success',
  };
  const response = await deliver({
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: signature(data),
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().status).toBe('UNMATCHED');
  expect(
    (
      await db.pool.query(
        "SELECT processing_status,payload_snapshot FROM payment_webhook_event WHERE provider='PAYOS' AND provider_event_id=$1",
        [data.reference],
      )
    ).rows[0],
  ).toMatchObject({ processing_status: 'UNMATCHED' });
});
it('provider failure redacts errors, retains reservation and blocks alternate collection until known', async () => {
  const p = await party('10000');
  provider.failGet = true;
  try {
    const i = await create(p.sid, '10000');
    expect(i.online.status).toBe('ERROR');
    expect(JSON.stringify(i)).not.toContain('FAKE_SECRET');
    expect((await bill(p.sid)).account.reserved_payment_amount).toBe('10000');
    expect(
      (
        await request('/core/sessions/' + p.sid + '/payments', {
          requestId: randomUUID(),
          method: 'CASH',
          amount: '1',
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    provider.failGet = false;
  }
});
it('lost create response recovers stable orderCode via GET and checkout without inventing QR', async () => {
  const p = await party('10000'),
    before = provider.creates;
  provider.loseCreateResponse = true;
  const i = await create(p.sid, '10000');
  expect(i.online.status).toBe('ERROR');
  const next = await ok('/core/payments/' + i.id + '/refresh', {});
  expect(next.id).toBe(i.id);
  expect(next.online.checkoutUrl).toMatch(/^https:\/\/pay.payos.vn\/web\//);
  expect(next.online.qrCode).toBeNull();
  expect(provider.creates - before).toBe(1);
});
it('cancellation needs provider acknowledgement and never releases unknown bank outcome', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  provider.failCancel = true;
  try {
    const cancelled = await ok('/core/payments/' + i.id + '/cancel', {});
    expect(cancelled.online.status).toBe('CANCEL_PENDING');
    expect((await bill(p.sid)).account.reserved_payment_amount).toBe('10000');
  } finally {
    provider.failCancel = false;
  }
  const confirmed = await ok('/core/payments/' + i.id + '/cancel', {});
  expect(confirmed.online.status).toBe('CANCELLED');
  expect((await bill(p.sid)).account.reserved_payment_amount).toBe('0');
  expect(provider.cancels).toBeGreaterThan(0);
});
it('maintenance confirms provider cancellation for expired intent before release', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  await db.pool.query(
    "UPDATE payment_intent SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",
    [i.id],
  );
  await db.pool.query(
    'UPDATE payos_payment_request SET next_poll_at=now() WHERE payment_intent_id=$1',
    [i.id],
  );
  await maintainCore(db, restaurantId, service);
  const b = await bill(p.sid);
  expect(['CANCELLED', 'EXPIRED']).toContain(b.intents[0].status);
  expect(b.account.reserved_payment_amount).toBe('0');
});
it('late active payment is recorded once, flagged for admin and blocks closing until reconciled', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  await ok('/core/payments/' + i.id + '/cancel', {});
  const data = await webhook(i, 10000);
  expect((await deliver(data)).statusCode).toBe(200);
  const b = await bill(p.sid);
  expect(b.account.paid_total).toBe('10000');
  expect(b.intents[0].status).toBe('REQUIRES_RECONCILIATION');
  expect(
    b.closure.blockers.some((x: { code: string }) => x.code === 'PAYMENT_REQUIRES_RECONCILIATION'),
  ).toBe(true);
  expect(
    (
      await request(
        '/core/admin/payment-reconciliation/' + i.id + '/resolve',
        { resolution: 'RECONCILED', reason: 'Đã đối chiếu tiền thực nhận' },
        'pv001',
      )
    ).statusCode,
  ).toBe(403);
  const cases = await ok('/core/admin/payment-reconciliation', undefined, 'quyettruong05');
  expect(cases.some((x: { id: string }) => x.id === i.id)).toBe(true);
  await ok(
    '/core/admin/payment-reconciliation/' + i.id + '/resolve',
    { resolution: 'RECONCILED', reason: 'Đã đối chiếu tiền thực nhận' },
    'quyettruong05',
  );
  expect((await bill(p.sid)).intents[0]).toMatchObject({
    status: 'SUCCEEDED',
    online: { status: 'PAID' },
  });
});
it('overpayment is actual received money, allocations capped and refund follows admin-to-staff approval', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  await deliver(await webhook(i, 12000));
  let b = await bill(p.sid);
  expect(b.account).toMatchObject({
    paid_total: '12000',
    charge_total: '10000',
    refund_due_amount: '2000',
  });
  expect(b.intents[0].status).toBe('REQUIRES_RECONCILIATION');
  expect(
    (
      await db.pool.query(
        'SELECT sum(allocated_amount)::text AS n FROM payment_allocation WHERE payment_transaction_id=$1',
        [b.payments[0].id],
      )
    ).rows[0].n,
  ).toBe('10000');
  expect(
    (
      await request(
        '/core/admin/payment-reconciliation/' + i.id + '/resolve',
        { resolution: 'RECONCILED', reason: 'Đối soát' },
        'quyettruong05',
      )
    ).statusCode,
  ).toBe(409);
  const refund = await ok(
    '/core/sessions/' + p.sid + '/refunds',
    {
      amount: '2000',
      paymentId: b.payments[0].id,
      reason: 'Hoàn phần chuyển dư',
      requestId: randomUUID(),
    },
    'quyettruong05',
  );
  await ok('/core/refunds/' + refund.id + '/complete', {
    amount: '2000',
    method: 'CASH',
    requestId: randomUUID(),
  });
  await ok(
    '/core/admin/payment-reconciliation/' + i.id + '/resolve',
    { resolution: 'RECONCILED', reason: 'Đã hoàn phần dư' },
    'quyettruong05',
  );
  b = await bill(p.sid);
  expect(b.account.refund_due_amount).toBe('0');
});
it('stale authenticated snapshot cannot downgrade a paid link or bank references', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000'),
    code = Number(i.online.orderCode);
  provider.add(code, 3000);
  const old = await provider.get(code);
  await service.applyLink(i.id, old);
  provider.add(code, 7000);
  await service.applyLink(i.id, await provider.get(code));
  expect(await service.applyLink(i.id, old)).toMatchObject({ status: 'STALE_IGNORED' });
  const b = await bill(p.sid);
  expect(b.intents[0]).toMatchObject({
    status: 'SUCCEEDED',
    online: { status: 'PAID', paidAmount: '10000' },
  });
  expect(b.payments).toHaveLength(2);
});
it('closed receipt stays frozen and extra late money is quarantined outside the settled ledger', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  await deliver(await webhook(i, 10000));
  for (const action of ['accept', 'prepare', 'ready'])
    await ok('/core/items/' + p.item.id + '/' + action, {}, 'bep001');
  await ok('/core/items/' + p.item.id + '/serve', {});
  const b = await bill(p.sid);
  await ok('/core/sessions/' + p.sid + '/receipt-provided', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: b.completion.receiptKey,
  });
  await ok('/core/sessions/' + p.sid + '/close', {});
  const before = (
    await db.pool.query('SELECT receipt_snapshot FROM table_session WHERE id=$1', [p.sid])
  ).rows[0].receipt_snapshot;
  await deliver(await webhook(i, 2000));
  const after = (
    await db.pool.query('SELECT receipt_snapshot FROM table_session WHERE id=$1', [p.sid])
  ).rows[0].receipt_snapshot;
  expect(after).toEqual(before);
  expect(
    (
      await db.pool.query(
        "SELECT sum(amount)::text AS n FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED'",
        [p.sid],
      )
    ).rows[0].n,
  ).toBe('10000');
  const cases = await ok('/core/admin/payment-reconciliation', undefined, 'quyettruong05'),
    c = cases.find((x: { id: string }) => x.id === i.id);
  expect(c.quarantined_amount).toBe('2000');
  expect(
    (
      await request(
        '/core/admin/payment-reconciliation/' + i.id + '/resolve',
        { resolution: 'RECONCILED', reason: 'Không sửa phiếu cũ' },
        'quyettruong05',
      )
    ).statusCode,
  ).toBe(409);
  await ok(
    '/core/admin/payment-reconciliation/' + i.id + '/resolve',
    {
      resolution: 'RETURNED_EXTERNALLY',
      reference: 'RETURN-' + randomUUID(),
      reason: 'Đã hoàn khoản đến muộn ngoài phiếu chốt',
    },
    'quyettruong05',
  );
  expect(await storedOnline(i.id)).toMatchObject({
    status: 'PAID',
    provider_status: 'PAID',
    reconciliation_status: 'RESOLVED',
  });
  expect(await bankLedger(i.id)).toEqual({ count: 1, amount: '10000' });
  expect(
    (await db.pool.query('SELECT receipt_snapshot FROM table_session WHERE id=$1', [p.sid])).rows[0]
      .receipt_snapshot,
  ).toEqual(before);
});

it('a signed bank payment arriving during create remains PAID when the create follow-up times out', async () => {
  const p = await party('10000');
  const originalCreate = provider.create.bind(provider);
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  provider.create = async (body) => {
    const response = await originalCreate(body);
    reached();
    await gate;
    return response;
  };
  const pending = create(p.sid, '10000');
  try {
    await ready;
    const target = (
      await db.pool.query('SELECT id FROM payment_intent WHERE session_id=$1', [p.sid])
    ).rows[0];
    const intent = await service.view(target.id);
    const event = await webhook(intent, 10000);
    expect((await deliver(event)).statusCode).toBe(200);
    provider.failGet = true;
    release();
    const created = await pending;
    expect(created.online.status).toBe('PAID');
    expect(created.online.lastError).toBeNull();
    const b = await bill(p.sid);
    expect(b.account.paid_total).toBe('10000');
    expect(b.payments).toHaveLength(1);
    expect(
      (await request('/core/payments/' + created.id + '/confirm', { amount: '10000' })).statusCode,
    ).toBe(403);
  } finally {
    release();
    provider.failGet = false;
    provider.create = originalCreate;
    await pending;
  }
});

it('waiving an unpaid dish cannot close the zero bill while the bank QR cancellation is unknown', async () => {
  const p = await party('10000'),
    i = await create(p.sid, '10000');
  for (const action of ['accept', 'prepare', 'ready'])
    await ok('/core/items/' + p.item.id + '/' + action, {}, 'bep001');
  await ok('/core/items/' + p.item.id + '/serve', {});
  provider.failCancel = true;
  try {
    await ok(
      '/core/items/' + p.item.id + '/waive',
      {
        reasonCode: 'QUALITY_ISSUE',
        note: 'Món không đạt chất lượng đã được kiểm tra.',
      },
      'quyettruong05',
    );
    const b = await bill(p.sid);
    expect(b.account.outstanding_amount).toBe('0');
    expect(b.account.reserved_payment_amount).toBe('10000');
    expect(b.intents[0]).toMatchObject({
      status: 'CANCELLED',
      online: { status: 'CANCEL_PENDING' },
    });
    expect(b.closure.blockers.some((x: { code: string }) => x.code === 'PAYMENT_PENDING')).toBe(
      true,
    );
    expect((await request('/core/sessions/' + p.sid + '/close', {})).statusCode).toBe(409);
    const unavailable = await request('/core/payments/' + i.id + '/refresh', {});
    expect(unavailable.statusCode, unavailable.body).toBe(503);
    expect(unavailable.headers['retry-after']).toBe('3');
    expect(unavailable.json().errorCode).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect((await bill(p.sid)).closure.canClose).toBe(false);
  } finally {
    provider.failCancel = false;
  }
  await ok('/core/payments/' + i.id + '/refresh', {});
  const settled = await bill(p.sid);
  expect(settled.intents[0].online.status).toBe('CANCELLED');
  expect(settled.account.reserved_payment_amount).toBe('0');
  expect(settled.closure.canClose).toBe(true);
  await ok('/core/sessions/' + p.sid + '/close', {});
});

async function joinGuest(tableId: string, displayName: string) {
  const qr = await ok('/core/tables/' + tableId + '/qr', {}, 'quyettruong05');
  const access = await ok('/core/tables/' + tableId + '/access-code', {});
  const response = await request(
    '/guest/join',
    {
      token: qr.joinPath.split('#')[1],
      name: displayName,
      acceptedPolicyVersion: restaurantPolicy.version,
      accessCode: access.accessCode,
    },
    '',
  );
  expect(response.statusCode, response.body).toBe(200);
  return {
    id: response.json().participantId as string,
    cookie: response.cookies.map((entry) => entry.name + '=' + entry.value).join('; '),
  };
}
async function guestOrder(cookie: string, productId: string) {
  const state = await ok('/guest/state', undefined, cookie);
  const cart = await ok(
    '/guest/cart',
    {
      productId,
      quantity: 1,
      cartVersion: state.cart.cart_version,
    },
    cookie,
  );
  const updated = await ok('/guest/state', undefined, cookie);
  return ok(
    '/guest/orders',
    {
      requestId: randomUUID(),
      cartVersion: updated.cart.cart_version,
      itemIds: [cart.id],
    },
    cookie,
  );
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function storedOnline(id: string) {
  return (
    await db.pool.query(
      'SELECT status,provider_status,lease_until,next_poll_at,reconciliation_status FROM payos_payment_request WHERE payment_intent_id=$1',
      [id],
    )
  ).rows[0];
}
async function bankLedger(id: string) {
  return (
    await db.pool.query(
      "SELECT count(*)::int AS count,COALESCE(sum(amount),0)::text AS amount FROM payment_transaction WHERE payment_intent_id=$1 AND provider='PAYOS' AND status='SUCCEEDED'",
      [id],
    )
  ).rows[0];
}

it('manual recovery ignores next_poll_at, queries the existing order and never creates another link', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  const code = Number(intent.online.orderCode),
    creates = provider.creates,
    gets = provider.gets;
  await db.pool.query(
    "UPDATE payos_payment_request SET next_poll_at=now()+interval '2 hours' WHERE payment_intent_id=$1",
    [intent.id],
  );
  provider.add(code, 5000);
  const recovered = await ok('/core/payments/' + intent.id + '/refresh', {});
  expect(provider.gets).toBeGreaterThan(gets);
  expect(provider.creates).toBe(creates);
  expect(recovered).toMatchObject({
    id: intent.id,
    status: 'SUCCEEDED',
    online: { status: 'PAID', paidAmount: '5000' },
  });
  expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
  expect((await storedOnline(intent.id)).lease_until).toBeNull();
  expect((await bill(p.sid)).account.outstanding_amount).toBe('0');
});

it('manual recovery does not create a missing provider link and exposes retryable safe503', async () => {
  const p = await party('5000');
  provider.failGet = true;
  let intent;
  try {
    intent = await create(p.sid, '5000');
  } finally {
    provider.failGet = false;
  }
  const before = provider.creates;
  const response = await request('/core/payments/' + intent.id + '/refresh', {});
  expect(response.statusCode, response.body).toBe(503);
  expect(response.headers['retry-after']).toBe('3');
  expect(response.json().errorCode).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
  expect(response.body).not.toContain('FAKE_SECRET');
  expect(provider.creates).toBe(before);
  expect(provider.links.has(Number(intent.online.orderCode))).toBe(false);
  expect(await bankLedger(intent.id)).toEqual({ count: 0, amount: '0' });
  expect((await storedOnline(intent.id)).lease_until).toBeNull();
  expect((await bill(p.sid)).account.reserved_payment_amount).toBe('5000');
});

it('provider outage on refresh keeps reservation and releases only its lease before recovery', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  provider.failGet = true;
  try {
    const response = await request('/core/payments/' + intent.id + '/refresh', {});
    expect(response.statusCode, response.body).toBe(503);
    expect(response.headers['retry-after']).toBe('3');
    expect(response.body).not.toContain('FAKE_SECRET');
    expect((await storedOnline(intent.id)).lease_until).toBeNull();
    expect((await bill(p.sid)).account.reserved_payment_amount).toBe('5000');
  } finally {
    provider.failGet = false;
  }
  provider.add(Number(intent.online.orderCode), 5000);
  const recovered = await ok('/core/payments/' + intent.id + '/refresh', {});
  expect(recovered.online.status).toBe('PAID');
  expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
});

it('a webhook cannot release an active refresh lease and an older poll cannot downgrade its paid result', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  const code = Number(intent.online.orderCode),
    originalGet = provider.get;
  const reached = deferred(),
    gate = deferred();
  let blocked = false;
  provider.get = async (target) => {
    const snapshot = await originalGet.call(provider, target);
    if (target === code && !blocked) {
      blocked = true;
      reached.release();
      await gate.promise;
    }
    return snapshot;
  };
  const polling = request('/core/payments/' + intent.id + '/refresh', {});
  try {
    await reached.promise;
    const claimed = await storedOnline(intent.id);
    expect(claimed.lease_until).not.toBeNull();
    const busy = await request('/core/payments/' + intent.id + '/refresh', {});
    expect(busy.statusCode, busy.body).toBe(409);
    const payload = await webhook(intent, 5000);
    expect((await deliver(payload)).statusCode).toBe(200);
    expect((await storedOnline(intent.id)).lease_until).toEqual(claimed.lease_until);
    gate.release();
    const response = await polling;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().online.status).toBe('PAID');
    expect((await storedOnline(intent.id)).lease_until).toBeNull();
    expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
  } finally {
    gate.release();
    provider.get = originalGet;
    await polling;
  }
});

it('a verified webhook ahead of GET is retryable and manual recovery completes its durable event once', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  const code = Number(intent.online.orderCode),
    originalGet = provider.get;
  const stale = await originalGet.call(provider, code),
    payload = await webhook(intent, 5000);
  let lagging = true;
  provider.get = async (target) => {
    if (target === code && lagging) {
      lagging = false;
      return structuredClone(stale);
    }
    return originalGet.call(provider, target);
  };
  try {
    const first = await deliver(payload);
    expect(first.statusCode, first.body).toBe(503);
    expect(first.headers['retry-after']).toBe('3');
    expect((await bankLedger(intent.id)).amount).toBe('0');
    expect((await storedOnline(intent.id)).status).toBe('PENDING');
    expect((await storedOnline(intent.id)).reconciliation_status).toBeNull();
    expect(
      (
        await db.pool.query(
          "SELECT processing_status FROM payment_webhook_event WHERE provider='PAYOS' AND provider_event_id=$1",
          [payload.data.reference],
        )
      ).rows[0].processing_status,
    ).toBe('RECEIVED');
    await ok('/core/payments/' + intent.id + '/refresh', {});
    expect((await deliver(payload)).statusCode).toBe(200);
    expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
    const saved = (
      await db.pool.query(
        "SELECT e.processing_status,t.payment_intent_id FROM payment_webhook_event e JOIN payment_transaction t ON t.id=e.payment_transaction_id WHERE e.provider='PAYOS' AND e.provider_event_id=$1",
        [payload.data.reference],
      )
    ).rows[0];
    expect(saved).toEqual({ processing_status: 'PROCESSED', payment_intent_id: intent.id });
    expect((await storedOnline(intent.id)).reconciliation_status).toBeNull();
  } finally {
    provider.get = originalGet;
  }
});

it.each(['amount', 'orderCode', 'currency'] as const)(
  'a signed mismatched %s never credits an unrelated or unverified collection',
  async (field) => {
    const p = await party('5000'),
      intent = await create(p.sid, '5000');
    const payload = await webhook(intent, 5000);
    const mutated = {
      ...payload.data,
      ...(field === 'amount'
        ? { amount: 4999 }
        : field === 'orderCode'
          ? { orderCode: Number.MAX_SAFE_INTEGER - 1 }
          : { currency: 'USD' }),
    };
    const response = await deliver({ ...payload, data: mutated, signature: signature(mutated) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().status).toBe(
      field === 'amount'
        ? 'REQUIRES_RECONCILIATION'
        : field === 'orderCode'
          ? 'UNMATCHED'
          : 'REJECTED',
    );
    expect(await bankLedger(intent.id)).toEqual({ count: 0, amount: '0' });
    expect((await bill(p.sid)).account.paid_total).toBe('0');
  },
);

it('re-reading paid funds after expiry or an equal-money cancelled snapshot cannot create a false anomaly', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  await deliver(await webhook(intent, 5000));
  await db.pool.query(
    "UPDATE payment_intent SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",
    [intent.id],
  );
  expect((await ok('/core/payments/' + intent.id + '/refresh', {})).online.status).toBe('PAID');
  const cancelled = await provider.get(Number(intent.online.orderCode));
  cancelled.status = 'CANCELLED';
  expect(await service.applyLink(intent.id, cancelled)).toMatchObject({ status: 'STALE_IGNORED' });
  const saved = await storedOnline(intent.id);
  expect(saved.status).toBe('PAID');
  expect(saved.reconciliation_status).toBeNull();
  expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
  expect((await bill(p.sid)).account).toMatchObject({
    paid_total: '5000',
    outstanding_amount: '0',
  });
});

it('recipient identity matches the signed virtual account without accepting another bank reference twice', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  const code = Number(intent.online.orderCode),
    payload = await webhook(intent, 5000);
  const bank = provider.links.get(code)!.transactions[0]!;
  bank.accountNumber = 'different-primary-representation';
  bank.virtualAccountNumber = '12345678';
  expect((await deliver(payload)).statusCode).toBe(200);
  expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
  const other = await party('5000'),
    second = await create(other.sid, '5000');
  provider.add(
    Number(second.online.orderCode),
    5000,
    payload.data.reference as ReturnType<typeof randomUUID>,
  );
  expect(
    await service.applyLink(second.id, await provider.get(Number(second.online.orderCode))),
  ).toMatchObject({ status: 'REQUIRES_RECONCILIATION' });
  expect(await bankLedger(second.id)).toEqual({ count: 0, amount: '0' });
  const unrecorded = await request(
    '/core/admin/payment-reconciliation/' + second.id + '/resolve',
    {
      resolution: 'RECONCILED',
      reason: 'Không được xác nhận khoản tham chiếu thuộc phiên khác.',
    },
    'quyettruong05',
  );
  expect(unrecorded.statusCode, unrecorded.body).toBe(409);
  expect((await storedOnline(second.id)).reconciliation_status).toBe('OPEN');
  expect(await bankLedger(second.id)).toEqual({ count: 0, amount: '0' });
  expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
});

it('guest online snapshots are table/participant scoped, private, and follow partial then paid ledger state', async () => {
  const p = await party('5000');
  const alice = await joinGuest(p.table.id, 'Khách An');
  const bob = await joinGuest(p.table.id, 'Khách Bình');
  await guestOrder(alice.cookie, p.product.id);

  const tableRequest = await ok('/guest/payment-requests', { method: 'ONLINE' }, alice.cookie);
  await ok('/core/support/' + tableRequest.id + '/claim', {});
  const tableIntent = await create(p.sid, '3000', { supportRequestId: tableRequest.id });
  expect((await deliver(await webhook(tableIntent, 3000))).statusCode).toBe(200);
  const ownIntent = await create(p.sid, '5000', {
    collectionScope: 'PARTICIPANT',
    participantId: alice.id,
  });
  const other = await party('5000'),
    foreignIntent = await create(other.sid, '5000');
  const stateA = await ok('/guest/state', undefined, alice.cookie);
  const stateB = await ok('/guest/state', undefined, bob.cookie);
  const own = stateA.onlinePayments.find(
    (payment: GuestOnlinePayment) => payment.scope === 'PARTICIPANT',
  );
  expect(stateA.onlinePayments).toHaveLength(2);
  expect(stateB.onlinePayments).toHaveLength(1);
  expect(stateB.onlinePayments[0].scope).toBe('TABLE');
  expect(stateB.onlinePayments[0]).not.toHaveProperty('supportRequestId');
  expect(
    stateA.onlinePayments.find((payment: GuestOnlinePayment) => payment.scope === 'TABLE')
      .supportRequestId,
  ).toBe(tableRequest.id);
  expect(
    stateA.onlinePayments.every(
      (payment: GuestOnlinePayment) =>
        ![tableIntent.id, ownIntent.id, foreignIntent.id].includes(payment.id),
    ),
  ).toBe(true);
  expect(Object.keys(own).sort()).toEqual(
    [
      'id',
      'scope',
      'amount',
      'status',
      'paidAmount',
      'bankConfirmedAmount',
      'remainingAmount',
      'expiresAt',
      'createdAt',
    ].sort(),
  );
  expect(own).toMatchObject({ paidAmount: '0', bankConfirmedAmount: '0', remainingAmount: '5000' });
  const safe = JSON.stringify(stateA.onlinePayments);
  for (const secret of [
    'orderCode',
    'checkoutUrl',
    'qrCode',
    'accountNumber',
    'created_by',
    'lastError',
    config.apiKey!,
  ])
    expect(safe).not.toContain(secret);
  const connection = await db.pool.connect();
  try {
    expect(await readGuestOnlinePayments(connection, p.sid, alice.id, randomUUID())).toEqual([]);
  } finally {
    connection.release();
  }
  await deliver(await webhook(ownIntent, 2000));
  let live = await ok('/guest/state', undefined, alice.cookie);
  expect(
    live.onlinePayments.find((payment: GuestOnlinePayment) => payment.id === own.id),
  ).toMatchObject({
    status: 'UNDERPAID',
    paidAmount: '2000',
    bankConfirmedAmount: '2000',
    remainingAmount: '3000',
  });
  expect(live.account).toMatchObject({ paid_total: '5000', outstanding_amount: '5000' });
  await deliver(await webhook(ownIntent, 3000));
  live = await ok('/guest/state', undefined, alice.cookie);
  expect(
    live.onlinePayments.find((payment: GuestOnlinePayment) => payment.id === own.id),
  ).toMatchObject({ status: 'PAID', paidAmount: '5000', remainingAmount: '0' });
  expect(live.account.outstanding_amount).toBe('2000');
  expect((await ok('/guest/state', undefined, bob.cookie)).onlinePayments).toHaveLength(1);
});

it('a paid linked scope resolves only its support request and preserves collector recovery ownership', async () => {
  const p = await party('5000');
  const alice = await joinGuest(p.table.id, 'Khách Chi');
  const bob = await joinGuest(p.table.id, 'Khách Dũng');
  await guestOrder(alice.cookie, p.product.id);

  const ownRequest = await ok('/guest/payment-requests', { method: 'ONLINE' }, alice.cookie);
  const unrelated = await ok('/guest/payment-requests', { method: 'CASH' }, bob.cookie);
  await ok('/core/support/' + ownRequest.id + '/claim', {});
  const intent = await create(p.sid, '5000', {
    collectionScope: 'PARTICIPANT',
    participantId: alice.id,
    supportRequestId: ownRequest.id,
  });
  const a = await ok('/guest/state', undefined, alice.cookie);
  expect(a.onlinePayments[0].supportRequestId).toBe(ownRequest.id);
  expect((await ok('/guest/state', undefined, bob.cookie)).onlinePayments).toEqual([]);
  const delivered = await deliver(await webhook(intent, 5000));
  expect(delivered.statusCode, delivered.body).toBe(200);
  const diagnostic = (
    await db.pool.query(
      'SELECT status,reconciliation_reason FROM payos_payment_request WHERE payment_intent_id=$1',
      [intent.id],
    )
  ).rows[0];
  expect(delivered.json().status, JSON.stringify(diagnostic)).toBe('PROCESSED');
  const currentA = await ok('/guest/state', undefined, alice.cookie);
  const requestState = currentA.support.find((entry: { id: string }) => entry.id === ownRequest.id);
  expect(requestState.status).toBe('RESOLVED');
  expect(
    (
      await db.pool.query(
        'SELECT resolution_actor_type,resolved_by FROM support_request WHERE id=$1',
        [ownRequest.id],
      )
    ).rows[0],
  ).toEqual({ resolution_actor_type: 'SYSTEM', resolved_by: null });
  expect(
    (await db.pool.query('SELECT status FROM support_request WHERE id=$1', [unrelated.id])).rows[0]
      .status,
  ).toBe('NEW');
  const response = await ok('/core/payments/' + intent.id + '/refresh', {});
  expect(response.online.status).toBe('PAID');
  expect((await request('/core/payments/' + intent.id + '/refresh', {}, 'pv002')).statusCode).toBe(
    403,
  );
  expect((await bill(p.sid)).account.outstanding_amount).toBe('5000');
});

it('an old missing-order response cannot erase funds received while cancellation recovery is in flight', async () => {
  const p = await party('5000');
  provider.loseCreateResponse = true;
  const intent = await create(p.sid, '5000');
  const code = Number(intent.online.orderCode);
  provider.failGet = true;
  try {
    await ok('/core/payments/' + intent.id + '/cancel', {});
  } finally {
    provider.failGet = false;
  }
  expect((await storedOnline(intent.id)).status).toBe('CANCEL_PENDING');
  const originalGet = provider.get,
    gate = deferred(),
    reached = deferred();
  let blocked = false;
  provider.get = async (target) => {
    if (target === code && !blocked) {
      blocked = true;
      const current = provider.links.get(code)!;
      provider.links.delete(code);
      let missing: unknown;
      try {
        await originalGet.call(provider, target);
      } catch (error) {
        missing = error;
      } finally {
        provider.links.set(code, current);
      }
      reached.release();
      await gate.promise;
      throw missing;
    }
    return originalGet.call(provider, target);
  };
  const recovery = request('/core/payments/' + intent.id + '/refresh', {});
  try {
    await reached.promise;
    const payload = await webhook(intent, 5000);
    expect((await deliver(payload)).statusCode).toBe(200);
    expect((await storedOnline(intent.id)).status).toBe('REQUIRES_RECONCILIATION');
    gate.release();
    const response = await recovery;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().online.status).toBe('REQUIRES_RECONCILIATION');
    expect((await storedOnline(intent.id)).provider_status).toBe('PAID');
    expect((await storedOnline(intent.id)).lease_until).toBeNull();
    expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
  } finally {
    gate.release();
    provider.get = originalGet;
    await recovery;
  }
});

it('a fully paid table resolves the linked online request and cancels other obsolete payment requests', async () => {
  const p = await party('5000');
  const alice = await joinGuest(p.table.id, 'Khách Hà');
  const bob = await joinGuest(p.table.id, 'Khách Giang');
  const ownRequest = await ok('/guest/payment-requests', { method: 'ONLINE' }, alice.cookie);
  const obsolete = await ok('/guest/payment-requests', { method: 'CASH' }, bob.cookie);
  await ok('/core/support/' + ownRequest.id + '/claim', {});
  const intent = await create(p.sid, '5000', { supportRequestId: ownRequest.id });
  const delivered = await deliver(await webhook(intent, 5000));
  expect(delivered.statusCode, delivered.body).toBe(200);
  const a = await ok('/guest/state', undefined, alice.cookie);
  const b = await ok('/guest/state', undefined, bob.cookie);
  expect(a.account).toMatchObject({ paid_total: '5000', outstanding_amount: '0' });
  expect(a.support.find((entry: { id: string }) => entry.id === ownRequest.id).status).toBe(
    'RESOLVED',
  );
  expect(b.support.find((entry: { id: string }) => entry.id === obsolete.id).status).toBe(
    'CANCELLED',
  );
  expect(b.onlinePayments[0]).toMatchObject({
    scope: 'TABLE',
    status: 'PAID',
    paidAmount: '5000',
    remainingAmount: '0',
  });
  expect(b.onlinePayments[0]).not.toHaveProperty('supportRequestId');
});

it('the legacy HMAC connector cannot impersonate the reserved payOS provider namespace', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  const connectorSecret = 'isolated-connector-secret-with-no-provider-access';
  const event = {
    eventId: randomUUID(),
    transactionId: randomUUID(),
    intentId: intent.id,
    amount: '5000',
    currency: 'VND' as const,
    timestamp: Date.now(),
  };
  for (const name of ['PAYOS', ' payos ', 'PayOS']) {
    await expect(
      ingestConnector(
        db,
        restaurantId,
        name,
        connectorSecret,
        event,
        connectorSignature(event, connectorSecret),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  }
  expect(await bankLedger(intent.id)).toEqual({ count: 0, amount: '0' });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM payment_webhook_event WHERE provider_event_id=$1',
        [event.eventId],
      )
    ).rows[0].n,
  ).toBe(0);
  expect((await bill(p.sid)).account.outstanding_amount).toBe('5000');
});

it('a PAID label without confirmed bank funds remains processing and reserved until bank facts arrive', async () => {
  const p = await party('5000'),
    intent = await create(p.sid, '5000');
  const code = Number(intent.online.orderCode),
    creates = provider.creates;
  const bank = provider.links.get(code)!;
  bank.status = 'PAID';
  expect(bank.amountPaid).toBe(0);
  expect(bank.transactions).toEqual([]);
  const response = await request('/core/payments/' + intent.id + '/refresh', {});
  expect(response.statusCode, response.body).toBe(503);
  expect(response.headers['retry-after']).toBe('3');
  const waiting = await bill(p.sid);
  expect(waiting.intents[0]).toMatchObject({
    status: 'PENDING',
    online: { status: 'PROCESSING', paidAmount: '0', remainingAmount: '5000' },
  });
  expect(waiting.account).toMatchObject({
    paid_total: '0',
    reserved_payment_amount: '5000',
    outstanding_amount: '5000',
  });
  expect(await bankLedger(intent.id)).toEqual({ count: 0, amount: '0' });
  expect((await storedOnline(intent.id)).lease_until).toBeNull();
  expect((await storedOnline(intent.id)).reconciliation_status).toBeNull();
  provider.add(code, 5000);
  const confirmed = await ok('/core/payments/' + intent.id + '/refresh', {});
  expect(confirmed.online.status).toBe('PAID');
  expect(provider.creates).toBe(creates);
  expect(await bankLedger(intent.id)).toEqual({ count: 1, amount: '5000' });
  expect((await bill(p.sid)).account.outstanding_amount).toBe('0');
});

it('resolution guards reject missing or wrong human actors while allowing explicit USER and SYSTEM completion', async () => {
  const p = await party('5000');
  const alice = await joinGuest(p.table.id, 'Khách kiểm tra chủ thể');
  const assistance = await ok('/guest/payment-requests', { method: 'ONLINE' }, alice.cookie);
  const claimed = await ok('/core/support/' + assistance.id + '/claim', {});
  const otherOwner = await db.prisma.app_user.findUniqueOrThrow({
    where: { restaurant_id_username: { restaurant_id: restaurantId, username: 'pv002' } },
  });
  const resolveAs = (actor: string | null, resolvedBy: string | null) =>
    db.pool.query(
      "UPDATE support_request SET status='RESOLVED',resolved_at=clock_timestamp(),resolution_actor_type=$2,resolved_by=$3 WHERE id=$1 RETURNING status,resolution_actor_type,resolved_by",
      [assistance.id, actor, resolvedBy],
    );
  await expect(resolveAs('USER', null)).rejects.toMatchObject({
    code: '23514',
    constraint: 'support_request_resolution_actor',
  });
  // A NULL actor is rejected even before CHECK evaluation by the existing NOT NULL column.
  await expect(resolveAs(null, null)).rejects.toMatchObject({
    code: '23502',
    column: 'resolution_actor_type',
  });
  await expect(resolveAs('USER', otherOwner.id)).rejects.toMatchObject({ code: '23514' });
  await expect(resolveAs('SYSTEM', claimed.acknowledged_by)).rejects.toMatchObject({
    code: '23514',
  });
  expect(
    (await db.pool.query('SELECT status FROM support_request WHERE id=$1', [assistance.id])).rows[0]
      .status,
  ).toBe('ACKNOWLEDGED');
  expect((await resolveAs('USER', claimed.acknowledged_by)).rows[0]).toEqual({
    status: 'RESOLVED',
    resolution_actor_type: 'USER',
    resolved_by: claimed.acknowledged_by,
  });
  const next = await ok('/guest/payment-requests', { method: 'ONLINE' }, alice.cookie);
  await ok('/core/support/' + next.id + '/claim', {});
  const system = await db.pool.query(
    "UPDATE support_request SET status='RESOLVED',resolved_at=clock_timestamp(),resolution_actor_type='SYSTEM',resolved_by=NULL WHERE id=$1 RETURNING status,resolution_actor_type,resolved_by",
    [next.id],
  );
  expect(system.rows[0]).toEqual({
    status: 'RESOLVED',
    resolution_actor_type: 'SYSTEM',
    resolved_by: null,
  });
});
