import { onlinePaymentState } from '../apps/web/features/shared/online-payment.js';
import type {
  PaymentLink,
  CreatePaymentLinkRequest,
} from '../apps/api/src/modules/payments/payos-adapter.js';
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  officialPayosProvider,
  type PayosConfig,
} from '../apps/api/src/modules/payments/payos-adapter.js';

// Deliberately synthetic, isolated credentials. Never use a merchant channel in regression tests.
const checksum = 'protocol-regression-checksum-with-no-merchant-access';
const config: PayosConfig = {
  enabled: true,
  clientId: 'protocol-test-client',
  apiKey: 'protocol-test-api-key',
  checksumKey: checksum,
  returnUrl: 'https://restaurant.example/payos/return',
  cancelUrl: 'https://restaurant.example/payos/cancel',
};
function signature(data: Record<string, unknown>) {
  const encoded = Object.keys(data)
    .sort()
    .filter((key) => data[key] !== undefined)
    .map((key) => {
      const value = data[key];
      return (
        key +
        '=' +
        (value === null
          ? ''
          : Array.isArray(value)
            ? JSON.stringify(
                value.map((item) => {
                  if (item === null || typeof item !== 'object') return item;
                  return Object.fromEntries(
                    Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
                  );
                }),
              )
            : String(value))
      );
    })
    .join('&');
  return createHmac('sha256', checksum).update(encoded).digest('hex');
}
const request = {
  orderCode: 987654321,
  amount: 44100,
  description: 'QRTEST001',
  returnUrl: config.returnUrl!,
  cancelUrl: config.cancelUrl!,
};
function link(fields: Record<string, unknown> = {}) {
  return {
    id: 'protocol-test-link-id',
    orderCode: request.orderCode,
    amount: request.amount,
    amountPaid: 0,
    amountRemaining: request.amount,
    status: 'PENDING',
    createdAt: '2026-10-14T00:00:00Z',
    transactions: [],
    cancellationReason: null,
    canceledAt: null,
    ...fields,
  };
}
function created(fields: Record<string, unknown> = {}) {
  return {
    bin: '970422',
    accountNumber: 'FAKE-TEST-ACCOUNT',
    accountName: 'PROTOCOL TEST',
    amount: request.amount,
    description: request.description,
    orderCode: request.orderCode,
    currency: 'VND',
    paymentLinkId: 'protocol-test-link-id',
    status: 'PENDING',
    checkoutUrl: 'https://pay.payos.vn/web/protocol-test-link-id',
    qrCode: 'SYNTHETIC-QR',
    ...fields,
  };
}
function response(data: Record<string, unknown>, ...supplied: [unknown?]) {
  const suppliedSignature = supplied.length ? supplied[0] : signature(data);
  return new Response(
    JSON.stringify({
      code: '00',
      desc: 'success',
      data,
      ...(suppliedSignature === undefined ? {} : { signature: suppliedSignature }),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
function transport(result: () => Response) {
  const fetcher = vi.fn<typeof fetch>(async () => result());
  return { fetcher, provider: officialPayosProvider(config, fetcher as typeof fetch) };
}

describe('payOS official SDK transport integrity, without external network', () => {
  it.each(['create', 'get', 'cancel'] as const)(
    '%s refuses a successful response that omits its signature',
    async (operation) => {
      const data =
        operation === 'create'
          ? created()
          : link(operation === 'cancel' ? { status: 'CANCELLED' } : {});
      const { provider, fetcher } = transport(() => response(data, undefined));
      const call =
        operation === 'create'
          ? provider.create(request)
          : operation === 'cancel'
            ? provider.cancel(request.orderCode, 'Không tiếp tục thanh toán')
            : provider.get(request.orderCode);
      await expect(call).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['', 'not-a-signature', '0'.repeat(64)])(
    'refuses malformed or wrong signatures (%s)',
    async (badSignature) => {
      const { provider } = transport(() => response(link(), badSignature));
      await expect(provider.get(request.orderCode)).rejects.toThrow();
    },
  );
  it('refuses changed amountPaid even when the provider response has a validly shaped old signature', async () => {
    const original = link();
    const { provider } = transport(() =>
      response(
        { ...original, amountPaid: request.amount, amountRemaining: 0, status: 'PAID' },
        signature(original),
      ),
    );
    await expect(provider.get(request.orderCode)).rejects.toThrow();
  });
  it('returns a correctly signed bank transaction list', async () => {
    const data = link({
      amountPaid: 20000,
      amountRemaining: 24100,
      status: 'UNDERPAID',
      transactions: [
        {
          reference: 'FAKE-BANK-REFERENCE-1',
          amount: 20000,
          accountNumber: 'FAKE-TEST-ACCOUNT',
          description: request.description,
          transactionDateTime: '2026-10-14 07:00:00',
          virtualAccountName: null,
          virtualAccountNumber: null,
          counterAccountBankId: null,
          counterAccountBankName: null,
          counterAccountName: null,
          counterAccountNumber: null,
        },
      ],
    });
    const { provider, fetcher } = transport(() => response(data));
    const result = await provider.get(request.orderCode);
    expect(result.amountPaid).toBe(20000);
    expect(result.amountRemaining).toBe(24100);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.reference).toBe('FAKE-BANK-REFERENCE-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('signs the server quote and sends the exact orderCode and VAT-inclusive amount', async () => {
    const { provider, fetcher } = transport(() => response(created()));
    await provider.create(request);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.amount).toBe(44100);
    expect(body.orderCode).toBe(request.orderCode);
    expect(body.signature).toBe(signature(request));
    expect(body.invoice).toBeUndefined();
  });
});

describe('payOS signed webhook payload boundary', () => {
  const data = {
    orderCode: request.orderCode,
    amount: 20000,
    description: request.description,
    accountNumber: 'FAKE-TEST-ACCOUNT',
    reference: 'FAKE-WEBHOOK-REFERENCE',
    transactionDateTime: '2026-10-14 07:00:00',
    currency: 'VND',
    paymentLinkId: 'protocol-test-link-id',
    code: '00',
    desc: 'Thành công',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: '',
    counterAccountNumber: '',
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
  it('verifies data without making any outbound API call', async () => {
    const { provider, fetcher } = transport(() => {
      throw Error('An outbound webhook verification call is forbidden');
    });
    const verified = await provider.verify({
      code: '00',
      desc: 'success',
      success: true,
      data,
      signature: signature(data),
    });
    expect(verified.amount).toBe(20000);
    expect(verified.reference).toBe(data.reference);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a tampered transaction amount before any reconciliation', async () => {
    const { provider } = transport(() => {
      throw Error('Network is forbidden');
    });
    await expect(
      provider.verify({
        code: '00',
        desc: 'success',
        success: true,
        data: { ...data, amount: 44100 },
        signature: signature(data),
      }),
    ).rejects.toThrow();
  });
  it('does not turn a signed failed data.code into success through envelope fields', async () => {
    const failedData = { ...data, code: '01', desc: 'Không thành công' };
    const { provider } = transport(() => {
      throw Error('Network is forbidden');
    });
    const verified = await provider.verify({
      code: '00',
      desc: 'success',
      success: true,
      data: failedData,
      signature: signature(failedData),
    });
    expect(verified.code).toBe('01');
  });
  it('rejects the documented registration sample if its signature is missing', async () => {
    const probe = {
      ...data,
      orderCode: 123,
      amount: 3000,
      description: 'VQRIO123',
      reference: 'TF230204212323',
    };
    const { provider } = transport(() => {
      throw Error('Network is forbidden');
    });
    await expect(
      provider.verify({ code: '00', desc: 'success', success: true, data: probe }),
    ).rejects.toThrow();
  });
});

import { beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { PayosService } from '../apps/api/src/modules/payments/payos.service.js';
import {
  transaction as dbTransaction,
  session as lockSession,
} from '../apps/api/src/modules/shared/core-persistence.js';
import { reverseItemCharge } from '../apps/api/src/modules/finance/ledger.service.js';
import type { PayosProvider } from '../apps/api/src/modules/payments/payos-adapter.js';

describe('payOS independent protocol and ledger regression', () => {
  const databaseName = 'thesis_payos_protocol_' + randomBytes(8).toString('hex');
  const password = randomBytes(24).toString('hex');
  const media = mkdtempSync(join(tmpdir(), 'thesis-payos-protocol-media-'));
  const previousMedia = process.env.MENU_UPLOAD_DIR;
  const cookies: Record<string, string> = {};
  const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
  let host: Database, db: Database, app: ReturnType<typeof buildApp>, staffId: string;
  const orders = new Map<number, PaymentLink>();
  const requests = new Map<number, CreatePaymentLinkRequest>();
  let nextCreateAccount: string | null = null;
  const verification = officialPayosProvider(config, async () => {
    throw Error('Real network is forbidden in protocol tests');
  });
  const fake: PayosProvider = {
    async create(input) {
      requests.set(input.orderCode, input);
      const recipientAccount = nextCreateAccount ?? 'FAKE-TEST-ACCOUNT';
      nextCreateAccount = null;
      const fresh = link({
        id: 'test-link-' + input.orderCode,
        orderCode: input.orderCode,
        amount: input.amount,
        amountPaid: 0,
        amountRemaining: input.amount,
      });
      orders.set(input.orderCode, fresh as PaymentLink);
      return created({
        ...input,
        accountNumber: recipientAccount,
        paymentLinkId: fresh.id,
        checkoutUrl: 'https://pay.payos.vn/web/' + fresh.id,
      }) as Awaited<ReturnType<PayosProvider['create']>>;
    },
    async get(orderCode) {
      if (!orders.has(orderCode))
        throw Object.assign(new Error('No synthetic order'), { testNotFound: true });
      return structuredClone(orders.get(orderCode)) as Awaited<ReturnType<PayosProvider['get']>>;
    },
    async cancel(orderCode) {
      const current = orders.get(orderCode)!;
      const cancelled = {
        ...current,
        status: 'CANCELLED',
        cancellationReason: 'Synthetic cancellation',
        canceledAt: new Date().toISOString(),
      };
      orders.set(orderCode, cancelled as PaymentLink);
      return structuredClone(cancelled) as Awaited<ReturnType<PayosProvider['cancel']>>;
    },
    verify: (body) => verification.verify(body),
    isNotFound: (error) => !!error && typeof error === 'object' && 'testNotFound' in error,
  };
  let service: PayosService;
  async function http(path: string, body?: unknown, user = 'pv001') {
    return app.inject({
      method: body === undefined ? 'GET' : 'POST',
      url: path,
      headers: { ...headers, cookie: cookies[user] ?? user },
      payload: body as Record<string, unknown>,
    });
  }
  async function api(path: string, body?: unknown, user?: string) {
    const result = await http(path, body, user);
    expect(result.statusCode, path + ' ' + result.body).toBe(200);
    return result.json();
  }
  beforeAll(async () => {
    process.env.MENU_UPLOAD_DIR = media;
    const url = new URL(process.env.DATABASE_URL!);
    host = createDatabase(url.toString());
    await host.pool.query('CREATE DATABASE ' + databaseName);
    url.pathname = '/' + databaseName;
    db = createDatabase(url.toString());
    for (const directory of readdirSync('packages/database/prisma/migrations')
      .filter((entry) => /^\d/.test(entry))
      .sort()) {
      await db.pool.query(
        readFileSync('packages/database/prisma/migrations/' + directory + '/migration.sql', 'utf8'),
      );
    }
    await seed(db, password, { includeWorkforce: false });
    app = buildApp(db);
    await registerAuth(app, db, {
      secret: 's'.repeat(96),
      restaurantId,
      origins: [headers.origin],
      secure: false,
      loginLimit: 100,
    });
    registerModules(app, db, restaurantId);
    for (const user of ['quyettruong05', 'pv001', 'bep001']) {
      const result = await http('/auth/login', { username: user, password }, '');
      expect(result.statusCode).toBe(200);
      cookies[user] = result.cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ');
    }
    staffId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } })).id;
    service = new PayosService(db, restaurantId, { config, provider: fake });
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.close();
    if (host) {
      expect(databaseName).toMatch(/^thesis_payos_protocol_[a-f0-9]+$/);
      await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
      await host.close();
    }
    if (previousMedia === undefined) delete process.env.MENU_UPLOAD_DIR;
    else process.env.MENU_UPLOAD_DIR = previousMedia;
    rmSync(media, { recursive: true, force: true });
  }, 60000);
  async function fixture(discounted = false, virtualAccount = false) {
    const area = await db.prisma.dining_area.findFirstOrThrow();
    const category = await db.prisma.menu_category.findFirstOrThrow();
    const table = await api(
      '/core/tables',
      {
        code: 'PROTO-' + randomBytes(4).toString('hex'),
        name: 'Bàn kiểm thử giao thức',
        areaId: area.id,
        capacity: 4,
      },
      'quyettruong05',
    );
    const opened = await api('/core/tables/' + table.id + '/open', {});
    const dish = await api(
      '/core/products',
      {
        code: 'PROTO-' + randomBytes(4).toString('hex'),
        name: 'Món kiểm thử giao thức',
        categoryId: category.id,
        price: '49000',
        stockManaged: false,
      },
      'quyettruong05',
    );
    const batch = await api('/core/sessions/' + opened.id + '/orders', {
      requestId: randomUUID(),
      lines: [{ productId: dish.id, quantity: 1 }],
    });
    const item = await db.prisma.order_item.findFirstOrThrow({
      where: { order_batch_id: batch.id },
    });
    if (discounted) {
      const promo = await api(
        '/core/admin/discount-programs',
        {
          name: 'Ưu đãi kiểm thử giao thức',
          description: 'Giảm theo giá đã gồm VAT',
          mode: 'CODE',
          code: 'PROTO' + randomBytes(4).toString('hex').toUpperCase(),
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
        },
        'quyettruong05',
      );
      await api('/core/sessions/' + opened.id + '/promotion', {
        programId: promo.id,
        requestId: randomUUID(),
      });
    }
    const amount = discounted ? '44100' : '49000';
    if (virtualAccount) nextCreateAccount = 'FAKE-ORDER-VIRTUAL-ACCOUNT';
    const pi = await service.create(opened.id, staffId, { requestId: randomUUID(), amount });
    const q = (
      await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [pi.id])
    ).rows[0];
    return {
      sid: opened.id as string,
      itemId: item.id,
      id: pi.id as string,
      code: Number(q.order_code),
      q,
      amount,
    };
  }
  function bank(reference: string, amount: number): PaymentLink['transactions'][number] {
    return {
      reference,
      amount,
      accountNumber: 'FAKE-TEST-ACCOUNT',
      description: 'QRTEST001',
      transactionDateTime: '2026-10-14 07:00:00',
      virtualAccountName: null,
      virtualAccountNumber: null,
      counterAccountBankId: null,
      counterAccountBankName: null,
      counterAccountName: null,
      counterAccountNumber: null,
    };
  }
  function bankLink(f: Awaited<ReturnType<typeof fixture>>, transfers: ReturnType<typeof bank>[]) {
    const amountPaid = transfers.reduce((sum, transfer) => sum + transfer.amount, 0);
    const state = link({
      id: f.q.payment_link_id,
      orderCode: f.code,
      amount: Number(f.amount),
      amountPaid,
      amountRemaining: Math.max(Number(f.amount) - amountPaid, 0),
      status: amountPaid >= Number(f.amount) ? 'PAID' : amountPaid ? 'UNDERPAID' : 'PENDING',
      transactions: transfers,
    });
    orders.set(f.code, state as PaymentLink);
    return state as Awaited<ReturnType<PayosProvider['get']>>;
  }
  function webhook(
    f: Awaited<ReturnType<typeof fixture>>,
    transfer: ReturnType<typeof bank>,
    fields: Record<string, unknown> = {},
  ) {
    const data = {
      orderCode: f.code,
      amount: transfer.amount,
      description: transfer.description,
      accountNumber: transfer.accountNumber,
      reference: transfer.reference,
      transactionDateTime: transfer.transactionDateTime,
      currency: 'VND',
      paymentLinkId: f.q.payment_link_id,
      code: '00',
      desc: 'Thành công',
      counterAccountBankId: '',
      counterAccountBankName: '',
      counterAccountName: '',
      counterAccountNumber: '',
      virtualAccountName: '',
      virtualAccountNumber: '',
      ...fields,
    };
    return { code: '00', desc: 'success', success: true, data, signature: signature(data) };
  }
  async function account(sid: string) {
    return (await api('/core/sessions/' + sid + '/bill')).account;
  }
  it('durably retains signed unknown registration data without changing any money', async () => {
    const before = await db.prisma.payment_transaction.count();
    const data = {
      orderCode: 123,
      amount: 3000,
      description: 'VQRIO123',
      accountNumber: 'FAKE-PROBE-ACCOUNT',
      reference: 'PROBE-' + randomUUID(),
      transactionDateTime: '2023-02-04 18:25:00',
      currency: 'VND',
      paymentLinkId: 'probe-link-id',
      code: '00',
      desc: 'Thành công',
    };
    const result = await service.webhook({
      code: '00',
      desc: 'success',
      success: true,
      data,
      signature: signature(data),
    });
    expect(result.status).toBe('UNMATCHED');
    const stored = (
      await db.pool.query(
        "SELECT * FROM payment_webhook_event WHERE provider='PAYOS' AND provider_event_id=$1",
        [data.reference],
      )
    ).rows[0];
    expect(stored.signature_valid).toBe(true);
    expect(stored.processing_status).toBe('UNMATCHED');
    expect(stored.payment_transaction_id).toBeNull();
    expect(await db.prisma.payment_transaction.count()).toBe(before);
  });
  it('restricts the unmatched inbox to administrators without accepting guest or staff sessions', async () => {
    const route = '/core/admin/payment-webhooks/unmatched';
    expect((await http(route, undefined, 'pv001')).statusCode).toBe(403);
    expect((await http(route, undefined, 'bep001')).statusCode).toBe(403);
    expect((await http(route, undefined, '')).statusCode).toBe(401);
    expect((await http(route, undefined, 'quyettruong05')).statusCode).toBe(200);
  });
  it('exposes only minimal signed unknown data for inspection and never creates a receipt', async () => {
    const before = await db.prisma.payment_transaction.count();
    const data = {
      orderCode: 0,
      amount: 3000,
      description: 'SYNTHETIC-REGISTRATION-NOT-A-RECEIPT',
      accountNumber: 'PRIVATE-BANK-DATA-MUST-NOT-LEAVE-INBOX',
      reference: 'VISIBLE-PROBE-' + randomUUID(),
      transactionDateTime: '2026-10-14 07:00:00',
      currency: 'VND',
      paymentLinkId: 'synthetic-unmatched-link',
      code: '00',
      desc: 'Thành công',
      counterAccountName: 'PRIVATE-COUNTERPARTY-MUST-NOT-LEAVE-INBOX',
    };
    const envelope = {
      code: '00',
      desc: 'success',
      success: true,
      data,
      signature: signature(data),
    };
    expect((await service.webhook(envelope)).status).toBe('UNMATCHED');
    expect((await service.webhook(envelope)).status).toBe('UNMATCHED');
    const rows = await api('/core/admin/payment-webhooks/unmatched', undefined, 'quyettruong05');
    const visible = rows.filter((row: { reference: string }) => row.reference === data.reference);
    expect(visible).toHaveLength(1);
    expect(Object.keys(visible[0]).sort()).toEqual([
      'amount',
      'currency',
      'id',
      'orderCode',
      'receivedAt',
      'reference',
    ]);
    expect(visible[0]).toMatchObject({ amount: '3000', currency: 'VND', orderCode: '0' });
    expect(new Date(visible[0].receivedAt).getTime()).not.toBeNaN();
    expect(JSON.stringify(visible)).not.toContain('PRIVATE-');
    expect(JSON.stringify(visible)).not.toContain('SYNTHETIC-REGISTRATION');
    expect(await db.prisma.payment_transaction.count()).toBe(before);
  });
  it('omits unsigned, nonpositive, rejected, other-provider and other-restaurant events from the inbox', async () => {
    const privateReference = 'OTHER-RESTAURANT-' + randomUUID();
    const unsignedReference = 'UNSIGNED-' + randomUUID();
    const hiddenReferences: string[] = [privateReference, unsignedReference];
    const data = {
      orderCode: 123,
      amount: 3000,
      description: 'Synthetic unknown notification',
      accountNumber: 'PRIVATE-BANK-ACCOUNT',
      reference: privateReference,
      transactionDateTime: '2026-10-14 07:00:00',
      currency: 'VND',
      paymentLinkId: 'synthetic-unknown-link',
      code: '00',
      desc: 'Thành công',
    };
    const otherRestaurant = new PayosService(db, randomUUID(), { config, provider: fake });
    await otherRestaurant.webhook({ code: '00', success: true, data, signature: signature(data) });
    await expect(
      service.webhook({
        code: '00',
        success: true,
        data: { ...data, reference: unsignedReference },
      }),
    ).rejects.toThrow('Chữ ký payOS không hợp lệ');
    expect(
      (
        await db.pool.query('SELECT id FROM payment_webhook_event WHERE provider_event_id=$1', [
          unsignedReference,
        ])
      ).rowCount,
    ).toBe(0);
    for (const variation of [
      { provider: 'PAYOS', valid: false, status: 'UNMATCHED', amount: 3000 },
      { provider: 'PAYOS', valid: true, status: 'UNMATCHED', amount: 0 },
      { provider: 'PAYOS', valid: true, status: 'UNMATCHED', amount: -1 },
      { provider: 'PAYOS', valid: true, status: 'UNMATCHED', amount: 'invalid-amount' },
      { provider: 'PAYOS', valid: true, status: 'REJECTED', amount: 3000 },
      { provider: 'SYNTHETIC-OTHER', valid: true, status: 'UNMATCHED', amount: 3000 },
    ]) {
      const reference = 'HIDDEN-INBOX-' + randomUUID();
      hiddenReferences.push(reference);
      await db.pool.query(
        `INSERT INTO payment_webhook_event(provider,provider_event_id,payload_hash,payload_snapshot,signature_valid,processing_status)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [
          variation.provider,
          reference,
          'synthetic-inbox-filter-hash',
          JSON.stringify({
            restaurantId,
            orderCode: 123,
            amount: variation.amount,
            currency: 'VND',
            reference,
          }),
          variation.valid,
          variation.status,
        ],
      );
    }
    const rows = await api('/core/admin/payment-webhooks/unmatched', undefined, 'quyettruong05');
    expect(rows.map((row: { reference: string }) => row.reference)).not.toEqual(
      expect.arrayContaining(hiddenReferences),
    );
    for (const reference of hiddenReferences) {
      expect(rows.some((row: { reference: string }) => row.reference === reference)).toBe(false);
    }
  });
  it('an envelope success flag cannot capture a signed unsuccessful bank transaction', async () => {
    const f = await fixture();
    const transfer = bank('FAILED-' + randomUUID(), 49000);
    bankLink(f, [transfer]);
    const result = await service.webhook(
      webhook(f, transfer, { code: '01', desc: 'Không thành công' }),
    );
    expect(result.status).toBe('REJECTED');
    expect((await account(f.sid)).paid_total).toBe('0');
    expect(await db.prisma.payment_transaction.count({ where: { payment_intent_id: f.id } })).toBe(
      0,
    );
  });
  it('partial transfers reserve only their remainder, deduplicate replay and refund each real source after a discount', async () => {
    const f = await fixture(true);
    const first = bank('PARTIAL-1-' + randomUUID(), 20000);
    const second = bank('PARTIAL-2-' + randomUUID(), 24100);
    bankLink(f, [first]);
    await Promise.all([service.webhook(webhook(f, first)), service.webhook(webhook(f, first))]);
    const partial = await account(f.sid);
    expect(partial.paid_total).toBe('20000');
    expect(partial.outstanding_amount).toBe('24100');
    expect(partial.reserved_payment_amount).toBe('24100');
    bankLink(f, [first, second]);
    await service.webhook(webhook(f, second));
    await service.webhook(webhook(f, first));
    const paid = await account(f.sid);
    expect(paid.paid_total).toBe('44100');
    expect(paid.outstanding_amount).toBe('0');
    expect(paid.reserved_payment_amount).toBe('0');
    const payments = (
      await db.pool.query(
        "SELECT * FROM payment_transaction WHERE payment_intent_id=$1 AND status='SUCCEEDED' ORDER BY amount",
        [f.id],
      )
    ).rows;
    expect(payments.map((payment) => payment.amount)).toEqual(['20000', '24100']);
    await dbTransaction(db, async (connection) => {
      await lockSession(connection, f.sid, restaurantId);
      await reverseItemCharge(connection, f.itemId, f.sid);
    });
    expect((await account(f.sid)).refund_due_amount).toBe('44100');
    const excessive = await http(
      '/core/sessions/' + f.sid + '/refunds',
      {
        requestId: randomUUID(),
        paymentId: payments[0].id,
        amount: '44100',
        reason: 'Hoàn món nhà hàng dừng phục vụ',
      },
      'quyettruong05',
    );
    expect(excessive.statusCode).toBe(409);
    for (const payment of payments) {
      const refund = await api(
        '/core/sessions/' + f.sid + '/refunds',
        {
          requestId: randomUUID(),
          paymentId: payment.id,
          amount: payment.amount,
          reason: 'Hoàn món nhà hàng dừng phục vụ',
        },
        'quyettruong05',
      );
      await api('/core/refunds/' + refund.id + '/complete', {
        requestId: randomUUID(),
        amount: payment.amount,
        method: 'BANK_TRANSFER',
        reference: 'RETURN-' + payment.provider_transaction_id,
      });
    }
    const finished = await account(f.sid);
    expect(finished.refunded_total).toBe('44100');
    expect(finished.refund_due_amount).toBe('0');
    expect(finished.paid_total).toBe('44100');
  });
  it('an older signed provider snapshot cannot downgrade a completed payment or its collected total', async () => {
    const f = await fixture();
    const first = bank('STALE-1-' + randomUUID(), 20000);
    const second = bank('STALE-2-' + randomUUID(), 29000);
    const old = bankLink(f, [first]);
    await service.applyLink(f.id, old);
    const complete = bankLink(f, [first, second]);
    await service.applyLink(f.id, complete);
    await service.applyLink(f.id, old);
    const stored = (
      await db.pool.query(
        'SELECT q.paid_amount,q.status,p.status AS intent_status FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id WHERE p.id=$1',
        [f.id],
      )
    ).rows[0];
    expect(stored.paid_amount).toBe('49000');
    expect(stored.intent_status).toBe('SUCCEEDED');
    expect(stored.status).toBe('PAID');
    expect((await account(f.sid)).paid_total).toBe('49000');
  });
  it('persists a fixed diagnostic message instead of a provider exception containing sensitive canaries', async () => {
    const f = await fixture();
    const canary = 'DO-NOT-LEAK-SYNTHETIC-KEY-AND-BANK-PII';
    const failing = new PayosService(db, restaurantId, {
      config,
      provider: {
        ...fake,
        async get() {
          throw Object.assign(new Error(canary), {
            error: { accountNumber: canary, apiKey: canary },
            cause: new Error(canary),
          });
        },
      },
    });
    await failing.process(f.id, true);
    const view = await failing.view(f.id);
    expect(JSON.stringify(view)).not.toContain(canary);
    expect(view.online.lastError).toContain('Chưa đối chiếu được');
    const stored = (
      await db.pool.query(
        'SELECT last_error FROM payos_payment_request WHERE payment_intent_id=$1',
        [f.id],
      )
    ).rows[0];
    expect(stored.last_error).not.toContain(canary);
  });
  it('accepts the authenticated virtual account alias without confusing it with the payer account', async () => {
    const f = await fixture(false, true);
    const transfer = {
      ...bank('VA-REFERENCE-' + randomUUID(), 49000),
      virtualAccountNumber: 'FAKE-ORDER-VIRTUAL-ACCOUNT',
      counterAccountNumber: 'UNRELATED-PAYER-ACCOUNT',
    };
    bankLink(f, [transfer]);
    const result = await service.webhook(
      webhook(f, transfer, {
        virtualAccountNumber: transfer.virtualAccountNumber,
        counterAccountNumber: transfer.counterAccountNumber,
      }),
    );
    expect(result.status).toBe('PROCESSED');
    expect((await account(f.sid)).paid_total).toBe('49000');
    expect(
      (await db.pool.query('SELECT status FROM payment_intent WHERE id=$1', [f.id])).rows[0].status,
    ).toBe('SUCCEEDED');
  });
  it('a definitively failed unpaid provider link releases cash collection and the promotion lock', async () => {
    const f = await fixture(true);
    const failed = { ...bankLink(f, []), status: 'FAILED' as const };
    orders.set(f.code, failed);
    await service.applyLink(f.id, failed);
    const current = await service.view(f.id);
    expect(current.status).toBe('FAILED');
    expect(current.online.status).toBe('FAILED');
    expect(onlinePaymentState(current).title).toContain('không thành công');
    expect(onlinePaymentState(current).showQr).toBe(false);
    expect((await account(f.sid)).reserved_payment_amount).toBe('0');
    const removed = await app.inject({
      method: 'DELETE',
      url: '/core/sessions/' + f.sid + '/promotion',
      headers: { ...headers, cookie: cookies.pv001 },
      payload: { requestId: randomUUID() },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const replacement = await api('/core/sessions/' + f.sid + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '49000',
    });
    expect(replacement.method).toBe('CASH');
    expect(replacement.amount).toBe('49000');
    expect((await account(f.sid)).paid_total).toBe('0');
  });
  it('legacy error presentation with authenticated FAILED status does not hold an unpaid session forever', async () => {
    const f = await fixture();
    const failed = { ...bankLink(f, []), status: 'FAILED' as const };
    orders.set(f.code, failed);
    await service.applyLink(f.id, failed);
    await db.pool.query(
      "UPDATE payos_payment_request SET status='ERROR',next_poll_at=now() WHERE payment_intent_id=$1",
      [f.id],
    );
    expect((await account(f.sid)).reserved_payment_amount).toBe('0');
    const get = vi.spyOn(fake, 'get');
    try {
      await service.maintain();
      expect(get.mock.calls.some(([orderCode]) => orderCode === f.code)).toBe(false);
    } finally {
      get.mockRestore();
    }
    const replacement = await api('/core/sessions/' + f.sid + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '49000',
    });
    expect(replacement.method).toBe('CASH');
  });
  it('provider PROCESSING persists, hides the payable QR and remains reserved until background verification', async () => {
    const f = await fixture();
    const processing = { ...bankLink(f, []), status: 'PROCESSING' as const };
    orders.set(f.code, processing);
    await service.applyLink(f.id, processing);
    const current = await service.view(f.id);
    expect(current.status).toBe('PENDING');
    expect(current.online.status).toBe('PROCESSING');
    expect(onlinePaymentState(current)).toMatchObject({
      kind: 'pending',
      title: 'Ngân hàng đang xử lý thanh toán',
      showQr: false,
    });
    expect((await account(f.sid)).reserved_payment_amount).toBe('49000');
    const attempted = await http('/core/sessions/' + f.sid + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '49000',
    });
    expect(attempted.statusCode).toBe(409);
    const received = bank('PROCESSING-PAID-' + randomUUID(), 49000);
    bankLink(f, [received]);
    await db.pool.query(
      'UPDATE payos_payment_request SET next_poll_at=now() WHERE payment_intent_id=$1',
      [f.id],
    );
    await service.maintain();
    const done = await service.view(f.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.online.status).toBe('PAID');
    expect((await account(f.sid)).paid_total).toBe('49000');
  });
  it('provider FAILED with an actual partial transfer keeps a reconciliation case and money history', async () => {
    const f = await fixture();
    const first = bank('FAILED-PARTIAL-' + randomUUID(), 20000);
    const failed = { ...bankLink(f, [first]), status: 'FAILED' as const };
    orders.set(f.code, failed);
    await service.applyLink(f.id, failed);
    const current = await service.view(f.id);
    expect(current.status).toBe('REQUIRES_RECONCILIATION');
    expect(current.online.status).toBe('REQUIRES_RECONCILIATION');
    expect((await account(f.sid)).paid_total).toBe('20000');
    const attempted = await http('/core/sessions/' + f.sid + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '29000',
    });
    expect(attempted.statusCode).toBe(409);
    expect((await service.cases()).some((row) => row.id === f.id && row.status === 'OPEN')).toBe(
      true,
    );
  });
  it('a valid webhook with a different recipient than its authenticated bank reference records no payment', async () => {
    const f = await fixture();
    const transfer = bank('RECIPIENT-' + randomUUID(), 49000);
    bankLink(f, [transfer]);
    const result = await service.webhook(
      webhook(f, transfer, { accountNumber: 'UNRELATED-RECIPIENT' }),
    );
    expect(result.status).toBe('REQUIRES_RECONCILIATION');
    expect((await account(f.sid)).paid_total).toBe('0');
    expect(await db.prisma.payment_transaction.count({ where: { payment_intent_id: f.id } })).toBe(
      0,
    );
  });
  it('a signed zero-code registration probe is durable and never creates a financial transaction', async () => {
    const data = {
      orderCode: 0,
      amount: 0,
      description: 'REGISTER-PROBE',
      accountNumber: 'PROBE-ACCOUNT',
      reference: 'ZERO-PROBE-' + randomUUID(),
      transactionDateTime: '2026-10-14 07:00:00',
      currency: 'VND',
      paymentLinkId: 'zero-probe-link',
      code: '00',
      desc: 'Thành công',
    };
    const result = await service.webhook({
      code: '00',
      desc: 'success',
      success: true,
      data,
      signature: signature(data),
    });
    expect(result.status).toBe('UNMATCHED');
    const stored = (
      await db.pool.query(
        "SELECT signature_valid,processing_status,payment_transaction_id FROM payment_webhook_event WHERE provider='PAYOS' AND provider_event_id=$1",
        [data.reference],
      )
    ).rows[0];
    expect(stored).toMatchObject({
      signature_valid: true,
      processing_status: 'UNMATCHED',
      payment_transaction_id: null,
    });
  });
  it('a changed late bank reference cannot rewrite quarantined money or a frozen closed receipt', async () => {
    const f = await fixture();
    const first = bank('CLOSED-PAID-' + randomUUID(), 49000);
    bankLink(f, [first]);
    await service.webhook(webhook(f, first));
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
    const before = (
      await db.pool.query('SELECT receipt_snapshot FROM table_session WHERE id=$1', [f.sid])
    ).rows[0].receipt_snapshot;
    const extra = bank('CLOSED-LATE-' + randomUUID(), 2000);
    bankLink(f, [first, extra]);
    await service.webhook(webhook(f, extra));
    const changed = bankLink(f, [first, { ...extra, amount: 2001 }]);
    const result = await service.applyLink(f.id, changed);
    expect(result.status).toBe('REQUIRES_RECONCILIATION');
    const q = (
      await db.pool.query(
        'SELECT paid_amount,quarantined_transactions FROM payos_payment_request WHERE payment_intent_id=$1',
        [f.id],
      )
    ).rows[0];
    expect(q.paid_amount).toBe('51000');
    expect(q.quarantined_transactions).toEqual([
      expect.objectContaining({ reference: extra.reference, amount: '2000' }),
    ]);
    expect(
      (
        await db.pool.query(
          "SELECT sum(amount)::text AS collected FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED'",
          [f.sid],
        )
      ).rows[0].collected,
    ).toBe('49000');
    expect(
      (await db.pool.query('SELECT receipt_snapshot FROM table_session WHERE id=$1', [f.sid]))
        .rows[0].receipt_snapshot,
    ).toEqual(before);
  });
});

it.each([
  { code: '101', status: 200, missing: true },
  { code: '201', status: 200, missing: false },
  { code: '214', status: 200, missing: false },
  { code: '231', status: 200, missing: false },
  { code: undefined, status: 404, missing: false },
])(
  'provider error $code HTTP$status is missing=$missing, using official business error semantics',
  async ({ code, status, missing }) => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ...(code ? { code } : {}), desc: 'Synthetic provider error' }),
          { status, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = officialPayosProvider(config, fetcher as typeof fetch);
    let providerError: unknown;
    try {
      await provider.get(request.orderCode);
    } catch (error) {
      providerError = error;
    }
    expect(providerError).toBeDefined();
    expect(provider.isNotFound(providerError)).toBe(missing);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
