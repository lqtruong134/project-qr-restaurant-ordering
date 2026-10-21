import { test, expect, type Page } from '@playwright/test';
import type { PayosStatus } from '../../packages/contracts/src/payments-online';
const sid = 'ffc78214-0000-4000-8000-000000000001';
const at = '2026-10-19T03:00:00Z';
test.use({ actionTimeout: 10000 });
async function fixture(page: Page, additionalPages: Page[] = []) {
  const pages = [page, ...additionalPages];
  for (const tab of pages) await tab.clock.install();
  const reads: string[] = [],
    writes: string[] = [],
    errors: string[] = [];
  let failRead = false,
    failRecovery = false;
  let state = {
    bill: 69000n,
    quote: 5000n,
    bank: 0n,
    recorded: 0n,
    applied: 0n,
    refund: 0n,
    status: 'PENDING' as PayosStatus,
  };
  for (const tab of pages) tab.on('pageerror', (error) => errors.push(error.message));
  const snapshot = () => {
    const outstanding = state.bill - state.applied;
    const pending = ['PENDING', 'UNDERPAID', 'PROCESSING', 'CREATE_PENDING', 'ERROR'].includes(
      state.status,
    );
    const reserved =
      pending || state.status === 'REQUIRES_RECONCILIATION'
        ? state.quote > state.recorded
          ? state.quote - state.recorded
          : 0n
        : 0n;
    const available = outstanding > reserved ? outstanding - reserved : 0n;
    const financialSummary = {
      billTotal: String(state.bill),
      bankReportedAmount: String(state.bank),
      recordedAmount: String(state.recorded),
      appliedAmount: String(state.applied),
      outstandingAmount: String(outstanding),
      pendingOnlineAmount: String(reserved),
      reservedAmount: String(reserved),
      availableToCollect: String(available),
      unallocatedAmount: String(state.refund),
      refundDueAmount: String(state.refund),
      refundedAmount: '0',
      reviewRequired: state.status === 'REQUIRES_RECONCILIATION',
    };
    const collectionAvailability = {
      outstandingAmount: String(outstanding),
      reservedAmount: String(reserved),
      availableAmount: String(available),
      blockedReason:
        state.status === 'REQUIRES_RECONCILIATION'
          ? 'Khoản chuyển đang cần quản trị kiểm tra. Không thu lại cùng khoản này.'
          : null,
      participants: [
        {
          participantId: 'guest',
          outstandingAmount: String(outstanding),
          reservedAmount: '0',
          availableAmount: String(available),
        },
      ],
    };
    const account = {
      id: 'account',
      charge_total: String(state.bill),
      paid_total: String(state.recorded),
      refunded_total: '0',
      outstanding_amount: String(outstanding),
      refund_due_amount: String(state.refund),
      reserved_payment_amount: String(reserved),
    };
    const intent = {
      id: 'intent',
      method: 'ONLINE',
      amount: String(state.quote),
      status: state.status === 'PAID' ? 'SUCCEEDED' : 'PENDING',
      created_at: at,
      expires_at: new Date(Date.now() + 900000).toISOString(),
      collection_scope: 'TABLE',
      online: {
        provider: 'PAYOS',
        status: state.status,
        orderCode: '500000001',
        checkoutUrl: 'https://pay.payos.vn/web/fixture-only',
        qrCode: '00020101021226060000TEST',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        lastError:
          state.status === 'REQUIRES_RECONCILIATION' ? 'RECIPIENT_MISMATCH_PRIVATE_DETAIL' : null,
        paidAmount: String(state.bank),
        bankReportedAmount: String(state.bank),
        recordedAmount: String(state.recorded),
        appliedAmount: String(state.applied),
        refundedAmount: '0',
        unallocatedAmount: String(state.refund),
        remainingAmount: String(state.quote > state.recorded ? state.quote - state.recorded : 0n),
      },
    };
    const payments = state.recorded
      ? [
          {
            id: 'receipt',
            payment_intent_id: 'intent',
            method: 'ONLINE',
            provider: 'PAYOS',
            status: 'SUCCEEDED',
            amount: String(state.recorded),
            allocated_amount: String(state.applied),
            refunded_amount: '0',
            refundable_amount: String(state.refund),
            pending_refund_amount: '0',
            available_refund_amount: String(state.refund),
            refund_context_kind: 'UNAPPLIED_PAYMENT',
            confirmed_at: at,
          },
        ]
      : [];
    const bill = {
      session: { id: sid, session_status: 'ACTIVE', table_code: 'A01', opened_at: at },
      billing: {
        version: 1,
        priceIncludesVat: true,
        subtotalAmount: String(state.bill),
        discountAmount: '0',
        payableAmount: String(state.bill),
        beforeVatAmount: String(state.bill),
        vatAmount: '0',
        vatGroups: [],
        promotion: null,
        lines: [],
        legacyTaxUnavailable: false,
      },
      account,
      financialSummary,
      collectionAvailability,
      charges: [
        {
          id: 'charge',
          order_item_id: 'item',
          owner_participant_id: 'guest',
          owner_name: 'Lan',
          amount: String(state.bill),
          net_amount: String(state.bill),
          quantity: 1,
          status: 'ACTIVE',
          item_status: 'SERVED',
          unpaid_amount: String(outstanding),
          product_name_snapshot: 'Cơm trưa',
          unit_price_snapshot: String(state.bill),
        },
      ],
      intents: [intent],
      payments,
      refunds: [],
      refundTransactions: [],
      paymentRequests: [],
      participants: [{ id: 'guest', display_name: 'Lan' }],
      store: { name: 'QTruongRes', timezone: 'Asia/Ho_Chi_Minh' },
      generatedAt: at,
      closedBy: null,
      paymentCapabilities: { online: true },
      closure: { canClose: false, blockers: [] },
    };
    return {
      bill,
      account,
      financialSummary,
      collectionAvailability,
      intent,
      payments,
      outstanding,
    };
  };
  for (const page of pages) {
    await page.route('**/api/workspaces/**', (route) =>
      route.fulfill({
        json: { user: { id: 'staff', displayName: 'Nhân viên', role: 'STAFF', permissions: [] } },
      }),
    );
    await page.route('**/api/core/**', (route) => {
      const path = new URL(route.request().url()).pathname,
        current = snapshot();
      if (route.request().method() !== 'GET') {
        writes.push(path);
        if (path.endsWith('/refresh') && failRecovery)
          return route.fulfill({
            status: 503,
            json: {
              errorCode: 'PAYOS_UNAVAILABLE',
              userMessage: 'Ngân hàng chưa phản hồi. Hệ thống tiếp tục tự kiểm tra.',
            },
          });
        throw Error('Unexpected financial mutation: ' + path);
      }
      reads.push(path);
      if (path.endsWith('/bill'))
        return failRead
          ? route.fulfill({ status: 503, json: { userMessage: 'Kết nối tạm gián đoạn.' } })
          : route.fulfill({ json: current.bill });
      if (path.endsWith('/tables'))
        return route.fulfill({
          json: [
            {
              id: 'table',
              code: 'A01',
              name: 'A01',
              table_status: 'OCCUPIED',
              session_id: sid,
              session_status: 'ACTIVE',
              area_name: 'Trong nhà',
              area_id: 'area',
              capacity: 4,
              verification_status: 'VERIFIED',
              opened_at: at,
              outstanding_amount: String(current.outstanding),
              charge_total: String(state.bill),
              pending_payments: 1,
              pending_manual_payments: 0,
              pending_online_payments: 1,
            },
          ],
        });
      if (path.endsWith('/catalog'))
        return route.fulfill({ json: { products: [], categories: [] } });
      if (path.endsWith('/promotion'))
        return route.fulfill({
          json: { billing: current.bill.billing, programs: [], locked: true },
        });
      if (path.endsWith('/alerts'))
        return route.fulfill({
          json: [
            {
              id: 'technical',
              session_id: sid,
              table_id: 'table',
              table_code: 'A01',
              alert_type: 'OTHER',
              status: 'NEW',
              payment_reconciliation: true,
              requires_admin: false,
              outstanding_amount: '0',
              created_at: at,
            },
          ],
        });
      return route.fulfill({ json: [] });
    });
    await page.route('**/api/guest/**', (route) => {
      const path = new URL(route.request().url()).pathname,
        current = snapshot();
      if (route.request().method() !== 'GET') {
        writes.push(path);
        throw Error('Guest must not mutate payments');
      }
      reads.push(path);
      if (path.endsWith('/state'))
        return route.fulfill({
          json: {
            participant: { id: 'guest', displayName: 'Lan' },
            participants: current.bill.participants,
            session: {
              ...current.bill.session,
              table_name: 'A01',
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
                owner_participant_id: 'guest',
                status: 'ACCEPTED',
                item_status: 'SERVED',
                charge_status: 'ACTIVE',
                product_name_snapshot: 'Cơm trưa',
                line_total: String(state.bill),
                net_amount: String(state.bill),
                original_amount: String(state.bill),
                paid_amount: String(state.applied),
                quantity: 1,
                unit_price_snapshot: String(state.bill),
                created_at: at,
              },
            ],
            billing: current.bill.billing,
            account: current.account,
            financialSummary: current.financialSummary,
            collectionAvailability: current.collectionAvailability,
            support: [],
            payments: current.payments,
            refundTransactions: [],
            onlinePayments: [
              {
                id: 'opaque',
                scope: 'TABLE',
                amount: String(state.quote),
                status: state.status,
                paidAmount: String(state.recorded),
                bankConfirmedAmount: String(state.bank),
                appliedAmount: String(state.applied),
                refundedAmount: '0',
                refundableAmount: String(state.refund),
                remainingAmount: current.intent.online.remainingAmount,
                createdAt: at,
                expiresAt: current.intent.online.expiresAt,
              },
            ],
          },
        });
      if (path.endsWith('/promotion'))
        return route.fulfill({
          json: { billing: current.bill.billing, programs: [], locked: true },
        });
      return route.fulfill({ json: null });
    });
  }
  return {
    reads,
    writes,
    errors,
    snapshot,
    change: (values: Partial<typeof state>) => {
      state = { ...state, ...values };
    },
    failReads: (value: boolean) => {
      failRead = value;
    },
    failRecovery: () => {
      failRecovery = true;
    },
  };
}
async function staff(page: Page) {
  await page.goto('/workspace/staff');
  await page
    .locator('.table-tile')
    .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Khoản thu online' })).toBeVisible();
  return dialog;
}
async function guest(page: Page) {
  await page.goto('/guest');
  await page
    .getByRole('navigation', { name: 'Điều hướng khách' })
    .getByRole('button', { name: 'Thanh toán', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Trạng thái thanh toán online' })).toBeVisible();
}
async function pause(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.waitForLoadState('networkidle');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test('a pending 5k QR reserves capacity but keeps 69k owed for table and participant scopes', async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await staff(page);
  await expect(
    dialog
      .locator('.bill-balance-grid > div')
      .filter({ hasText: 'Đã tính vào tiền món' })
      .locator('strong'),
  ).toHaveText('0 đ');
  await expect(
    dialog
      .locator('.bill-balance-grid > div')
      .filter({ hasText: 'Còn phải thanh toán' })
      .locator('strong'),
  ).toHaveText('69.000 đ');
  await expect(
    dialog
      .locator('.amount-choices[aria-label="Chọn phần tiền thanh toán"]')
      .getByRole('button', { name: /Cả bàn/ }),
  ).toContainText('69.000 đ');
  const availability = dialog.getByLabel('Số tiền còn thu và khoản đang chờ', { exact: true });
  await expect(availability).toContainText('64.000 đ');
  await expect(availability).toContainText('5.000 đ');
  await dialog
    .locator('.amount-choices')
    .getByRole('button', { name: /Món của một khách/ })
    .click();
  await expect(availability).toContainText('69.000 đ');
  await expect(availability).toContainText('64.000 đ');
  await expect(dialog.getByText('Kiểm tra giao dịch', { exact: true })).toHaveCount(0);
  const card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card.getByRole('img')).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Kiểm tra trạng thái', exact: true }),
  ).not.toBeVisible();
  await noOverflow(page);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('staff automatically sees committed 5k success and 64k remaining, with a status replacing QR', async ({
  page,
}, info) => {
  const f = await fixture(page),
    dialog = await staff(page);
  await pause(page);
  f.change({ bank: 5000n, status: 'PROCESSING' });
  await page.clock.runFor(3500);
  await expect(dialog).toContainText('Ngân hàng đang xử lý thanh toán');
  await expect(dialog.locator('.bill-balance-grid')).toContainText('69.000 đ');
  await expect(dialog.getByText('Thanh toán thành công', { exact: true })).toHaveCount(0);
  f.change({ recorded: 5000n, applied: 5000n, status: 'PAID' });
  await page.clock.runFor(3500);
  await expect(dialog.getByRole('region', { name: 'Khoản thu online' })).toContainText(
    'Thanh toán thành công',
  );
  await expect(
    dialog
      .locator('.bill-balance-grid > div')
      .filter({ hasText: 'Còn phải thanh toán' })
      .locator('strong'),
  ).toHaveText('64.000 đ');
  await expect(
    dialog
      .locator('.bill-balance-grid > div')
      .filter({ hasText: 'Đã tính vào tiền món' })
      .locator('strong'),
  ).toHaveText('5.000 đ');
  await expect(page.getByText(/Thanh toán thành công — Đã nhận 5.000 đ qua payOS/)).toBeVisible();
  await expect(
    dialog.getByRole('region', { name: 'Khoản thu online' }).getByRole('img'),
  ).toHaveCount(0);
  if (info.project.name === 'desktop') {
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page);
      await dialog.locator('.bill-balance-grid').screenshot({
        path: info.outputPath('staff-confirmed-summary-' + width + '.png'),
        animations: 'disabled',
      });
      await dialog.getByRole('region', { name: 'Khoản thu online' }).screenshot({
        path: info.outputPath('staff-confirmed-payment-' + width + '.png'),
        animations: 'disabled',
      });
    }
  }
  expect(f.snapshot().payments).toHaveLength(1);
  expect(f.snapshot().payments[0]!.allocated_amount).toBe('5000');
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('guest automatically receives the same committed success and never pays again while verification is pending', async ({
  page,
}, info) => {
  const f = await fixture(page);
  await guest(page);
  await pause(page);
  f.change({ bank: 5000n, status: 'PROCESSING' });
  await page.clock.runFor(3500);
  const online = page.getByRole('region', { name: 'Trạng thái thanh toán online' });
  await expect(online).toContainText('không chuyển lại cùng khoản tiền');
  await expect(online).not.toContainText('Thanh toán thành công');
  f.change({ recorded: 5000n, applied: 5000n, status: 'PAID' });
  await page.clock.runFor(3500);
  await expect(online).toContainText('Thanh toán thành công');
  await expect(
    page
      .locator('.guest-content > .core-card > .core-stats > p')
      .filter({ hasText: 'Còn phải thanh toán' })
      .locator('strong'),
  ).toHaveText('64.000 đ');
  await expect(page.getByText(/Thanh toán thành công — Nhà hàng đã nhận 5.000 đ/)).toBeVisible();
  if (info.project.name === 'desktop') {
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page);
      await page.locator('.guest-content > .core-card > .core-stats').screenshot({
        path: info.outputPath('guest-confirmed-summary-' + width + '.png'),
        animations: 'disabled',
      });
      await online.screenshot({
        path: info.outputPath('guest-confirmed-payment-' + width + '.png'),
        animations: 'disabled',
      });
    }
  }
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('real recipient review stays unpaid and visible without a staff accounting form or technical error leak', async ({
  page,
}) => {
  const f = await fixture(page);
  f.change({ bank: 5000n, status: 'REQUIRES_RECONCILIATION' });
  const dialog = await staff(page),
    card = dialog.getByRole('region', { name: 'Khoản thu online' });
  await expect(card).toContainText('Quản trị đang kiểm tra khoản chuyển');
  await expect(card).toContainText('Không thu lại');
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(dialog).not.toContainText('RECIPIENT_MISMATCH_PRIVATE_DETAIL');
  await expect(dialog.getByRole('textbox', { name: 'Nội dung đã xử lý', exact: true })).toHaveCount(
    0,
  );
  await expect(dialog.locator('.bill-balance-grid')).toContainText('69.000 đ');
  await guest(page);
  await expect(page.getByRole('region', { name: 'Trạng thái thanh toán online' })).toContainText(
    'Ngân hàng đã ghi nhận giao dịch 5.000 đ',
  );
  await expect(
    page.getByRole('region', { name: 'Trạng thái thanh toán online' }),
  ).not.toContainText('Thanh toán thành công');
  await noOverflow(page);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('overpaid partial quote keeps 10k outstanding and 2k refundable with no automatic extra charge', async ({
  page,
}) => {
  const f = await fixture(page);
  f.change({
    bill: 20000n,
    quote: 10000n,
    bank: 12000n,
    recorded: 12000n,
    applied: 10000n,
    refund: 2000n,
    status: 'REQUIRES_RECONCILIATION',
  });
  const dialog = await staff(page);
  for (const [label, amount] of [
    ['Đã nhận (trước hoàn)', '12.000 đ'],
    ['Đã tính vào tiền món', '10.000 đ'],
    ['Còn phải thanh toán', '10.000 đ'],
    ['Cần hoàn lại khách', '2.000 đ'],
  ])
    await expect(
      dialog.locator('.bill-balance-grid > div').filter({ hasText: label! }).locator('strong'),
    ).toHaveText(amount!);
  await expect(dialog.getByRole('region', { name: 'Khoản thu online' })).toContainText(
    'chưa tự bù',
  );
  await noOverflow(page);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('hidden/offline payment reads pause and foreground reconnect coalesces into a fresh committed read', async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await staff(page);
  await pause(page);
  const before = f.reads.filter((path) => path.endsWith('/bill')).length;
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
  });
  await page.clock.runFor(15000);
  expect(f.reads.filter((path) => path.endsWith('/bill'))).toHaveLength(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(15000);
  expect(f.reads.filter((path) => path.endsWith('/bill'))).toHaveLength(before);
  f.change({ bank: 5000n, recorded: 5000n, applied: 5000n, status: 'PAID' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(dialog.locator('.bill-balance-grid')).toContainText('64.000 đ');
  expect(f.reads.filter((path) => path.endsWith('/bill'))).toHaveLength(before + 1);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('two real staff and guest tabs share one verified payment without duplicate collection or money', async ({
  page,
  context,
}) => {
  const guestTab = await context.newPage();
  try {
    const f = await fixture(page, [guestTab]);
    const dialog = await staff(page);
    await pause(page);
    await guest(guestTab);
    await pause(guestTab);
    const staffCard = dialog.getByRole('region', { name: 'Khoản thu online' });
    const guestCard = guestTab.getByRole('region', { name: 'Trạng thái thanh toán online' });
    const staffMoney = (label: string) =>
      dialog.locator('.bill-balance-grid > div').filter({ hasText: label }).locator('strong');
    const guestMoney = (label: string) =>
      guestTab
        .locator('.guest-content > .core-card > .core-stats > p')
        .filter({ hasText: label })
        .locator('strong');
    await expect(staffCard.getByRole('img')).toBeVisible();
    await expect(guestCard).toContainText('Đang chờ thanh toán online');
    await expect(staffMoney('Còn phải thanh toán')).toHaveText('69.000 đ');
    await expect(guestMoney('Còn phải thanh toán')).toHaveText('69.000 đ');

    // A bank report is not a posted receipt. Each actual tab reads the same uncommitted state.
    f.change({ bank: 5000n, status: 'PROCESSING' });
    const staffBefore = f.reads.filter((path) => path.endsWith('/bill')).length;
    await page.bringToFront();
    await page.clock.runFor(3500);
    await expect(staffCard).toContainText('Ngân hàng đang xử lý thanh toán');
    await expect(staffMoney('Đã tính vào tiền món')).toHaveText('0 đ');
    await expect(staffMoney('Còn phải thanh toán')).toHaveText('69.000 đ');
    expect(f.reads.filter((path) => path.endsWith('/bill')).length).toBeGreaterThan(staffBefore);
    const guestBefore = f.reads.filter((path) => path.endsWith('/state')).length;
    await guestTab.bringToFront();
    await guestTab.clock.runFor(3500);
    await expect(guestCard).not.toContainText('Thanh toán thành công');
    await expect(guestMoney('Đã tính vào tiền món')).toHaveText('0 đ');
    await expect(guestMoney('Còn phải thanh toán')).toHaveText('69.000 đ');
    expect(f.reads.filter((path) => path.endsWith('/state')).length).toBeGreaterThan(guestBefore);
    expect(f.snapshot().payments).toHaveLength(0);

    // Only the verified server snapshot posts the receipt. No manual reload or capture is clicked.
    f.change({ recorded: 5000n, applied: 5000n, status: 'PAID' });
    await guestTab.clock.runFor(3500);
    await expect(guestCard).toContainText('Thanh toán thành công');
    await expect(guestMoney('Đã tính vào tiền món')).toHaveText('5.000 đ');
    await expect(guestMoney('Còn phải thanh toán')).toHaveText('64.000 đ');
    await page.bringToFront();
    await page.clock.runFor(3500);
    await expect(staffCard).toContainText('Thanh toán thành công');
    await expect(staffCard.getByRole('img')).toHaveCount(0);
    await expect(staffMoney('Đã tính vào tiền món')).toHaveText('5.000 đ');
    await expect(staffMoney('Còn phải thanh toán')).toHaveText('64.000 đ');

    // Repeated foreground/reconnect reads in both tabs must not create or capture another payment.
    for (const tab of [guestTab, page]) {
      await tab.bringToFront();
      await tab.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      await tab.clock.runFor(3500);
      await noOverflow(tab);
    }
    await expect(staffCard).toHaveCount(1);
    await expect(guestCard).toHaveCount(1);
    await expect(staffMoney('Đã tính vào tiền món')).toHaveText('5.000 đ');
    await expect(guestMoney('Đã tính vào tiền món')).toHaveText('5.000 đ');
    expect(f.snapshot().payments).toHaveLength(1);
    expect(f.snapshot().payments[0]).toMatchObject({
      id: 'receipt',
      amount: '5000',
      allocated_amount: '5000',
    });
    expect(f.snapshot().account).toMatchObject({ paid_total: '5000', outstanding_amount: '64000' });
    expect(f.writes).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await guestTab.close();
  }
});
