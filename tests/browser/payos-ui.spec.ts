import { test, expect, type Page, type Locator } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
import type {
  PaymentCapabilities,
  OnlinePaymentView,
} from '../../packages/contracts/src/payments-online';
type PaymentIntent = {
  id: string;
  method: string;
  amount: string;
  status: string;
  expires_at?: string;
  support_request_id?: string;
  online?: OnlinePaymentView | null;
};
import type { PaymentReconciliationCase } from '../../packages/contracts/src/payments-online';

const sid = 'f63b91bc-0000-4000-8000-000000000001';
const at = '2026-10-14T05:00:00Z';
test.setTimeout(60000);
test.use({ actionTimeout: 10000 });
function fixture() {
  const account = {
    id: 'account',
    charge_total: '450000',
    paid_total: '0',
    refunded_total: '0',
    outstanding_amount: '450000',
    refund_due_amount: '0',
    reserved_payment_amount: '0',
  };
  const table = {
    id: 'table',
    code: 'A10',
    name: 'Bàn A10',
    table_status: 'OCCUPIED',
    session_id: sid,
    session_status: 'ACTIVE',
    area_name: 'Trong nhà',
    area_id: 'area',
    capacity: 4,
    opened_at: at,
    verification_status: 'VERIFIED',
    charge_total: '450000',
    outstanding_amount: '450000',
  };
  const bill = {
    session: { id: sid, session_status: 'ACTIVE', table_code: 'A10', opened_at: at },
    billing: {
      version: 1,
      priceIncludesVat: true,
      subtotalAmount: '450000',
      discountAmount: '0',
      payableAmount: '450000',
      beforeVatAmount: '416667',
      vatAmount: '33333',
      vatGroups: [
        {
          treatment: 'TAXABLE',
          ratePercent: 8,
          beforeVatAmount: '416667',
          vatAmount: '33333',
          totalAmount: '450000',
        },
      ],
      promotion: null,
      lines: [],
      legacyTaxUnavailable: false,
    },
    account,
    charges: [
      {
        id: 'charge',
        order_item_id: 'item',
        owner_participant_id: 'guest',
        owner_name: 'Lan',
        amount: '450000',
        net_amount: '450000',
        unit_price_snapshot: '450000',
        product_name_snapshot: 'Mâm cơm gia đình Việt Nam dùng chung tại bàn',
        quantity: 1,
        status: 'ACTIVE',
        item_status: 'SERVED',
        unpaid_amount: '450000',
      },
    ],
    intents: [] as PaymentIntent[],
    payments: [] as { id: string; [key: string]: unknown }[],
    refunds: [],
    refundTransactions: [],
    paymentRequests: [] as { id: string; [key: string]: unknown }[],
    participants: [{ id: 'guest', display_name: 'Lan' }],
    store: {
      name: 'Quyết Trường Bistro',
      address: 'Nhà hàng món Việt',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    generatedAt: at,
    closedBy: null,
    paymentCapabilities: { online: true } as PaymentCapabilities,
    closure: { canClose: false, blockers: [] },
  };
  return { bill, table };
}
async function mock(page: Page) {
  await page.clock.install();
  const data = fixture();
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  let reject = false;
  const cases: PaymentReconciliationCase[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const makeIntent = (amount = '150000'): PaymentIntent => ({
    id: 'online-intent',
    method: 'ONLINE',
    amount,
    status: 'PENDING',
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    online: {
      provider: 'PAYOS',
      status: 'PENDING',
      orderCode: '202610140001',
      checkoutUrl: 'https://pay.payos.vn/web/fixture-payment',
      qrCode: '00020101021226060000TEST',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      lastError: null,
      paidAmount: '0',
      remainingAmount: amount,
    },
  });
  await page.route('**/api/workspaces/**', (route) => {
    const role = route.request().url().endsWith('admin') ? 'ADMIN' : 'STAFF';
    return route.fulfill({
      json: {
        user: {
          id: role === 'ADMIN' ? 'admin' : 'staff',
          displayName: 'Nhân viên nhà hàng',
          role,
          permissions: [],
        },
      },
    });
  });
  await page.route('**/api/core/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'GET') {
      if (path === '/api/core/admin/overview')
        return route.fulfill({
          status: 503,
          json: { userMessage: 'Tổng quan không được dùng trong fixture đối soát.' },
        });
      if (path === '/api/core/sessions/' + sid + '/bill') return route.fulfill({ json: data.bill });
      if (path.endsWith('/promotion'))
        return route.fulfill({ json: { billing: data.bill.billing, programs: [], locked: true } });
      if (path === '/api/core/tables' || path === '/api/core/admin/tables')
        return route.fulfill({ json: [data.table] });
      if (path === '/api/core/catalog')
        return route.fulfill({ json: { products: [], categories: [] } });
      if (path === '/api/core/admin/payment-reconciliation') return route.fulfill({ json: cases });
      if (path === '/api/core/inventory')
        return route.fulfill({
          json: {
            units: [],
            ingredients: [],
            locations: [],
            balances: [],
            movements: [],
            receipts: [],
            recipes: [],
            recipeItems: [],
          },
        });
      if (path === '/api/core/reports')
        return route.fulfill({ json: { store: {}, sales: [], payments: [], reconciliation: [] } });
      if (path === '/api/core/risk') return route.fulfill({ json: { defaults: {}, policies: [] } });
      return route.fulfill({ json: [] });
    }
    const body = route.request().postDataJSON();
    writes.push({ path, body });
    if (path === '/api/core/sessions/' + sid + '/payments') {
      if (reject)
        return route.fulfill({
          status: 503,
          json: {
            errorCode: 'PAYOS_UNAVAILABLE',
            userMessage:
              'Chưa kết nối được cổng thanh toán. Kiểm tra lại khoản thu trước khi thử lại.',
          },
        });
      expect(body.method).toBe('ONLINE');
      const intent = makeIntent(String(body.amount));
      data.bill.intents.unshift(intent);
      data.bill.account.reserved_payment_amount = intent.amount;
      return route.fulfill({ json: intent });
    }
    if (path.endsWith('/refresh')) return route.fulfill({ json: data.bill.intents[0] });
    if (path.endsWith('/cancel')) {
      data.bill.intents[0]!.status = 'CANCELLED';
      data.bill.intents[0]!.online!.status = 'CANCELLED';
      data.bill.account.reserved_payment_amount = '0';
      return route.fulfill({ json: data.bill.intents[0] });
    }
    if (path.includes('/payment-reconciliation/') && path.endsWith('/resolve')) {
      const record = cases.find((row) => path.includes(row.id))!;
      record.status = 'RESOLVED';
      return route.fulfill({ json: record });
    }
    throw Error('Unexpected business mutation: ' + path);
  });
  await page.route('**/api/guest/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/state'))
      return route.fulfill({
        json: {
          participant: { id: 'guest', displayName: 'Lan' },
          paymentRequests: [] as { id: string; [key: string]: unknown }[],
          participants: data.bill.participants,
          session: {
            ...data.bill.session,
            table_name: 'Bàn A10',
            table_id: 'table',
            area_name: 'Trong nhà',
            version: 1,
            access_code: '1234',
          },
          products: [],
          promotions: [],
          discountPrograms: [],
          cart: { cart_version: 1 },
          items: [],
          orders: [
            {
              id: 'batch',
              item_id: 'item',
              status: 'ACCEPTED',
              item_status: 'SERVED',
              charge_status: 'ACTIVE',
              created_at: at,
              product_name_snapshot: 'Mâm cơm gia đình',
              quantity: 1,
            },
          ],
          account: data.bill.account,
          support: [],
          payments: data.bill.payments,
          refundTransactions: [],
        },
      });
    if (path.endsWith('/promotion'))
      return route.fulfill({ json: { billing: data.bill.billing, programs: [], locked: true } });
    if (path.endsWith('/payment-requests')) {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      expect(['CASH', 'BANK_TRANSFER']).toContain(body.method);
      return route.fulfill({ json: { id: 'request', status: 'NEW', payment_method: body.method } });
    }
    if (route.request().method() !== 'GET') throw Error('Guest cannot create online payments');
    return route.fulfill({ json: null });
  });
  return {
    ...data,
    writes,
    errors,
    cases,
    makeIntent,
    reject: () => {
      reject = true;
    },
    cash: () => {
      data.bill.payments.push({
        id: 'cash',
        method: 'CASH',
        status: 'SUCCEEDED',
        amount: '200000',
        confirmed_at: at,
        confirmed_by_name: 'Nhân viên',
        cash_received_amount: '200000',
        change_amount: '0',
        change_returned_at: at,
      });
      data.bill.account.paid_total = '200000';
      data.bill.account.outstanding_amount = '250000';
      data.bill.charges[0]!.unpaid_amount = '250000';
    },
    online: (
      status: NonNullable<PaymentIntent['online']>['status'],
      amount = '150000',
      received = '0',
    ) => {
      data.bill.intents = [makeIntent(amount)];
      const intent = data.bill.intents[0]!;
      intent.online!.status = status;
      intent.online!.paidAmount = received;
      intent.online!.remainingAmount = (
        BigInt(amount) > BigInt(received) ? BigInt(amount) - BigInt(received) : 0n
      ).toString();
      if (status === 'EXPIRED') {
        intent.status = 'EXPIRED';
        intent.expires_at = at;
        intent.online!.expiresAt = at;
      }
      if (status === 'CANCELLED') intent.status = 'CANCELLED';
      if (status === 'ERROR') {
        intent.status = 'FAILED';
        intent.online!.lastError = 'Chưa kết nối được cổng thanh toán. Hãy kiểm tra lại.';
      }
      if (status === 'PAID') intent.status = 'SUCCEEDED';
      return intent;
    },
  };
}
async function staffPayment(page: Page, navigate = true) {
  if (navigate) await page.goto('/workspace/staff');
  await page
    .locator('.table-tile')
    .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
  return dialog;
}
async function fits(page: Page, scope: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  for (const item of await scope
    .locator('.online-payment-card, .online-payment-facts, .online-reconciliation-card')
    .all()) {
    const metrics = await item.evaluate((element) => ({
      fits: element.scrollWidth <= element.clientWidth + 1,
      width: element.clientWidth,
      scroll: element.scrollWidth,
      overflow: Array.from(element.querySelectorAll('*'))
        .filter(
          (child) =>
            child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1 ||
            child.scrollWidth > child.clientWidth + 1,
        )
        .map((child) => ({
          tag: child.tagName,
          class: child.className,
          width: child.clientWidth,
          scroll: child.scrollWidth,
        })),
    }));
    expect(metrics.fits, JSON.stringify(metrics)).toBe(true);
  }
}

test('staff creates a partial online QR after cash, refresh preserves QR, provider success updates receipt without manual confirm', async ({
  page,
}, info) => {
  const f = await mock(page);
  f.cash();
  let dialog = await staffPayment(page);
  const form = dialog.getByRole('form', { name: 'Thu tiền tại bàn' });
  await form.getByRole('button', { name: 'Online (payOS)', exact: true }).click();
  await form.getByRole('button', { name: /Số tiền khác/ }).click();
  await form.getByLabel('Số tiền thu lần này (đồng)', { exact: true }).fill('150000');
  await expect(form.getByLabel('Tiền mặt khách đưa (đồng)')).toHaveCount(0);
  await expect(form.getByLabel('Ảnh chứng từ chuyển khoản')).toHaveCount(0);
  await form.getByRole('button', { name: 'Tạo QR thanh toán', exact: true }).click();
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card.getByRole('img')).toBeVisible();
  await expect(card).toContainText('150.000 đ');
  await expect(card.getByRole('button', { name: /nhận tiền/ })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Online (payOS)', exact: true })).toBeDisabled();
  expect(f.writes.filter((write) => write.path.endsWith('/confirm'))).toHaveLength(0);
  expect(f.writes[0]!.body).toMatchObject({
    method: 'ONLINE',
    amount: '150000',
    collectionScope: 'TABLE',
  });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await fits(page, dialog);
  }
  await card.screenshot({ path: info.outputPath('payos-qr-320.png'), animations: 'disabled' });
  await page.clock.pauseAt(new Date());
  await page.waitForLoadState('networkidle');
  await page.reload();
  await page.clock.resume();
  dialog = await staffPayment(page, false);
  await expect(
    dialog.getByRole('region', { name: 'Khoản thu online' }).getByRole('img'),
  ).toBeVisible();
  expect(f.writes.filter((write) => write.path.endsWith('/payments'))).toHaveLength(1);
  const intent = f.bill.intents[0]!;
  intent.status = 'SUCCEEDED';
  intent.online!.status = 'PAID';
  intent.online!.paidAmount = '150000';
  intent.online!.remainingAmount = '0';
  f.bill.account.paid_total = '350000';
  f.bill.account.outstanding_amount = '100000';
  f.bill.account.reserved_payment_amount = '0';
  f.bill.payments.unshift({
    id: 'online',
    method: 'ONLINE',
    status: 'SUCCEEDED',
    amount: '150000',
    confirmed_at: at,
  });
  await expect(dialog.getByRole('region', { name: 'Khoản thu online' })).toContainText(
    'Đã nhận thanh toán online',
  );
  await expect(dialog.locator('.last-payment')).toContainText('payOS');
  await dialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
  await expect(dialog.locator('.receipt-sheet')).toContainText('Online (payOS)');
  await expect(dialog.locator('.receipt-sheet')).toContainText('Hệ thống xác nhận');
  await expect(dialog.locator('.receipt-sheet')).toContainText('100.000 đ');
  expect(f.writes.filter((write) => write.path.endsWith('/confirm'))).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test('underpaid displays actual bank receipt and remaining balance on the same QR', async ({
  page,
}) => {
  const f = await mock(page);
  f.cash();
  f.online('UNDERPAID', '150000', '100000');
  f.bill.account.paid_total = '300000';
  f.bill.account.outstanding_amount = '150000';
  f.bill.account.reserved_payment_amount = '50000';
  const dialog = await staffPayment(page);
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card).toContainText('Đã nhận một phần tiền online');
  await expect(card.locator('.online-payment-facts')).toContainText('100.000 đ');
  await expect(card.locator('.online-payment-facts')).toContainText('50.000 đ');
  await expect(card.getByRole('img')).toBeVisible();
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

for (const [status, label] of [
  ['EXPIRED', 'QR thanh toán đã hết hạn'],
  ['CANCELLED', 'Khoản thu online đã hủy'],
  ['ERROR', 'Khoản thanh toán online không thành công'],
  ['REQUIRES_RECONCILIATION', 'Cần quản trị đối soát'],
] as const)
  test(status + ' hides payable QR and states the next action', async ({ page }) => {
    const f = await mock(page);
    f.online(status);
    const dialog = await staffPayment(page);
    const card = dialog.getByRole('region', { name: 'Khoản thu online' });
    await expect(card).toContainText(label);
    await expect(card.getByRole('img')).toHaveCount(0);
    await expect(card.getByRole('button', { name: /nhận tiền/ })).toHaveCount(0);
    expect(f.writes).toEqual([]);
    expect(f.errors).toEqual([]);
  });

test('missing configuration disables Online with explanation; failed creation does not fabricate paid state', async ({
  page,
}) => {
  const f = await mock(page);
  f.bill.paymentCapabilities = { online: false, reason: 'Thanh toán online chưa được cấu hình.' };
  let dialog = await staffPayment(page);
  await expect(dialog.getByRole('button', { name: 'Online (payOS)', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('Thanh toán online chưa được cấu hình.');
  f.bill.paymentCapabilities = { online: true };
  f.reject();
  await page.clock.pauseAt(new Date());
  await page.waitForLoadState('networkidle');
  await page.reload();
  await page.clock.resume();
  dialog = await staffPayment(page, false);
  const form = dialog.getByRole('form', { name: 'Thu tiền tại bàn' });
  await form.getByRole('button', { name: 'Online (payOS)', exact: true }).click();
  await form.getByRole('button', { name: 'Tạo QR thanh toán', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Chưa kết nối được cổng thanh toán');
  expect(f.bill.account.paid_total).toBe('0');
  expect(f.bill.intents).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test('guest only requests staff assistance and cannot start online payment or close the session', async ({
  page,
}) => {
  const f = await mock(page);
  await page.goto('/guest');
  await page.getByRole('button', { name: 'Thanh toán', exact: true }).click();
  const form = page.getByRole('form', { name: 'Yêu cầu thanh toán' });
  await expect(form.getByRole('button', { name: 'Online (payOS)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tạo QR thanh toán' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Đóng phiên/ })).toHaveCount(0);
  await form.getByRole('button', { name: 'Chuyển khoản', exact: true }).click();
  await form.getByRole('button', { name: 'Báo nhân viên thu tiền', exact: true }).click();
  expect(f.writes).toEqual([
    { path: '/api/guest/payment-requests', body: { method: 'BANK_TRANSFER' } },
  ]);
  expect(f.errors).toEqual([]);
});

test('admin can record verified reconciliation outcome with reference, without changing payment state', async ({
  page,
}, info) => {
  const f = await mock(page);
  f.cases.push({
    id: 'online-intent',
    session_id: sid,
    table_code: 'A10',
    session_status: 'CLOSED',
    amount: '150000',
    paid_amount: '150000',
    quarantined_amount: '5000',
    provider_status: 'REQUIRES_RECONCILIATION',
    last_error: null,
    updated_at: at,
    reason: 'Khoản chuyển đến sau khi phiên đã đóng.',
    status: 'OPEN',
  });
  await page.goto('/workspace/admin');
  await selectAdmin(page, 'Báo cáo', 'Đối soát online');
  const panel = page.getByRole('region', { name: 'Đối soát thanh toán online' });
  await expect(panel).toContainText('5.000 đ');
  await expect(panel.getByRole('option', { name: 'Đã đối chiếu, kết thúc hồ sơ' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Đã nhận tiền|PAID/ })).toHaveCount(0);
  await panel
    .getByLabel('Mã giao dịch / tham chiếu sao kê', { exact: true })
    .fill('BANK-RETURN-FIXTURE');
  await panel
    .getByLabel('Nội dung đối soát và căn cứ xử lý', { exact: true })
    .fill('Đã kiểm tra sao kê và trả lại khoản chuyển dư cho khách.');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await fits(page, panel);
  }
  await panel.screenshot({
    path: info.outputPath('payos-admin-reconciliation-320.png'),
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: 'Lưu kết quả đối soát', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(panel).toContainText('Không có khoản online cần đối soát');
  expect(f.writes[0]!.body).toMatchObject({
    resolution: 'RETURNED_EXTERNALLY',
    reference: 'BANK-RETURN-FIXTURE',
  });
  expect(f.bill.account.paid_total).toBe('0');
  expect(f.errors).toEqual([]);
});

test('recovered link uses checkout URL when QR is unavailable; uncertain cancellation keeps the persisted amount visible', async ({
  page,
}) => {
  const f = await mock(page);
  const intent = f.online('PENDING');
  intent.online!.qrCode = null;
  f.bill.account.reserved_payment_amount = '150000';
  const dialog = await staffPayment(page);
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(
    card.getByRole('link', { name: 'Mở trang thanh toán', exact: true }),
  ).toHaveAttribute('href', 'https://pay.payos.vn/web/fixture-payment');
  intent.online!.status = 'CANCEL_PENDING';
  await expect(card).toContainText('Đang kiểm tra để hủy khoản thu');
  await expect(card.getByRole('link')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Hủy QR thanh toán', exact: true })).toHaveCount(
    0,
  );
  expect(f.bill.account.reserved_payment_amount).toBe('150000');
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('a colleague sees online status but cannot cancel, refresh or manually capture another staff request', async ({
  page,
}) => {
  const f = await mock(page);
  const intent = f.online('PENDING');
  intent.support_request_id = 'owned-request';
  f.bill.account.reserved_payment_amount = '150000';
  f.bill.paymentRequests = [
    {
      id: 'owned-request',
      status: 'ACKNOWLEDGED',
      acknowledged_by: 'other-staff',
      payment_method: 'BANK_TRANSFER',
      participant_id: 'guest',
      display_name: 'Lan',
    },
  ];
  const dialog = await staffPayment(page);
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card.getByRole('img')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Kiểm tra trạng thái' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Hủy QR thanh toán' })).toHaveCount(0);
  await expect(dialog.getByRole('form', { name: 'Thu tiền tại bàn' })).toHaveCount(0);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('transient provider error keeps the pending amount reserved and allows status checks without a payable QR', async ({
  page,
}) => {
  const f = await mock(page);
  const intent = f.online('ERROR');
  intent.status = 'PENDING';
  f.bill.account.reserved_payment_amount = '150000';
  const dialog = await staffPayment(page);
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card).toContainText('Chưa tạo được QR thanh toán');
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(card.getByRole('link')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /nhận tiền/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Online (payOS)', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Kiểm tra trạng thái', exact: true }).click();
  await expect(card).toContainText('Chưa tạo được QR thanh toán');
  expect(f.bill.account.reserved_payment_amount).toBe('150000');
  expect(f.bill.account.paid_total).toBe('0');
  expect(f.writes.map((write) => write.path)).toEqual(['/api/core/payments/online-intent/refresh']);
  expect(f.errors).toEqual([]);
});
