import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';

let host: Database, db: Database, app: ReturnType<typeof buildApp>;
const databaseName = 'thesis_pricing_audit_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const imageDirectory = mkdtempSync(join(tmpdir(), 'thesis-pricing-audit-'));
const oldImageDirectory = process.env.MENU_UPLOAD_DIR;
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const cookies: Record<string, string> = {};
async function request(
  url: string,
  payload?: Record<string, unknown>,
  user = 'quyettruong05',
  method: 'GET' | 'POST' | 'PATCH' = payload ? 'POST' : 'GET',
) {
  return app.inject({ url, method, headers: { ...headers, cookie: cookies[user] ?? '' }, payload });
}
async function ok(
  url: string,
  payload?: Record<string, unknown>,
  user?: string,
  method?: 'GET' | 'POST' | 'PATCH',
) {
  const response = await request(url, payload, user, method);
  expect(response.statusCode, url + ': ' + response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  for (const directory of readdirSync('packages/database/prisma/migrations')
    .filter((x) => /^\d/.test(x))
    .sort()) {
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + directory + '/migration.sql', 'utf8'),
    );
  }
  process.env.MENU_UPLOAD_DIR = imageDirectory;
  await seed(db, password, { includeWorkforce: false });
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'r'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const user of ['quyettruong05', 'pv001', 'bep001']) {
    const response = await request('/auth/login', { username: user, password }, '');
    expect(response.statusCode, response.body).toBe(200);
    cookies[user] = response.cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_pricing_audit_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
  if (oldImageDirectory === undefined) delete process.env.MENU_UPLOAD_DIR;
  else process.env.MENU_UPLOAD_DIR = oldImageDirectory;
  rmSync(imageDirectory, { recursive: true, force: true });
});
async function party() {
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const table = await ok('/core/tables', {
    code: 'R-' + randomUUID().slice(0, 8),
    name: 'Bàn đối soát',
    areaId: area.id,
    capacity: 4,
  });
  return ok('/core/tables/' + table.id + '/open', {}, 'pv001');
}
async function food(price: string) {
  const category = await db.prisma.menu_category.findFirstOrThrow();
  return ok('/core/products', {
    code: 'R-' + randomUUID().slice(0, 8),
    name: 'Món đối soát',
    categoryId: category.id,
    price,
    stockManaged: false,
  });
}
async function order(sid: string, productId: string) {
  const batch = await ok(
    '/core/sessions/' + sid + '/orders',
    { requestId: randomUUID(), lines: [{ productId, quantity: 1 }] },
    'pv001',
  );
  return db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
}
async function promotion(productIds: string[], percent = 10) {
  return ok('/core/admin/discount-programs', {
    name: 'Ưu đãi đối soát',
    description: '',
    mode: 'CODE',
    code: 'R' + randomUUID().replaceAll('-', '').slice(0, 8),
    type: 'PERCENT',
    percent,
    minEligibleAmount: '0',
    maxDiscountAmount: null,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    weekdays: [],
    startTime: null,
    endTime: null,
    scope: 'PRODUCTS',
    productIds,
    categoryIds: [],
    excludeCombos: true,
    usageLimit: 10,
    status: 'ACTIVE',
  });
}
const bill = (sid: string) => ok('/core/sessions/' + sid + '/bill', undefined, 'pv001');
async function collect(sid: string, amount: string) {
  const intent = await ok(
    '/core/sessions/' + sid + '/payments',
    { requestId: randomUUID(), method: 'CASH', amount },
    'pv001',
  );
  return ok(
    '/core/payments/' + intent.id + '/confirm',
    { amount, receivedAmount: '100000' },
    'pv001',
  );
}

it('reconciles two 100k cash tenders, discounted payments, kitchen cancellation and staff refunds through actual APIs', async () => {
  const s = await party(),
    a = await food('45000'),
    b = await food('49000');
  const first = await order(s.id, a.id),
    second = await order(s.id, b.id);
  const program = await promotion([a.id, b.id]);
  await ok(
    '/core/sessions/' + s.id + '/promotion',
    { programId: program.id, requestId: randomUUID() },
    'pv001',
  );
  const quotation = await bill(s.id);
  expect(quotation.billing).toMatchObject({
    subtotalAmount: '94000',
    discountAmount: '9400',
    payableAmount: '84600',
    beforeVatAmount: '78333',
    vatAmount: '6267',
  });
  const paidA = await collect(s.id, '40500'),
    paidB = await collect(s.id, '44100');
  for (const payment of [paidA, paidB])
    await ok('/core/payment-transactions/' + payment.id + '/change-returned', {}, 'pv001');
  expect(BigInt(paidA.metadata.cashReceived) + BigInt(paidB.metadata.cashReceived)).toBe(200000n);
  expect(BigInt(paidA.metadata.changeGiven) + BigInt(paidB.metadata.changeGiven)).toBe(115400n);
  for (const item of [first, second]) {
    await ok('/core/items/' + item.id + '/accept', {}, 'bep001');
    await ok(
      '/core/items/' + item.id + '/unavailable',
      { reasonCode: 'OUT_OF_STOCK', note: 'Không đủ nguyên liệu tại bếp' },
      'bep001',
    );
  }
  const cancelled = await bill(s.id);
  expect(cancelled.account).toMatchObject({
    charge_total: '0',
    paid_total: '84600',
    refunded_total: '0',
    refund_due_amount: '84600',
  });
  expect(cancelled.refunds).toHaveLength(0);
  expect(cancelled.billing.promotion.discountAmount).toBe('0');
  expect(
    (
      await request(
        '/core/sessions/' + s.id + '/refunds',
        {
          paymentId: paidA.id,
          amount: '40500',
          reason: 'Nhà hàng hủy món',
          requestId: randomUUID(),
        },
        'pv001',
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request('/core/sessions/' + s.id + '/refunds', {
        paymentId: paidA.id,
        amount: '45000',
        reason: 'Nhà hàng hủy món',
        requestId: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  for (const payment of [paidA, paidB]) {
    const refund = await ok('/core/sessions/' + s.id + '/refunds', {
      paymentId: payment.id,
      amount: payment.amount,
      reason: 'Nhà hàng hủy món đã thanh toán',
      requestId: randomUUID(),
    });
    expect(
      (
        await request('/core/refunds/' + refund.id + '/complete', {
          amount: payment.amount,
          method: 'CASH',
          requestId: randomUUID(),
        })
      ).statusCode,
    ).toBe(403);
    const confirmation = { amount: payment.amount, method: 'CASH', requestId: randomUUID() };
    await ok('/core/refunds/' + refund.id + '/complete', confirmation, 'pv001');
    const transaction = await db.prisma.refund_transaction.findFirstOrThrow({
      where: { refund_case_id: refund.id, request_key: confirmation.requestId },
    });
    expect((await ok('/core/refunds/' + refund.id + '/complete', confirmation, 'pv001')).id).toBe(
      transaction.id,
    );
    expect(await db.prisma.refund_transaction.count({ where: { refund_case_id: refund.id } })).toBe(
      1,
    );
  }
  const final = await bill(s.id);
  expect(final.account).toMatchObject({
    charge_total: '0',
    paid_total: '84600',
    refunded_total: '84600',
    outstanding_amount: '0',
    refund_due_amount: '0',
  });
  expect(final.refundTransactions).toHaveLength(2);
  expect(200000n - 115400n - BigInt(final.account.refunded_total)).toBe(0n);
});

it('captures tax on order submission and rejects later snapshot or oversized discount tampering', async () => {
  const s = await party(),
    product = await food('108000');
  const item = await order(s.id, product.id);
  await ok(
    '/core/products/' + product.id + '/tax',
    {
      treatment: 'TAXABLE',
      ratePercent: 5,
      version: product.version,
      reason: 'Phân loại áp dụng cho món gọi mới',
    },
    undefined,
    'PATCH',
  );
  await order(s.id, product.id);
  const result = await bill(s.id);
  expect(
    result.billing.vatGroups
      .map((x: { ratePercent: number }) => x.ratePercent)
      .sort((a: number, b: number) => a - b),
  ).toEqual([5, 8]);
  expect(
    result.billing.lines.find((x: { orderItemId: string }) => x.orderItemId === item.id).vatAmount,
  ).toBe('8000');
  await expect(
    db.pool.query(
      "UPDATE financial_charge SET tax_snapshot=jsonb_set(tax_snapshot,'{ratePercent}','5') WHERE order_item_id=$1",
      [item.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('UPDATE financial_charge SET discount_amount=60000 WHERE order_item_id=$1', [
      item.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  const snapshots = (
    await db.pool.query(
      'SELECT tax_snapshot FROM financial_charge WHERE session_id=$1 ORDER BY id',
      [s.id],
    )
  ).rows;
  expect(snapshots.every((x) => x.tax_snapshot.priceIncludesVat === true)).toBe(true);
});

it('keeps zero-VAT distinct from exemption and supersedes a future policy without deleting the old version', async () => {
  const effectiveAt = new Date(Date.now() + 86400000).toISOString();
  const first = await ok('/core/admin/tax-policies', {
    effectiveAt,
    defaultRatePercent: 10,
    reason: 'Lịch VAT tương lai cần đối chiếu',
  });
  const next = await ok('/core/admin/tax-policies', {
    effectiveAt,
    defaultRatePercent: 8,
    reason: 'Thay thế mốc hiệu lực bằng cấu hình mới',
  });
  expect(next.version).toBeGreaterThan(first.version);
  const settings = await ok('/core/admin/tax-policies');
  const sameTime = settings.policies.filter(
    (x: { effectiveAt: string }) => x.effectiveAt === effectiveAt,
  );
  expect(sameTime.map((x: { id: string }) => x.id)).toEqual([next.id, first.id]);
  expect(settings.current.defaultRatePercent).toBe(8);
  const s = await party();
  for (const treatment of ['TAXABLE', 'EXEMPT']) {
    const product = await food('5000');
    await ok(
      '/core/products/' + product.id + '/tax',
      {
        treatment,
        ratePercent: treatment === 'TAXABLE' ? 0 : null,
        version: product.version,
        reason: 'Phân loại theo hồ sơ thuế',
      },
      undefined,
      'PATCH',
    );
    await order(s.id, product.id);
  }
  expect(
    (await bill(s.id)).billing.vatGroups.map((x: { treatment: string }) => x.treatment).sort(),
  ).toEqual(['EXEMPT', 'TAXABLE']);
});

it('admin lookup and exception detail display the same discounted charge as the payment quote', async () => {
  const s = await party(),
    product = await food('49000');
  const item = await order(s.id, product.id);
  const program = await promotion([product.id]);
  await ok(
    '/core/sessions/' + s.id + '/promotion',
    { programId: program.id, requestId: randomUUID() },
    'pv001',
  );
  for (const action of ['accept', 'prepare', 'ready'])
    await ok('/core/items/' + item.id + '/' + action, {}, 'bep001');
  await ok('/core/items/' + item.id + '/serve', {}, 'pv001');
  const lookup = await ok('/core/history/order-active?period=all');
  const historyLine = lookup.rows.find((row: { id: string }) => row.id === item.id);
  expect(historyLine).toMatchObject({
    line_total: '49000',
    charged_amount: '44100',
    discount_amount: '4900',
    has_charge: true,
  });
  const exceptions = await ok('/core/order-exceptions');
  expect(exceptions.find((row: { id: string }) => row.id === item.id)).toMatchObject({
    charged_amount: '44100',
    discount_amount: '4900',
  });
  expect((await bill(s.id)).account.charge_total).toBe(historyLine.charged_amount);
});
