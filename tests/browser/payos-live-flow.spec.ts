import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createDatabase, type Database } from '../../packages/database/src/index.js';
import { seed, restaurantId } from '../../packages/database/src/seed.js';
import { buildApp } from '../../apps/api/src/app.js';
import { registerAuth } from '../../apps/api/src/auth.js';
import { registerModules } from '../../apps/api/src/modules/index.js';
import { restaurantPolicy } from '../../packages/contracts/src/restaurant-policy.js';
import { config, signature, FakeProvider } from '../helpers/payos-provider-fixture.js';

// Actual domain/auth/database handlers run behind a browser transport bridge.
// Only the external bank is fake. The test cannot mutate the running restaurant database.
type Entity = { id: string };
type Bill = {
  session: Entity & { session_status: string; receipt_number: string | null };
  account: {
    charge_total: string;
    paid_total: string;
    outstanding_amount: string;
    reserved_payment_amount: string;
  };
  intents: (Entity & {
    status: string;
    method: string;
    online?: { orderCode: string; status: string; paidAmount: string };
  })[];
  payments: (Entity & { method: string; amount: string; confirmed_by: string | null })[];
  paymentRequests: (Entity & { status: string; acknowledged_by: string | null })[];
  completion: { receiptKey: string };
  closure: { canClose: boolean; blockers: { title: string }[] };
};
test('guest calls staff, claimed cash and two payOS receipts settle and freeze the actual bill automatically', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const name = 'thesis_payos_ui_' + randomBytes(8).toString('hex');
  const dbUrl = new URL(process.env.DATABASE_URL!);
  const originalDatabase = dbUrl.pathname;
  expect(name).toMatch(/^thesis_payos_ui_[a-f0-9]{16}$/);
  expect(originalDatabase).not.toBe('/' + name);
  const host = createDatabase(dbUrl.toString());
  let db: Database | undefined, app: ReturnType<typeof buildApp> | undefined;
  const media = mkdtempSync(join(tmpdir(), 'thesis-payos-ui-'));
  const originalMedia = process.env.MENU_UPLOAD_DIR;
  const contexts: BrowserContext[] = [];
  const provider = new FakeProvider();
  const cookieJars: Record<string, Map<string, string>> = {};
  const origin = new URL(baseURL!).origin;
  const errors: string[] = [];
  const browserMutations: string[] = [];
  const cookie = (role: string) =>
    [...(cookieJars[role] ?? new Map()).entries()]
      .map(([key, value]) => key + '=' + value)
      .join('; ');
  async function request<T>(
    role: string,
    url: string,
    body?: object,
    method: 'GET' | 'POST' | 'PATCH' = body ? 'POST' : 'GET',
  ): Promise<T> {
    const response = await app!.inject({
      url,
      method,
      headers: { origin, 'x-csrf-protection': '1', cookie: cookie(role) },
      payload: body,
    });
    cookieJars[role] ??= new Map();
    for (const c of response.cookies) cookieJars[role]!.set(c.name, c.value);
    expect(response.statusCode, url + ': ' + response.body).toBe(200);
    return response.json() as T;
  }
  async function bridge(page: Page, role: string) {
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const r = route.request(),
        url = new URL(r.url());
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(r.method()))
        throw Error('Unexpected browser API method');
      const path = url.pathname.slice(4) + url.search;
      if (r.method() !== 'GET') browserMutations.push(path);
      const response = await app!.inject({
        url: path,
        method: r.method() as 'GET' | 'POST' | 'PATCH' | 'DELETE',
        headers: {
          origin,
          'x-csrf-protection': '1',
          cookie: cookie(role),
          ...(r.postData() ? { 'content-type': 'application/json' } : {}),
        },
        ...(r.postData() ? { payload: r.postData()! } : {}),
      });
      for (const c of response.cookies) cookieJars[role]!.set(c.name, c.value);
      await route.fulfill({
        status: response.statusCode,
        headers: { 'content-type': String(response.headers['content-type'] ?? 'application/json') },
        body: response.rawPayload,
      });
    });
    await page.route('https://pay.payos.vn/**', (route) => route.abort('blockedbyclient'));
  }
  try {
    await host.pool.query('CREATE DATABASE ' + name);
    dbUrl.pathname = '/' + name;
    db = createDatabase(dbUrl.toString());
    expect(new URL(dbUrl).pathname.startsWith('/thesis_payos_ui_')).toBe(true);
    for (const migration of readdirSync('packages/database/prisma/migrations')
      .filter((n) => /^\d/.test(n))
      .sort())
      await db.pool.query(
        readFileSync('packages/database/prisma/migrations/' + migration + '/migration.sql', 'utf8'),
      );
    process.env.MENU_UPLOAD_DIR = media;
    const password = randomBytes(24).toString('hex');
    await seed(db, password, { includeWorkforce: false });
    app = buildApp(db);
    await registerAuth(app, db, {
      secret: randomBytes(96).toString('hex'),
      restaurantId,
      origins: [origin],
      secure: false,
      loginLimit: 100,
    });
    registerModules(app, db, restaurantId, false, { config, provider });
    for (const [role, username] of [
      ['admin', 'quyettruong05'],
      ['staff', 'pv001'],
      ['kitchen', 'bep001'],
    ])
      await request(role!, '/auth/login', { username, password });
    cookieJars.guest = new Map();
    const area = await db.prisma.dining_area.findFirstOrThrow(),
      category = await db.prisma.menu_category.findFirstOrThrow();
    const code = 'UI-PO-' + randomUUID().slice(0, 7).toUpperCase();
    const table = await request<Entity>('admin', '/core/tables', {
      code,
      name: code,
      areaId: area.id,
      capacity: 4,
    });
    const access = await request<{ sessionId: string; accessCode: string }>(
      'staff',
      '/core/tables/' + table.id + '/access-code',
      {},
    );
    const qr = await request<{ joinPath: string }>('admin', '/core/tables/' + table.id + '/qr', {});
    await request('guest', '/guest/join', {
      token: qr.joinPath.split('#')[1],
      name: 'Khách thanh toán từng phần',
      accessCode: access.accessCode,
      acceptedPolicyVersion: restaurantPolicy.version,
    });
    const product = await request<Entity>('admin', '/core/products', {
      code: 'FOOD-' + code,
      name: 'Mâm cơm Việt ' + code,
      categoryId: category.id,
      price: '450000',
      stockManaged: false,
    });
    const initial = await request<{ cart: { cart_version: number } }>('guest', '/guest/state');
    await request('guest', '/guest/cart', {
      productId: product.id,
      quantity: 1,
      cartVersion: initial.cart.cart_version,
    });
    const cart = await request<{
      session: Entity;
      cart: { cart_version: number };
      items: Entity[];
    }>('guest', '/guest/state');
    const sid = cart.session.id;
    const batch = await request<Entity & { status: string }>('guest', '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: cart.cart.cart_version,
      itemIds: cart.items.map((item) => item.id),
    });
    if (batch.status === 'PENDING_REVIEW')
      await request('staff', '/core/orders/' + batch.id + '/review', { approve: true });
    const item = await db.prisma.order_item.findFirstOrThrow({
      where: { order_batch_id: batch.id },
    });
    for (const action of ['accept', 'prepare', 'ready'])
      await request('kitchen', '/core/items/' + item.id + '/' + action, {});
    await request('staff', '/core/items/' + item.id + '/serve', {});
    const guestContext = await browser.newContext({ baseURL, ...info.project.use }),
      staffContext = await browser.newContext({ baseURL, ...info.project.use });
    contexts.push(guestContext, staffContext);
    const guest = await guestContext.newPage(),
      staff = await staffContext.newPage();
    guest.setDefaultTimeout(15000);
    staff.setDefaultTimeout(15000);
    await staff.clock.install();
    await bridge(guest, 'guest');
    await bridge(staff, 'staff');
    await guest.goto('/guest');
    await guest
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    const assistance = guest.getByRole('form', { name: 'Yêu cầu thanh toán' });
    await expect(assistance.getByRole('button', { name: 'Online (payOS)' })).toHaveCount(0);
    await assistance.getByRole('button', { name: 'Tiền mặt', exact: true }).click();
    await assistance.getByRole('button', { name: 'Báo nhân viên thu tiền', exact: true }).click();
    await staff.goto('/workspace/staff');
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await staff
      .locator('.table-tile')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
      .click();
    let dialog = staff.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    const [claimResponse] = await Promise.all([
      staff.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith('/claim') &&
          response.request().method() === 'POST',
      ),
      dialog.getByRole('button', { name: 'Nhận việc & đến bàn', exact: true }).click(),
    ]);
    expect(claimResponse.status()).toBe(200);
    let bill = await request<Bill>('staff', '/core/sessions/' + sid + '/bill');
    expect(bill.paymentRequests.some((r) => r.status === 'ACKNOWLEDGED')).toBe(true);
    let form = dialog.getByRole('form', { name: 'Thu tiền tại bàn', exact: true });
    await form.getByRole('button', { name: 'Tiền mặt', exact: true }).click();
    await form.getByRole('button', { name: /Số tiền khác/ }).click();
    await form.getByLabel('Số tiền thu lần này (đồng)', { exact: true }).fill('200000');
    await form.getByLabel('Tiền mặt khách đưa (đồng)', { exact: true }).fill('200000');
    await form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(dialog.locator('.last-payment')).toContainText('200.000 đ');
    async function createOnline(amount: string) {
      form = dialog.getByRole('form', { name: 'Thu tiền tại bàn', exact: true });
      await form.getByRole('button', { name: 'Online (payOS)', exact: true }).click();
      await form.getByRole('button', { name: /Số tiền khác/ }).click();
      await form.getByLabel('Số tiền thu lần này (đồng)', { exact: true }).fill(amount);
      await form.getByRole('button', { name: 'Tạo QR thanh toán', exact: true }).click();
      const card = dialog.getByRole('region', { name: 'Khoản thu online' }).first();
      await expect(card.getByRole('img')).toBeVisible();
      await expect(card.getByRole('button', { name: /nhận tiền/ })).toHaveCount(0);
      const current = await request<Bill>('staff', '/core/sessions/' + sid + '/bill');
      return current.intents.find((i) => i.method === 'ONLINE' && i.status === 'PENDING')!;
    }
    async function bankPaid(intent: Bill['intents'][number], amount: number) {
      const orderCode = Number(intent.online!.orderCode),
        transaction = provider.add(orderCode, amount);
      const data = {
        orderCode,
        amount,
        description: transaction.description,
        accountNumber: transaction.accountNumber,
        reference: transaction.reference,
        transactionDateTime: transaction.transactionDateTime,
        currency: 'VND',
        paymentLinkId: provider.links.get(orderCode)!.id,
        code: '00',
        desc: 'Thành công',
      };
      const webhook = { code: '00', success: true, data, signature: signature(data) };
      const response = await app!.inject({
        url: '/payments/webhooks/payos',
        method: 'POST',
        payload: webhook,
      });
      expect(response.statusCode, response.body).toBe(200);
      const replay = await app!.inject({
        url: '/payments/webhooks/payos',
        method: 'POST',
        payload: webhook,
      });
      expect(replay.statusCode, replay.body).toBe(200);
    }
    const first = await createOnline('150000');
    // Drain all polling requests before replacing WebKit's document transport.
    // Use the browser's clock and a future instant; the host timestamp can already be in its past.
    const pauseTime = await staff.evaluate(() => Date.now() + 10_000);
    await staff.clock.pauseAt(pauseTime);
    await staff.waitForLoadState('networkidle');
    await staff.reload();
    await staff.clock.resume();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await staff
      .locator('.table-tile')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
      .click();
    dialog = staff.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    await expect(
      dialog.getByRole('region', { name: 'Khoản thu online' }).getByRole('img'),
    ).toBeVisible();
    expect(provider.creates).toBe(1);
    await bankPaid(first, 150000);
    await expect(dialog.getByRole('region', { name: 'Khoản thu online' }).first()).toContainText(
      'Đã nhận thanh toán online',
    );
    await expect(dialog.locator('.last-payment')).toContainText('150.000 đ');
    const second = await createOnline('100000');
    await bankPaid(second, 100000);
    await expect(dialog.locator('.last-payment')).toContainText('100.000 đ');
    bill = await request<Bill>('staff', '/core/sessions/' + sid + '/bill');
    expect(bill.account).toMatchObject({
      charge_total: '450000',
      paid_total: '450000',
      outstanding_amount: '0',
      reserved_payment_amount: '0',
    });
    expect(bill.payments.map((p) => [p.method, p.amount]).sort()).toEqual([
      ['CASH', '200000'],
      ['ONLINE', '100000'],
      ['ONLINE', '150000'],
    ]);
    expect(
      bill.payments.filter((p) => p.method === 'ONLINE').every((p) => p.confirmed_by === null),
    ).toBe(true);
    await expect(
      guest
        .locator('.core-stats p')
        .filter({ hasText: 'Đã thanh toán (sau hoàn)' })
        .locator('strong'),
    ).toHaveText('450.000 đ');
    await expect(
      guest.locator('.core-stats p').filter({ hasText: 'Còn phải thanh toán' }).locator('strong'),
    ).toHaveText('0 đ');
    await dialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
    const receipt = dialog.getByRole('region', { name: 'Phiếu thanh toán', exact: true });
    await expect(receipt).toContainText('Online (payOS)');
    await expect(receipt).toContainText('Hệ thống xác nhận');
    await expect(receipt).toContainText('450.000 đ');
    await staff.emulateMedia({ media: 'print' });
    const printBounds = await receipt.boundingBox();
    expect(printBounds!.width).toBeLessThanOrEqual((80 / 25.4) * 96 + 1);
    await receipt.screenshot({
      path: info.outputPath('payos-live-receipt.png'),
      animations: 'disabled',
    });
    await staff.emulateMedia({ media: 'screen' });
    await dialog.getByRole('button', { name: 'Đã in và giao phiếu', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Xác nhận thao tác', exact: true })
      .getByRole('button', { name: 'Tiếp tục', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Xác nhận thao tác', exact: true })
      .getByRole('button', { name: 'Tiếp tục', exact: true })
      .click();
    const closed = await request<Bill>('staff', '/core/sessions/' + sid + '/bill');
    expect(closed.session.session_status).toBe('CLOSED');
    expect(closed.session.receipt_number).toBeTruthy();
    expect(closed.account.paid_total).toBe('450000');
    expect(provider.creates).toBe(2);
    expect(browserMutations.filter((p) => p.endsWith('/confirm'))).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (app) await app.close();
    if (db) await db.close();
    expect(name).toMatch(/^thesis_payos_ui_[a-f0-9]{16}$/);
    await host.pool.query('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)');
    await host.close();
    if (originalMedia === undefined) delete process.env.MENU_UPLOAD_DIR;
    else process.env.MENU_UPLOAD_DIR = originalMedia;
    expect(media.startsWith(join(tmpdir(), 'thesis-payos-ui-'))).toBe(true);
    rmSync(media, { recursive: true, force: true });
  }
});
