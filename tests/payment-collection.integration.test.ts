import { withTableCode } from './table-code-fixture.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { readBill } from '../apps/api/src/modules/payments/receipt.service.js';
let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const name = 'thesis_collection_' + randomBytes(8).toString('hex'),
  password = randomBytes(24).toString('hex');
const media = mkdtempSync(join(tmpdir(), 'thesis-payment-proof-')),
  oldMedia = process.env.PAYMENT_PROOF_DIR;
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
async function party() {
  const area = await db.prisma.dining_area.findFirstOrThrow(),
    code = 'PAY-' + randomBytes(3).toString('hex');
  const t = await db.prisma.dining_table.create({
      data: { restaurant_id: restaurantId, area_id: area.id, code, name: code, capacity: 4 },
    }),
    s = await ok('/core/tables/' + t.id + '/open', 'pv001', {}),
    qr = await ok('/core/tables/' + t.id + '/qr', 'quyettruong05', {});
  const guests = [];
  for (const name of ['Lan', 'Minh']) {
    const r = await req('/guest/join', '', {
      token: qr.joinPath.split('#')[1],
      name,
      acceptedPolicyVersion: restaurantPolicy.version,
    });
    expect(r.statusCode, r.body).toBe(200);
    guests.push({ cookie: jar(r), id: r.json().participantId });
  }
  return { sid: s.id, table: t, guests };
}
async function dish(cookie: string, name = 'Gỏi cuốn tôm thịt', quantity = 2, fulfill = true) {
  const p = await db.prisma.product.findFirstOrThrow({ where: { name } });
  let state = await ok('/guest/state', cookie);
  await ok('/guest/cart', cookie, {
    productId: p.id,
    quantity,
    cartVersion: state.cart.cart_version,
  });
  state = await ok('/guest/state', cookie);
  const b = await ok('/guest/orders', cookie, {
    requestId: randomUUID(),
    cartVersion: state.cart.cart_version,
    itemIds: state.items
      .filter(
        (i: { owner_participant_id: string }) => i.owner_participant_id === state.participant.id,
      )
      .map((i: { id: string }) => i.id),
  });
  const batch = await db.prisma.order_batch.findUniqueOrThrow({ where: { id: b.id } });
  if (batch.status === 'PENDING_REVIEW')
    await ok('/core/orders/' + b.id + '/review', 'pv001', { approve: true });
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: b.id } });
  if (!fulfill) return item;
  for (const action of ['accept', 'prepare', 'ready'])
    await ok('/core/items/' + item.id + '/' + action, 'bep001', {});
  await ok('/core/items/' + item.id + '/serve', 'pv001', {});
  return item;
}
async function intent(sid: string, amount: string, extra: Record<string, unknown> = {}) {
  return ok('/core/sessions/' + sid + '/payments', 'pv001', {
    requestId: randomUUID(),
    method: 'CASH',
    amount,
    ...extra,
  });
}
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=';
it('guest calls staff once with preferred method and reserves no money, including concurrent retries', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const calls = await Promise.all(
    Array.from({ length: 3 }, () =>
      ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'CASH' }),
    ),
  );
  expect(new Set(calls.map((x) => x.id)).size).toBe(1);
  expect(
    (await ok('/core/sessions/' + p.sid + '/bill', 'pv001')).account.reserved_payment_amount,
  ).toBe('0');
  const state = await ok('/guest/state', p.guests[0]!.cookie);
  expect(state.support[0].payment_method).toBe('CASH');
  expect(
    (await req('/guest/payment-requests', p.guests[1]!.cookie, { method: 'ONLINE' })).statusCode,
  ).toBe(400);
});
it('own-dish collection allocates only to that guest, even when another guest ordered first', async () => {
  const p = await party();
  const a = await dish(p.guests[0]!.cookie, 'Nước suối 500 ml', 1),
    b = await dish(p.guests[1]!.cookie);
  const request = await ok('/guest/payment-requests', p.guests[1]!.cookie, { method: 'CASH' });
  await ok('/core/support/' + request.id + '/claim', 'pv001', {});
  const i = await intent(p.sid, b.line_total.toString(), {
    collectionScope: 'PARTICIPANT',
    participantId: p.guests[1]!.id,
    supportRequestId: request.id,
  });
  await ok('/core/payments/' + i.id + '/confirm', 'pv001', {
    amount: i.amount,
    receivedAmount: '500000',
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(
    bill.charges.find((f: { order_item_id: string }) => f.order_item_id === a.id).unpaid_amount,
  ).toBe(a.line_total.toString());
  expect(
    bill.charges.find((f: { order_item_id: string }) => f.order_item_id === b.id).unpaid_amount,
  ).toBe('0');
  expect(bill.account.outstanding_amount).toBe(a.line_total.toString());
  expect(bill.paymentRequests).toHaveLength(0);
});
it('cash 500000 for a 40000 payment records 40000 revenue and 460000 change; retry records once', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const i = await intent(p.sid, '40000');
  const responses = await Promise.all([
    ok('/core/payments/' + i.id + '/confirm', 'pv001', {
      amount: '40000',
      receivedAmount: '500000',
    }),
    ok('/core/payments/' + i.id + '/confirm', 'pv001', {
      amount: '40000',
      receivedAmount: '500000',
    }),
  ]);
  expect(responses[0].id).toBe(responses[1].id);
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account.paid_total).toBe('40000');
  expect(bill.account.outstanding_amount).toBe('50000');
  expect(bill.payments[0].metadata).toMatchObject({
    cashReceived: '500000',
    changeGiven: '460000',
  });
});
it('participant from another table and over-collection cannot reserve or pay', async () => {
  const p = await party(),
    other = await party();
  await dish(p.guests[0]!.cookie);
  expect(
    (
      await req('/core/sessions/' + p.sid + '/payments', 'pv001', {
        requestId: randomUUID(),
        amount: '90000',
        method: 'CASH',
        collectionScope: 'PARTICIPANT',
        participantId: other.guests[0]!.id,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await req('/core/sessions/' + p.sid + '/payments', 'pv001', {
        requestId: randomUUID(),
        amount: '90001',
        method: 'CASH',
      })
    ).statusCode,
  ).toBe(409);
});
it('another staff cannot collect a claimed payment request without handoff', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const x = await ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'CASH' });
  await ok('/core/support/' + x.id + '/claim', 'pv002', {});
  expect(
    (
      await req('/core/sessions/' + p.sid + '/payments', 'pv001', {
        requestId: randomUUID(),
        method: 'CASH',
        amount: '90000',
        supportRequestId: x.id,
      })
    ).statusCode,
  ).toBe(403);
});
it('bank payment accepts a private screenshot in place of typed reference; image alone is not payment', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const i = await intent(p.sid, '90000', { method: 'BANK_TRANSFER' });
  expect(
    (await req('/core/payments/' + i.id + '/confirm', 'pv001', { amount: '90000' })).statusCode,
  ).toBe(400);
  await ok('/core/payments/' + i.id + '/proof', 'pv001', { data: png });
  let bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account.paid_total).toBe('0');
  expect((await req('/core/payments/' + i.id + '/proof', '')).statusCode).toBe(401);
  expect((await req('/core/payments/' + i.id + '/proof', 'bep001')).statusCode).toBe(403);
  const image = await req('/core/payments/' + i.id + '/proof', 'quyettruong05');
  expect(image.statusCode).toBe(200);
  expect(image.headers['cache-control']).toBe('private,no-store');
  await ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount: '90000' });
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account.paid_total).toBe('90000');
  expect(bill.payments[0].metadata.proof.uploadedBy).toBeTruthy();
  expect((await req('/core/payments/' + i.id + '/proof', 'pv001', { data: png })).statusCode).toBe(
    409,
  );
});
it('proof rejects unsupported file content and duplicate successful screenshot', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const first = await intent(p.sid, '40000', { method: 'BANK_TRANSFER' });
  expect(
    (
      await req('/core/payments/' + first.id + '/proof', 'pv001', {
        data: Buffer.from('<svg/>').toString('base64'),
      })
    ).statusCode,
  ).toBe(400);
  const uniquePng = Buffer.concat([Buffer.from(png, 'base64'), Buffer.from(randomUUID())]).toString(
    'base64',
  );
  await ok('/core/payments/' + first.id + '/proof', 'pv001', { data: uniquePng });
  await ok('/core/payments/' + first.id + '/confirm', 'pv001', { amount: '40000' });
  const second = await intent(p.sid, '50000', { method: 'BANK_TRANSFER' });
  await ok('/core/payments/' + second.id + '/proof', 'pv001', { data: uniquePng });
  expect(
    (await req('/core/payments/' + second.id + '/confirm', 'pv001', { amount: '50000' }))
      .statusCode,
  ).toBe(409);
});
it('full payment completes all typed cash calls; partial payment leaves other guests waiting', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const a = await ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'CASH' }),
    b = await ok('/guest/payment-requests', p.guests[1]!.cookie, { method: 'BANK_TRANSFER' });
  await ok('/core/support/' + a.id + '/claim', 'pv001', {});
  let i = await intent(p.sid, '40000', { supportRequestId: a.id });
  await ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount: i.amount });
  expect((await db.prisma.support_request.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
    'NEW',
  );
  await ok('/core/support/' + b.id + '/claim', 'pv001', {});
  i = await intent(p.sid, '50000', { supportRequestId: b.id });
  await ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount: i.amount });
  expect((await ok('/core/sessions/' + p.sid + '/bill', 'pv001')).paymentRequests).toHaveLength(0);
});

it('a typed payment call requires explicit acceptance, cannot be bypassed by direct collection, and two claims have one owner', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const x = await ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'CASH' });
  const data = { requestId: randomUUID(), method: 'CASH', amount: '90000' };
  expect(
    (
      await req('/core/sessions/' + p.sid + '/payments', 'pv001', {
        ...data,
        supportRequestId: x.id,
      })
    ).statusCode,
  ).toBe(409);
  expect((await req('/core/sessions/' + p.sid + '/payments', 'pv002', data)).statusCode).toBe(409);
  const results = await Promise.all(
    ['pv001', 'pv002'].map((u) => req('/core/support/' + x.id + '/claim', u, {})),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const row = (await ok('/core/support', 'pv001')).find((r: { id: string }) => r.id === x.id);
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv002');
  expect(bill.paymentRequests[0].acknowledged_by).toBe(row.acknowledged_by);
  expect(bill.paymentRequests[0].acknowledged_by_name).toBe(row.acknowledged_by_name);
  expect(bill.account.reserved_payment_amount).toBe('0');
  expect(bill.intents).toHaveLength(0);
});
it('handoff transfers payment confirmation, proof upload and cancellation rights only after acceptance', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const x = await ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'BANK_TRANSFER' });
  await ok('/core/support/' + x.id + '/claim', 'pv001', {});
  const i = await intent(p.sid, '40000', { supportRequestId: x.id, method: 'BANK_TRANSFER' });
  expect((await req('/core/payments/' + i.id + '/proof', 'pv002', { data: png })).statusCode).toBe(
    403,
  );
  expect((await req('/core/payments/' + i.id + '/cancel', 'pv002', {})).statusCode).toBe(403);
  expect(
    (await req('/core/support/' + x.id + '/resolve', 'pv001', { reason: 'Khách chưa trả' }))
      .statusCode,
  ).toBe(409);
  const assignees = await ok('/core/support-assignees', 'pv001');
  const target = assignees.find((u: { username: string }) => u.username === 'pv002');
  const h = await ok('/core/support/' + x.id + '/reassign', 'pv001', {
    userId: target.id,
    reason: 'Hết ca',
  });
  expect(
    (
      await req('/core/payments/' + i.id + '/confirm', 'pv002', {
        amount: i.amount,
        reference: randomUUID(),
      })
    ).statusCode,
  ).toBe(403);
  await ok('/core/support/' + x.id + '/handoffs/' + h.id + '/accept', 'pv002', {});
  expect(
    (
      await req('/core/payments/' + i.id + '/confirm', 'pv001', {
        amount: i.amount,
        reference: randomUUID(),
      })
    ).statusCode,
  ).toBe(403);
  expect((await req('/core/payments/' + i.id + '/cancel', 'pv001', {})).statusCode).toBe(403);
  await ok('/core/payments/' + i.id + '/confirm', 'pv002', {
    amount: i.amount,
    reference: randomUUID(),
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account.paid_total).toBe('40000');
  expect(bill.paymentRequests).toHaveLength(0);
  expect((await ok('/guest/state', p.guests[0]!.cookie)).support[0].status).toBe('RESOLVED');
});
it('an old unlinked intent cannot confirm after a payment call is claimed by another employee', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const i = await intent(p.sid, '40000');
  const x = await ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'CASH' });
  await ok('/core/support/' + x.id + '/claim', 'pv002', {});
  expect(
    (await req('/core/payments/' + i.id + '/confirm', 'pv001', { amount: i.amount })).statusCode,
  ).toBe(409);
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account.paid_total).toBe('0');
  expect(bill.paymentRequests[0].acknowledged_by).toBeTruthy();
  await ok('/core/payments/' + i.id + '/cancel', 'pv001', {});
});
it('ending a call without collecting money requires a reason and leaves the invoice unpaid', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const x = await ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'CASH' });
  await ok('/core/support/' + x.id + '/claim', 'pv001', {});
  expect((await req('/core/support/' + x.id + '/resolve', 'pv001', {})).statusCode).toBe(400);
  await ok('/core/support/' + x.id + '/resolve', 'pv001', {
    reason: 'Khách muốn ăn tiếp, chưa thanh toán.',
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account.outstanding_amount).toBe('90000');
  expect(bill.account.paid_total).toBe('0');
  expect(bill.payments).toHaveLength(0);
  expect(bill.paymentRequests).toHaveLength(0);
  const audit = await db.pool.query(
    "SELECT reason,details FROM business_audit_event WHERE resource_id=$1 AND action='SUPPORT_REQUEST_RESOLVED'",
    [x.id],
  );
  expect(audit.rows[0].reason).toContain('chưa thanh toán');
  expect(audit.rows[0].details.paymentRecorded).toBe(false);
});
it('settling the table ends other payment calls, keeps unrelated support open and records money once', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const a = await ok('/guest/payment-requests', p.guests[0]!.cookie, { method: 'CASH' }),
    b = await ok('/guest/payment-requests', p.guests[1]!.cookie, { method: 'CASH' });
  await ok('/core/support/' + a.id + '/claim', 'pv001', {});
  await ok('/core/support/' + b.id + '/claim', 'pv002', {});
  const water = await ok('/guest/support', p.guests[1]!.cookie, {
    type: 'WATER',
    content: 'Thêm nước',
  });
  const i = await intent(p.sid, '90000', { supportRequestId: a.id });
  const paid = await ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount: i.amount });
  expect((await ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount: i.amount })).id).toBe(
    paid.id,
  );
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.paymentRequests).toHaveLength(0);
  expect(bill.payments).toHaveLength(1);
  expect((await db.prisma.support_request.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
    'CANCELLED',
  );
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: water.id } })).status,
  ).toBe('NEW');
});

it('a legacy bill call without a preferred method follows the same acceptance and collection ownership rules', async () => {
  const p = await party();
  await dish(p.guests[0]!.cookie);
  const x = await ok('/guest/support', p.guests[0]!.cookie, { type: 'BILL' });
  expect(
    (
      await req('/core/sessions/' + p.sid + '/payments', 'pv001', {
        requestId: randomUUID(),
        method: 'CASH',
        amount: '90000',
      })
    ).statusCode,
  ).toBe(409);
  await ok('/core/support/' + x.id + '/claim', 'pv002', {});
  expect(
    (
      await req('/core/sessions/' + p.sid + '/payments', 'pv001', {
        requestId: randomUUID(),
        method: 'CASH',
        amount: '90000',
        supportRequestId: x.id,
      })
    ).statusCode,
  ).toBe(403);
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv002');
  expect(bill.paymentRequests[0].id).toBe(x.id);
  const i = await ok('/core/sessions/' + p.sid + '/payments', 'pv002', {
    requestId: randomUUID(),
    method: 'CASH',
    amount: '90000',
    supportRequestId: x.id,
  });
  await ok('/core/payments/' + i.id + '/confirm', 'pv002', { amount: i.amount });
  expect((await ok('/core/sessions/' + p.sid + '/bill', 'pv002')).paymentRequests).toHaveLength(0);
});

it('paid before kitchen acceptance shows exact blockers and closing creates shared cleaning work for both employees', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie, 'Chả giò giòn', 1, false);
  const payment = await intent(p.sid, item.line_total.toString());
  await ok('/core/payments/' + payment.id + '/confirm', 'pv001', {
    amount: payment.amount,
    receivedAmount: payment.amount,
  });
  let bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv002');
  expect(bill.account.outstanding_amount).toBe('0');
  expect(bill.closure.canClose).toBe(false);
  expect(bill.closure.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'KITCHEN_WAIT',
        detail: expect.stringContaining('Chả giò giòn'),
      }),
    ]),
  );
  const denied = await req('/core/sessions/' + p.sid + '/close', 'pv001', {});
  expect(denied.statusCode).toBe(409);
  expect(denied.json().details).toEqual(bill.closure);
  expect(denied.json().userMessage).toContain('Bếp chưa nhận món');
  expect(
    (await db.prisma.table_session.findUniqueOrThrow({ where: { id: p.sid } })).session_status,
  ).toBe('ACTIVE');
  await ok('/core/items/' + item.id + '/accept', 'bep001', {});
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.closure.blockers[0].code).toBe('COOKING');
  await ok('/core/items/' + item.id + '/prepare', 'bep001', {});
  await ok('/core/items/' + item.id + '/ready', 'bep001', {});
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.closure.blockers[0].code).toBe('SERVING');
  await ok('/core/items/' + item.id + '/serve', 'pv001', {});
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.closure.blockers).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'RECEIPT' })]),
  );
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
    delivery: 'PRINTED',
    layout: 'detailed',
    billKey: bill.completion.receiptKey,
  });
  expect((await ok('/core/sessions/' + p.sid + '/bill', 'pv001')).closure.canClose).toBe(true);
  const help = await ok('/guest/support', p.guests[0]!.cookie, {
    type: 'WATER',
    content: 'Thêm nước',
  });
  const changed = await req('/core/sessions/' + p.sid + '/close', 'pv001', {});
  expect(changed.statusCode).toBe(409);
  expect(changed.json().details.blockers[0].code).toBe('SUPPORT_WATER_NEW');
  await ok('/core/support/' + help.id + '/claim', 'pv002', {});
  await ok('/core/support/' + help.id + '/resolve', 'pv002', {});
  await ok('/core/sessions/' + p.sid + '/close', 'pv001', {});
  for (const user of ['pv001', 'pv002']) {
    const table = (await ok('/core/tables', user)).find((t: { id: string }) => t.id === p.table.id);
    expect(table.table_status).toBe('NEEDS_CLEANING');
    expect(table.session_id).toBeNull();
    expect(table.cleaning_since).toBeTruthy();
  }
  const attempts = await Promise.all(
    ['pv001', 'pv002'].map((u) => req('/core/tables/' + p.table.id + '/clean', u, {})),
  );
  expect(attempts.filter((r) => r.statusCode === 200)).toHaveLength(1);
  expect(attempts.filter((r) => r.statusCode === 404)).toHaveLength(1);
  expect(
    (await db.prisma.dining_table.findUniqueOrThrow({ where: { id: p.table.id } })).table_status,
  ).toBe('AVAILABLE');
  const frozen = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(frozen.session.receipt_number).toMatch(/^PT-/);
  expect(frozen.account.paid_total).toBe(payment.amount);
});
it('close preview lists unpaid food, pending collection and support together without masking the cooking reason', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie, 'Nước suối 500 ml', 1, false);
  await intent(p.sid, item.line_total.toString());
  await ok('/guest/support', p.guests[0]!.cookie, { type: 'UTENSILS', content: 'Thêm dụng cụ' });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  const codes = bill.closure.blockers.map((b: { code: string }) => b.code);
  expect(codes).toEqual(
    expect.arrayContaining(['UNPAID', 'KITCHEN_WAIT', 'PAYMENT_CREATED', 'SUPPORT_UTENSILS_NEW']),
  );
  const denied = await req('/core/sessions/' + p.sid + '/close', 'pv001', {});
  expect(denied.statusCode).toBe(409);
  expect(denied.json().details.blockers.map((b: { code: string }) => b.code)).toEqual(codes);
  expect(
    (await db.prisma.dining_table.findUniqueOrThrow({ where: { id: p.table.id } })).table_status,
  ).toBe('OCCUPIED');
});

it('admin approves the refund document before staff execute it; guest sees safe partial/full history and alerts clear only after return', async () => {
  const p = await party();
  const cookie = p.guests[0]!.cookie;
  const item = await dish(cookie, 'Gỏi cuốn tôm thịt', 2, false);
  for (const action of ['accept', 'prepare'])
    await ok('/core/items/' + item.id + '/' + action, 'bep001', {});
  const payment = await intent(p.sid, '90000');
  const transaction = await ok('/core/payments/' + payment.id + '/confirm', 'pv001', {
    amount: '90000',
  });
  await ok('/core/items/' + item.id + '/report-issue', 'bep001', {
    reasonCode: 'QUALITY_ISSUE',
    note: 'Món không đạt chất lượng kiểm tra',
  });
  const report = (await ok('/core/order-exceptions?pending=true', 'quyettruong05')).find(
    (x: { id: string }) => x.id === item.id,
  );
  await ok('/core/items/' + item.id + '/late-cancel', 'quyettruong05', {
    useReportedReason: true,
    expectedReportId: report.report_id,
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.refundContext.reason).toContain('Gỏi cuốn tôm thịt');
  expect(bill.refundContext.reason).toContain('Món không đạt chất lượng kiểm tra');
  const command = {
    paymentId: transaction.id,
    amount: '90000',
    useDecisionReason: true,
    reason: 'Nội dung nhân viên không được dùng thay quyết định',
    requestId: randomUUID(),
  };
  expect(bill.refundWorkflow).toEqual({
    approvedAmount: '0',
    awaitingApprovalAmount: '0',
    reviewAmount: '90000',
  });
  const pendingAlert = (await ok('/core/alerts', 'quyettruong05')).find(
    (a: { session_id: string; alert_type: string }) =>
      a.session_id === p.sid && a.alert_type === 'REFUND_REQUIRED',
  );
  expect(pendingAlert).toMatchObject({
    requires_admin: true,
    approved_refund_amount: '0',
    refund_review_amount: '90000',
  });
  expect(
    (await ok('/core/alerts', 'pv001')).some((a: { id: string }) => a.id === pendingAlert.id),
  ).toBe(false);
  for (const body of [command, { ...command, useDecisionReason: false, reason: 'Tự lập hồ sơ' }])
    expect((await req('/core/sessions/' + p.sid + '/refunds', 'pv001', body)).statusCode).toBe(403);
  expect(await db.prisma.refund_case.count({ where: { session_id: p.sid } })).toBe(0);
  const f = await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', command);
  expect(f.approval_required).toBe(false);
  expect(Number.isFinite(Date.parse(f.approved_at))).toBe(true);
  expect(f.reason).toBe(bill.refundContext.reason);
  expect((await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', command)).id).toBe(
    f.id,
  );
  expect(
    (
      await req('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
        ...command,
        amount: '91000',
      })
    ).statusCode,
  ).toBe(409);
  const alert = (await ok('/core/alerts', 'pv001')).find(
    (a: { session_id: string; alert_type: string }) =>
      a.session_id === p.sid && a.alert_type === 'REFUND_REQUIRED',
  );
  expect(alert).toMatchObject({
    requires_admin: false,
    approved_refund_amount: '90000',
    refund_review_amount: '0',
  });
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: f.id, action: 'REFUND_APPROVED' },
    }),
  ).toBe(1);
  expect(
    (await req('/core/alerts/' + alert.id + '/resolve', 'pv001', { reason: 'Đã hoàn' })).statusCode,
  ).toBe(409);
  let state = await ok('/guest/state', cookie);
  expect(state.account.refund_due_amount).toBe('90000');
  expect(state.refundTransactions).toEqual([]);
  const first = { method: 'CASH', amount: '20000', requestId: randomUUID() };
  expect(
    (await req('/core/refunds/' + f.id + '/complete', 'quyettruong05', first)).statusCode,
  ).toBe(403);
  expect(await db.prisma.refund_transaction.count({ where: { refund_case_id: f.id } })).toBe(0);
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', first);
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', first);
  state = await ok('/guest/state', cookie);
  expect(state.account).toMatchObject({ refunded_total: '20000', refund_due_amount: '70000' });
  expect(state.refundTransactions).toHaveLength(1);
  expect(Object.keys(state.refundTransactions[0]).sort()).toEqual([
    'amount',
    'id',
    'method',
    'processed_at',
  ]);
  expect((await ok('/core/alerts', 'pv002')).some((a: { id: string }) => a.id === alert.id)).toBe(
    true,
  );
  await ok('/core/refunds/' + f.id + '/complete', 'pv002', {
    method: 'CASH',
    amount: '70000',
    requestId: randomUUID(),
  });
  state = await ok('/guest/state', cookie);
  expect(state.account).toMatchObject({
    charge_total: '0',
    paid_total: '90000',
    refunded_total: '90000',
    refund_due_amount: '0',
  });
  expect(state.refundTransactions).toHaveLength(2);
  expect((await ok('/core/alerts', 'pv001')).some((a: { id: string }) => a.id === alert.id)).toBe(
    false,
  );
  const other = await party();
  expect((await ok('/guest/state', other.guests[0]!.cookie)).refundTransactions).toEqual([]);
});
it('requires explicit admin approval for old refund documents and deduplicates concurrent approvals', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie);
  const paymentIntent = await intent(p.sid, item.line_total.toString());
  const payment = await ok('/core/payments/' + paymentIntent.id + '/confirm', 'pv001', {
    amount: item.line_total.toString(),
  });
  await ok('/core/items/' + item.id + '/waive', 'quyettruong05', {
    reasonCode: 'QUALITY_ISSUE',
    note: 'Món không đạt chất lượng kiểm tra',
  });
  const legacy = await db.prisma.refund_case.create({
    data: {
      session_id: p.sid,
      source_payment_transaction_id: payment.id,
      amount: item.line_total,
      reason: 'Hồ sơ cũ cần quản trị kiểm tra',
    },
  });
  let bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.refunds[0]).toMatchObject({ approval_required: true, approved_at: null });
  expect(bill.refundWorkflow).toEqual({
    approvedAmount: '0',
    awaitingApprovalAmount: item.line_total.toString(),
    reviewAmount: item.line_total.toString(),
  });
  const completion = { method: 'CASH', requestId: randomUUID() };
  expect(
    (await req('/core/refunds/' + legacy.id + '/complete', 'pv001', completion)).statusCode,
  ).toBe(409);
  expect(
    (await req('/core/refunds/' + legacy.id + '/complete', 'quyettruong05', completion)).statusCode,
  ).toBe(403);
  expect((await req('/core/refunds/' + legacy.id + '/approve', 'pv001', {})).statusCode).toBe(403);
  expect(await db.prisma.refund_transaction.count({ where: { refund_case_id: legacy.id } })).toBe(
    0,
  );
  const approved = await Promise.all([
    ok('/core/refunds/' + legacy.id + '/approve', 'quyettruong05', {}),
    ok('/core/refunds/' + legacy.id + '/approve', 'quyettruong05', {}),
  ]);
  expect(approved[0].approved_at).toBe(approved[1].approved_at);
  expect(approved[0].approval_required).toBe(false);
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: legacy.id, action: 'REFUND_APPROVED' },
    }),
  ).toBe(1);
  await ok('/core/refunds/' + legacy.id + '/complete', 'pv001', completion);
  await ok('/core/refunds/' + legacy.id + '/complete', 'pv001', completion);
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account.refund_due_amount).toBe('0');
  expect(bill.refundWorkflow).toEqual({
    approvedAmount: '0',
    awaitingApprovalAmount: '0',
    reviewAmount: '0',
  });
  expect(await db.prisma.refund_transaction.count({ where: { refund_case_id: legacy.id } })).toBe(
    1,
  );
});
it('staff work reflects only approved amounts while guest communication and further admin review remain independent', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie, 'Gỏi cuốn tôm thịt', 2, false);
  await ok('/core/items/' + item.id + '/accept', 'bep001', {});
  const paymentIntent = await intent(p.sid, '90000');
  const payment = await ok('/core/payments/' + paymentIntent.id + '/confirm', 'pv001', {
    amount: '90000',
    receivedAmount: '100000',
  });
  await ok('/core/items/' + item.id + '/unavailable', 'bep001', {
    reasonCode: 'EQUIPMENT_FAILURE',
  });
  await db.prisma.product.update({
    where: { id: item.product_id },
    data: { availability_status: 'AVAILABLE' },
  });
  let alerts = (await ok('/core/alerts', 'pv001')).filter(
    (a: { session_id: string }) => a.session_id === p.sid,
  );
  const notice = alerts.find((a: { guest_notice: boolean }) => a.guest_notice);
  expect(notice).toBeTruthy();
  expect(alerts.some((a: { alert_type: string }) => a.alert_type === 'REFUND_REQUIRED')).toBe(
    false,
  );
  const f = await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    paymentId: payment.id,
    amount: '20000',
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  alerts = (await ok('/core/alerts', 'pv001')).filter(
    (a: { session_id: string }) => a.session_id === p.sid,
  );
  expect(alerts.some((a: { id: string }) => a.id === notice.id)).toBe(true);
  const refundAlert = alerts.find(
    (a: { alert_type: string }) => a.alert_type === 'REFUND_REQUIRED',
  );
  expect(refundAlert).toMatchObject({
    requires_admin: false,
    approved_refund_amount: '20000',
    refund_review_amount: '70000',
  });
  const completion = { amount: '20000', method: 'CASH', requestId: randomUUID() };
  await ok('/core/refunds/' + f.id + '/complete', 'pv001', completion);
  alerts = (await ok('/core/alerts', 'pv001')).filter(
    (a: { session_id: string }) => a.session_id === p.sid,
  );
  expect(alerts.some((a: { id: string }) => a.id === notice.id)).toBe(true);
  expect(alerts.some((a: { alert_type: string }) => a.alert_type === 'REFUND_REQUIRED')).toBe(
    false,
  );
  const adminAlert = (await ok('/core/alerts', 'quyettruong05')).find(
    (a: { id: string }) => a.id === refundAlert.id,
  );
  expect(adminAlert).toMatchObject({
    requires_admin: true,
    approved_refund_amount: '0',
    refund_review_amount: '70000',
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.refundWorkflow).toEqual({
    approvedAmount: '0',
    awaitingApprovalAmount: '0',
    reviewAmount: '70000',
  });
  expect(bill.completion.pendingChange[0].metadata.changeGiven).toBe('10000');
  expect(bill.account.refund_due_amount).toBe('70000');
  await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {});
  expect(
    (await ok('/core/alerts', 'quyettruong05')).some(
      (a: { id: string }) => a.id === refundAlert.id,
    ),
  ).toBe(true);
});
it('rechecks the whole session balance before approving an old document, including a second guest order', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie);
  const paymentIntent = await intent(p.sid, item.line_total.toString());
  const payment = await ok('/core/payments/' + paymentIntent.id + '/confirm', 'pv001', {
    amount: item.line_total.toString(),
  });
  await ok('/core/items/' + item.id + '/waive', 'quyettruong05', {
    reasonCode: 'QUALITY_ISSUE',
    note: 'Món không đạt chất lượng kiểm tra',
  });
  const legacy = await db.prisma.refund_case.create({
    data: {
      session_id: p.sid,
      source_payment_transaction_id: payment.id,
      amount: item.line_total,
      reason: 'Cần kiểm tra dư phiên',
    },
  });
  const newItem = await dish(p.guests[1]!.cookie);
  expect(
    (await req('/core/refunds/' + legacy.id + '/approve', 'quyettruong05', {})).statusCode,
  ).toBe(409);
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: legacy.id, action: 'REFUND_APPROVED' },
    }),
  ).toBe(0);
  await ok('/core/items/' + newItem.id + '/waive', 'quyettruong05', {
    reasonCode: 'QUALITY_ISSUE',
    note: 'Món không đạt chất lượng kiểm tra',
  });
  await ok('/core/refunds/' + legacy.id + '/approve', 'quyettruong05', {});
  const extraBatch = await ok('/core/sessions/' + p.sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: item.product_id, quantity: item.quantity }],
  });
  const extraItem = await db.prisma.order_item.findFirstOrThrow({
    where: { order_batch_id: extraBatch.id },
  });
  const changed = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(changed.account.refund_due_amount).toBe('0');
  expect(changed.refundWorkflow.approvedAmount).toBe('0');
  expect(changed.closure.blockers.map((b: { code: string }) => b.code)).not.toEqual(
    expect.arrayContaining(['REFUND_OPEN', 'ALERT_REFUND_REQUIRED']),
  );
  expect(changed.closure.blockers.map((b: { code: string }) => b.code)).toContain('KITCHEN_WAIT');
  expect(
    (await ok('/core/alerts', 'pv001')).some(
      (a: { session_id: string; alert_type: string }) =>
        a.session_id === p.sid && a.alert_type === 'REFUND_REQUIRED',
    ),
  ).toBe(false);
  expect(
    (await req('/core/refunds/' + legacy.id + '/complete', 'pv001', { method: 'CASH' })).statusCode,
  ).toBe(409);
  for (const action of ['accept', 'prepare', 'ready'])
    await ok('/core/items/' + extraItem.id + '/' + action, 'bep001', {});
  await ok('/core/items/' + extraItem.id + '/serve', 'pv001', {});
  const delivered = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: delivered.completion.receiptKey,
  });
  expect((await ok('/core/sessions/' + p.sid + '/bill', 'pv001')).closure.canClose).toBe(true);
  await ok('/core/items/' + extraItem.id + '/waive', 'quyettruong05', {
    reasonCode: 'QUALITY_ISSUE',
    note: 'Món không đạt chất lượng kiểm tra',
  });
  expect(await db.prisma.refund_transaction.count({ where: { refund_case_id: legacy.id } })).toBe(
    0,
  );
  await ok('/core/refunds/' + legacy.id + '/complete', 'pv001', {
    method: 'CASH',
    requestId: randomUUID(),
  });
  expect((await ok('/core/sessions/' + p.sid + '/bill', 'pv001')).account.refund_due_amount).toBe(
    '0',
  );
});

it('does not invent an admin refund decision when none exists', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie);
  const payment = await intent(p.sid, item.line_total.toString());
  await ok('/core/payments/' + payment.id + '/confirm', 'pv001', {
    amount: item.line_total.toString(),
  });
  const result = await req('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    paymentId: payment.id,
    amount: '1000',
    useDecisionReason: true,
  });
  expect(result.statusCode).toBe(409);
  expect(result.body).toContain('Chưa có quyết định quản trị');
});

it('requires actual change handover, safely deduplicates concurrent confirmations, and invalidates a receipt after new items', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie, 'Nước suối 500 ml', 1);
  const i = await intent(p.sid, item.line_total.toString());
  const payment = await ok('/core/payments/' + i.id + '/confirm', 'pv001', {
    amount: i.amount,
    receivedAmount: '500000',
  });
  let bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.completion.pendingChange).toHaveLength(1);
  expect(bill.closure.blockers.map((x: { code: string }) => x.code)).toEqual(
    expect.arrayContaining(['CASH_CHANGE', 'RECEIPT']),
  );
  expect(
    (
      await req('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
        delivery: 'PRINTED',
        layout: 'standard',
        billKey: bill.completion.receiptKey,
      })
    ).statusCode,
  ).toBe(409);
  const results = await Promise.all(
    ['pv001', 'pv002'].map((user) =>
      ok('/core/payment-transactions/' + payment.id + '/change-returned', user, {}),
    ),
  );
  expect(results.filter((x) => x.alreadyProcessed)).toHaveLength(1);
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.payments[0].change_returned_at).toBeTruthy();
  expect(bill.completion.pendingChange).toHaveLength(0);
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
    delivery: 'PRINTED',
    layout: 'detailed',
    billKey: bill.completion.receiptKey,
  });
  expect((await ok('/core/sessions/' + p.sid + '/bill', 'pv001')).closure.canClose).toBe(true);
  const stale = bill.completion.receiptKey;
  const next = await dish(p.guests[1]!.cookie, 'Nước suối 500 ml', 1);
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.completion.receiptDelivery).toBeNull();
  const nextIntent = await intent(p.sid, next.line_total.toString());
  await ok('/core/payments/' + nextIntent.id + '/confirm', 'pv001', { amount: nextIntent.amount });
  expect(
    (
      await req('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
        delivery: 'PRINTED',
        layout: 'standard',
        billKey: stale,
      })
    ).statusCode,
  ).toBe(409);
  bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv002', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: bill.completion.receiptKey,
  });
  await ok('/core/sessions/' + p.sid + '/close', 'pv001', {});
  const frozen = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(frozen.completion.receiptDelivery.details.delivery).toBe('DECLINED');
  expect(frozen.charges.every((c: { owner_name: string }) => !!c.owner_name)).toBe(true);
});
it('preparation has not started: unavailable releases reserves once, not physical stock, and alerts both admin and service even unpaid', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie, 'Chả giò giòn', 1, false);
  await ok('/core/items/' + item.id + '/accept', 'bep001', {});
  const before = (
    await db.pool.query(
      'SELECT b.* FROM inventory_balance b JOIN inventory_reservation r ON r.ingredient_id=b.ingredient_id AND r.location_id=b.location_id WHERE r.order_item_id=$1 ORDER BY b.ingredient_id',
      [item.id],
    )
  ).rows;
  expect(before.length).toBeGreaterThan(0);
  const replies = await Promise.all(
    [1, 2].map(() =>
      ok('/core/items/' + item.id + '/unavailable', 'bep001', { reasonCode: 'INGREDIENT_QUALITY' }),
    ),
  );
  expect(replies.filter((r) => r.alreadyProcessed)).toHaveLength(1);
  const after = (
    await db.pool.query(
      'SELECT b.* FROM inventory_balance b JOIN inventory_reservation r ON r.ingredient_id=b.ingredient_id AND r.location_id=b.location_id WHERE r.order_item_id=$1 ORDER BY b.ingredient_id',
      [item.id],
    )
  ).rows;
  expect(after.map((b) => String(b.on_hand_qty))).toEqual(before.map((b) => String(b.on_hand_qty)));
  expect(
    after.every((b, index) => Number(b.reserved_qty) < Number(before[index].reserved_qty)),
  ).toBe(true);
  const alerts = (await ok('/core/alerts', 'pv001')).filter(
    (a: { session_id: string }) => a.session_id === p.sid,
  );
  expect(alerts).toHaveLength(2);
  const inspection = alerts.find((a: { stock_inspection: boolean }) => a.stock_inspection);
  const notice = alerts.find((a: { guest_notice: boolean }) => a.guest_notice);
  expect(
    (await req('/core/alerts/' + inspection.id + '/resolve', 'pv001', { reason: 'Đã kiểm tra' }))
      .statusCode,
  ).toBe(403);
  await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {});
  expect((await ok('/core/sessions/' + p.sid + '/bill', 'pv001')).closure.canClose).toBe(true);
  await ok('/core/alerts/' + inspection.id + '/stock-checked', 'quyettruong05', {
    reason: 'Đã kiểm tra nguyên liệu hỏng; giữ món tạm ngừng bán để xử lý.',
  });
  expect(
    (await db.prisma.product.findUniqueOrThrow({ where: { id: item.product_id } }))
      .availability_status,
  ).toBe('UNAVAILABLE');
  await db.prisma.product.update({
    where: { id: item.product_id },
    data: { availability_status: 'AVAILABLE' },
  });
});

it.each([
  { label: 'fully prepaid', paid: '50000', refundDue: '30000' },
  { label: 'partly prepaid', paid: '30000', refundDue: '10000' },
  { label: 'still owes for the remaining dish', paid: '10000', refundDue: '0' },
])(
  '$label: a pre-preparation stop preserves history and refunds only the actual overpayment',
  async ({ paid, refundDue }) => {
    const p = await party();
    const tag = 'PREP-' + randomUUID().slice(0, 8);
    const category = await db.prisma.menu_category.findFirstOrThrow({ where: { is_active: true } });
    const stoppedProduct = await ok('/core/products', 'quyettruong05', {
      code: tag + '-STOP',
      name: 'Món dừng ' + tag,
      categoryId: category.id,
      price: '30000',
      stockManaged: false,
      complimentary: false,
    });
    const servedProduct = await ok('/core/products', 'quyettruong05', {
      code: tag + '-KEEP',
      name: 'Món còn phục vụ ' + tag,
      categoryId: category.id,
      price: '20000',
      stockManaged: false,
      complimentary: false,
    });
    const batch = await ok('/core/sessions/' + p.sid + '/orders', 'pv001', {
      requestId: randomUUID(),
      lines: [
        { productId: stoppedProduct.id, quantity: 1 },
        { productId: servedProduct.id, quantity: 1 },
      ],
    });
    const items = await db.prisma.order_item.findMany({ where: { order_batch_id: batch.id } });
    const stopped = items.find((i) => i.product_id === stoppedProduct.id)!;
    const kept = items.find((i) => i.product_id === servedProduct.id)!;
    await ok('/core/items/' + stopped.id + '/accept', 'bep001', {});
    for (const action of ['accept', 'prepare', 'ready'])
      await ok('/core/items/' + kept.id + '/' + action, 'bep001', {});
    await ok('/core/items/' + kept.id + '/serve', 'pv001', {});
    const paymentIntent = await intent(p.sid, paid);
    const payment = await ok('/core/payments/' + paymentIntent.id + '/confirm', 'pv001', {
      amount: paid,
      receivedAmount: paid,
    });
    await ok('/core/items/' + stopped.id + '/unavailable', 'bep001', {
      reasonCode: 'EQUIPMENT_FAILURE',
    });
    let bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
    expect(bill.account).toMatchObject({
      charge_total: '20000',
      paid_total: paid,
      refunded_total: '0',
      refund_due_amount: refundDue,
    });
    expect(bill.refundContext.reason).toContain('Hoàn tiền do món dừng trước chế biến');
    expect(bill.refundContext.reason).toContain(stoppedProduct.name);
    expect(bill.refundContext.decisions[0]).toMatchObject({
      item_id: stopped.id,
      action: 'ITEM_UNAVAILABLE',
      reason_code: 'EQUIPMENT_FAILURE',
    });
    const alerts = (await ok('/core/alerts', 'quyettruong05')).filter(
      (a: { session_id: string }) => a.session_id === p.sid,
    );
    const inspection = alerts.find((a: { stock_inspection: boolean }) => a.stock_inspection);
    const notice = alerts.find((a: { guest_notice: boolean }) => a.guest_notice);
    expect(
      alerts.filter((a: { alert_type: string }) => a.alert_type === 'REFUND_REQUIRED'),
    ).toHaveLength(refundDue === '0' ? 0 : 1);
    const lookup = '/core/history/order-unavailable?q=' + tag;
    const pending = await ok(lookup + '&status=NEW', 'quyettruong05');
    expect(pending.total).toBe(1);
    expect(pending.rows[0]).toMatchObject({
      session_code: p.sid.slice(0, 8).toUpperCase(),
      session_status: 'ACTIVE',
      refund_history: {
        scope: 'NONE',
        amount: '0',
        refunded_amount: '0',
        remaining_amount: '0',
        cases: [],
      },
    });
    expect(
      (await ok('/core/history/order-unavailable?itemId=' + stopped.id, 'quyettruong05')).rows.map(
        (i: { id: string }) => i.id,
      ),
    ).toEqual([stopped.id]);
    expect((await ok(lookup + '&itemId=' + kept.id, 'quyettruong05')).total).toBe(0);
    expect(
      (await req('/core/history/order-unavailable?itemId=invalid', 'quyettruong05')).statusCode,
    ).toBe(400);

    const reporter = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'bep001' } });
    expect(pending.rows[0]).toMatchObject({
      id: stopped.id,
      stock_inspection: true,
      has_charge: false,
      stock_check_status: 'NEW',
      reported_reason_code: 'EQUIPMENT_FAILURE',
      reported_by_name: reporter.display_name,
      stock_checked_at: null,
      stock_check_note: null,
    });
    expect(Number.isFinite(Date.parse(pending.rows[0].reported_at))).toBe(true);
    expect(pending.rows[0].reported_reason).toBeTruthy();
    expect((await req(lookup, 'pv001')).statusCode).toBe(403);
    expect((await req(lookup, 'bep001')).statusCode).toBe(403);
    await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {});
    const command = {
      paymentId: payment.id,
      amount: refundDue,
      useDecisionReason: true,
      requestId: randomUUID(),
    };
    if (refundDue === '0') {
      expect(
        (
          await req('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
            ...command,
            amount: '1',
          })
        ).statusCode,
      ).toBe(409);
      expect(await db.prisma.refund_case.count({ where: { session_id: p.sid } })).toBe(0);
    } else {
      expect(
        (
          await req('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
            ...command,
            amount: String(BigInt(refundDue) + 1n),
          })
        ).statusCode,
      ).toBe(409);
      const refund = await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', command);
      expect(refund.reason).toBe(bill.refundContext.reason);
      const approvedHistory = (await ok(lookup, 'quyettruong05')).rows[0];
      expect(approvedHistory.refund_history).toMatchObject({
        scope: 'ITEM',
        amount: refundDue,
        refunded_amount: '0',
        remaining_amount: refundDue,
        cases: [
          {
            id: refund.id,
            scope: 'ITEM',
            association_source: 'APPROVAL_SNAPSHOT',
            related_item_ids: [stopped.id],
          },
        ],
      });
      const partialAmount = (BigInt(refundDue) / 2n).toString();
      const firstReturn = { method: 'CASH', amount: partialAmount, requestId: randomUUID() };
      await ok('/core/refunds/' + refund.id + '/complete', 'pv001', firstReturn);
      await ok('/core/refunds/' + refund.id + '/complete', 'pv001', firstReturn);
      expect((await ok(lookup, 'quyettruong05')).rows[0].refund_history).toMatchObject({
        scope: 'ITEM',
        refunded_amount: partialAmount,
        remaining_amount: (BigInt(refundDue) - BigInt(partialAmount)).toString(),
      });
      const completion = {
        method: 'CASH',
        amount: (BigInt(refundDue) - BigInt(partialAmount)).toString(),
        requestId: randomUUID(),
      };
      await ok('/core/refunds/' + refund.id + '/complete', 'pv001', completion);
      await ok('/core/refunds/' + refund.id + '/complete', 'pv001', completion);
      expect(
        await db.prisma.refund_transaction.count({ where: { refund_case_id: refund.id } }),
      ).toBe(2);
      bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
      expect(bill.account).toMatchObject({ refunded_total: refundDue, refund_due_amount: '0' });
      const stillPending = (await ok('/core/alerts', 'quyettruong05')).filter(
        (a: { session_id: string }) => a.session_id === p.sid,
      );
      expect(stillPending.map((a: { id: string }) => a.id)).toEqual([inspection.id]);
    }
    const checkNote = 'Đã kiểm tra thiết bị ' + tag + '; chờ sửa xong mới mở bán lại.';
    await ok('/core/alerts/' + inspection.id + '/stock-checked', 'quyettruong05', {
      reason: checkNote,
    });
    const resolved = await ok(lookup + '&status=RESOLVED', 'quyettruong05');
    expect(resolved.total).toBe(1);
    const admin = await db.prisma.app_user.findFirstOrThrow({
      where: { username: 'quyettruong05' },
    });
    expect(resolved.rows[0]).toMatchObject({
      id: stopped.id,
      stock_check_status: 'RESOLVED',
      stock_checked_by_name: admin.display_name,
      stock_check_note: checkNote,
      guest_notified: true,
    });
    expect(Number.isFinite(Date.parse(resolved.rows[0].stock_checked_at))).toBe(true);
    expect(Date.parse(resolved.rows[0].stock_checked_at)).toBeGreaterThanOrEqual(
      Date.parse(resolved.rows[0].reported_at),
    );
    expect((await ok(lookup + '&status=NEW', 'quyettruong05')).total).toBe(0);
    expect(
      (
        await ok(
          '/core/history/order-unavailable?q=' + encodeURIComponent(checkNote),
          'quyettruong05',
        )
      ).rows.some((i: { id: string }) => i.id === stopped.id),
    ).toBe(true);
    expect(
      (await ok(lookup + '&period=custom&from=2000-01-01&to=2000-01-02', 'quyettruong05')).total,
    ).toBe(0);
    bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
    if (BigInt(bill.account.outstanding_amount) > 0n) {
      const remainder = await intent(p.sid, bill.account.outstanding_amount);
      await ok('/core/payments/' + remainder.id + '/confirm', 'pv001', {
        amount: remainder.amount,
        receivedAmount: remainder.amount,
      });
    }
    bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
    await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
      delivery: 'DECLINED',
      layout: 'standard',
      billKey: bill.completion.receiptKey,
    });
    await ok('/core/sessions/' + p.sid + '/close', 'pv001', {});
    const closedHistory = await ok(lookup + '&status=RESOLVED', 'quyettruong05');
    expect(closedHistory.rows[0]).toMatchObject({
      id: stopped.id,
      stock_check_note: checkNote,
      stock_checked_by_name: admin.display_name,
      session_status: 'CLOSED',
      session_code: p.sid.slice(0, 8).toUpperCase(),
      refund_history: {
        scope: refundDue === '0' ? 'NONE' : 'ITEM',
        refunded_amount: refundDue,
        remaining_amount: '0',
      },
    });
    expect(closedHistory.rows[0].receipt_number).toMatch(/^PT-/);
    expect(Number.isFinite(Date.parse(closedHistory.rows[0].session_closed_at))).toBe(true);
    expect(
      (await db.prisma.product.findUniqueOrThrow({ where: { id: stoppedProduct.id } }))
        .availability_status,
    ).toBe('UNAVAILABLE');
  },
);

async function historyProduct(tag: string, price: string) {
  const category = await db.prisma.menu_category.findFirstOrThrow({ where: { is_active: true } });
  return ok('/core/products', 'quyettruong05', {
    code: tag,
    name: 'Món lịch sử ' + tag,
    categoryId: category.id,
    price,
    stockManaged: false,
    complimentary: false,
  });
}
async function stoppedHistoryItem(sid: string, productId: string) {
  const batch = await ok('/core/sessions/' + sid + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId, quantity: 1 }],
  });
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
  await ok('/core/items/' + item.id + '/accept', 'bep001', {});
  return item;
}
it('old single-item refund history stays linked to the original stop when a later unpaid item is stopped', async () => {
  const p = await party();
  const tag = 'TRACE-' + randomUUID().slice(0, 8);
  const firstProduct = await historyProduct(tag + '-A', '49000');
  const secondProduct = await historyProduct(tag + '-B', '25000');
  const first = await stoppedHistoryItem(p.sid, firstProduct.id);
  const i = await intent(p.sid, '49000');
  const payment = await ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount: '49000' });
  await ok('/core/items/' + first.id + '/unavailable', 'bep001', {
    reasonCode: 'EQUIPMENT_FAILURE',
  });
  const legacy = await db.prisma.refund_case.create({
    data: {
      session_id: p.sid,
      source_payment_transaction_id: payment.id,
      amount: 49000n,
      reason: 'Hồ sơ cũ hoàn món dừng đầu tiên',
    },
  });
  const before = (await ok('/core/history/order-unavailable?itemId=' + first.id, 'quyettruong05'))
    .rows[0];
  expect(before.refund_history).toMatchObject({
    scope: 'ITEM',
    amount: '49000',
    refunded_amount: '0',
    cases: [
      { id: legacy.id, association_source: 'LEGACY_SINGLE_ITEM', related_item_ids: [first.id] },
    ],
  });
  await ok('/core/refunds/' + legacy.id + '/approve', 'quyettruong05', {});
  await ok('/core/refunds/' + legacy.id + '/complete', 'pv001', {
    method: 'CASH',
    requestId: randomUUID(),
  });
  const second = await stoppedHistoryItem(p.sid, secondProduct.id);
  await ok('/core/items/' + second.id + '/unavailable', 'bep001', { reasonCode: 'OUT_OF_STOCK' });
  const rows = (await ok('/core/history/order-unavailable?q=' + tag, 'quyettruong05')).rows;
  expect(rows.find((row: { id: string }) => row.id === first.id).refund_history).toMatchObject({
    scope: 'ITEM',
    refunded_amount: '49000',
    remaining_amount: '0',
  });
  expect(rows.find((row: { id: string }) => row.id === second.id).refund_history).toEqual({
    scope: 'NONE',
    amount: '0',
    refunded_amount: '0',
    remaining_amount: '0',
    cases: [],
  });
});
it('multi-item documents keep shared actual refund totals without inventing per-item money allocations', async () => {
  const p = await party();
  const tag = 'SHARED-' + randomUUID().slice(0, 8);
  const firstProduct = await historyProduct(tag + '-A', '25000');
  const secondProduct = await historyProduct(tag + '-B', '30000');
  const first = await stoppedHistoryItem(p.sid, firstProduct.id);
  const second = await stoppedHistoryItem(p.sid, secondProduct.id);
  const i = await intent(p.sid, '55000');
  const payment = await ok('/core/payments/' + i.id + '/confirm', 'pv001', { amount: '55000' });
  for (const item of [first, second])
    await ok('/core/items/' + item.id + '/unavailable', 'bep001', {
      reasonCode: 'EQUIPMENT_FAILURE',
    });
  const legacy = await db.prisma.refund_case.create({
    data: {
      session_id: p.sid,
      source_payment_transaction_id: payment.id,
      amount: 55000n,
      reason: 'Hồ sơ chung hai món đã dừng',
    },
  });
  let rows = (await ok('/core/history/order-unavailable?q=' + tag, 'quyettruong05')).rows;
  expect(rows).toHaveLength(2);
  for (const row of rows)
    expect(row.refund_history).toMatchObject({
      scope: 'SESSION',
      amount: null,
      refunded_amount: null,
      remaining_amount: null,
      cases: [
        {
          id: legacy.id,
          amount: '55000',
          refunded_amount: '0',
          scope: 'SESSION',
          association_source: 'LEGACY_SESSION_CONTEXT',
        },
      ],
    });
  await ok('/core/refunds/' + legacy.id + '/approve', 'quyettruong05', {});
  await ok('/core/refunds/' + legacy.id + '/complete', 'pv001', {
    method: 'CASH',
    amount: '20000',
    requestId: randomUUID(),
  });
  rows = (await ok('/core/history/order-unavailable?q=' + tag, 'quyettruong05')).rows;
  for (const row of rows)
    expect(row.refund_history).toMatchObject({
      scope: 'SHARED_SESSION',
      amount: null,
      refunded_amount: null,
      remaining_amount: null,
      cases: [
        {
          id: legacy.id,
          scope: 'SHARED_SESSION',
          association_source: 'APPROVAL_SNAPSHOT',
          amount: '55000',
          refunded_amount: '20000',
          remaining_amount: '35000',
        },
      ],
    });
  await ok('/core/refunds/' + legacy.id + '/complete', 'pv001', {
    method: 'CASH',
    amount: '35000',
    requestId: randomUUID(),
  });
  const alerts = (await ok('/core/alerts', 'pv001')).filter(
    (alert: { session_id: string; guest_notice: boolean }) =>
      alert.session_id === p.sid && alert.guest_notice,
  );
  for (const notice of alerts)
    await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {});
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: bill.completion.receiptKey,
  });
  await ok('/core/sessions/' + p.sid + '/close', 'pv001', {});
  rows = (await ok('/core/history/order-unavailable?q=' + tag, 'quyettruong05')).rows;
  for (const row of rows) {
    expect(row.session_status).toBe('CLOSED');
    expect(row.receipt_number).toMatch(/^PT-/);
    expect(row.refund_history).toMatchObject({
      scope: 'SHARED_SESSION',
      refunded_amount: null,
      cases: [{ id: legacy.id, refunded_amount: '55000', remaining_amount: '0' }],
    });
    expect(Number.isFinite(Date.parse(row.refund_history.cases[0].last_refunded_at))).toBe(true);
  }
});

it('keeps two cash tenders, actual change, invoice credits and refunds distinct across guest, admin and frozen receipts', async () => {
  const p = await party();
  const tag = 'CASH-TRACE-' + randomUUID().slice(0, 8);
  const firstProduct = await historyProduct(tag + '-A', '45000');
  const secondProduct = await historyProduct(tag + '-B', '49000');
  const first = await stoppedHistoryItem(p.sid, firstProduct.id);
  const second = await stoppedHistoryItem(p.sid, secondProduct.id);
  const payments = [];
  for (const amount of ['45000', '49000']) {
    const i = await intent(p.sid, amount);
    payments.push(
      await ok('/core/payments/' + i.id + '/confirm', 'pv001', {
        amount,
        receivedAmount: '100000',
      }),
    );
  }
  const before = await ok('/guest/state', p.guests[0]!.cookie);
  expect(before.account.paid_total).toBe('94000');
  expect(before.payments).toHaveLength(2);
  expect(
    before.payments.every(
      (payment: { change_returned_at: unknown }) => payment.change_returned_at === null,
    ),
  ).toBe(true);
  expect(
    before.payments.map(
      (payment: { cash_received_amount: string }) => payment.cash_received_amount,
    ),
  ).toEqual(['100000', '100000']);
  expect(
    before.payments.map((payment: { change_amount: string }) => payment.change_amount).sort(),
  ).toEqual(['51000', '55000']);
  expect(Object.keys(before.payments[0]).sort()).toEqual([
    'amount',
    'cash_received_amount',
    'change_amount',
    'change_returned_at',
    'id',
    'metadata',
    'method',
    'status',
  ]);
  expect(Object.keys(before.payments[0].metadata).sort()).toEqual([
    'cashHandlingVersion',
    'cashReceived',
    'changeGiven',
  ]);
  for (const payment of payments)
    await ok('/core/payment-transactions/' + payment.id + '/change-returned', 'pv001', {});
  for (const item of [first, second])
    await ok('/core/items/' + item.id + '/unavailable', 'bep001', {
      reasonCode: 'EQUIPMENT_FAILURE',
    });
  const refund = await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    paymentId: payments[0].id,
    amount: '45000',
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  const secondRefund = await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    paymentId: payments[1].id,
    amount: '49000',
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  for (const document of [refund, secondRefund])
    await ok('/core/refunds/' + document.id + '/complete', 'pv001', {
      method: 'CASH',
      requestId: randomUUID(),
    });
  const guestState = await ok('/guest/state', p.guests[0]!.cookie);
  const sum = (rows: Record<string, string>[], key: string) =>
    rows.reduce((total, row) => total + BigInt(row[key] ?? '0'), 0n);
  expect(guestState.account).toMatchObject({
    charge_total: '0',
    paid_total: '94000',
    refunded_total: '94000',
    refund_due_amount: '0',
  });
  const handedOver = sum(guestState.payments, 'cash_received_amount');
  const returnedChange = sum(
    guestState.payments.filter(
      (payment: { change_returned_at: unknown }) => payment.change_returned_at,
    ),
    'change_amount',
  );
  const refunded = sum(guestState.refundTransactions, 'amount');
  const retained =
    BigInt(guestState.account.paid_total) - BigInt(guestState.account.refunded_total);
  expect([handedOver, returnedChange, refunded, retained]).toEqual([200000n, 106000n, 94000n, 0n]);
  expect(handedOver).toBe(returnedChange + refunded + retained);
  const staffBill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  const adminBill = await ok('/core/sessions/' + p.sid + '/bill', 'quyettruong05');
  for (const bill of [staffBill, adminBill]) {
    expect(sum(bill.payments, 'cash_received_amount')).toBe(handedOver);
    expect(sum(bill.payments, 'change_amount')).toBe(returnedChange);
    expect(
      bill.payments.every((payment: { change_returned_at: unknown }) => payment.change_returned_at),
    ).toBe(true);
    expect(bill.account.refunded_total).toBe('94000');
  }
  const notices = (await ok('/core/alerts', 'pv001')).filter(
    (alert: { session_id: string; guest_notice: boolean }) =>
      alert.session_id === p.sid && alert.guest_notice,
  );
  for (const notice of notices)
    await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {});
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: staffBill.completion.receiptKey,
  });
  await ok('/core/sessions/' + p.sid + '/close', 'pv001', {});
  const frozen = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(frozen.account).toMatchObject({
    charge_total: '0',
    paid_total: '94000',
    refunded_total: '94000',
    refund_due_amount: '0',
  });
  expect(sum(frozen.payments, 'cash_received_amount')).toBe(200000n);
  expect(
    sum(
      frozen.payments.filter(
        (payment: { change_returned_at: unknown }) => payment.change_returned_at,
      ),
      'change_amount',
    ),
  ).toBe(106000n);
  const stored = await db.prisma.table_session.findUniqueOrThrow({ where: { id: p.sid } });
  expect(stored.receipt_snapshot).toMatchObject({
    account: frozen.account,
    payments: frozen.payments,
  });
  const legacyPayments = frozen.payments.map((payment: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(payment).filter(
        ([key]) => !['cash_received_amount', 'change_amount', 'change_returned_at'].includes(key),
      ),
    ),
  );
  const c = await db.pool.connect();
  try {
    const legacy = await readBill(
      c,
      { id: p.sid, receipt_snapshot: { ...frozen, payments: legacyPayments } },
      restaurantId,
    );
    expect(legacy).toMatchObject({
      account: frozen.account,
      payments: [
        { cash_received_amount: '100000', change_returned_at: null },
        { cash_received_amount: '100000', change_returned_at: null },
      ],
    });
    expect(stored.receipt_snapshot).toMatchObject({ payments: frozen.payments });
  } finally {
    c.release();
  }
});

it('closed sessions reject cancellation and waiver without changing the final receipt or ledger', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie, 'Khoai tây chiên', 1);
  const payment = await intent(p.sid, item.line_total.toString());
  await ok('/core/payments/' + payment.id + '/confirm', 'pv001', {
    amount: payment.amount,
    receivedAmount: payment.amount,
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: bill.completion.receiptKey,
  });
  await ok('/core/sessions/' + p.sid + '/close', 'pv001', {});
  const before = {
    session: await db.prisma.table_session.findUniqueOrThrow({ where: { id: p.sid } }),
    item: await db.prisma.order_item.findUniqueOrThrow({ where: { id: item.id } }),
    account: await db.prisma.session_financial_account.findUniqueOrThrow({
      where: { session_id: p.sid },
    }),
    charge: await db.prisma.financial_charge.findMany({ where: { session_id: p.sid } }),
    auditCount: await db.prisma.business_audit_event.count({ where: { resource_id: item.id } }),
  };
  const results = await Promise.all([
    req('/core/items/' + item.id + '/waive', 'quyettruong05', {
      reasonCode: 'QUALITY_ISSUE',
      note: 'Khách phản ánh món không đạt chất lượng',
    }),
    req('/core/items/' + item.id + '/late-cancel', 'quyettruong05', {
      reasonCode: 'CUSTOMER_CHANGED_MIND',
    }),
  ]);
  for (const result of results) {
    expect(result.statusCode).toBe(409);
    expect(result.json().userMessage).toContain('Phiên bàn đã chốt');
  }
  expect(await db.prisma.table_session.findUniqueOrThrow({ where: { id: p.sid } })).toEqual(
    before.session,
  );
  expect(await db.prisma.order_item.findUniqueOrThrow({ where: { id: item.id } })).toEqual(
    before.item,
  );
  expect(
    await db.prisma.session_financial_account.findUniqueOrThrow({ where: { session_id: p.sid } }),
  ).toEqual(before.account);
  expect(await db.prisma.financial_charge.findMany({ where: { session_id: p.sid } })).toEqual(
    before.charge,
  );
  expect(await db.prisma.business_audit_event.count({ where: { resource_id: item.id } })).toBe(
    before.auditCount,
  );
  expect(await db.prisma.refund_case.count({ where: { session_id: p.sid } })).toBe(0);
  expect(
    await db.prisma.operational_alert.count({
      where: { session_id: p.sid, alert_type: 'REFUND_REQUIRED' },
    }),
  ).toBe(0);
});

it('closing and waiving race on the session lock, so a settled closed receipt cannot acquire a refund liability', async () => {
  const p = await party();
  const item = await dish(p.guests[0]!.cookie, 'Khoai tây chiên', 1);
  const payment = await intent(p.sid, item.line_total.toString());
  await ok('/core/payments/' + payment.id + '/confirm', 'pv001', {
    amount: payment.amount,
    receivedAmount: payment.amount,
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  await ok('/core/sessions/' + p.sid + '/receipt-provided', 'pv001', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: bill.completion.receiptKey,
  });
  const [closed, waived] = await Promise.all([
    req('/core/sessions/' + p.sid + '/close', 'pv001', {}),
    req('/core/items/' + item.id + '/waive', 'quyettruong05', {
      reasonCode: 'QUALITY_ISSUE',
      note: 'Khách phản ánh món không đạt chất lượng',
    }),
  ]);
  expect([closed.statusCode, waived.statusCode].sort()).toEqual([200, 409]);
  const currentSession = await db.prisma.table_session.findUniqueOrThrow({ where: { id: p.sid } });
  const account = await db.prisma.session_financial_account.findUniqueOrThrow({
    where: { session_id: p.sid },
  });
  const charge = await db.prisma.financial_charge.findFirstOrThrow({
    where: { order_item_id: item.id },
  });
  if (closed.statusCode === 200) {
    expect(currentSession.session_status).toBe('CLOSED');
    expect(currentSession.receipt_snapshot).not.toBeNull();
    expect(charge.status).toBe('ACTIVE');
    expect(account.refund_due_amount.toString()).toBe('0');
  } else {
    expect(currentSession.session_status).toBe('ACTIVE');
    expect(currentSession.receipt_snapshot).toBeNull();
    expect(charge.status).toBe('REVERSED');
    expect(account.refund_due_amount.toString()).toBe(item.line_total.toString());
  }
});

it('refund documents use the remaining invoice payment, not cash tender, and can split across two original payments', async () => {
  const p = await party();
  const first = await dish(p.guests[0]!.cookie, 'Khoai tây chiên', 1);
  const second = await dish(p.guests[1]!.cookie, 'Gỏi cuốn tôm thịt', 1);
  const sources = [];
  for (const item of [first, second]) {
    const payment = await intent(p.sid, item.line_total.toString());
    const original = await ok('/core/payments/' + payment.id + '/confirm', 'pv001', {
      amount: payment.amount,
      receivedAmount: '100000',
    });
    await ok('/core/payment-transactions/' + original.id + '/change-returned', 'pv001', {});
    sources.push(original);
  }
  for (const item of [first, second])
    await ok('/core/items/' + item.id + '/waive', 'quyettruong05', {
      reasonCode: 'QUALITY_ISSUE',
      note: 'Khách phản ánh món không đạt chất lượng',
    });
  const tooLarge = await req('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    amount: '94000',
    paymentId: sources[0].id,
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  expect(tooLarge.statusCode).toBe(409);
  expect(tooLarge.json().userMessage).toContain('49.000 đ');
  expect(await db.prisma.refund_case.count({ where: { session_id: p.sid } })).toBe(0);
  const firstRefund = await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    amount: '49000',
    paymentId: sources[0].id,
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  await ok('/core/refunds/' + firstRefund.id + '/complete', 'pv001', {
    method: 'CASH',
    amount: '49000',
    requestId: randomUUID(),
  });
  const exhausted = await req('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    amount: '1',
    paymentId: sources[0].id,
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  expect(exhausted.statusCode).toBe(409);
  expect(exhausted.json().userMessage).toContain('0 đ');
  const secondRefund = await ok('/core/sessions/' + p.sid + '/refunds', 'quyettruong05', {
    amount: '45000',
    paymentId: sources[1].id,
    useDecisionReason: true,
    requestId: randomUUID(),
  });
  const alert = (await ok('/core/alerts', 'quyettruong05')).find(
    (a: { session_id: string; alert_type: string }) =>
      a.session_id === p.sid && a.alert_type === 'REFUND_REQUIRED',
  );
  await ok('/core/alerts/' + alert.id + '/acknowledge', 'pv001', {});
  expect(
    (await req('/core/alerts/' + alert.id + '/resolve', 'pv001', { reason: 'Bỏ việc đang xử lý' }))
      .statusCode,
  ).toBe(409);
  await ok('/core/refunds/' + secondRefund.id + '/complete', 'pv002', {
    method: 'CASH',
    amount: '45000',
    requestId: randomUUID(),
  });
  const bill = await ok('/core/sessions/' + p.sid + '/bill', 'pv001');
  expect(bill.account).toMatchObject({
    paid_total: '94000',
    refunded_total: '94000',
    refund_due_amount: '0',
  });
  expect(bill.refunds).toHaveLength(2);
});

it('obsolete refund alerts do not remain in work counters and can be resolved without deleting financial history', async () => {
  const p = await party();
  const stale = await db.prisma.operational_alert.create({
    data: {
      session_id: p.sid,
      table_id: p.table.id,
      alert_type: 'REFUND_REQUIRED',
      severity: 'WARNING',
      outstanding_amount: 49000,
    },
  });
  for (const user of ['quyettruong05', 'pv001'])
    expect((await ok('/core/alerts', user)).some((a: { id: string }) => a.id === stale.id)).toBe(
      false,
    );
  expect(
    (await db.prisma.operational_alert.findUniqueOrThrow({ where: { id: stale.id } })).status,
  ).toBe('NEW');
  await ok('/core/alerts/' + stale.id + '/acknowledge', 'pv001', {});
  await ok('/core/alerts/' + stale.id + '/resolve', 'pv001', {
    reason: 'Không còn số tiền cần hoàn theo đối chiếu hiện tại',
  });
  const resolved = await db.prisma.operational_alert.findUniqueOrThrow({ where: { id: stale.id } });
  expect(resolved.status).toBe('RESOLVED');
  expect(resolved.resolution_note).toContain('Không còn số tiền cần hoàn');
  expect(await db.prisma.refund_case.count({ where: { session_id: p.sid } })).toBe(0);
});
