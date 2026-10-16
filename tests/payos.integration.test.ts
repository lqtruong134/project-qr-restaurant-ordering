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
  const replies = await Promise.all(Array.from({ length: 4 }, () => deliver(payload)));
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
  expect((await bill(p.sid)).intents[0].status).toBe('SUCCEEDED');
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
    await ok('/core/payments/' + i.id + '/refresh', {});
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
