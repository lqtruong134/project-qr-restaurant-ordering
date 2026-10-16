import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import type { BillingSummary } from '../../packages/contracts/src/billing';
import { browserTableCode } from './table-code-fixture';

type Entity = { id: string };
type Bill = {
  session: Entity & { session_status: string; receipt_number: string | null };
  account: {
    charge_total: string;
    paid_total: string;
    refunded_total: string;
    outstanding_amount: string;
    refund_due_amount: string;
  };
  billing: BillingSummary;
  payments: (Entity & {
    amount: string;
    metadata: { cashReceived: string; changeGiven: string };
  })[];
  refunds: (Entity & { approved_at: string; approval_required: boolean })[];
  completion: { receiptKey: string };
  closure: { canClose: boolean; blockers: { title: string }[] };
};

async function login(page: Page, username: string, role: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function get<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get('/api' + path);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post('/api' + path, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

test('real promotion, inclusive VAT, cash change and staff refund agree across all four roles and frozen receipt', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  // This test creates business records. It must only run in the disposable browser database.
  expect(Boolean(baseURL && new URL(baseURL).port === '13100')).toBe(true);
  expect(
    Boolean(
      process.env.DATABASE_URL &&
      new URL(process.env.DATABASE_URL).pathname.startsWith('/thesis_browser_'),
    ),
  ).toBe(true);
  expect(process.env.API_PORT).toBe('14100');
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, kitchen, guest] = (await Promise.all(
    contexts.map((context) => context.newPage()),
  )) as [Page, Page, Page, Page];
  const errors: string[] = [];
  for (const page of [admin, staff, kitchen, guest]) {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  }
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv007', 'staff');
    await login(kitchen, 'bep003', 'kitchen');
    const code = 'VAT-' + randomUUID().slice(0, 8).toUpperCase();
    const areas = await get<Entity[]>(admin, '/core/areas');
    const catalog = await get<{ categories: Entity[] }>(admin, '/core/catalog');
    const product = await post<Entity>(admin, '/core/products', {
      code,
      name: 'Món Việt ưu đãi ' + code,
      categoryId: catalog.categories[0]!.id,
      price: '49000',
      stockManaged: false,
      complimentary: false,
    });
    await post(admin, '/core/admin/discount-programs', {
      name: 'Ưu đãi bữa Việt ' + code,
      description: 'Giảm 10% cho món đã chọn; giá đã bao gồm VAT.',
      mode: 'CODE',
      code,
      type: 'PERCENT',
      percent: 10,
      fixedAmount: null,
      minEligibleAmount: '0',
      maxDiscountAmount: '50000',
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      weekdays: [],
      startTime: null,
      endTime: null,
      scope: 'PRODUCTS',
      productIds: [product.id],
      categoryIds: [],
      excludeCombos: true,
      usageLimit: 10,
      status: 'ACTIVE',
    });
    const table = await post<Entity>(admin, '/core/tables', {
      areaId: areas[0]!.id,
      code,
      name: code,
      capacity: 4,
    });
    const qr = await post<{ joinPath: string }>(admin, '/core/tables/' + table.id + '/qr', {});
    await guest.goto(qr.joinPath);
    await guest
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin, qr.joinPath, staff));
    await guest.getByLabel('Tên của bạn').fill('Khách dùng ưu đãi');
    await guest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      guest.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
    await expect(guest.locator('.menu-vat-note')).toHaveText('Giá thực đơn đã gồm VAT.');
    type GuestState = {
      session: Entity;
      cart: { cart_version: number };
      items: Entity[];
      billing: BillingSummary;
    };
    let state = await get<GuestState>(guest, '/guest/state');
    await post(guest, '/guest/cart', {
      productId: product.id,
      quantity: 1,
      cartVersion: state.cart.cart_version,
    });
    state = await get<GuestState>(guest, '/guest/state');
    const sid = state.session.id;
    const batch = await post<Entity>(guest, '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: state.cart.cart_version,
      itemIds: state.items.map((item) => item.id),
    });
    const order = (
      await get<(Entity & { status: string; items: Entity[] })[]>(staff, '/core/orders')
    ).find((row) => row.id === batch.id)!;
    if (order.status === 'PENDING_REVIEW')
      await post(staff, '/core/orders/' + order.id + '/review', { approve: true });
    const item = order.items[0]!;
    await guest
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    const guestPricing = guest.getByRole('region', {
      name: 'Tiền món, khuyến mãi và VAT',
      exact: true,
    });
    await expect(guestPricing.locator('.billing-payable dd')).toHaveText('49.000 đ');
    const promotion = guest.getByRole('region', { name: 'Khuyến mãi của bàn', exact: true });
    await promotion.getByLabel('Mã khuyến mãi', { exact: true }).fill(code);
    await promotion.getByRole('button', { name: 'Áp dụng mã', exact: true }).click();
    await expect(guestPricing.locator('.billing-payable dd')).toHaveText('44.100 đ');
    await expect(guestPricing.locator('.billing-discount dd')).toHaveText('−4.900 đ');
    await guestPricing.locator('.billing-tax-details > summary').click();
    await expect(guestPricing.locator('.billing-tax-facts')).toContainText('VAT 8%');
    await expect(guestPricing.locator('.billing-tax-facts')).toContainText('3.267 đ');
    const quote = await get<Bill>(staff, '/core/sessions/' + sid + '/bill');
    expect(quote.billing).toMatchObject({
      subtotalAmount: '49000',
      discountAmount: '4900',
      payableAmount: '44100',
      beforeVatAmount: '40833',
      vatAmount: '3267',
    });
    expect(quote.account.charge_total).toBe('44100');
    await guest.screenshot({
      path: info.outputPath('pricing-live-guest-before-payment.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await staff.goto('/workspace/staff');
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await staff
      .locator('.table-tile')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
      .click();
    const dialog = staff.getByRole('dialog', { name: 'Chi tiết - ' + code, exact: true });
    await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    await expect(dialog.locator('.billing-payable dd').first()).toHaveText('44.100 đ');
    const collection = dialog.getByRole('form', { name: 'Thu tiền tại bàn', exact: true });
    await collection.getByLabel('Tiền mặt khách đưa (đồng)', { exact: true }).fill('100000');
    await expect(collection.locator('.cash-preview')).toContainText('55.900 đ');
    await collection.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(dialog.locator('.last-payment')).toContainText('44.100 đ');
    await expect(dialog.locator('.last-payment')).toContainText('55.900 đ');
    const paid = await get<Bill>(staff, '/core/sessions/' + sid + '/bill');
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]!.metadata).toMatchObject({
      cashReceived: '100000',
      changeGiven: '55900',
    });
    await dialog.getByRole('button', { name: 'Xác nhận đã trả tiền thừa', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Xác nhận thao tác', exact: true })
      .getByRole('button', { name: 'Đã trả đủ tiền thừa', exact: true })
      .click();
    await expect(
      dialog.getByRole('region', { name: 'Trả tiền thừa cho khách', exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
    const receipt = dialog.getByRole('region', { name: 'Phiếu thanh toán', exact: true });
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('Khuyến mãi');
    await expect(receipt).toContainText('3.267 đ');
    await expect(receipt.locator('.billing-payable dd')).toHaveText('44.100 đ');
    await receipt.screenshot({
      path: info.outputPath('pricing-live-receipt-paid.png'),
      animations: 'disabled',
    });

    await post(kitchen, '/core/items/' + item.id + '/accept', {});
    await post(kitchen, '/core/items/' + item.id + '/unavailable', { reasonCode: 'OUT_OF_STOCK' });
    const cancelled = await get<Bill>(staff, '/core/sessions/' + sid + '/bill');
    expect(cancelled.account).toMatchObject({
      charge_total: '0',
      paid_total: '44100',
      refunded_total: '0',
      refund_due_amount: '44100',
    });
    expect(cancelled.refunds).toHaveLength(0);
    const unapproved = await staff.request.post('/api/core/sessions/' + sid + '/refunds', {
      headers: { origin: new URL(staff.url()).origin, 'x-csrf-protection': '1' },
      data: {
        requestId: randomUUID(),
        paymentId: paid.payments[0]!.id,
        amount: '44100',
        useDecisionReason: true,
      },
    });
    expect(unapproved.status()).toBe(403);
    const approved = await post<Entity>(admin, '/core/sessions/' + sid + '/refunds', {
      requestId: randomUUID(),
      paymentId: paid.payments[0]!.id,
      amount: '44100',
      useDecisionReason: true,
    });
    await expect(
      dialog.getByRole('heading', { name: 'Còn phải hoàn 44.100 đ', exact: true }),
    ).toBeVisible();
    const refund = dialog
      .getByRole('region', { name: 'Hoàn tiền cho khách', exact: true })
      .locator('form')
      .filter({ has: staff.getByRole('heading', { name: 'Còn phải hoàn 44.100 đ', exact: true }) });
    await expect(refund).toContainText('Quản trị đã duyệt');
    await refund.getByRole('button', { name: 'Đã hoàn tiền cho khách', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(refund).toHaveCount(0);
    const returned = await get<Bill>(staff, '/core/sessions/' + sid + '/bill');
    expect(returned.refunds[0]!.id).toBe(approved.id);
    expect(returned.account).toMatchObject({
      charge_total: '0',
      paid_total: '44100',
      refunded_total: '44100',
      refund_due_amount: '0',
      outstanding_amount: '0',
    });
    await expect(
      guest.getByRole('region', { name: 'Thông tin hoàn tiền', exact: true }),
    ).toContainText('44.100 đ');
    await expect(guestPricing.locator('.billing-payable dd')).toHaveText('0 đ');
    await expect(receipt.locator('.billing-payable dd')).toHaveText('0 đ');
    await expect(receipt.locator('.receipt-money-breakdown')).toContainText('Tiền thối đã trả');
    await expect(receipt.locator('.receipt-money-breakdown')).toContainText('55.900 đ');
    await expect(receipt.locator('.receipt-money-breakdown')).toContainText('Đã hoàn tiền món');
    await expect(receipt.locator('.receipt-money-breakdown')).toContainText('44.100 đ');
    await expect(
      receipt
        .locator('.receipt-money-breakdown')
        .getByText('Nhà hàng còn giữ', { exact: true })
        .locator('..')
        .locator('dd'),
    ).toHaveText('0 đ');

    const alerts = (
      await get<
        (Entity & { session_id: string; guest_notice: boolean; stock_inspection: boolean })[]
      >(admin, '/core/alerts')
    ).filter((row) => row.session_id === sid);
    for (const alert of alerts) {
      if (alert.guest_notice) await post(staff, '/core/alerts/' + alert.id + '/guest-notified', {});
      if (alert.stock_inspection)
        await post(admin, '/core/alerts/' + alert.id + '/stock-checked', {
          reason: 'Đã kiểm tra nguyên liệu và khả năng phục vụ.',
        });
    }
    const ready = await get<Bill>(staff, '/core/sessions/' + sid + '/bill');
    await post(staff, '/core/sessions/' + sid + '/receipt-provided', {
      delivery: 'PRINTED',
      layout: 'standard',
      billKey: ready.completion.receiptKey,
    });
    const close = await get<Bill>(staff, '/core/sessions/' + sid + '/bill');
    expect(close.closure.blockers).toEqual([]);
    await post(staff, '/core/sessions/' + sid + '/close', {});
    const frozen = await get<Bill>(staff, '/core/sessions/' + sid + '/bill');
    expect(frozen.session.session_status).toBe('CLOSED');
    expect(frozen.session.receipt_number).toMatch(/^PT-/);
    expect(frozen.billing).toMatchObject({
      payableAmount: '0',
      discountAmount: '0',
      vatAmount: '0',
    });
    const closedReceipt = staff.getByRole('region', { name: 'Phiếu thanh toán', exact: true });
    await expect(closedReceipt).toContainText('PHIẾU THANH TOÁN', { timeout: 15000 });
    await expect(closedReceipt.locator('.billing-payable dd')).toHaveText('0 đ');
    await expect(closedReceipt).not.toContainText('chưa có thông tin VAT');
    await staff.emulateMedia({ media: 'print' });
    await expect(closedReceipt).toBeVisible();
    expect(await closedReceipt.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
      true,
    );
    await staff.screenshot({
      path: info.outputPath('pricing-live-receipt-refunded-closed.png'),
      fullPage: true,
      animations: 'disabled',
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
