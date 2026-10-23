import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { restaurantPolicy } from '../packages/contracts/src/restaurant-policy.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { PayosService } from '../apps/api/src/modules/payments/payos.service.js';
import type {
  BankEvidenceContext,
  BankEvidenceInput,
  BankEvidencePreview,
  BankEvidenceProof,
} from '../packages/contracts/src/bank-evidence.js';
import type {
  CreatePaymentLinkRequest,
  WebhookData,
} from '../apps/api/src/modules/payments/payos-adapter.js';
import { config, FakeProvider, signature } from './helpers/payos-provider-fixture.js';

const databaseName = 'thesis_bank_evidence_' + randomBytes(6).toString('hex');
const directory = mkdtempSync(join(tmpdir(), 'thesis-bank-evidence-'));
const previousMedia = process.env.MENU_UPLOAD_DIR;
const previousProof = process.env.PAYMENT_PROOF_DIR;
const previousSecret = process.env.AUTH_SECRET;
const previousBinding = config.recipientBinding;
const password = randomBytes(24).toString('hex');
const primary = '0123456789';
const alias = '1000000000001';
function tlv(tag: string, value: string) {
  return tag + String(Buffer.byteLength(value)).padStart(2, '0') + value;
}
const qr =
  tlv('00', '01') +
  tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', '970422') + tlv('01', alias)));
class BankProvider extends FakeProvider {
  override async create(body: CreatePaymentLinkRequest) {
    return { ...(await super.create(body)), accountNumber: alias, qrCode: qr };
  }
}
const provider = new BankProvider();
let host: Database,
  db: Database,
  app: ReturnType<typeof buildApp>,
  service: PayosService,
  staffId: string,
  adminId: string;
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const cookies: Record<string, string> = {};
async function request(path: string, payload?: Record<string, unknown>, user = 'quyettruong05') {
  return app.inject({
    url: path,
    method: payload === undefined ? 'GET' : 'POST',
    headers: { ...headers, cookie: cookies[user] ?? '' },
    payload,
  });
}
async function api<T = Record<string, unknown>>(
  path: string,
  payload?: Record<string, unknown>,
  user = 'quyettruong05',
): Promise<T> {
  const result = await request(path, payload, user);
  expect(result.statusCode, path + ' ' + result.body).toBe(200);
  return result.json();
}
beforeAll(async () => {
  // Explicit disposable local URL only. Never load a merchant or deployment env.
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('Bank evidence tests require an explicitly supplied local test database.');
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
  process.env.MENU_UPLOAD_DIR = join(directory, 'menu');
  process.env.PAYMENT_PROOF_DIR = join(directory, 'proofs');
  process.env.AUTH_SECRET = 'isolated-bank-evidence-qr-key-not-production-'.repeat(3);
  config.recipientBinding = {
    clientId: config.clientId!,
    restaurantId,
    bankBin: '970422',
    accountNumber: primary,
  };
  await seed(db, password, { includeWorkforce: false });
  const admin = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } });
  const role = await db.prisma.user_role.findFirstOrThrow({
    where: { user_id: admin.id, revoked_at: null },
  });
  const otherAdmin = await db.prisma.app_user.create({
    data: {
      restaurant_id: restaurantId,
      username: 'bank_admin_two',
      display_name: 'Bank evidence verifier two',
      password_hash: admin.password_hash,
    },
  });
  await db.prisma.user_role.create({ data: { user_id: otherAdmin.id, role_id: role.role_id } });
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'b'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId, false, { config, provider });
  service = new PayosService(db, restaurantId, { config, provider });
  for (const username of ['quyettruong05', 'bank_admin_two', 'pv001', 'bep001']) {
    const response = await app.inject({
      url: '/auth/login',
      method: 'POST',
      headers,
      payload: { username, password },
    });
    expect(response.statusCode, response.body).toBe(200);
    cookies[username] = response.cookies.map((value) => value.name + '=' + value.value).join('; ');
  }
  staffId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } })).id;
  adminId = admin.id;
}, 60000);
afterAll(async () => {
  vi.restoreAllMocks();
  config.recipientBinding = previousBinding;
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_bank_evidence_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
  for (const [key, value] of Object.entries({
    MENU_UPLOAD_DIR: previousMedia,
    PAYMENT_PROOF_DIR: previousProof,
    AUTH_SECRET: previousSecret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect(directory.startsWith(join(tmpdir(), 'thesis-bank-evidence-'))).toBe(true);
  rmSync(directory, { recursive: true, force: true });
}, 60000);
async function fixture(amount = '10000', price = '20000') {
  const area = await db.prisma.dining_area.findFirstOrThrow({
    where: { restaurant_id: restaurantId },
  });
  const category = await db.prisma.menu_category.findFirstOrThrow({
    where: { restaurant_id: restaurantId },
  });
  const table = await api<{ id: string }>('/core/tables', {
    code: 'BE-' + randomUUID().slice(0, 8),
    name: 'Bank evidence fixture',
    areaId: area.id,
    capacity: 4,
  });
  const session = await api<{ id: string; accessCode: string }>(
    '/core/tables/' + table.id + '/open',
    {},
    'pv001',
  );
  const product = await api<{ id: string }>('/core/products', {
    code: 'BE-' + randomUUID().slice(0, 8),
    name: 'Bank evidence dish',
    categoryId: category.id,
    price,
    stockManaged: false,
  });
  await api(
    '/core/sessions/' + session.id + '/orders',
    { requestId: randomUUID(), lines: [{ productId: product.id, quantity: 1 }] },
    'pv001',
  );
  const intent = await service.create(session.id, staffId, { requestId: randomUUID(), amount });
  const q = (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [
      intent.id,
    ])
  ).rows[0];
  return {
    id: String(intent.id),
    sid: session.id,
    tableId: table.id,
    accessCode: session.accessCode,
    code: Number(q.order_code),
    q,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const base = (f: Fixture) => '/core/admin/payment-reconciliation/' + f.id + '/bank-evidence';
async function context(f: Fixture) {
  return api<BankEvidenceContext>(base(f));
}
function proofBytes() {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('isolated bank statement ' + randomUUID()),
  ]);
}
async function proof(f: Fixture, user = 'quyettruong05') {
  return api<BankEvidenceProof>(
    base(f) + '/proof',
    { data: proofBytes().toString('base64') },
    user,
  );
}
async function input(f: Fixture, overrides: Partial<BankEvidenceInput> = {}) {
  const saved = await proof(f);
  return {
    proofId: saved.id,
    reference: 'BANK-' + randomUUID(),
    amount: '10000',
    bankTransactionAt: new Date().toISOString(),
    reason: 'Đã đối chiếu sao kê MB Bank và nội dung khoản thanh toán của phiên.',
    attested: true as const,
    ...overrides,
  };
}
async function preview(f: Fixture, body: BankEvidenceInput) {
  return api<BankEvidencePreview>(base(f) + '/preview', body);
}
async function confirm(f: Fixture, token: string, user = 'quyettruong05') {
  return request(base(f) + '/confirm', { token, attested: true }, user);
}
async function ledger(f: Fixture) {
  return (
    await db.pool.query(
      `SELECT count(*)::int AS count,COALESCE(sum(amount),0)::text AS received,
    COALESCE((SELECT sum(a.allocated_amount-a.reversed_amount) FROM payment_allocation a JOIN payment_transaction p ON p.id=a.payment_transaction_id WHERE p.payment_intent_id=$1),0)::text AS allocated
    FROM payment_transaction WHERE payment_intent_id=$1 AND status='SUCCEEDED'`,
      [f.id],
    )
  ).rows[0];
}
function bank(f: Fixture, reference: string, amount = 10000) {
  const item = provider.add(f.code, amount, reference);
  item.accountNumber = primary;
  item.transactionDateTime = new Date().toISOString();
  return item;
}
function event(f: Fixture, item: ReturnType<typeof bank>) {
  const data: WebhookData = {
    orderCode: f.code,
    amount: item.amount,
    description: item.description,
    accountNumber: primary,
    virtualAccountNumber: null,
    reference: item.reference,
    transactionDateTime: item.transactionDateTime,
    currency: 'VND',
    paymentLinkId: f.q.payment_link_id,
    code: '00',
    desc: 'Thành công',
  };
  return { code: '00', success: true, data, signature: signature(data) };
}
it('ADMIN context is scoped, masks the receiver and does not record a bank-reported amount as money', async () => {
  const f = await fixture();
  const result = await context(f);
  expect(result.facts).toMatchObject({
    intentId: f.id,
    sessionId: f.sid,
    quoteAmount: '10000',
    recordedAmount: '0',
    appliedAmount: '0',
    outstandingAmount: '20000',
    receiverBank: 'MB Bank',
    canVerify: true,
  });
  expect(result.facts.receiverAccountMasked).not.toContain(primary);
  expect(JSON.stringify(result)).not.toContain(primary);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('STAFF, KITCHEN and anonymous users cannot read, upload, preview or confirm ADMIN bank evidence', async () => {
  const f = await fixture();
  for (const user of ['pv001', 'bep001', 'anonymous']) {
    for (const [suffix, payload] of [
      ['', undefined],
      ['/proof', { data: proofBytes().toString('base64') }],
      ['/preview', {}],
      ['/confirm', { token: 'x', attested: true }],
    ] as const) {
      const response = await request(base(f) + suffix, payload, user);
      expect([401, 403], response.body).toContain(response.statusCode);
    }
  }
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('bank proofs are private, cannot be fetched by STAFF and cannot be used for another payment', async () => {
  const f = await fixture(),
    other = await fixture();
  const saved = await proof(f);
  const read = await request(base(f) + '/proof/' + saved.id);
  expect(read.statusCode, read.body).toBe(200);
  expect(read.headers['cache-control']).toMatch(/private.*no-store/);
  expect(read.headers['x-content-type-options']).toBe('nosniff');
  expect([401, 403]).toContain(
    (await request(base(f) + '/proof/' + saved.id, undefined, 'pv001')).statusCode,
  );
  expect((await request(base(other) + '/proof/' + saved.id)).statusCode).toBe(404);
  const body = await input(other, { proofId: saved.id });
  expect([400, 404, 409]).toContain((await request(base(other) + '/preview', body)).statusCode);
  expect(await ledger(other)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('proof upload rejects malformed base64, executable content and an excessive file', async () => {
  const f = await fixture();
  for (const data of [
    'data:image/png;base64,AA==',
    Buffer.from('<script>bad()</script>').toString('base64'),
    Buffer.alloc(2097153, 1).toString('base64'),
  ]) {
    const response = await request(base(f) + '/proof', { data });
    expect([400, 413], response.body).toContain(response.statusCode);
  }
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM payment_bank_proof WHERE payment_intent_id=$1',
        [f.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
it('preview shows the exact scoped financial impact and never writes a receipt or allocation', async () => {
  const f = await fixture();
  const result = await preview(f, await input(f));
  expect(result).toMatchObject({
    canConfirm: true,
    blockers: [],
    impact: {
      recordedDelta: '10000',
      allocatedDelta: '10000',
      unallocatedDelta: '0',
      outstandingAfter: '10000',
    },
  });
  expect(result.token).toEqual(expect.any(String));
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM payment_bank_evidence WHERE payment_intent_id=$1',
        [f.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
it('ADMIN can independently verify MB receipt while payOS GET is unavailable without fabricating provider PAID', async () => {
  const f = await fixture();
  const body = await input(f);
  provider.failGet = true;
  try {
    const p = await preview(f, body);
    expect(p.canConfirm).toBe(true);
    const response = await confirm(f, p.token!);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      alreadyProcessed: false,
      verificationSource: 'BANK_ADMIN_VERIFIED',
    });
    expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
    const q = (
      await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [f.id])
    ).rows[0];
    expect(q.provider_status).not.toBe('PAID');
    expect(String(q.paid_amount)).toBe('0');
    const rows = (
      await db.pool.query('SELECT * FROM payment_transaction WHERE payment_intent_id=$1', [f.id])
    ).rows;
    expect(rows[0].metadata.verificationSource).toBe('BANK_ADMIN_VERIFIED');
    expect(rows[0].confirmed_by).toBe(adminId);
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS n FROM bank_receipt_claim WHERE payment_intent_id=$1',
          [f.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS n FROM payment_bank_evidence WHERE payment_intent_id=$1',
          [f.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    provider.failGet = false;
  }
});
it('confirmation requires explicit attestation, the original actor, a valid token and the original intent', async () => {
  const f = await fixture(),
    other = await fixture();
  const p = await preview(f, await input(f));
  expect(
    (await request(base(f) + '/confirm', { token: p.token, attested: false })).statusCode,
  ).toBe(400);
  expect([404, 409]).toContain((await confirm(f, p.token!, 'bank_admin_two')).statusCode);
  expect([404, 409]).toContain((await confirm(other, p.token!)).statusCode);
  expect([400, 404, 409]).toContain((await confirm(f, 'invalid-token')).statusCode);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('a proof uploaded by another ADMIN cannot authorize the current ADMIN preview', async () => {
  const f = await fixture();
  const saved = await proof(f, 'bank_admin_two');
  const body = await input(f, { proofId: saved.id });
  const result = await request(base(f) + '/preview', body);
  expect([400, 404, 409], result.body).toContain(result.statusCode);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('repeated and concurrent confirmations return one immutable bank receipt, claim, allocation and audit', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  const responses = await Promise.all([confirm(f, p.token!), confirm(f, p.token!)]);
  for (const response of responses) expect(response.statusCode, response.body).toBe(200);
  expect(new Set(responses.map((response) => response.json().receiptId)).size).toBe(1);
  const replay = await confirm(f, p.token!);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json().alreadyProcessed).toBe(true);
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM business_audit_event WHERE resource_id=$1 AND action='BANK_ADMIN_PAYMENT_RECEIVED'",
        [f.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM payment_bank_evidence WHERE payment_intent_id=$1',
        [f.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('a later PENDING provider snapshot never downgrades independently verified bank money', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  expect((await confirm(f, p.token!)).statusCode).toBe(200);
  await service.refreshForAdmin(f.id, adminId);
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
  const pi = await db.prisma.payment_intent.findUniqueOrThrow({ where: { id: f.id } });
  expect(pi.status).toBe('SUCCEEDED');
  const q = (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [f.id])
  ).rows[0];
  expect(q.provider_status).toBe('PENDING');
  expect(q.status).toBe('PAID');
});
it('late matching webhook and ADMIN refresh attach provider verification without recording bank money twice', async () => {
  const f = await fixture();
  const body = await input(f);
  const p = await preview(f, body);
  expect((await confirm(f, p.token!)).statusCode).toBe(200);
  const original = (
    await db.pool.query('SELECT id FROM payment_transaction WHERE payment_intent_id=$1', [f.id])
  ).rows[0].id;
  const item = bank(f, body.reference);
  await Promise.all([service.webhook(event(f, item)), service.refreshForAdmin(f.id, adminId)]);
  await service.webhook(event(f, item));
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
  const receipt = (
    await db.pool.query('SELECT * FROM payment_transaction WHERE payment_intent_id=$1', [f.id])
  ).rows[0];
  expect(receipt.id).toBe(original);
  expect(receipt.metadata.verificationSource).toBe('BANK_ADMIN_VERIFIED');
  const webhook = await db.prisma.payment_webhook_event.findFirstOrThrow({
    where: { provider: 'PAYOS', provider_event_id: body.reference },
  });
  expect(webhook.processing_status).toBe('PROCESSED');
  expect(webhook.payment_transaction_id).toBe(original);
});
it('a preview becomes stale after another payment changes the session balance and cannot silently post', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  const cash = await api<{ id: string }>(
    '/core/sessions/' + f.sid + '/payments',
    { method: 'CASH', amount: '5000', requestId: randomUUID() },
    'pv001',
  );
  await api(
    '/core/payments/' + cash.id + '/confirm',
    { amount: '5000', cashReceived: '5000' },
    'pv001',
  );
  const response = await confirm(f, p.token!);
  expect(response.statusCode, response.body).toBe(409);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('an expired preview token cannot be used even if the intent remains payable', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
  try {
    const response = await confirm(f, p.token!);
    expect(response.statusCode, response.body).toBe(409);
  } finally {
    clock.mockRestore();
  }
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('missing or wrongly scoped trusted receiver configuration blocks independent bank verification', async () => {
  const f = await fixture();
  const body = await input(f);
  const previous = config.recipientBinding;
  try {
    for (const binding of [
      undefined,
      { ...previous!, clientId: 'untrusted-channel' },
      { ...previous!, restaurantId: randomUUID() },
      { ...previous!, bankBin: '970436' },
    ]) {
      config.recipientBinding = binding;
      expect((await context(f)).facts.canVerify).toBe(false);
      const p = await preview(f, body);
      expect(p.canConfirm).toBe(false);
      expect(p.token).toBeNull();
      expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
    }
  } finally {
    config.recipientBinding = previous;
  }
});
it('a regular CASH intent cannot be used as a payOS bank evidence destination', async () => {
  const f = await fixture();
  const cash = await api<{ id: string }>(
    '/core/sessions/' + f.sid + '/payments',
    { method: 'CASH', amount: '5000', requestId: randomUUID() },
    'pv001',
  );
  const response = await request(base({ ...f, id: cash.id }));
  expect([400, 404]).toContain(response.statusCode);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('preview validates attestation, exact positive integer amount, reference and timestamp timezone', async () => {
  const f = await fixture();
  const body = await input(f);
  for (const fields of [
    { attested: false },
    { amount: '0' },
    { amount: '10.5' },
    { reference: '../<script>' },
    { bankTransactionAt: '2026-10-23 08:00:00' },
  ]) {
    const response = await request(base(f) + '/preview', { ...body, ...fields });
    expect(response.statusCode, response.body).toBe(400);
  }
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('bank evidence cannot allocate above the quoted partial payment or assert a future or pre-quote receipt', async () => {
  const f = await fixture();
  const body = await input(f);
  for (const fields of [
    { bankTransactionAt: new Date(Date.now() + 60000).toISOString() },
    { bankTransactionAt: new Date(Date.parse(f.q.created_at) - 60000).toISOString() },
  ]) {
    const p = await preview(f, { ...body, ...fields });
    expect(p.canConfirm).toBe(false);
    expect(p.token).toBeNull();
    expect(p.blockers.length).toBeGreaterThan(0);
  }
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('changing a stored proof after preview blocks confirmation and records no receipt', async () => {
  const f = await fixture();
  const body = await input(f);
  const p = await preview(f, body);
  const stored = (
    await db.pool.query('SELECT filename FROM payment_bank_proof WHERE id=$1', [body.proofId])
  ).rows[0];
  expect(stored.filename).toMatch(/^[a-f0-9-]{36}\.png$/);
  const path = join(directory, 'proofs', stored.filename);
  const original = readFileSync(path);
  const altered = Buffer.from(original);
  altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
  writeFileSync(path, altered);
  try {
    const response = await confirm(f, p.token!);
    expect(response.statusCode, response.body).toBe(409);
    expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  } finally {
    writeFileSync(path, original);
  }
});
it('a proof already used for another bank receipt cannot be uploaded and reused with a different reference', async () => {
  const f = await fixture(),
    other = await fixture();
  const bytes = proofBytes();
  const saved = await api<BankEvidenceProof>(base(f) + '/proof', {
    data: bytes.toString('base64'),
  });
  const p = await preview(f, await input(f, { proofId: saved.id }));
  expect((await confirm(f, p.token!)).statusCode).toBe(200);
  const reused = await api<BankEvidenceProof>(base(other) + '/proof', {
    data: bytes.toString('base64'),
  });
  const blocked = await preview(other, await input(other, { proofId: reused.id }));
  expect(blocked.canConfirm).toBe(false);
  expect(blocked.token).toBeNull();
  expect(await ledger(other)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('a bank reference already collected by STAFF BANK_TRANSFER cannot become a second payOS receipt', async () => {
  const f = await fixture(),
    other = await fixture();
  const reference = 'BANK-' + randomUUID();
  const transfer = await api<{ id: string }>(
    '/core/sessions/' + other.sid + '/payments',
    { method: 'BANK_TRANSFER', amount: '10000', requestId: randomUUID() },
    'pv001',
  );
  await api('/core/payments/' + transfer.id + '/confirm', { amount: '10000', reference }, 'pv001');
  const p = await preview(f, await input(f, { reference }));
  expect(p.canConfirm).toBe(false);
  expect(p.token).toBeNull();
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('a bank-admin receipt also blocks a later STAFF BANK_TRANSFER duplicate reference', async () => {
  const f = await fixture(),
    other = await fixture();
  const body = await input(f);
  const p = await preview(f, body);
  expect((await confirm(f, p.token!)).statusCode).toBe(200);
  const transfer = await api<{ id: string }>(
    '/core/sessions/' + other.sid + '/payments',
    { method: 'BANK_TRANSFER', amount: '10000', requestId: randomUUID() },
    'pv001',
  );
  const response = await request(
    '/core/payments/' + transfer.id + '/confirm',
    { amount: '10000', reference: body.reference },
    'pv001',
  );
  expect(response.statusCode, response.body).toBe(409);
  expect(await ledger(other)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('cancelling the payment after preview blocks confirmation instead of overriding lifecycle controls', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  await service.cancel(f.id, staffId);
  const response = await confirm(f, p.token!);
  expect(response.statusCode, response.body).toBe(409);
  expect((await context(f)).facts.canVerify).toBe(false);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('a closed session blocks bank confirmation and preserves its financial snapshot', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  await db.pool.query(
    "UPDATE table_session SET session_status='CLOSED',closed_at=now() WHERE id=$1",
    [f.sid],
  );
  const before = (
    await db.pool.query('SELECT * FROM session_financial_account WHERE session_id=$1', [f.sid])
  ).rows[0];
  const response = await confirm(f, p.token!);
  expect(response.statusCode, response.body).toBe(409);
  expect((await context(f)).facts.canVerify).toBe(false);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  expect(
    (await db.pool.query('SELECT * FROM session_financial_account WHERE session_id=$1', [f.sid]))
      .rows[0],
  ).toEqual(before);
});
it('a bank receipt after quote expiry without independently timely provider evidence remains blocked', async () => {
  const f = await fixture();
  const body = await input(f);
  await db.pool.query(
    "UPDATE payment_intent SET created_at=now()-interval '3 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",
    [f.id],
  );
  const p = await preview(f, {
    ...body,
    bankTransactionAt: new Date(Date.now() - 120000).toISOString(),
  });
  expect(p.canConfirm).toBe(false);
  expect(p.token).toBeNull();
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('a different late provider reference is treated as additional money needing review, never as proof for the old receipt', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  expect((await confirm(f, p.token!)).statusCode).toBe(200);
  const item = bank(f, 'DIFFERENT-' + randomUUID());
  await service.webhook(event(f, item));
  const result = await ledger(f);
  expect(result.allocated).toBe('10000');
  const q = (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [f.id])
  ).rows[0];
  expect(q.reconciliation_status).toBe('OPEN');
  expect(q.status).toBe('REQUIRES_RECONCILIATION');
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM refund_transaction WHERE refund_case_id IN (SELECT id FROM refund_case WHERE session_id=$1)',
        [f.sid],
      )
    ).rows[0].n,
  ).toBe(0);
});
it('posting failures roll back receipt, claim, allocation, evidence and preview consumption atomically', async () => {
  const f = await fixture();
  const p = await preview(f, await input(f));
  expect(f.id).toMatch(/^[a-f0-9-]{36}$/);
  // Only this freshly named disposable database receives a failure-injection trigger.
  await db.pool
    .query(`CREATE FUNCTION isolated_bank_posting_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM payment_transaction WHERE id=NEW.payment_transaction_id AND payment_intent_id='${f.id}'::uuid)
    THEN RAISE EXCEPTION 'SYNTHETIC_BANK_POSTING_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER isolated_bank_posting_failure BEFORE INSERT ON outbox_event FOR EACH ROW EXECUTE FUNCTION isolated_bank_posting_failure();`);
  try {
    expect((await confirm(f, p.token!)).statusCode).toBe(500);
    expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS n FROM bank_receipt_claim WHERE payment_intent_id=$1',
          [f.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS n FROM payment_bank_evidence WHERE payment_intent_id=$1',
          [f.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          'SELECT confirmed_at,receipt_id FROM payment_bank_preview WHERE payment_intent_id=$1',
          [f.id],
        )
      ).rows[0],
    ).toEqual({ confirmed_at: null, receipt_id: null });
  } finally {
    await db.pool.query(
      'DROP TRIGGER isolated_bank_posting_failure ON outbox_event; DROP FUNCTION isolated_bank_posting_failure()',
    );
  }
  const retried = await confirm(f, p.token!);
  expect(retried.statusCode, retried.body).toBe(200);
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
});
it('concurrent bank confirmation and valid provider webhook cannot post the same receipt twice', async () => {
  const f = await fixture();
  const body = await input(f);
  const p = await preview(f, body);
  const item = bank(f, body.reference);
  const [confirmation] = await Promise.all([confirm(f, p.token!), service.webhook(event(f, item))]);
  expect([200, 409], confirmation.body).toContain(confirmation.statusCode);
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM bank_receipt_claim WHERE payment_intent_id=$1',
        [f.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await service.refreshForAdmin(f.id, adminId);
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
});
it('revoking ADMIN access after preview prevents confirmation even with the original valid token', async () => {
  const f = await fixture();
  const saved = await proof(f, 'bank_admin_two');
  const body: BankEvidenceInput = {
    proofId: saved.id,
    reference: 'BANK-' + randomUUID(),
    amount: '10000',
    bankTransactionAt: new Date().toISOString(),
    reason: 'Đối chiếu sao kê MB Bank độc lập.',
    attested: true,
  };
  const p = await api<BankEvidencePreview>(base(f) + '/preview', body, 'bank_admin_two');
  const user = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'bank_admin_two' } });
  await db.pool.query(
    'UPDATE user_role SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
    [user.id],
  );
  try {
    expect((await confirm(f, p.token!, 'bank_admin_two')).statusCode).toBe(403);
    expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  } finally {
    await db.pool.query('UPDATE user_role SET revoked_at=NULL WHERE user_id=$1', [user.id]);
  }
});
it('tenant ownership is rechecked for evidence context and private proof reads', async () => {
  const f = await fixture();
  const foreign = await db.prisma.restaurant.create({
    data: { name: 'Isolated foreign restaurant' },
  });
  const area = await db.prisma.dining_area.create({
    data: { restaurant_id: foreign.id, code: 'FOREIGN', name: 'Foreign test area' },
  });
  const table = await db.prisma.dining_table.create({
    data: {
      restaurant_id: foreign.id,
      area_id: area.id,
      code: 'FOREIGN',
      name: 'Foreign table',
      capacity: 4,
    },
  });
  const party = await db.prisma.table_session.create({ data: { table_id: table.id } });
  const pi = await db.prisma.payment_intent.create({
    data: {
      session_id: party.id,
      method: 'ONLINE',
      provider: 'PAYOS',
      amount: 10000n,
      client_request_id: randomUUID(),
      expires_at: new Date(Date.now() + 300000),
    },
  });
  const actor = await db.prisma.app_user.create({
    data: {
      restaurant_id: foreign.id,
      username: 'foreign_admin',
      display_name: 'Foreign administrator',
      password_hash: 'synthetic-unusable-password-hash',
    },
  });
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO payment_bank_proof(id,restaurant_id,payment_intent_id,uploaded_by,filename,sha256,mime,byte_size)
    VALUES($1,$2,$3,$4,$5,$6,'image/png',8)`,
    [id, foreign.id, pi.id, actor.id, randomUUID() + '.png', 'a'.repeat(64)],
  );
  const foreignFixture = { ...f, id: pi.id, sid: party.id, tableId: table.id };
  expect((await request(base(foreignFixture))).statusCode).toBe(404);
  expect((await request(base(foreignFixture) + '/proof/' + id)).statusCode).toBe(404);
  expect(await ledger(foreignFixture)).toEqual({ count: 0, received: '0', allocated: '0' });
});
it('two previews for the same bank receipt cannot bypass the consumed receipt or stale snapshot checks', async () => {
  const f = await fixture();
  const body = await input(f);
  const first = await preview(f, body),
    second = await preview(f, body);
  const responses = await Promise.all([confirm(f, first.token!), confirm(f, second.token!)]);
  expect(responses.filter((response) => response.statusCode === 200).length).toBe(1);
  expect(responses.filter((response) => response.statusCode === 409).length).toBe(1);
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
});
it('concurrent confirmations cannot reuse the same statement image for two different bank receipts', async () => {
  const f = await fixture(),
    other = await fixture();
  const bytes = proofBytes().toString('base64');
  const saved = await api<BankEvidenceProof>(base(f) + '/proof', { data: bytes });
  const otherSaved = await api<BankEvidenceProof>(base(other) + '/proof', { data: bytes });
  const first = await preview(f, await input(f, { proofId: saved.id }));
  const second = await preview(other, await input(other, { proofId: otherSaved.id }));
  const responses = await Promise.all([confirm(f, first.token!), confirm(other, second.token!)]);
  expect(responses.filter((response) => response.statusCode === 200).length).toBe(1);
  expect(responses.filter((response) => response.statusCode === 409).length).toBe(1);
  expect((await ledger(f)).count + (await ledger(other)).count).toBe(1);
});
it('independent bank provenance is visible to STAFF and GUEST without leaking proof, bank reference or full account', async () => {
  const f = await fixture();
  const qr = await api<{ joinPath: string }>('/core/tables/' + f.tableId + '/qr', {});
  const joined = await app.inject({
    url: '/guest/join',
    method: 'POST',
    headers,
    payload: {
      token: qr.joinPath.split('#')[1],
      name: 'Bank source guest',
      accessCode: f.accessCode,
      acceptedPolicyVersion: restaurantPolicy.version,
    },
  });
  expect(joined.statusCode, joined.body).toBe(200);
  cookies.bank_guest = joined.cookies.map((value) => value.name + '=' + value.value).join('; ');
  const body = await input(f);
  const p = await preview(f, body);
  expect((await confirm(f, p.token!)).statusCode).toBe(200);
  const staff = await api<{
    intents: {
      id: string;
      online: {
        verificationSource: string;
        providerEvidenceAttached: boolean;
        recordedAmount: string;
        appliedAmount: string;
        bankReportedAmount: string;
      };
    }[];
  }>('/core/sessions/' + f.sid + '/bill', undefined, 'pv001');
  const online = staff.intents.find((row) => row.id === f.id)!.online;
  expect(online).toMatchObject({
    verificationSource: 'BANK_ADMIN_VERIFIED',
    providerEvidenceAttached: false,
    recordedAmount: '10000',
    appliedAmount: '10000',
    bankReportedAmount: '0',
  });
  const guest = await api<{
    onlinePayments: { verificationSource: string; providerEvidenceAttached: boolean }[];
  }>('/guest/state', undefined, 'bank_guest');
  expect(guest.onlinePayments[0]).toMatchObject({
    verificationSource: 'BANK_ADMIN_VERIFIED',
    providerEvidenceAttached: false,
  });
  expect(JSON.stringify(guest)).not.toContain(body.reference);
  expect(JSON.stringify(guest)).not.toContain(body.proofId);
  expect(JSON.stringify(guest)).not.toContain(primary);
  const item = bank(f, body.reference);
  await service.webhook(event(f, item));
  const checked = await api<{
    onlinePayments: { verificationSource: string; providerEvidenceAttached: boolean }[];
  }>('/guest/state', undefined, 'bank_guest');
  expect(checked.onlinePayments[0]).toMatchObject({
    verificationSource: 'BANK_ADMIN_VERIFIED',
    providerEvidenceAttached: true,
  });
  expect(await ledger(f)).toEqual({ count: 1, received: '10000', allocated: '10000' });
});
it('a claimed bank amount cannot override the exact amount already reported for the same provider reference', async () => {
  const f = await fixture();
  const item = bank(f, 'BANK-' + randomUUID(), 5000);
  item.accountNumber = '9999999999';
  await service.process(f.id, true, false);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
  const p = await preview(f, await input(f, { reference: item.reference, amount: '10000' }));
  expect(p.canConfirm).toBe(false);
  expect(p.token).toBeNull();
  expect(p.blockers.join(' ')).toMatch(/số tiền/i);
  expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
});

it.each(['20000', '10000'])(
  'ADMIN records verified excess without spending beyond quote and closes only after actual refund, bill %s',
  async (price) => {
    const f = await fixture('10000', price),
      body = await input(f, { amount: '12000' });
    const p = await preview(f, body);
    expect(p.canConfirm).toBe(true);
    expect(p.impact).toEqual({
      recordedDelta: '12000',
      allocatedDelta: '10000',
      unallocatedDelta: '2000',
      outstandingAfter: price === '20000' ? '10000' : '0',
    });
    expect(await ledger(f)).toEqual({ count: 0, received: '0', allocated: '0' });
    const posted = await confirm(f, p.token!);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(await ledger(f)).toEqual({ count: 1, received: '12000', allocated: '10000' });
    let cases = await service.cases();
    const current = cases.find((row) => row.id === f.id)!;
    expect(current.status).toBe('OPEN');
    expect(current.can_resolve).toBe(false);
    expect(current.provider_status).toBe('PENDING');
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_BANK_PAYMENT_RECEIVED'",
          [f.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(current.bank_verified_at).not.toBeNull();
    expect(
      (
        await request('/core/admin/payment-reconciliation/' + f.id + '/resolve', {
          resolution: 'RECONCILED',
        })
      ).statusCode,
    ).toBe(409);
    const refund = await api<{ id: string }>('/core/sessions/' + f.sid + '/refunds', {
      paymentId: posted.json().receiptId,
      amount: '2000',
      reason: 'Hoàn thực tế tiền chuyển dư của bài kiểm thử ngân hàng',
      requestId: randomUUID(),
    });
    // Approval never means the guest received a refund.
    expect(
      (
        await request('/core/admin/payment-reconciliation/' + f.id + '/resolve', {
          resolution: 'RECONCILED',
        })
      ).statusCode,
    ).toBe(409);
    await api(
      '/core/refunds/' + refund.id + '/complete',
      { amount: '2000', method: 'CASH', requestId: randomUUID() },
      'pv001',
    );
    cases = await service.cases();
    expect(cases.find((row) => row.id === f.id)!.can_resolve).toBe(true);
    expect(
      (
        await request('/core/admin/payment-reconciliation/' + f.id + '/resolve', {
          resolution: 'RECONCILED',
        })
      ).statusCode,
    ).toBe(200);
    const q = (
      await db.pool.query(
        'SELECT q.*,p.status AS intent_status FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id WHERE p.id=$1',
        [f.id],
      )
    ).rows[0];
    expect(q.status).toBe('PAID');
    expect(q.intent_status).toBe('SUCCEEDED');
    expect(q.provider_status).toBe('PENDING');
    expect(q.paid_amount).toBe('0');
    const money = (
      await db.pool.query('SELECT * FROM session_financial_account WHERE session_id=$1', [f.sid])
    ).rows[0];
    expect(money.refund_due_amount).toBe('0');
    expect(money.outstanding_amount).toBe(price === '20000' ? '10000' : '0');
    const item = bank(f, body.reference, 12000);
    await service.webhook(event(f, item));
    const afterProvider = (
      await db.pool.query(
        `SELECT q.reconciliation_status,p.metadata FROM payos_payment_request q
      JOIN payment_transaction p ON p.payment_intent_id=q.payment_intent_id WHERE q.payment_intent_id=$1`,
        [f.id],
      )
    ).rows[0];
    expect(afterProvider.reconciliation_status).toBe('RESOLVED');
    expect(afterProvider.metadata.verificationSource).toBe('BANK_ADMIN_VERIFIED');
    expect(afterProvider.metadata.providerVerifiedAt).toBeTruthy();
    expect(await ledger(f)).toEqual({ count: 1, received: '12000', allocated: '10000' });
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS n FROM refund_transaction r JOIN refund_case c ON c.id=r.refund_case_id WHERE c.session_id=$1',
          [f.sid],
        )
      ).rows[0].n,
    ).toBe(1);
  },
);
