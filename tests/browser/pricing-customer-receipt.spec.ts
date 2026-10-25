import { test, expect, type Page, type Locator } from '@playwright/test';
import type { BillingSummary, DiscountProgram } from '../../packages/contracts/src/billing';

const sid = 'f63b91bc-0000-4000-8000-000000000001';
const at = '2026-10-13T04:00:00Z';
const name =
  'Gỏi cuốn tôm thịt dùng cùng rau sống và nước chấm đậu phộng riêng theo yêu cầu của khách';
const program: DiscountProgram = {
  id: 'promotion',
  name: 'Ưu đãi bữa trưa',
  description: 'Giảm cho các món lẻ trong bữa trưa.',
  mode: 'CODE',
  code: 'GIAM10',
  type: 'PERCENT',
  percent: 10,
  fixedAmount: null,
  minEligibleAmount: '100000',
  maxDiscountAmount: '50000',
  startsAt: '2026-10-01T00:00:00+07:00',
  endsAt: '2026-10-31T23:59:59+07:00',
  weekdays: [1, 2, 3, 4, 5],
  startTime: '11:00',
  endTime: '14:00',
  scope: 'ALL',
  productIds: [],
  categoryIds: [],
  excludeCombos: true,
  usageLimit: 100,
  status: 'ACTIVE',
  version: 1,
  usedCount: 5,
  reservedCount: 0,
  createdAt: at,
};
const billing = (): BillingSummary => ({
  version: 1,
  priceIncludesVat: true,
  subtotalAmount: '256000',
  discountAmount: '15700',
  payableAmount: '240300',
  beforeVatAmount: '220864',
  vatAmount: '19436',
  legacyTaxUnavailable: false,
  vatGroups: [
    {
      treatment: 'TAXABLE',
      ratePercent: 8,
      beforeVatAmount: '132500',
      vatAmount: '10600',
      totalAmount: '143100',
    },
    {
      treatment: 'TAXABLE',
      ratePercent: 10,
      beforeVatAmount: '88364',
      vatAmount: '8836',
      totalAmount: '97200',
    },
  ],
  promotion: {
    id: program.id,
    name: program.name,
    code: program.code,
    status: 'SELECTED',
    locked: false,
    eligibleAmount: '157000',
    discountAmount: '15700',
    reason: null,
  },
  lines: [
    {
      chargeId: 'charge-a',
      orderItemId: 'item-a',
      grossAmount: '49000',
      discountAmount: '4900',
      payableAmount: '44100',
      beforeVatAmount: '40833',
      vatAmount: '3267',
      taxTreatment: 'TAXABLE',
      vatRatePercent: 8,
      promotionId: program.id,
    },
    {
      chargeId: 'charge-b',
      orderItemId: 'item-b',
      grossAmount: '108000',
      discountAmount: '10800',
      payableAmount: '97200',
      beforeVatAmount: '88364',
      vatAmount: '8836',
      taxTreatment: 'TAXABLE',
      vatRatePercent: 10,
      promotionId: program.id,
    },
    {
      chargeId: 'charge-combo',
      orderItemId: 'item-combo',
      grossAmount: '99000',
      discountAmount: '0',
      payableAmount: '99000',
      beforeVatAmount: '91667',
      vatAmount: '7333',
      taxTreatment: 'TAXABLE',
      vatRatePercent: 8,
      promotionId: null,
    },
  ],
});

function fixtureData() {
  const charges = [
    {
      id: 'charge-a',
      order_item_id: 'item-a',
      owner_participant_id: 'person-a',
      owner_name: 'Minh Anh',
      amount: '49000',
      unit_price_snapshot: '49000',
      net_amount: '44100',
      discount_amount: '4900',
      product_name_snapshot: name,
      quantity: 1,
      status: 'ACTIVE',
      item_status: 'SERVED',
      unpaid_amount: '44100',
    },
    {
      id: 'charge-b',
      order_item_id: 'item-b',
      owner_participant_id: 'person-b',
      owner_name: 'Thùy Dương',
      amount: '108000',
      unit_price_snapshot: '108000',
      net_amount: '97200',
      discount_amount: '10800',
      product_name_snapshot: 'Món dùng chung theo lựa chọn',
      quantity: 1,
      status: 'ACTIVE',
      item_status: 'SERVED',
      unpaid_amount: '97200',
    },
    {
      id: 'charge-combo',
      order_item_id: 'item-combo',
      owner_participant_id: 'person-a',
      owner_name: 'Minh Anh',
      amount: '99000',
      unit_price_snapshot: '99000',
      net_amount: '99000',
      discount_amount: '0',
      product_name_snapshot: 'Combo cơm trưa',
      product_kind_snapshot: 'COMBO',
      quantity: 1,
      status: 'ACTIVE',
      item_status: 'SERVED',
      unpaid_amount: '99000',
      combo_components_snapshot: [
        { name: 'Cơm tấm', quantity: 1 },
        { name: 'Nước sâm', quantity: 1 },
      ],
    },
  ];
  const account = {
    id: 'account',
    charge_total: '240300',
    paid_total: '0',
    refunded_total: '0',
    outstanding_amount: '240300',
    refund_due_amount: '0',
    reserved_payment_amount: '0',
  };
  const participants = [
    { id: 'person-a', display_name: 'Minh Anh' },
    { id: 'person-b', display_name: 'Thùy Dương' },
  ];
  const table = {
    id: 'table-a',
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
    charge_total: account.charge_total,
    outstanding_amount: account.outstanding_amount,
  };
  const bill = {
    session: { id: sid, session_status: 'ACTIVE', table_code: 'A10', opened_at: at },
    account,
    billing: billing() as BillingSummary | undefined,
    charges,
    payments: [] as Record<string, unknown>[],
    intents: [] as Record<string, unknown>[],
    refunds: [],
    refundTransactions: [] as Record<string, unknown>[],
    participants,
    store: {
      name: 'Quyết Trường Bistro',
      address: 'Nhà hàng món Việt',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    generatedAt: at,
    closedBy: null,
    closure: { canClose: false, blockers: [] },
  };
  const guest = () => ({
    participant: { id: 'person-a', displayName: 'Minh Anh' },
    participants,
    session: {
      ...bill.session,
      table_name: 'Bàn A10',
      table_id: table.id,
      area_name: 'Trong nhà',
      version: 1,
      access_code: '1234',
    },
    products: [],
    discountPrograms: [
      {
        ...program,
        eligible: true,
        eligibleAmount: '157000',
        discountAmount: '15700',
        reason: null,
      },
    ],
    promotions: [],
    cart: { cart_version: 1 },
    items: [],
    orders: bill.charges.map((c) => ({
      ...c,
      id: 'batch',
      item_id: c.order_item_id,
      charge_id: c.id,
      charge_status: c.status,
      original_amount: c.amount,
      status: 'ACCEPTED',
      created_at: at,
    })),
    account: bill.account,
    billing: bill.billing,
    support: [],
    payments: bill.payments,
    refundTransactions: bill.refundTransactions,
  });
  return { table, bill, guest };
}

async function mock(page: Page) {
  const data = fixtureData();
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  let rejectedCode = false;
  let empty = false;
  page.on('pageerror', (error) => errors.push(error.message));
  const quote = () => ({
    billing: data.bill.billing ?? {
      ...billing(),
      subtotalAmount: '0',
      discountAmount: '0',
      payableAmount: '0',
      beforeVatAmount: '0',
      vatAmount: '0',
      promotion: null,
      lines: [],
      vatGroups: [],
      legacyTaxUnavailable: true,
    },
    programs: empty
      ? []
      : [
          {
            ...program,
            eligible: true,
            eligibleAmount: '157000',
            discountAmount: '15700',
            reason: null,
          },
        ],
    locked: Boolean(
      data.bill.billing?.promotion?.locked || data.bill.intents.some((p) => p.status === 'PENDING'),
    ),
  });
  await page.route('**/api/workspaces/staff', (route) =>
    route.fulfill({
      json: {
        user: { id: 'staff', displayName: 'Nhân viên phục vụ', role: 'STAFF', permissions: [] },
      },
    }),
  );
  await page.route('**/api/core/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/core/sessions/${sid}/bill`) return route.fulfill({ json: data.bill });
    if (path.endsWith('/promotion')) return promotion(route);
    if (path === '/api/core/tables') return route.fulfill({ json: [data.table] });
    if (path === '/api/core/catalog')
      return route.fulfill({ json: { products: [], categories: [] } });
    if (route.request().method() !== 'GET') throw new Error(`Unexpected business write ${path}`);
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/guest/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/state')) return route.fulfill({ json: data.guest() });
    if (path.endsWith('/promotion')) return promotion(route);
    if (route.request().method() !== 'GET') throw new Error(`Unexpected guest write ${path}`);
    return route.fulfill({ json: null });
  });
  async function promotion(route: import('@playwright/test').Route) {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: quote() });
    const body = route.request().postDataJSON();
    writes.push({ method, body });
    if (rejectedCode)
      return route.fulfill({
        status: 409,
        json: {
          errorCode: 'PROMOTION_EXHAUSTED',
          userMessage: 'Mã ưu đãi đã hết lượt. Vui lòng chọn ưu đãi khác.',
        },
      });
    if (method === 'DELETE') {
      data.bill.billing!.promotion = null;
      data.bill.billing!.discountAmount = '0';
      data.bill.billing!.payableAmount = '256000';
      data.bill.account.charge_total = '256000';
      data.bill.account.outstanding_amount = '256000';
    } else {
      data.bill.billing = billing();
      data.bill.account.charge_total = '240300';
      data.bill.account.outstanding_amount = '240300';
    }
    return route.fulfill({ json: quote() });
  }
  return {
    ...data,
    errors,
    writes,
    reject: () => {
      rejectedCode = true;
    },
    noPrograms: () => {
      empty = true;
    },
  };
}

async function fits(page: Page, scope: Locator = page.locator('body')) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  for (const selector of [
    '.billing-totals',
    '.promotion-selection',
    '.receipt-row',
    '.billing-price-facts > div',
    '.billing-tax-facts > div',
  ]) {
    for (const element of await scope.locator(selector).all()) {
      if (!(await element.isVisible())) continue;
      const box = (await element.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      expect(await element.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  }
}
async function guestPayment(page: Page) {
  await page.goto('/guest');
  await page.getByRole('button', { name: 'Thanh toán', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanh toán tại bàn' })).toBeVisible();
}
async function staffPayment(page: Page) {
  await page.goto('/workspace/staff');
  await page
    .locator('.table-tile')
    .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
  return dialog;
}

test('guest sees inclusive VAT, explicit eligible conditions and discounted own lines at every width', async ({
  page,
}, info) => {
  const f = await mock(page);
  await guestPayment(page);
  const totals = page.getByRole('region', { name: 'Tiền món, khuyến mãi và VAT' });
  await expect(totals).toContainText('256.000 đ');
  await expect(totals).toContainText('−15.700 đ');
  await expect(totals).toContainText('240.300 đ');
  await totals.getByText('Chi tiết VAT đã gồm trong giá', { exact: true }).click();
  await expect(totals).toContainText('VAT 8%');
  await expect(totals).toContainText('VAT 10%');
  await page.getByText('Ưu đãi và điều kiện áp dụng (1)', { exact: true }).click();
  await expect(page.locator('.promotion-available')).toContainText('Combo không được giảm tiếp');
  await page.getByRole('button', { name: 'Món của tôi', exact: true }).click();
  await expect(page.locator('.own-bill-summary')).toContainText('143.100 đ');
  await expect(page.locator('.guest-bill-item').filter({ hasText: name })).toContainText(
    '44.100 đ',
  );
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await fits(page);
    const head = page.locator('.guest-bill-lines .compact-bill-head');
    if (width <= 560) await expect(head).toBeHidden();
    else {
      const rightEdges = await page.locator('.guest-bill-lines').evaluate((root) => {
        const head = root.querySelector('.compact-bill-head')!;
        const row = root.querySelector('.guest-bill-item .compact-bill-row')!;
        return [head, row].map((el) =>
          Array.from(el.children)
            .slice(1)
            .map((cell) => cell.getBoundingClientRect().right),
        );
      });
      rightEdges[0]!.forEach((edge, index) =>
        expect(Math.abs(edge - rightEdges[1]![index]!)).toBeLessThanOrEqual(1),
      );
    }
  }
  await page.screenshot({
    path: info.outputPath('guest-discount-vat-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(f.errors).toEqual([]);
  expect(f.writes).toEqual([]);
});

test('code apply, removal and exhausted-code errors refresh the shared table amount', async ({
  page,
}) => {
  const f = await mock(page);
  await guestPayment(page);
  const promotion = page.getByRole('region', { name: 'Khuyến mãi của bàn' });
  await promotion.getByRole('button', { name: 'Bỏ ưu đãi' }).click();
  await expect(page.locator('.billing-payable')).toContainText('256.000 đ');
  await promotion.getByLabel('Mã khuyến mãi').fill('GIAM10');
  await promotion.getByRole('button', { name: 'Áp dụng mã' }).click();
  await expect(page.locator('.billing-payable')).toContainText('240.300 đ');
  expect(f.writes[0]!.method).toBe('DELETE');
  expect(f.writes[1]!.body).toMatchObject({ code: 'GIAM10' });
  expect(f.writes[1]!.body.requestId).toBeTruthy();
  f.reject();
  await promotion.getByLabel('Mã khuyến mãi').fill('HETLUOT');
  await promotion.getByRole('button', { name: 'Áp dụng mã' }).click();
  await expect(promotion.getByRole('alert')).toContainText('đã hết lượt');
  await expect(page.locator('.billing-payable')).toContainText('240.300 đ');
  expect(f.errors).toEqual([]);
});

test('first payment locks promotion and cash change remains separate from refund on the receipt', async ({
  page,
}, info) => {
  const f = await mock(page);
  f.bill.billing!.promotion!.locked = true;
  f.bill.billing!.promotion!.status = 'USED';
  f.bill.account.paid_total = '94100';
  f.bill.account.outstanding_amount = '146200';
  f.bill.payments.push(
    {
      id: 'cash',
      status: 'SUCCEEDED',
      method: 'CASH',
      amount: '44100',
      cash_received_amount: '100000',
      change_amount: '55900',
      change_returned_at: at,
      confirmed_at: at,
      confirmed_by_name: 'Nhân viên phục vụ',
      metadata: { cashHandlingVersion: 1, cashReceived: '100000', changeGiven: '55900' },
    },
    {
      id: 'bank',
      status: 'SUCCEEDED',
      method: 'BANK_TRANSFER',
      amount: '50000',
      confirmed_at: at,
      confirmed_by_name: 'Nhân viên phục vụ',
    },
  );
  const dialog = await staffPayment(page);
  const promotion = dialog.getByRole('region', { name: 'Khuyến mãi của bàn' });
  await expect(promotion).toContainText('món gọi thêm');
  await expect(promotion.getByLabel('Mã khuyến mãi')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Phiếu chi tiết theo người gọi' }).click();
  const receipt = dialog.locator('.receipt-sheet');
  await expect(receipt).toContainText('PHIẾU TẠM TÍNH');
  await expect(receipt).toContainText('Minh Anh');
  await expect(receipt).toContainText('Thùy Dương');
  await expect(receipt.locator('.receipt-owner-total').first()).toContainText('143.100 đ');
  await expect(receipt.locator('.receipt-money-breakdown')).toContainText('Tiền thối đã trả');
  await expect(receipt.locator('.receipt-money-breakdown')).toContainText('55.900 đ');
  await expect(receipt.locator('.receipt-money-breakdown')).not.toContainText('Đã hoàn lại khách');
  async function alignedPaymentAmounts() {
    const entries = await receipt.locator('.receipt-payment-line').evaluateAll((rows) =>
      rows.map((row) => {
        const label = row.querySelector(':scope > span')!.getBoundingClientRect();
        const amount = row.querySelector(':scope > strong')!.getBoundingClientRect();
        return {
          gap: amount.left - label.right,
          rightGap: row.getBoundingClientRect().right - amount.right,
        };
      }),
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.gap).toBeGreaterThanOrEqual(8);
      expect(Math.abs(entry.rightGap)).toBeLessThanOrEqual(1);
    }
  }

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await fits(page, dialog);
    await alignedPaymentAmounts();
  }
  await page.screenshot({
    path: info.outputPath('receipt-discount-split-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ media: 'print' });
  await expect(receipt).toBeVisible();
  expect(await receipt.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await alignedPaymentAmounts();
  await page.screenshot({
    path: info.outputPath('receipt-discount-print.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(f.errors).toEqual([]);
});

test('a canceled discounted dish is zero and the already-returned amount is shown separately', async ({
  page,
}) => {
  const f = await mock(page);
  f.bill.billing!.promotion!.locked = true;
  f.bill.charges[0]!.status = 'REVERSED';
  f.bill.charges[0]!.item_status = 'CANCELLED';
  f.bill.billing!.lines[0] = {
    ...f.bill.billing!.lines[0]!,
    grossAmount: '0',
    discountAmount: '0',
    payableAmount: '0',
    beforeVatAmount: '0',
    vatAmount: '0',
  };
  f.bill.billing!.subtotalAmount = '207000';
  f.bill.billing!.discountAmount = '10800';
  f.bill.billing!.payableAmount = '196200';
  f.bill.billing!.beforeVatAmount = '180031';
  f.bill.billing!.vatAmount = '16169';
  f.bill.billing!.vatGroups = [
    {
      treatment: 'TAXABLE',
      ratePercent: 8,
      beforeVatAmount: '91667',
      vatAmount: '7333',
      totalAmount: '99000',
    },
    {
      treatment: 'TAXABLE',
      ratePercent: 10,
      beforeVatAmount: '88364',
      vatAmount: '8836',
      totalAmount: '97200',
    },
  ];
  f.bill.account.charge_total = '196200';
  f.bill.account.paid_total = '240300';
  f.bill.account.refunded_total = '44100';
  f.bill.account.outstanding_amount = '0';
  f.bill.refundTransactions.push({
    id: 'refund',
    method: 'CASH',
    amount: '44100',
    processed_at: at,
    processed_by_name: 'Nhân viên phục vụ',
  });
  const dialog = await staffPayment(page);
  await dialog.getByRole('button', { name: 'Phiếu thường' }).click();
  const receipt = dialog.locator('.receipt-sheet');
  const canceled = receipt.locator('.receipt-row').filter({ hasText: name });
  await expect(canceled.locator(':scope > strong')).toHaveText('0 đ');
  await expect(canceled).not.toContainText('Khuyến mãi');
  await expect(receipt.locator('.receipt-totals')).toContainText('196.200 đ');
  await expect(receipt.locator('.receipt-money-breakdown')).toContainText('Đã hoàn lại khách');
  await expect(receipt).toContainText('44.100 đ');
  await fits(page, dialog);
  expect(f.errors).toEqual([]);
});

test('empty orders and a legacy closed receipt do not manufacture tax details', async ({
  page,
}) => {
  const f = await mock(page);
  f.noPrograms();
  f.bill.charges.splice(0);
  f.bill.billing = undefined;
  f.bill.account.charge_total = '0';
  f.bill.account.outstanding_amount = '0';
  await guestPayment(page);
  await page.getByText('Ưu đãi và điều kiện áp dụng (0)', { exact: true }).click();
  await expect(page.locator('.promotion-available')).toContainText('chưa có chương trình');
  await fits(page);
  f.bill.session.session_status = 'CLOSED';
  const dialog = await staffPayment(page);
  const receipt = dialog.locator('.receipt-sheet');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('PHIẾU THANH TOÁN');
  await expect(receipt).toContainText('chưa có thông tin VAT');
  await expect(receipt).not.toContainText('VAT 8%');
  await expect(dialog.getByRole('region', { name: 'Khuyến mãi của bàn' })).toHaveCount(0);
  await fits(page, dialog);
  expect(f.errors).toEqual([]);
});

test('a pending collection temporarily blocks promotion changes without claiming payment has succeeded', async ({
  page,
}) => {
  const f = await mock(page);
  f.bill.intents.push({
    id: 'pending',
    status: 'PENDING',
    amount: '240300',
    method: 'CASH',
    expires_at: '2099-01-01T00:00:00Z',
  });
  await guestPayment(page);
  const promotion = page.getByRole('region', { name: 'Khuyến mãi của bàn' });
  await expect(promotion).toContainText('Tạm khóa');
  await expect(promotion).toContainText('khoản thu chờ xác nhận');
  await expect(promotion).not.toContainText('Bàn đã bắt đầu thanh toán');
  await expect(promotion.getByLabel('Mã khuyến mãi')).toHaveCount(0);
  await expect(promotion.getByRole('button', { name: 'Bỏ ưu đãi' })).toHaveCount(0);
  f.bill.intents.splice(0);
  await expect(promotion.getByLabel('Mã khuyến mãi')).toBeVisible({ timeout: 7000 });
  await expect(promotion).not.toContainText('Tạm khóa');
  await fits(page);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
