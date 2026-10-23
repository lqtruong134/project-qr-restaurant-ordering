import { restaurantPolicy } from '../packages/contracts/src/restaurant-policy.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { PayosService } from '../apps/api/src/modules/payments/payos.service.js';
import type {
  PayosConfig,
  CreatePaymentLinkRequest,
  WebhookData,
} from '../apps/api/src/modules/payments/payos-adapter.js';
import { config, FakeProvider, signature } from './helpers/payos-provider-fixture.js';

const databaseName = 'thesis_payos_recovery_' + randomBytes(6).toString('hex');
const media = mkdtempSync(join(tmpdir(), 'thesis-payos-recovery-'));
const previousMedia = process.env.MENU_UPLOAD_DIR;
const previousSecret = process.env.AUTH_SECRET;
const password = randomBytes(24).toString('hex');
class RecoveryProvider extends FakeProvider {
  nextAccount: string | undefined;
  nextQr: string | undefined;
  override async create(request: CreatePaymentLinkRequest) {
    const result = await super.create(request);
    const accountNumber = this.nextAccount ?? result.accountNumber;
    const qrCode = this.nextQr ?? result.qrCode;
    this.nextAccount = undefined;
    this.nextQr = undefined;
    return { ...result, accountNumber, qrCode };
  }
}
const provider = new RecoveryProvider();
let host: Database,
  db: Database,
  app: ReturnType<typeof buildApp>,
  service: PayosService,
  staffId: string,
  adminId: string;
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const cookies: Record<string, string> = {};
async function api(path: string, payload?: Record<string, unknown>, user = 'pv001') {
  const response = await app.inject({
    url: path,
    method: payload === undefined ? 'GET' : 'POST',
    headers: { ...headers, cookie: cookies[user] ?? user },
    payload,
  });
  expect(response.statusCode, path + ' ' + response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  process.env.AUTH_SECRET = 'synthetic-fixture-qr-secret-'.repeat(4);
  // The test runner must inject its disposable PostgreSQL URL explicitly. Never load .env here.
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('Synthetic payOS tests require an explicitly supplied local PostgreSQL test host.');
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  for (const folder of readdirSync('packages/database/prisma/migrations')
    .filter((value) => /^\d/.test(value))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
    );
  process.env.MENU_UPLOAD_DIR = media;
  await seed(db, password, { includeWorkforce: false });
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'r'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId, false, { config, provider });
  service = new PayosService(db, restaurantId, { config, provider });
  for (const username of ['quyettruong05', 'pv001', 'bep001']) {
    const response = await app.inject({
      url: '/auth/login',
      method: 'POST',
      headers,
      payload: { username, password },
    });
    expect(response.statusCode).toBe(200);
    cookies[username] = response.cookies.map((value) => value.name + '=' + value.value).join('; ');
  }
  staffId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } })).id;
  adminId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } }))
    .id;
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_payos_recovery_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
  if (previousSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previousSecret;
  if (previousMedia === undefined) delete process.env.MENU_UPLOAD_DIR;
  else process.env.MENU_UPLOAD_DIR = previousMedia;
  rmSync(media, { recursive: true, force: true });
}, 60000);
async function fixture(
  price = '69000',
  amount = '5000',
  virtual = false,
  withSupport = false,
  withGuestOwner = false,
) {
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const category = await db.prisma.menu_category.findFirstOrThrow();
  const table = await api(
    '/core/tables',
    {
      code: 'REC-' + randomUUID().slice(0, 8),
      name: 'Recovery fixture',
      areaId: area.id,
      capacity: 4,
    },
    'quyettruong05',
  );
  const session = await api('/core/tables/' + table.id + '/open', {});
  const product = await api(
    '/core/products',
    {
      code: 'REC-' + randomUUID().slice(0, 8),
      name: 'Recovery dish',
      categoryId: category.id,
      price,
      stockManaged: false,
    },
    'quyettruong05',
  );
  let batch;
  let participantId: string | undefined;
  if (withGuestOwner) {
    const qr = await api('/core/tables/' + table.id + '/qr', {}, 'quyettruong05');
    const joined = await app.inject({
      url: '/guest/join',
      method: 'POST',
      headers,
      payload: {
        token: qr.joinPath.split('#')[1],
        name: 'Projection guest',
        accessCode: session.accessCode,
        acceptedPolicyVersion: restaurantPolicy.version,
      },
    });
    expect(joined.statusCode, joined.body).toBe(200);
    participantId = joined.json().participantId;
    cookies.projection_guest = joined.cookies
      .map((value) => value.name + '=' + value.value)
      .join('; ');
    let state = await api('/guest/state', undefined, 'projection_guest');
    await api(
      '/guest/cart',
      { productId: product.id, quantity: 1, cartVersion: state.cart.cart_version },
      'projection_guest',
    );
    state = await api('/guest/state', undefined, 'projection_guest');
    batch = await api(
      '/guest/orders',
      {
        requestId: randomUUID(),
        cartVersion: state.cart.cart_version,
        itemIds: state.items.map((row: { id: string }) => row.id),
      },
      'projection_guest',
    );
    const current = await db.prisma.order_batch.findUniqueOrThrow({ where: { id: batch.id } });
    if (current.status === 'PENDING_REVIEW')
      await api('/core/orders/' + batch.id + '/review', { approve: true });
  } else
    batch = await api('/core/sessions/' + session.id + '/orders', {
      requestId: randomUUID(),
      lines: [{ productId: product.id, quantity: 1 }],
    });
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
  let supportId: string | undefined;
  if (withSupport)
    supportId = (
      await db.prisma.support_request.create({
        data: {
          session_id: session.id,
          request_type: 'BILL',
          payment_method: 'ONLINE',
          status: 'ACKNOWLEDGED',
          acknowledged_by: staffId,
          acknowledged_at: new Date(),
        },
      })
    ).id;
  if (virtual) provider.nextAccount = '000-ORDER-' + randomUUID().slice(0, 8);
  const intent = await service.create(session.id, staffId, {
    requestId: randomUUID(),
    amount,
    ...(supportId ? { supportRequestId: supportId } : {}),
  });
  const q = (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [
      intent.id,
    ])
  ).rows[0];
  return {
    sid: String(session.id),
    id: String(intent.id),
    code: Number(q.order_code),
    q,
    itemId: item.id,
    supportId,
    participantId,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function received(f: Fixture, amount = 5000) {
  const bank = provider.add(f.code, amount);
  if (f.q.account_number !== '12345678') {
    bank.accountNumber = 'MERCHANT-PRIMARY';
    bank.virtualAccountNumber = f.q.account_number;
  }
  return bank;
}
function event(f: Fixture, bank: ReturnType<typeof received>, fields: Partial<WebhookData> = {}) {
  const data: WebhookData = {
    orderCode: f.code,
    amount: bank.amount,
    description: bank.description,
    accountNumber: bank.accountNumber,
    virtualAccountNumber: bank.virtualAccountNumber,
    reference: bank.reference,
    transactionDateTime: bank.transactionDateTime,
    currency: 'VND',
    paymentLinkId: f.q.payment_link_id,
    code: '00',
    desc: 'Thành công',
    ...fields,
  };
  return { code: '00', success: true, data, signature: signature(data) };
}
async function finance(f: Fixture) {
  const result = await api('/core/sessions/' + f.sid + '/bill');
  return result.account;
}
async function ledger(f: Fixture) {
  return (
    await db.pool.query(
      `SELECT count(DISTINCT p.id)::int AS count,COALESCE(sum(p.amount),0)::text AS received,
      COALESCE((SELECT sum(a.allocated_amount-a.reversed_amount)
        FROM payment_allocation a JOIN payment_transaction t ON t.id=a.payment_transaction_id
        WHERE t.payment_intent_id=$1),0)::text AS allocated
      FROM payment_transaction p WHERE p.payment_intent_id=$1 AND p.provider='PAYOS' AND p.status='SUCCEEDED'`,
      [f.id],
    )
  ).rows[0];
}
async function stored(f: Fixture) {
  return (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [f.id])
  ).rows[0];
}
it('pending 5000 of a 69000 bill reserves collection capacity but never reduces debt', async () => {
  const f = await fixture();
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect(await finance(f)).toMatchObject({
    charge_total: '69000',
    paid_total: '0',
    outstanding_amount: '69000',
    reserved_payment_amount: '5000',
  });
});
it('automatically allocates verified 5000 once, leaves 64000 due and ends its linked request', async () => {
  const f = await fixture('69000', '5000', false, true);
  await service.webhook(event(f, received(f)));
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect(await finance(f)).toMatchObject({
    charge_total: '69000',
    paid_total: '5000',
    outstanding_amount: '64000',
    reserved_payment_amount: '0',
  });
  expect(await stored(f)).toMatchObject({
    status: 'PAID',
    reconciliation_status: null,
    alert_id: null,
  });
  expect(
    await db.prisma.support_request.findUniqueOrThrow({ where: { id: f.supportId } }),
  ).toMatchObject({ status: 'RESOLVED', resolution_actor_type: 'SYSTEM', resolved_by: null });
});
it('accepts exact signed order-specific VA identity while preserving leading zeroes', async () => {
  const f = await fixture('69000', '5000', true);
  await service.webhook(event(f, received(f)));
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect((await stored(f)).reconciliation_status).toBeNull();
});
it('corroborates a GET missing its VA only with the same signed webhook transaction', async () => {
  const f = await fixture('69000', '5000', true),
    bank = received(f);
  const payload = event(f, bank);
  bank.virtualAccountNumber = null;
  await service.webhook(payload);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect((await stored(f)).reconciliation_status).toBeNull();
});
it('keeps signed bank-reported money separate from the ledger, then automatically recovers matching new evidence', async () => {
  const f = await fixture('69000', '5000', true, true),
    bank = received(f),
    payload = event(f, bank);
  bank.virtualAccountNumber = null;
  await service.process(f.id, true, false);
  expect(await stored(f)).toMatchObject({
    status: 'REQUIRES_RECONCILIATION',
    paid_amount: '5000',
    provider_status: 'PAID',
    reconciliation_status: 'OPEN',
  });
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect((await finance(f)).outstanding_amount).toBe('69000');
  const waitingCase = (await service.cases()).find((entry) => entry.id === f.id)!;
  expect(waitingCase.provider_references).toContain(bank.reference);
  expect(waitingCase.verified_at).toBeNull();
  expect(waitingCase.can_resolve).toBe(false);
  expect(waitingCase.resolution_blockers.length).toBeGreaterThan(0);
  await service.webhook(payload);
  const q = await stored(f);
  expect(q).toMatchObject({ status: 'PAID', reconciliation_status: null, resolved_by: null });
  expect(q.resolved_at).toBeInstanceOf(Date);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect((await finance(f)).outstanding_amount).toBe('64000');
  expect(
    await db.prisma.operational_alert.findUniqueOrThrow({ where: { id: q.alert_id } }),
  ).toMatchObject({ status: 'RESOLVED', resolved_by: null });
  expect(
    await db.prisma.business_audit_event.count({
      where: {
        resource_id: f.id,
        action: 'PAYOS_VERIFICATION_RECOVERED',
        actor_type: 'SYSTEM',
      },
    }),
  ).toBe(1);
  expect((await service.cases()).find((entry) => entry.id === f.id)).toMatchObject({
    status: 'RESOLVED',
  });
});
it('recovers a legacy recipient-less webhook only after a fresh signed replay, keeping upgrade audit', async () => {
  const f = await fixture('69000', '5000', true),
    bank = received(f),
    payload = event(f, bank);
  bank.virtualAccountNumber = null;
  const minimal = {
    orderCode: payload.data.orderCode,
    amount: payload.data.amount,
    reference: payload.data.reference,
    paymentLinkId: payload.data.paymentLinkId,
    currency: payload.data.currency,
    code: payload.data.code,
  };
  await db.prisma.payment_webhook_event.create({
    data: {
      provider: 'PAYOS',
      provider_event_id: bank.reference,
      provider_transaction_id: bank.reference,
      payload_hash: createHash('sha256').update(JSON.stringify(minimal)).digest('hex'),
      payload_snapshot: { ...minimal, restaurantId },
      signature_valid: true,
      processing_status: 'REJECTED',
    },
  });
  await service.process(f.id, true, false);
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
  await service.webhook(payload);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect(
    await db.prisma.business_audit_event.count({
      where: { action: 'PAYOS_WEBHOOK_EVIDENCE_UPGRADED' },
    }),
  ).toBeGreaterThan(0);
  const saved = await db.prisma.payment_webhook_event.findFirstOrThrow({
    where: { provider_event_id: bank.reference },
  });
  expect(saved.payload_snapshot).toMatchObject({
    recipientEvidenceVersion: 2,
    recipientVirtualAccountNumber: f.q.account_number,
  });
  expect(saved.processing_status).toBe('PROCESSED');
});
it('does not accept another explicit VA merely because bank and webhook share a merchant primary', async () => {
  const f = await fixture('69000', '5000', true),
    bank = received(f);
  const payload = event(f, bank);
  bank.virtualAccountNumber = 'WRONG-ORDER-VA';
  await service.webhook(payload);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
});
it('does not borrow VA proof from a different reference, amount or currency', async () => {
  for (const mismatch of ['reference', 'amount', 'currency'] as const) {
    const f = await fixture('69000', '5000', true),
      bank = received(f),
      fields: Partial<WebhookData> = {};
    if (mismatch === 'reference') fields.reference = randomUUID();
    if (mismatch === 'amount') fields.amount = 4999;
    if (mismatch === 'currency') fields.currency = 'USD';
    const payload = event(f, bank, fields);
    bank.virtualAccountNumber = null;
    await service.webhook(payload).catch(() => undefined);
    await service.process(f.id, true, false);
    expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  }
});
it('makes duplicate webhooks and concurrent refresh idempotent under locks', async () => {
  const f = await fixture(),
    payload = event(f, received(f));
  await Promise.all([
    service.webhook(payload),
    service.webhook(payload),
    service.process(f.id, true, false),
  ]);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect(
    await db.prisma.payment_webhook_event.count({
      where: { provider_event_id: payload.data.reference },
    }),
  ).toBe(1);
});
it('receives 12000 for a 10000 quote of a 20000 bill without funding the extra 2000', async () => {
  const f = await fixture('20000', '10000');
  await service.webhook(event(f, received(f, 12000)));
  expect(await ledger(f)).toEqual({ count: 1, received: '12000', allocated: '10000' });
  expect(await finance(f)).toMatchObject({
    charge_total: '20000',
    outstanding_amount: '10000',
    refund_due_amount: '2000',
  });
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
});
it('supports underpayment followed by the remaining transfer without reopening a manual exception', async () => {
  const f = await fixture('69000', '5000');
  await service.webhook(event(f, received(f, 2000)));
  expect(await finance(f)).toMatchObject({
    outstanding_amount: '67000',
    reserved_payment_amount: '3000',
  });
  expect((await stored(f)).status).toBe('UNDERPAID');
  await service.webhook(event(f, received(f, 3000)));
  expect((await finance(f)).outstanding_amount).toBe('64000');
  expect((await stored(f)).reconciliation_status).toBeNull();
  expect(await db.prisma.payment_transaction.count({ where: { payment_intent_id: f.id } })).toBe(2);
});
it('records genuinely late money once but retains the exception after cancellation', async () => {
  const f = await fixture();
  await service.cancel(f.id, staffId);
  await service.webhook(event(f, received(f)));
  await service.process(f.id, true, false);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
});
it('retries a provider-success/ledger-failure atomically without claiming or duplicating money', async () => {
  const f = await fixture(),
    payload = event(f, received(f));
  await db.pool.query(`CREATE FUNCTION recovery_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic ledger failure'; END $$`);
  await db.pool.query(
    'CREATE TRIGGER recovery_test_fail BEFORE INSERT ON payment_transaction FOR EACH ROW EXECUTE FUNCTION recovery_test_fail()',
  );
  await expect(service.webhook(payload)).rejects.toThrow();
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  await db.pool.query('DROP TRIGGER recovery_test_fail ON payment_transaction');
  await db.pool.query('DROP FUNCTION recovery_test_fail()');
  await service.process(f.id, true, false);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  await service.webhook(payload);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
});
it('lets an administrator refresh verified provider data without becoming the STAFF collector', async () => {
  const f = await fixture('69000', '5000', false, true);
  received(f);
  await service.refreshForAdmin(f.id, adminId);
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
});
it('never accepts typed-in refund references as proof that a quarantined return occurred', async () => {
  const f = await fixture();
  await expect(
    service.resolve(f.id, adminId, {
      resolution: 'RETURNED_EXTERNALLY',
      reason: 'synthetic operator input',
      reference: 'FAKE-RETURN',
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    await db.prisma.refund_transaction.count({ where: { refund_case: { session_id: f.sid } } }),
  ).toBe(0);
});

it('preserves a closed receipt and quarantines extra verified money without a fake external return', async () => {
  const f = await fixture('5000', '5000');
  await service.webhook(event(f, received(f)));
  for (const action of ['accept', 'prepare', 'ready'])
    await api('/core/items/' + f.itemId + '/' + action, {}, 'bep001');
  await api('/core/items/' + f.itemId + '/serve', {});
  const bill = await api('/core/sessions/' + f.sid + '/bill');
  await api('/core/sessions/' + f.sid + '/receipt-provided', {
    delivery: 'DECLINED',
    layout: 'standard',
    billKey: bill.completion.receiptKey,
  });
  await api('/core/sessions/' + f.sid + '/close', {});
  const before = await db.prisma.table_session.findUniqueOrThrow({ where: { id: f.sid } });
  await service.webhook(event(f, received(f, 2000)));
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  const q = await stored(f);
  expect(q.quarantined_transactions).toMatchObject([{ amount: '2000' }]);
  expect(q.reconciliation_status).toBe('OPEN');
  expect(
    (await db.prisma.table_session.findUniqueOrThrow({ where: { id: f.sid } })).receipt_snapshot,
  ).toEqual(before.receipt_snapshot);
  await expect(
    service.resolve(f.id, adminId, {
      resolution: 'RETURNED_EXTERNALLY',
      reason: 'No bank return proof',
      reference: 'TYPED-RETURN',
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
});
it('maintenance revisits a terminal provider identity case and resolves it only once matching evidence is available', async () => {
  const f = await fixture('69000', '5000', true),
    bank = received(f);
  const originalVirtual = bank.virtualAccountNumber;
  bank.virtualAccountNumber = null;
  await service.process(f.id, true, false);
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
  bank.virtualAccountNumber = originalVirtual;
  await db.pool.query(
    'UPDATE payos_payment_request SET next_poll_at=now() WHERE payment_intent_id=$1',
    [f.id],
  );
  await service.maintain();
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  expect((await stored(f)).reconciliation_status).toBeNull();
});

it('opens a distinct real money exception after automatic recovery while preserving the resolved alert', async () => {
  const f = await fixture('69000', '5000', true),
    bank = received(f),
    payload = event(f, bank);
  bank.virtualAccountNumber = null;
  await service.process(f.id, true, false);
  await service.webhook(payload);
  const recovered = await stored(f);
  const previousAlert = recovered.alert_id;
  const extra = received(f, 2000);
  await service.webhook(event(f, extra));
  const reopened = await stored(f);
  expect(reopened.reconciliation_status).toBe('OPEN');
  expect(reopened.resolved_at).toBeNull();
  expect(reopened.alert_id).not.toBe(previousAlert);
  expect(
    (await db.prisma.operational_alert.findUniqueOrThrow({ where: { id: previousAlert } })).status,
  ).toBe('RESOLVED');
  expect(
    (await db.prisma.operational_alert.findUniqueOrThrow({ where: { id: reopened.alert_id } }))
      .status,
  ).toBe('NEW');
});

it('cannot use an older verification to close a newer metadata mismatch without fresh matching evidence', async () => {
  const f = await fixture(),
    payload = event(f, received(f));
  await service.webhook(payload);
  const original = await provider.get(f.code);
  await service.applyLink(f.id, { ...original, id: 'DIFFERENT-SIGNED-LINK' });
  const mismatch = (await service.cases()).find((entry) => entry.id === f.id)!;
  expect(mismatch).toMatchObject({ status: 'OPEN', verified_at: null, can_resolve: false });
  await expect(service.resolve(f.id, adminId, { resolution: 'RECONCILED' })).rejects.toMatchObject({
    statusCode: 409,
  });
  await service.process(f.id, true, false);
  expect((await stored(f)).reconciliation_status).toBeNull();
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
});

it('one canonical backend snapshot distinguishes 69k debt, 5k QR reservation and 64k collection capacity for both scopes', async () => {
  const f = await fixture('69000', '5000', false, false, true);
  const participant = { id: f.participantId! };
  const pending = await api('/core/sessions/' + f.sid + '/bill');
  expect(pending.financialSummary).toMatchObject({
    billTotal: '69000',
    recordedAmount: '0',
    appliedAmount: '0',
    outstandingAmount: '69000',
    reservedAmount: '5000',
    availableToCollect: '64000',
    reviewRequired: false,
  });
  expect(pending.collectionAvailability).toMatchObject({
    outstandingAmount: '69000',
    reservedAmount: '5000',
    availableAmount: '64000',
    blockedReason: null,
    participants: [
      {
        participantId: participant.id,
        outstandingAmount: '69000',
        reservedAmount: '0',
        availableAmount: '64000',
      },
    ],
  });
  const tables = await api('/core/tables');
  expect(tables.find((row: { session_id: string }) => row.session_id === f.sid)).toMatchObject({
    pending_manual_payments: 0,
    pending_online_payments: 1,
  });
  await service.webhook(event(f, received(f)));
  const paid = await api('/core/sessions/' + f.sid + '/bill');
  expect(paid.financialSummary).toMatchObject({
    billTotal: '69000',
    bankReportedAmount: '5000',
    recordedAmount: '5000',
    appliedAmount: '5000',
    outstandingAmount: '64000',
    reservedAmount: '0',
    availableToCollect: '64000',
    refundDueAmount: '0',
    reviewRequired: false,
  });
  expect(paid.intents.find((row: { id: string }) => row.id === f.id).online).toMatchObject({
    status: 'PAID',
    bankReportedAmount: '5000',
    recordedAmount: '5000',
    appliedAmount: '5000',
  });
  const connection = await db.pool.connect();
  try {
    const { readPaymentPosition } =
      await import('../apps/api/src/modules/payments/payment-position.service.js');
    const { readGuestOnlinePayments } =
      await import('../apps/api/src/modules/sessions/guest-payment-view.js');
    const guestPosition = await readPaymentPosition(
      connection,
      f.sid,
      paid.account,
      participant.id,
    );
    expect(guestPosition.financialSummary).toEqual(paid.financialSummary);
    expect((await api('/guest/state', undefined, 'projection_guest')).financialSummary).toEqual(
      paid.financialSummary,
    );
    expect(guestPosition.collectionAvailability.participants).toHaveLength(1);
    expect(
      (await readGuestOnlinePayments(connection, f.sid, participant.id, restaurantId))[0],
    ).toMatchObject({ paidAmount: '5000', bankConfirmedAmount: '5000', appliedAmount: '5000' });
  } finally {
    connection.release();
  }
});

it('admin acknowledgement is idempotent, changes no money, and generic staff alerts cannot close payment exceptions', async () => {
  const f = await fixture('69000', '5000', true),
    bank = received(f);
  bank.virtualAccountNumber = null;
  await service.process(f.id, true, false);
  const before = await stored(f);
  await Promise.all([
    api('/core/admin/payment-reconciliation/' + f.id + '/acknowledge', {}, 'quyettruong05'),
    api('/core/admin/payment-reconciliation/' + f.id + '/acknowledge', {}, 'quyettruong05'),
  ]);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: f.id, action: 'PAYOS_RECONCILIATION_ACKNOWLEDGED' },
    }),
  ).toBe(1);
  const record = (await api('/core/admin/payment-reconciliation', undefined, 'quyettruong05')).find(
    (row: { id: string }) => row.id === f.id,
  );
  expect(record).toMatchObject({
    acknowledged_by_name: expect.any(String),
    can_resolve: false,
    recorded_amount: '0',
    paid_amount: '5000',
  });
  const staffBill = await api('/core/sessions/' + f.sid + '/bill');
  expect(staffBill.financialSummary).toMatchObject({
    outstandingAmount: '69000',
    bankReportedAmount: '5000',
    appliedAmount: '0',
    availableToCollect: '0',
    reviewRequired: true,
  });
  const alerts = await api('/core/alerts');
  expect(alerts.find((row: { id: string }) => row.id === before.alert_id)).toMatchObject({
    payment_reconciliation: true,
    requires_admin: true,
  });
  for (const action of ['acknowledge', 'resolve']) {
    const result = await app.inject({
      url: '/core/alerts/' + before.alert_id + '/' + action,
      method: 'POST',
      headers: { ...headers, cookie: cookies.pv001 },
      payload: { reason: 'Not a bank proof' },
    });
    expect(result.statusCode).toBe(403);
  }
  const denied = await app.inject({
    url: '/core/admin/payment-reconciliation/' + f.id + '/acknowledge',
    method: 'POST',
    headers: { ...headers, cookie: cookies.pv001 },
    payload: {},
  });
  expect(denied.statusCode).toBe(403);
  bank.virtualAccountNumber = f.q.account_number;
  await api('/core/admin/payment-reconciliation/' + f.id + '/refresh', {}, 'quyettruong05');
  expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  const history = (
    await api('/core/admin/payment-reconciliation', undefined, 'quyettruong05')
  ).find((row: { id: string }) => row.id === f.id);
  expect(history.status).toBe('RESOLVED');
  expect(history.acknowledged_at).not.toBeNull();
});

it('signed bank reporting ahead of GET is visible but never reduces debt or doubles one reference', async () => {
  const f = await fixture(),
    bank = received(f),
    payload = event(f, bank);
  const link = provider.links.get(f.code)!;
  link.transactions = [];
  link.amountPaid = 0;
  link.amountRemaining = 5000;
  link.status = 'PENDING';
  await expect(service.webhook(payload)).rejects.toMatchObject({ statusCode: 503 });
  await expect(service.webhook(payload)).rejects.toMatchObject({ statusCode: 503 });
  const bill = await api('/core/sessions/' + f.sid + '/bill');
  expect(bill.financialSummary).toMatchObject({
    bankReportedAmount: '5000',
    recordedAmount: '0',
    appliedAmount: '0',
    outstandingAmount: '69000',
  });
  expect(
    bill.intents.find((row: { id: string }) => row.id === f.id).online.bankReportedAmount,
  ).toBe('5000');
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  link.transactions = [bank];
  link.amountPaid = 5000;
  link.amountRemaining = 0;
  link.status = 'PAID';
  await service.process(f.id, true, false);
  expect((await api('/core/sessions/' + f.sid + '/bill')).financialSummary).toMatchObject({
    bankReportedAmount: '5000',
    recordedAmount: '5000',
    appliedAmount: '5000',
    outstandingAmount: '64000',
  });
});

it('never self-anchors positive GET or webhook funds after a lost create response', async () => {
  provider.loseCreateResponse = true;
  const f = await fixture();
  expect((await stored(f)).account_number).toBeNull();
  const bank = provider.add(f.code, 5000);
  await service.process(f.id, true, false);
  const missing = await stored(f);
  expect(missing).toMatchObject({
    account_number: null,
    paid_amount: '5000',
    status: 'REQUIRES_RECONCILIATION',
    reconciliation_status: 'OPEN',
  });
  expect(missing.reconciliation_reason).toMatch(/Chưa có bằng chứng tài khoản nhận/);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  await service.webhook(event(f, bank, { paymentLinkId: provider.links.get(f.code)!.id }));
  expect((await stored(f)).account_number).toBeNull();
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect((await finance(f)).outstanding_amount).toBe('69000');
});
it('recovers a webhook-before-create response only after the separate create anchor arrives', async () => {
  const originalCreate = provider.create.bind(provider);
  let sawMissingAnchor = false;
  provider.create = async (request) => {
    const created = await originalCreate(request);
    const bank = provider.add(request.orderCode, 5000);
    const data: WebhookData = {
      orderCode: request.orderCode,
      amount: bank.amount,
      reference: bank.reference,
      description: bank.description,
      accountNumber: bank.accountNumber,
      virtualAccountNumber: bank.virtualAccountNumber,
      transactionDateTime: bank.transactionDateTime,
      currency: 'VND',
      paymentLinkId: created.paymentLinkId,
      code: '00',
      desc: 'Thành công',
    };
    await service.webhook({ code: '00', success: true, data, signature: signature(data) });
    const q = (
      await db.pool.query(
        'SELECT account_number,reconciliation_status FROM payos_payment_request WHERE order_code=$1',
        [request.orderCode],
      )
    ).rows[0];
    sawMissingAnchor = q.account_number === null && q.reconciliation_status === 'OPEN';
    return created;
  };
  try {
    const f = await fixture();
    expect(sawMissingAnchor).toBe(true);
    expect((await stored(f)).account_number).toBe('12345678');
    expect((await stored(f)).reconciliation_status).toBeNull();
    expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
    expect((await finance(f)).outstanding_amount).toBe('64000');
  } finally {
    provider.create = originalCreate;
  }
});
it('rejects an explicitly wrong webhook VA even when GET repeats the expected account alias', async () => {
  const f = await fixture();
  const bank = received(f);
  const payload = event(f, bank, { virtualAccountNumber: 'DIFFERENT-ORDER-VA' });
  await service.webhook(payload);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect((await stored(f)).reconciliation_status).toBe('OPEN');
});
it('does not auto-close unapplied participant money after a table CASH collection consumed its scoped charges', async () => {
  const setup = await fixture('5000', '5000');
  await service.cancel(setup.id, staffId);
  const token = randomBytes(24).toString('hex');
  const guest = await db.prisma.session_participant.create({
    data: {
      session_id: setup.sid,
      guest_id: randomUUID(),
      display_name: 'Scope fixture guest',
      credential_hash: createHash('sha256').update(token).digest('hex'),
    },
  });
  const originalItem = await db.prisma.order_item.findUniqueOrThrow({
    where: { id: setup.itemId },
  });
  const product = await db.prisma.product.findUniqueOrThrow({
    where: { id: originalItem.product_id },
  });
  const cookie = 'guest=' + token;
  const cart = await db.prisma.session_cart.findUniqueOrThrow({ where: { session_id: setup.sid } });
  const line = await api(
    '/guest/cart',
    { cartVersion: cart.cart_version, productId: product.id, quantity: 1 },
    cookie,
  );
  const cartNow = await db.prisma.session_cart.findUniqueOrThrow({
    where: { session_id: setup.sid },
  });
  await api(
    '/guest/orders',
    { requestId: randomUUID(), cartVersion: cartNow.cart_version, itemIds: [line.id] },
    cookie,
  );
  const secondProduct = await api(
    '/core/products',
    {
      code: 'SCOP-' + randomUUID().slice(0, 8),
      name: 'Other participant scope dish',
      categoryId: product.category_id,
      price: '64000',
      stockManaged: false,
    },
    'quyettruong05',
  );
  await api('/core/sessions/' + setup.sid + '/orders', {
    requestId: randomUUID(),
    lines: [{ productId: secondProduct.id, quantity: 1 }],
  });
  const participantIntent = await service.create(setup.sid, staffId, {
    requestId: randomUUID(),
    amount: '5000',
    collectionScope: 'PARTICIPANT',
    participantId: guest.id,
  });
  const participantQ = (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [
      participantIntent.id,
    ])
  ).rows[0];
  const own: Fixture = {
    ...setup,
    id: participantIntent.id,
    code: Number(participantQ.order_code),
    q: participantQ,
  };
  const tableIntent = await api('/core/sessions/' + setup.sid + '/payments', {
    requestId: randomUUID(),
    method: 'CASH',
    amount: '69000',
  });
  await api('/core/payments/' + tableIntent.id + '/confirm', {
    amount: '69000',
    receivedAmount: '69000',
  });
  const payload = event(own, received(own));
  await service.webhook(payload);
  expect(await ledger(own)).toEqual({ count: 1, received: '5000', allocated: '0' });
  expect((await finance(own)).refund_due_amount).toBe('5000');
  expect((await stored(own)).reconciliation_status).toBe('OPEN');
  await service.process(own.id, true, false);
  expect((await stored(own)).reconciliation_status).toBe('OPEN');
  expect((await stored(own)).status).toBe('REQUIRES_RECONCILIATION');
  expect((await finance(own)).refund_due_amount).toBe('5000');
});

it('returns every open reconciliation case while limiting only recent resolved history', async () => {
  const f = await fixture('69000', '5000', true);
  received(f).virtualAccountNumber = null;
  await service.process(f.id, true, false);
  const ids = Array.from({ length: 202 }, () => randomUUID());
  const connection = await db.pool.connect();
  try {
    await connection.query('BEGIN');
    // Terminal synthetic intents avoid active-quote uniqueness and never create money.
    await connection.query(
      `INSERT INTO payment_intent
        (id,session_id,method,amount,status,client_request_id,expires_at,provider)
       SELECT id,$1,'ONLINE',1,'CANCELLED','QUEUE-'||id::text,now()+interval '1 hour','PAYOS'
       FROM unnest($2::uuid[]) AS item(id)`,
      [f.sid, ids],
    );
    await connection.query(
      `WITH fixtures AS (
         SELECT id,position,nextval('payos_order_code_seq') AS code
         FROM unnest($1::uuid[]) WITH ORDINALITY AS item(id,position)
       )
       INSERT INTO payos_payment_request
         (payment_intent_id,created_by,order_code,request_payload,status,provider_status,
          reconciliation_status,reconciliation_reason,resolved_by,resolved_at)
       SELECT id,$2,code,jsonb_build_object('orderCode',code,'amount',1),'CANCELLED','CANCELLED',
         CASE WHEN position<=101 THEN 'OPEN' ELSE 'RESOLVED' END,'Synthetic queue history',
         CASE WHEN position>101 THEN $3::uuid ELSE NULL END,
         CASE WHEN position>101 THEN now() ELSE NULL END
       FROM fixtures`,
      [ids, staffId, adminId],
    );
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
  const expectedOpenIds = (
    await db.pool.query(
      `SELECT p.id FROM payos_payment_request q
       JOIN payment_intent p ON p.id=q.payment_intent_id
       JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id
       WHERE t.restaurant_id=$1 AND q.reconciliation_status='OPEN'`,
      [restaurantId],
    )
  ).rows.map((row) => row.id as string);
  expect(expectedOpenIds.length).toBeGreaterThan(100);
  const cases = await service.cases();
  const open = cases.filter((entry) => entry.status === 'OPEN');
  expect(open.map((entry) => entry.id).sort()).toEqual(expectedOpenIds.sort());
  expect(open.some((entry) => entry.id === f.id)).toBe(true);
  expect(cases.filter((entry) => entry.status === 'RESOLVED')).toHaveLength(100);
  expect(cases.slice(0, open.length).every((entry) => entry.status === 'OPEN')).toBe(true);
});

it('executes the sanitized operator diagnostic in a read-only transaction on the isolated database', async () => {
  const sql = readFileSync('docs/reference/payment-readonly-audit-20261019.sql', 'utf8');
  const statementsOnly = sql.replace(/--[^\r\n]*/g, '');
  expect(statementsOnly).toMatch(/BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i);
  expect(statementsOnly.trim()).toMatch(/ROLLBACK\s*;$/i);
  expect(statementsOnly).not.toMatch(
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|COPY)\b/i,
  );
  expect(statementsOnly).not.toMatch(/'reason'\s*,\s*i\.reconciliation_reason/i);

  const f = await fixture('69000', '5000', true);
  const bank = received(f);
  await service.webhook(event(f, bank));
  const privateValues = [
    'SYNTHETIC-CUSTOMER-' + randomUUID(),
    'SYNTHETIC-ACCOUNT-' + randomUUID(),
    'SYNTHETIC-REFERENCE-' + randomUUID(),
  ];
  // Old administrator notes are free text, not just fixed domain messages.
  // Write the canary only into this suite's randomly named disposable database.
  const privateReason = privateValues.join(' / ');
  await db.pool.query(
    'UPDATE payos_payment_request SET reconciliation_reason=$2 WHERE payment_intent_id=$1',
    [f.id, privateReason],
  );
  expect((await stored(f)).reconciliation_reason).toBe(privateReason);

  // Retarget only the in-memory diagnostic to this fixture. Never execute the
  // operator's real table/session selector against an application database.
  expect(f.sid).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  const targetPredicate =
    "WHERE t.code='A01' AND upper(left(replace(s.id::text,'-',''),8))='FFC78214'";
  expect(sql.split(targetPredicate)).toHaveLength(2);
  const fixtureSql = sql
    .replace(targetPredicate, `WHERE s.id='${f.sid}'::uuid`)
    .replace("'A01/#FFC78214'", "'SYNTHETIC-FIXTURE'");
  const connection = await db.pool.connect();
  try {
    const result = (await connection.query(fixtureSql)) as unknown as {
      command: string;
      fields: { name: string }[];
      rows: Record<string, unknown>[];
    }[];
    const projection = result.find((entry) => entry.command === 'SELECT');
    expect(projection?.fields.map((field) => field.name)).toEqual(['sanitized_payment_audit']);
    expect(projection?.rows).toHaveLength(1);
    const audit = projection!.rows[0]!.sanitized_payment_audit;
    expect(audit).toMatchObject({
      sessionHint: 'SYNTHETIC-FIXTURE',
      hasReason: true,
      requestedAmount: '5000',
      recordedAmount: '5000',
      activeAllocatedAmount: '5000',
      account: { outstanding: '64000' },
      webhookEvidence: [
        {
          signatureVerified: true,
          matchingOrder: true,
          matchingLink: true,
          expectedMatchesVirtual: true,
        },
      ],
    });
    expect(audit).not.toHaveProperty('reason');
    const serialized = JSON.stringify(audit);
    for (const secret of [
      ...privateValues,
      privateReason,
      f.q.account_number,
      f.q.payment_link_id,
      bank.reference,
    ])
      expect(serialized).not.toContain(secret);
    expect(
      (await connection.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
    ).toBe('off');
    expect((await stored(f)).reconciliation_reason).toBe(privateReason);
    expect(await ledger(f)).toEqual({ count: 1, received: '5000', allocated: '5000' });
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }
});

const mbQrAccount = '1000000000001';
const mbPrimaryAccount = '2000000002';
function mbQr(account = mbQrAccount, bin = '970422') {
  const field = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;
  const payload =
    field('00', '01') +
    field('01', '12') +
    field(
      '38',
      field('00', 'A000000727') +
        field('01', field('00', bin) + field('01', account)) +
        field('02', 'QRIBFTTA'),
    ) +
    field('53', '704') +
    field('54', '10000') +
    field('58', 'VN') +
    '6304';
  let crc = 0xffff;
  for (const byte of Buffer.from(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return payload + crc.toString(16).toUpperCase().padStart(4, '0');
}
const mbBinding = () => ({
  clientId: config.clientId!,
  restaurantId,
  bankBin: '970422',
  accountNumber: mbPrimaryAccount,
});
async function withMbBinding(binding: PayosConfig['recipientBinding'], run: () => Promise<void>) {
  const previous = config.recipientBinding;
  config.recipientBinding = binding;
  try {
    await run();
  } finally {
    config.recipientBinding = previous;
  }
}
async function mbFixture(options: { qr?: string; guest?: boolean; primary?: string } = {}) {
  provider.nextAccount = mbQrAccount;
  provider.nextQr = options.qr ?? mbQr();
  const f = await fixture('20000', '10000', false, false, options.guest);
  const bank = provider.add(f.code, 10000);
  bank.accountNumber = options.primary ?? mbPrimaryAccount;
  bank.virtualAccountNumber = null;
  bank.transactionDateTime = new Date().toISOString();
  return { ...f, bank };
}

it('MB recipient hotfix records a scoped primary-account bridge and updates STAFF/GUEST balances', async () => {
  await withMbBinding(mbBinding(), async () => {
    const f = await mbFixture({ guest: true });
    await service.webhook(event(f, f.bank));
    expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
    expect(await stored(f)).toMatchObject({ status: 'PAID', reconciliation_status: null });
    const staff = await api('/core/sessions/' + f.sid + '/bill');
    expect(staff.financialSummary).toMatchObject({
      bankReportedAmount: '10000',
      recordedAmount: '10000',
      appliedAmount: '10000',
      outstandingAmount: '10000',
      reviewRequired: false,
    });
    expect((await api('/guest/state', undefined, 'projection_guest')).financialSummary).toEqual(
      staff.financialSummary,
    );
  });
});
it('MB recipient hotfix requires independent binding for the current client, tenant and bank', async () => {
  for (const binding of [
    undefined,
    { ...mbBinding(), clientId: 'another-synthetic-channel' },
    { ...mbBinding(), restaurantId: randomUUID() },
    { ...mbBinding(), bankBin: '970436' },
    { ...mbBinding(), accountNumber: '3000000003' },
  ]) {
    await withMbBinding(binding, async () => {
      const f = await mbFixture();
      await service.process(f.id, true, false);
      expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
      expect((await stored(f)).status).toBe('REQUIRES_RECONCILIATION');
    });
  }
});
it('MB recipient binding rejects another real recipient or unbound QR even without a webhook', async () => {
  await withMbBinding(mbBinding(), async () => {
    for (const options of [
      { primary: '3000000003' },
      { qr: mbQr(mbQrAccount, '970436') },
      { qr: mbQr('1000000000002') },
      { qr: 'UNVERIFIABLE_QR' },
    ]) {
      const f = await mbFixture(options);
      await service.process(f.id, true, false);
      expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
      expect((await stored(f)).reconciliation_status).toBe('OPEN');
    }
  });
});
it('MB recipient binding automatically records a verified primary-only GET without waiting for a webhook', async () => {
  await withMbBinding(mbBinding(), async () => {
    const f = await mbFixture({ guest: true });
    await service.process(f.id, true, false);
    expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
    expect(await stored(f)).toMatchObject({ status: 'PAID', reconciliation_status: null });
    const staff = await api('/core/sessions/' + f.sid + '/bill');
    expect(staff.financialSummary).toMatchObject({
      bankReportedAmount: '10000',
      recordedAmount: '10000',
      appliedAmount: '10000',
      outstandingAmount: '10000',
      reviewRequired: false,
    });
    expect((await api('/guest/state', undefined, 'projection_guest')).financialSummary).toEqual(
      staff.financialSummary,
    );
    await service.refreshForAdmin(f.id, adminId);
    await service.webhook(event(f, f.bank));
    expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
  });
});
it('MB recipient hotfix never repairs a conflicting explicit GET or webhook VA through a trusted primary', async () => {
  await withMbBinding(mbBinding(), async () => {
    for (const source of ['get', 'webhook'] as const) {
      const f = await mbFixture();
      if (source === 'get') f.bank.virtualAccountNumber = '9999999999999';
      const fields = source === 'webhook' ? { virtualAccountNumber: '9999999999999' } : {};
      await service.webhook(event(f, f.bank, fields));
      expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
      expect((await stored(f)).reconciliation_status).toBe('OPEN');
    }
  });
});
it('MB recipient hotfix blocks bad signatures and wrong order, link, reference, amount or currency', async () => {
  await withMbBinding(mbBinding(), async () => {
    for (const mismatch of [
      'signature',
      'orderCode',
      'paymentLinkId',
      'reference',
      'amount',
      'currency',
    ] as const) {
      const f = await mbFixture();
      const fields: Partial<WebhookData> = {};
      if (mismatch === 'orderCode') fields.orderCode = f.code + 100000;
      if (mismatch === 'paymentLinkId') fields.paymentLinkId = 'another-synthetic-link';
      if (mismatch === 'reference') fields.reference = randomUUID();
      if (mismatch === 'amount') fields.amount = 9999;
      if (mismatch === 'currency') fields.currency = 'USD';
      const payload = event(f, f.bank, fields);
      if (mismatch === 'signature') payload.signature = '0'.repeat(64);
      await service.webhook(payload).catch(() => undefined);
      // Reject the invalid webhook itself. A later independently verified GET is
      // allowed to recover the legitimate receipt without trusting this message.
      expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
    }
    for (const field of ['orderCode', 'amount'] as const) {
      const f = await mbFixture();
      provider.links.get(f.code)![field]++;
      await service.webhook(event(f, f.bank)).catch(() => undefined);
      expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
    }
  });
});
it('MB recipient hotfix makes repeated webhooks and ADMIN refresh idempotent', async () => {
  await withMbBinding(mbBinding(), async () => {
    const f = await mbFixture();
    const payload = event(f, f.bank);
    await Promise.all([
      service.webhook(payload),
      service.webhook(payload),
      service.refreshForAdmin(f.id, adminId),
    ]);
    await service.refreshForAdmin(f.id, adminId);
    await service.webhook(payload);
    expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
    expect(
      await db.prisma.payment_webhook_event.count({
        where: { provider: 'PAYOS', provider_event_id: f.bank.reference },
      }),
    ).toBe(1);
    expect(await stored(f)).toMatchObject({ status: 'PAID', reconciliation_status: null });
  });
});
it('MB recipient hotfix lets ADMIN recover a previously reported timely receipt after retry-time expiry exactly once', async () => {
  await withMbBinding(undefined, async () => {
    const f = await mbFixture();
    f.bank.transactionDateTime = new Date(Date.now() - 150000).toISOString();
    const payload = event(f, f.bank);
    await service.webhook(payload);
    expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
    expect((await stored(f)).reconciliation_reason).toBe(
      'Tài khoản nhận tiền payOS không khớp kênh đã tạo.',
    );
    // All mutations here target only this suite's randomly named disposable DB.
    // The server observed this exact signed transfer inside the original quote.
    await db.pool.query(
      "UPDATE payment_intent SET created_at=now()-interval '3 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",
      [f.id],
    );
    await db.pool.query(
      `INSERT INTO business_audit_event(restaurant_id,resource_id,resource_type,action,reason,details,actor_type,created_at)
         SELECT restaurant_id,resource_id,resource_type,action,reason,details,actor_type,now()-interval '2 minutes'
         FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_PROVIDER_REPORTED'
           AND details->>'bankReportedAmount'='10000'
         ORDER BY created_at,id LIMIT 1`,
      [f.id],
    );
    await withMbBinding(mbBinding(), async () => {
      await api('/core/admin/payment-reconciliation/' + f.id + '/refresh', {}, 'quyettruong05');
      const checked = await stored(f);
      expect({ status: checked.status, reason: checked.reconciliation_reason }).toEqual({
        status: 'PAID',
        reason: 'Tài khoản nhận tiền payOS không khớp kênh đã tạo.',
      });
      expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
      expect(await stored(f)).toMatchObject({ status: 'PAID', reconciliation_status: null });
      expect((await finance(f)).outstanding_amount).toBe('10000');
      await service.refreshForAdmin(f.id, adminId);
      await service.webhook(payload);
      expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
      expect(
        await db.prisma.business_audit_event.count({
          where: { resource_id: f.id, action: 'PAYOS_VERIFICATION_RECOVERED' },
        }),
      ).toBe(1);
    });
  });
});
it('MB recipient hotfix keeps expiry without timely audit and explicit cancellation in reconciliation', async () => {
  for (const cancelled of [false, true]) {
    await withMbBinding(undefined, async () => {
      const f = await mbFixture();
      f.bank.transactionDateTime = new Date(Date.now() - 150000).toISOString();
      await service.webhook(event(f, f.bank));
      await db.pool.query(
        "UPDATE payment_intent SET created_at=now()-interval '3 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",
        [f.id],
      );
      if (cancelled) {
        await db.pool.query(
          'UPDATE payos_payment_request SET cancel_requested=true WHERE payment_intent_id=$1',
          [f.id],
        );
        await db.pool.query(
          `INSERT INTO business_audit_event(restaurant_id,resource_id,resource_type,action,reason,details,actor_type,created_at)
         SELECT restaurant_id,resource_id,resource_type,action,reason,details,actor_type,now()-interval '2 minutes'
         FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_PROVIDER_REPORTED'
           AND details->>'bankReportedAmount'='10000'
         ORDER BY created_at,id LIMIT 1`,
          [f.id],
        );
      }
      await withMbBinding(mbBinding(), async () => {
        await service.refreshForAdmin(f.id, adminId);
        expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
        expect(await stored(f)).toMatchObject({
          status: 'REQUIRES_RECONCILIATION',
          reconciliation_status: 'OPEN',
          resolved_at: null,
        });
        expect(
          await db.prisma.business_audit_event.count({
            where: { resource_id: f.id, action: 'PAYOS_VERIFICATION_RECOVERED' },
          }),
        ).toBe(0);
      });
    });
  }
});
