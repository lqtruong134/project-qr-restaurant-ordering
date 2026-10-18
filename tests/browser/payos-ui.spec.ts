import { test, expect, type Page, type Locator } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
import type {
  PaymentCapabilities,
  OnlinePaymentView,
  GuestOnlinePayment,
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
    pending_payments: 0,
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
    closure: {
      canClose: false,
      blockers: [] as {
        code: string;
        title: string;
        detail: string;
        tab: 'payments' | 'tasks' | 'orders';
        count: number;
      }[],
    },
  };
  return { bill, table };
}
async function mock(page: Page) {
  await page.clock.install();
  const data = fixture();
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const reads: string[] = [];
  let rejectRefresh = false;
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
      reads.push(path);
      if (path === '/api/core/admin/overview')
        return route.fulfill({
          status: 503,
          json: { userMessage: 'Tổng quan không được dùng trong fixture đối soát.' },
        });
      if (path === '/api/core/sessions/' + sid + '/bill')
        return route.fulfill({
          json: {
            ...data.bill,
            paymentRequests: data.bill.paymentRequests.filter((request) =>
              ['NEW', 'ACKNOWLEDGED'].includes(String(request.status)),
            ),
          },
        });
      if (path.endsWith('/promotion'))
        return route.fulfill({ json: { billing: data.bill.billing, programs: [], locked: true } });
      if (path === '/api/core/tables' || path === '/api/core/admin/tables')
        return route.fulfill({ json: [data.table] });
      if (path === '/api/core/support')
        return route.fulfill({
          json: data.bill.paymentRequests.filter((request) =>
            ['NEW', 'ACKNOWLEDGED'].includes(String(request.status)),
          ),
        });
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
    if (path.endsWith('/refresh'))
      return rejectRefresh
        ? route.fulfill({
            status: 503,
            json: {
              errorCode: 'PAYOS_UNAVAILABLE',
              userMessage: 'Chưa kiểm tra được ngân hàng. Hệ thống sẽ tiếp tục tự cập nhật.',
            },
          })
        : route.fulfill({ json: data.bill.intents[0] });
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
    if (route.request().method() === 'GET') reads.push(path);
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
          support: data.bill.paymentRequests,
          onlinePayments: data.bill.intents
            .filter((intent) => intent.method === 'ONLINE' && intent.online)
            .map((intent): GuestOnlinePayment => {
              const sources = data.bill.payments.filter(
                (payment) =>
                  payment.status === 'SUCCEEDED' && payment.payment_intent_id === intent.id,
              );
              const sum = (field: string) =>
                sources
                  .reduce((total, payment) => total + BigInt(String(payment[field] ?? '0')), 0n)
                  .toString();
              return {
                id: 'opaque-' + intent.id,
                scope: 'TABLE',
                amount: intent.amount,
                status: intent.online!.status,
                paidAmount: sources.length
                  ? sum('amount')
                  : intent.online!.status === 'REQUIRES_RECONCILIATION'
                    ? '0'
                    : intent.online!.paidAmount,
                ...(sources.length
                  ? {
                      appliedAmount: sum('allocated_amount'),
                      refundableAmount: sum('refundable_amount'),
                      refundedAmount: sum('refunded_amount'),
                    }
                  : {}),
                bankConfirmedAmount: intent.online!.paidAmount,
                remainingAmount: sources.length
                  ? intent.online!.remainingAmount
                  : intent.online!.status === 'REQUIRES_RECONCILIATION'
                    ? intent.amount
                    : intent.online!.remainingAmount,
                expiresAt: intent.online!.expiresAt,
                createdAt: at,
              };
            }),
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
      const request = {
        id: 'request',
        status: 'NEW',
        request_type: 'BILL',
        payment_method: body.method,
        participant_id: 'guest',
        display_name: 'Lan',
        session_id: sid,
        table_id: 'table',
        table_code: 'A10',
        area_name: 'Trong nhà',
        created_at: at,
        acknowledged_by: null,
      };
      data.bill.paymentRequests.push(request);
      return route.fulfill({ json: request });
    }
    if (route.request().method() !== 'GET') throw Error('Guest cannot create online payments');
    return route.fulfill({ json: null });
  });
  return {
    ...data,
    writes,
    reads,
    errors,
    rejectRefresh: () => {
      rejectRefresh = true;
    },
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
async function pauseClock(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.waitForLoadState('networkidle');
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
  await pauseClock(page);
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
  await pauseClock(page);
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

test('pending staff payment automatically becomes partial then paid and reloads account, tasks and checklist', async ({
  page,
}) => {
  const f = await mock(page);
  f.online('PENDING', '450000');
  f.bill.account.reserved_payment_amount = '450000';
  f.table.pending_payments = 1;
  f.bill.paymentRequests = [
    {
      id: 'payment-call',
      request_type: 'BILL',
      payment_method: 'BANK_TRANSFER',
      status: 'ACKNOWLEDGED',
      acknowledged_by: 'staff',
      participant_id: 'guest',
      display_name: 'Lan',
      session_id: sid,
      table_id: 'table',
      created_at: at,
    },
  ];
  f.bill.closure.blockers = [
    {
      code: 'PAYMENT',
      title: 'Còn khoản thu chưa xác nhận',
      detail: 'Chờ ngân hàng xác nhận.',
      tab: 'payments',
      count: 1,
    },
  ];
  const dialog = await staffPayment(page);
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card).toContainText('Đang chờ khách thanh toán');
  await expect(card.getByRole('img')).toBeVisible();
  await pauseClock(page);
  const before = f.reads.filter((path) => path.endsWith('/bill')).length;
  f.online('UNDERPAID', '450000', '100000');
  f.bill.account.paid_total = '100000';
  f.bill.account.outstanding_amount = '350000';
  f.bill.account.reserved_payment_amount = '350000';
  f.bill.payments.push({
    id: 'part-one',
    method: 'ONLINE',
    status: 'SUCCEEDED',
    amount: '100000',
    confirmed_at: at,
  });
  f.table.outstanding_amount = '350000';
  await page.clock.runFor(3500);
  await expect(card).toContainText('Đã nhận một phần tiền online');
  await expect(card.locator('.online-payment-facts')).toContainText('350.000 đ');
  await expect(card).toContainText('Chỉ chuyển thêm 350.000 đ');
  await expect(
    dialog.locator('.bill-balance-grid').getByText('350.000 đ', { exact: true }),
  ).toBeVisible();
  expect(f.reads.filter((path) => path.endsWith('/bill')).length).toBeGreaterThan(before);
  f.online('PAID', '450000', '450000');
  f.bill.account.paid_total = '450000';
  f.bill.account.outstanding_amount = '0';
  f.bill.account.reserved_payment_amount = '0';
  f.bill.payments.unshift({
    id: 'part-two',
    method: 'ONLINE',
    status: 'SUCCEEDED',
    amount: '350000',
    confirmed_at: at,
  });
  f.bill.paymentRequests[0]!.status = 'RESOLVED';
  f.table.outstanding_amount = '0';
  f.table.pending_payments = 0;
  f.bill.closure.blockers = [
    {
      code: 'RECEIPT',
      title: 'Chưa giao phiếu cho khách',
      detail: 'Nhân viên cần xác nhận giao phiếu.',
      tab: 'payments',
      count: 1,
    },
  ];
  await page.clock.runFor(3500);
  await expect(card).toContainText('Đã nhận thanh toán online');
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(
    dialog.locator('.bill-balance-grid').getByText('0 đ', { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('[data-support-id="payment-call"]')).toHaveCount(0);
  await expect(dialog.getByRole('status', { name: 'Điều kiện kết thúc bàn' })).toContainText(
    'Chưa giao phiếu cho khách',
  );
  await expect(dialog.getByRole('status', { name: 'Điều kiện kết thúc bàn' })).not.toContainText(
    'Còn khoản thu chưa xác nhận',
  );
  await expect(
    dialog.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.table-tile')).toContainText('Còn phải trả 0 đ');
  const settledReads = f.reads.filter((path) => path.endsWith('/bill')).length;
  await page.clock.runFor(9000);
  expect(f.reads.filter((path) => path.endsWith('/bill'))).toHaveLength(settledReads);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('guest automatically shows partial and successful online receipts and clears settled assistance wording', async ({
  page,
}) => {
  const f = await mock(page);
  f.online('PENDING', '450000');
  f.bill.paymentRequests = [
    {
      id: 'payment-call',
      request_type: 'BILL',
      payment_method: 'BANK_TRANSFER',
      status: 'ACKNOWLEDGED',
      acknowledged_by: 'staff',
      participant_id: 'guest',
      created_at: at,
    },
  ];
  await page.goto('/guest');
  await page
    .getByRole('navigation', { name: 'Điều hướng khách' })
    .getByRole('button', { name: 'Thanh toán', exact: true })
    .click();
  const online = page.getByRole('region', { name: 'Trạng thái thanh toán online' });
  await expect(online).toContainText('Đang chờ thanh toán online');
  await expect(page.getByRole('button', { name: 'Tạo QR thanh toán' })).toHaveCount(0);
  await pauseClock(page);
  f.online('UNDERPAID', '450000', '100000');
  f.bill.account.paid_total = '100000';
  f.bill.account.outstanding_amount = '350000';
  await page.clock.runFor(3500);
  await expect(online).toContainText('Đã nhận một phần thanh toán');
  await expect(online).toContainText('100.000 đ');
  await expect(online).toContainText('350.000 đ');
  await expect(online).not.toContainText('Thanh toán thành công');
  f.online('PAID', '450000', '450000');
  f.bill.account.paid_total = '450000';
  f.bill.account.outstanding_amount = '0';
  f.bill.paymentRequests[0]!.status = 'RESOLVED';
  await page.clock.runFor(3500);
  await expect(online.getByRole('status')).toHaveText('Thanh toán thành công');
  await expect(
    page.getByRole('heading', { name: 'Bàn đã thanh toán đủ', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.core-stats p').filter({ hasText: 'Đã tính vào tiền món' }).locator('strong'),
  ).toHaveText('450.000 đ');
  await expect(
    page.locator('.core-stats p').filter({ hasText: 'Còn phải thanh toán' }).locator('strong'),
  ).toHaveText('0 đ');
  await expect(page.locator('.guest-payment-sent')).toHaveCount(0);
  await expect(page.getByText('Nhân viên đang xử lý', { exact: true })).toHaveCount(0);
  await expect(online).not.toContainText('202610140001');
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('manual provider failure is truthful and still reloads the newly recorded bill without creating another link', async ({
  page,
}) => {
  const f = await mock(page);
  f.online('PENDING', '450000');
  const dialog = await staffPayment(page);
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card.getByRole('img')).toBeVisible();
  await pauseClock(page);
  const reads = f.reads.filter((path) => path.endsWith('/bill')).length;
  f.online('UNDERPAID', '450000', '100000');
  f.bill.account.paid_total = '100000';
  f.bill.account.outstanding_amount = '350000';
  f.bill.payments.push({
    id: 'concurrent-webhook',
    method: 'ONLINE',
    status: 'SUCCEEDED',
    amount: '100000',
    confirmed_at: at,
  });
  f.rejectRefresh();
  await card.getByRole('button', { name: 'Kiểm tra trạng thái', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Chưa kiểm tra được ngân hàng');
  await expect(card).toContainText('Đã nhận một phần tiền online');
  await expect(dialog.locator('.bill-balance-grid')).toContainText('350.000 đ');
  expect(f.reads.filter((path) => path.endsWith('/bill')).length).toBeGreaterThan(reads);
  expect(f.writes.map((write) => write.path)).toEqual(['/api/core/payments/online-intent/refresh']);
  expect(
    f.writes.some((write) => write.path.endsWith('/payments') || write.path.endsWith('/confirm')),
  ).toBe(false);
  expect(f.errors).toEqual([]);
});

test('hidden payment panel pauses reads, foreground events coalesce, and closing the panel cleans up its timer', async ({
  page,
}) => {
  const f = await mock(page);
  f.online('PENDING');
  const dialog = await staffPayment(page);
  await expect(
    dialog.getByRole('region', { name: 'Khoản thu online' }).getByRole('img'),
  ).toBeVisible();
  await pauseClock(page);
  const before = f.reads.filter((path) => path.endsWith('/bill')).length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(15000);
  expect(f.reads.filter((path) => path.endsWith('/bill'))).toHaveLength(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => f.reads.filter((path) => path.endsWith('/bill')).length).toBe(before + 1);
  await page.clock.runFor(500);
  expect(f.reads.filter((path) => path.endsWith('/bill'))).toHaveLength(before + 1);
  await page.waitForLoadState('networkidle');
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const afterClose = f.reads.filter((path) => path.endsWith('/bill')).length;
  await page.clock.runFor(15000);
  expect(f.reads.filter((path) => path.endsWith('/bill'))).toHaveLength(afterClose);
  expect(f.errors).toEqual([]);
});

test('guest expiry, cancellation and reconciliation never claim money was posted or invite using an old QR', async ({
  page,
}) => {
  const f = await mock(page);
  f.online('EXPIRED', '150000');
  await page.goto('/guest');
  await page
    .getByRole('navigation', { name: 'Điều hướng khách' })
    .getByRole('button', { name: 'Thanh toán', exact: true })
    .click();
  const online = page.getByRole('region', { name: 'Trạng thái thanh toán online' });
  await expect(online).toContainText('QR thanh toán đã hết hạn');
  await expect(online).toContainText('Không sử dụng QR cũ');
  await pauseClock(page);
  f.online('CANCELLED', '150000');
  await page.clock.runFor(5500);
  await expect(online).toContainText('Khoản thanh toán online đã hủy');
  await expect(online).toContainText('kiểm tra trước khi chuyển lại');
  f.online('REQUIRES_RECONCILIATION', '150000', '150000');
  await page.clock.runFor(5500);
  await expect(online).toContainText('Nhà hàng đang kiểm tra khoản chuyển tiền');
  await expect(online).toContainText('Ngân hàng đã xác nhận 150.000 đ');
  await expect(online).toContainText('chưa ghi nhận vào thanh toán');
  await expect(online).toContainText('bạn chưa cần chuyển lại');
  await expect(online).not.toContainText('Thanh toán thành công');
  await expect(online.getByRole('img')).toHaveCount(0);
  await expect(online.getByRole('link')).toHaveCount(0);
  await expect(
    page.locator('.core-stats p').filter({ hasText: 'Đã tính vào tiền món' }).locator('strong'),
  ).toHaveText('0 đ');
  await expect(
    page.locator('.core-stats p').filter({ hasText: 'Còn phải thanh toán' }).locator('strong'),
  ).toHaveText('450.000 đ');
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('a partial-quote overpayment shows received, applied, still owed and refund due separately for staff and guest', async ({
  page,
}) => {
  const f = await mock(page);
  Object.assign(f.bill.account, {
    charge_total: '20000',
    paid_total: '12000',
    outstanding_amount: '10000',
    refund_due_amount: '2000',
  });
  Object.assign(f.table, { charge_total: '20000', outstanding_amount: '10000' });
  Object.assign(f.bill.billing, {
    subtotalAmount: '20000',
    payableAmount: '20000',
    beforeVatAmount: '18518',
    vatAmount: '1482',
  });
  f.bill.billing.vatGroups[0] = {
    treatment: 'TAXABLE',
    ratePercent: 8,
    beforeVatAmount: '18518',
    vatAmount: '1482',
    totalAmount: '20000',
  };
  Object.assign(f.bill.charges[0]!, {
    amount: '20000',
    net_amount: '20000',
    unit_price_snapshot: '20000',
    unpaid_amount: '10000',
  });
  f.online('REQUIRES_RECONCILIATION', '10000', '12000');
  f.bill.intents[0]!.online!.remainingAmount = '0';
  f.bill.payments.push({
    id: 'receipt12',
    payment_intent_id: 'online-intent',
    status: 'SUCCEEDED',
    method: 'ONLINE',
    amount: '12000',
    allocated_amount: '10000',
    refunded_amount: '0',
    refundable_amount: '2000',
    pending_refund_amount: '0',
    available_refund_amount: '2000',
    refund_context_kind: 'UNAPPLIED_PAYMENT',
    confirmed_at: at,
  });
  f.bill.closure.blockers = [
    {
      code: 'OUTSTANDING',
      title: 'Còn tiền món chưa thu',
      detail: 'Còn 10.000 đ tiền món.',
      tab: 'payments',
      count: 1,
    },
    {
      code: 'REFUND',
      title: 'Còn tiền chưa hoàn khách',
      detail: 'Cần thực tế hoàn lại 2.000 đ.',
      tab: 'payments',
      count: 1,
    },
  ];
  const dialog = await staffPayment(page);
  for (const [label, amount] of [
    ['Đã nhận (trước hoàn)', '12.000 đ'],
    ['Đã tính vào tiền món', '10.000 đ'],
    ['Còn phải thanh toán', '10.000 đ'],
    ['Cần hoàn lại khách', '2.000 đ'],
  ]) {
    await expect(
      dialog
        .locator('.bill-balance-grid > div')
        .filter({ has: page.getByText(label!, { exact: true }) })
        .locator('strong'),
    ).toHaveText(amount!);
  }
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card).toContainText('Đã nhận tiền; còn khoản cần hoàn');
  await expect(card).toContainText('chưa tự bù');
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(card.getByRole('link')).toHaveCount(0);
  await fits(page, dialog);
  await page.goto('/guest');
  await page
    .getByRole('navigation', { name: 'Điều hướng khách' })
    .getByRole('button', { name: 'Thanh toán', exact: true })
    .click();
  const summary = page.locator('.guest-content > .core-card > .core-stats');
  for (const [label, amount] of [
    ['Đã nhận (trước hoàn)', '12.000 đ'],
    ['Đã tính vào tiền món', '10.000 đ'],
    ['Còn phải thanh toán', '10.000 đ'],
    ['Cần hoàn lại khách', '2.000 đ'],
  ]) {
    await expect(summary.locator('p').filter({ hasText: label! }).locator('strong')).toHaveText(
      amount!,
    );
  }
  const online = page.getByRole('region', { name: 'Trạng thái thanh toán online' });
  await expect(online).toContainText('Khoản chuyển có phần cần hoàn lại');
  await expect(online).not.toContainText('Thanh toán thành công');
  await expect(online).not.toContainText('Còn thiếu cho khoản thu này');
  await expect(
    page.getByText('Tiền cần hoàn chưa tự bù vào tiền món còn thiếu', { exact: false }),
  ).toBeVisible();
  await fits(page, online);
  // Returning the excess does not pay the other 10k of active items.
  f.bill.account.refunded_total = '2000';
  f.bill.account.refund_due_amount = '0';
  Object.assign(f.bill.payments[0]!, {
    refunded_amount: '2000',
    refundable_amount: '0',
    available_refund_amount: '0',
  });
  f.online('PAID', '10000', '12000');
  f.bill.intents[0]!.online!.remainingAmount = '0';
  const returned = await staffPayment(page);
  const returnedCard = returned.getByRole('region', { name: 'Khoản thu online' });
  await expect(returnedCard).toContainText('đã hoàn lại khách 2.000 đ');
  await expect(returnedCard).toContainText('Đã tính vào tiền món 10.000 đ');
  await expect(
    returned
      .locator('.bill-balance-grid > div')
      .filter({ hasText: 'Còn phải thanh toán' })
      .locator('strong'),
  ).toHaveText('10.000 đ');
  await expect(returnedCard.getByRole('img')).toHaveCount(0);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('admin must finish a source refund before closing a booked-unapplied reconciliation case', async ({
  page,
}) => {
  const f = await mock(page);
  f.cases.push({
    id: 'online-intent',
    session_id: sid,
    table_code: 'A10',
    session_status: 'ACTIVE',
    amount: '10000',
    paid_amount: '12000',
    recorded_amount: '12000',
    allocated_amount: '10000',
    refunded_amount: '0',
    unapplied_amount: '2000',
    quarantined_amount: '0',
    provider_status: 'REQUIRES_RECONCILIATION',
    last_error: null,
    updated_at: at,
    reason: 'Khách chuyển vượt khoản thu một phần.',
    status: 'OPEN',
  });
  await page.goto('/workspace/admin');
  await selectAdmin(page, 'Báo cáo', 'Đối soát online');
  const panel = page.getByRole('region', { name: 'Đối soát thanh toán online' });
  await expect(panel).toContainText('Còn 2.000 đ đã nhận nhưng chưa tính vào tiền món');
  await expect(panel).toContainText('Lập phiếu hoàn từ đúng giao dịch gốc');
  await expect(
    panel.getByRole('button', { name: 'Lưu kết quả đối soát', exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByRole('option', { name: /trả.*ngân hàng/ })).toHaveCount(0);
  await fits(page, panel);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('session reconciliation reports show both amounts due and refundable without netting or a false balanced badge', async ({
  page,
}) => {
  const f = await mock(page);
  await page.route('**/api/core/admin/reports?*', (route) =>
    route.fulfill({
      json: {
        scope: {
          period: 'month',
          startDay: '2026-10-01',
          endDay: '2026-10-18',
          timezone: 'Asia/Ho_Chi_Minh',
          updatedAt: at,
          granularity: 'day',
        },
        summary: { sessions: 1, balanced: 0, outstanding: '10000', refundDue: '2000' },
        rows: [
          {
            id: sid,
            table_code: 'A10',
            at,
            payable: '20000',
            collected: '12000',
            refunded: '0',
            written_off: '0',
            appliedAmount: '10000',
            outstanding: '10000',
            refundDue: '2000',
            balance: '8000',
            financialBalance: '8000',
            legacyTaxUnavailable: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    }),
  );
  await page.goto('/workspace/admin');
  await selectAdmin(page, 'Báo cáo', 'Đối soát phiên');
  const table = page.getByRole('table', { name: 'Đối chiếu theo từng phiên bàn', exact: true });
  const row = table.locator('tbody > tr');
  await expect(row.locator('td[data-label="Đã tính vào món"]')).toContainText('10.000 đ');
  await expect(row.locator('td[data-label="Còn phải thu"] strong')).toHaveText('10.000 đ');
  await expect(row.locator('td[data-label="Cần hoàn khách"] strong')).toHaveText('2.000 đ');
  await expect(row.locator('td[data-label="Tiền giữ sau hoàn"]')).toContainText('12.000 đ');
  await expect(row).toContainText('Hoàn và thu riêng, chưa tự bù trừ');
  await expect(row).not.toContainText('Cân bằng tiền');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await fits(page, table);
  }
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
