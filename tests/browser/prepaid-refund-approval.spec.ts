import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
import { browserTableCode } from './table-code-fixture';

type Entity = { id: string };
type Bill = {
  account: {
    charge_total: string;
    paid_total: string;
    refunded_total: string;
    outstanding_amount: string;
    refund_due_amount: string;
  };
  payments: (Entity & {
    amount: string;
    metadata: { cashReceived: string; changeGiven: string };
  })[];
  refunds: (Entity & { approved_at: string; approval_required: boolean })[];
};

type UnavailableHistoryRecord = Entity & {
  guest_notified: boolean;
  refund_history: {
    scope: 'ITEM' | 'SHARED_SESSION' | 'SESSION' | 'NONE';
    amount: string | null;
    refunded_amount: string | null;
    remaining_amount: string | null;
    cases: { related_item_ids: string[] }[];
  };
};

async function login(page: Page, username: string, role: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}

async function get<T>(page: Page, route: string): Promise<T> {
  const response = await page.request.get('/api' + route);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

async function post<T>(page: Page, route: string, data: unknown): Promise<T> {
  const response = await page.request.post('/api' + route, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

test('prepaid cancellation separates guest notice, admin approval, cash change and actual refund', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(170000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, kitchen, guest] = (await Promise.all(contexts.map((c) => c.newPage()))) as [
    Page,
    Page,
    Page,
    Page,
  ];
  const errors: string[] = [];
  for (const page of [admin, staff, kitchen, guest]) {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  }
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv007', 'staff');
    await login(kitchen, 'bep003', 'kitchen');
    const code = 'PREPAY-' + randomUUID().slice(0, 8);
    const name = 'Món trả trước ' + code;
    const areas = await get<Entity[]>(admin, '/core/areas');
    const catalog = await get<{ categories: Entity[] }>(admin, '/core/catalog');
    const product = await post<Entity>(admin, '/core/products', {
      code,
      name,
      categoryId: catalog.categories[0]!.id,
      price: '49000',
      stockManaged: false,
      complimentary: false,
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
    await guest.getByLabel('Tên của bạn').fill('Khách trả trước');
    await guest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      guest.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
    type GuestState = {
      session: Entity;
      cart: { cart_version: number };
      items: Entity[];
    };
    let state = await get<GuestState>(guest, '/guest/state');
    await post(guest, '/guest/cart', {
      productId: product.id,
      quantity: 1,
      cartVersion: state.cart.cart_version,
    });
    state = await get<GuestState>(guest, '/guest/state');
    const sessionId = state.session.id;
    const batch = await post<Entity>(guest, '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: state.cart.cart_version,
      itemIds: state.items.map((item) => item.id),
    });
    const orders = await get<(Entity & { status: string; items: Entity[] })[]>(
      staff,
      '/core/orders',
    );
    const order = orders.find((row) => row.id === batch.id)!;
    if (order.status === 'PENDING_REVIEW')
      await post(staff, '/core/orders/' + batch.id + '/review', { approve: true });
    const item = order.items[0]!;
    const payment = await post<Entity>(staff, '/core/sessions/' + sessionId + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '49000',
    });
    await post(staff, '/core/payments/' + payment.id + '/confirm', {
      amount: '49000',
      receivedAmount: '100000',
    });
    const paid = await get<Bill>(staff, '/core/sessions/' + sessionId + '/bill');
    expect(paid.account.paid_total).toBe('49000');
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]!.metadata).toMatchObject({
      cashReceived: '100000',
      changeGiven: '51000',
    });
    await post(
      staff,
      '/core/payment-transactions/' + paid.payments[0]!.id + '/change-returned',
      {},
    );
    await post(kitchen, '/core/items/' + item.id + '/accept', {});
    await post(kitchen, '/core/items/' + item.id + '/unavailable', {
      reasonCode: 'OUT_OF_STOCK',
    });
    const cancelled = await get<Bill>(staff, '/core/sessions/' + sessionId + '/bill');
    expect(cancelled.account).toMatchObject({
      charge_total: '0',
      paid_total: '49000',
      refunded_total: '0',
      refund_due_amount: '49000',
    });
    expect(cancelled.refunds).toHaveLength(0);
    const unapprovedHistory = await get<{ rows: UnavailableHistoryRecord[] }>(
      admin,
      '/core/history/order-unavailable?period=all&itemId=' + item.id,
    );
    expect(unapprovedHistory.rows).toHaveLength(1);
    expect(unapprovedHistory.rows[0]!.refund_history).toMatchObject({
      scope: 'NONE',
      refunded_amount: '0',
      cases: [],
    });
    const forbidden = await staff.request.post('/api/core/sessions/' + sessionId + '/refunds', {
      headers: { origin: new URL(staff.url()).origin, 'x-csrf-protection': '1' },
      data: {
        requestId: randomUUID(),
        paymentId: paid.payments[0]!.id,
        amount: '49000',
        useDecisionReason: true,
      },
    });
    expect(forbidden.status()).toBe(403);

    // Until an administrator approves a document, serving staff only need to inform the guest.
    await staff.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await staff
      .locator('.table-tile')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
      .click();
    const dialog = staff.getByRole('dialog', { name: 'Chi tiết - ' + code, exact: true });
    await dialog.getByRole('button', { name: 'Việc tại bàn', exact: true }).click();
    await expect(dialog.locator('.dish-guest-task')).toHaveCount(1);
    await expect(
      dialog.getByRole('button', { name: 'Mở xác nhận hoàn tiền', exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Đã trao đổi với khách tại bàn', exact: true })
      .click();
    await expect(dialog.locator('.dish-guest-task')).toHaveCount(0);
    await expect(dialog.locator('.alert-card')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    const staffRefund = dialog.getByRole('region', { name: 'Hoàn tiền cho khách', exact: true });
    await expect(staffRefund).toContainText('Khoản hoàn đang chờ quản trị duyệt');
    await expect(staffRefund.locator('form')).toHaveCount(0);
    await staff.screenshot({
      path: info.outputPath('prepaid-staff-awaiting-admin.png'),
      scale: 'css',
    });
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await staff
      .getByRole('navigation', { name: 'Người phụ trách công việc' })
      .getByRole('button', { name: /Việc chung/ })
      .click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await expect(staff.locator('.queue-table-card[data-table-id="' + table.id + '"]')).toHaveCount(
      0,
    );

    await admin
      .getByRole('navigation', { name: 'Quản trị', exact: true })
      .getByRole('button', { name: 'Tải lại dữ liệu', exact: true })
      .click();
    await selectAdmin(admin, 'Việc cần xử lý', 'Món & nguyên liệu');
    await admin.getByRole('textbox', { name: 'Tìm bàn, món hoặc mã phiên…' }).fill(code);
    const incident = admin.locator('.inbox-case').filter({ hasText: code });
    await expect(incident).toHaveCount(1);
    await incident
      .getByRole('button', { name: 'Kiểm tra kho & khả năng phục vụ', exact: true })
      .click();
    const inspection = admin.getByRole('dialog', {
      name: 'Kiểm tra nguyên liệu - Bàn ' + code,
      exact: true,
    });
    const facts = inspection.getByRole('region', { name: 'Thanh toán cả bàn', exact: true });
    await expect(facts.locator('.billing-payable dd')).toHaveText('0 đ');
    for (const [label, amount] of [
      ['Đã thanh toán (sau hoàn)', '49.000 đ'],
      ['Còn phải thanh toán', '0 đ'],
      ['Còn chờ hoàn tiền món', '49.000 đ'],
    ]) {
      await expect(
        facts
          .locator('.inbox-facts > div')
          .filter({ has: admin.getByText(label!, { exact: true }) })
          .locator('dd'),
      ).toHaveText(amount!);
    }
    await admin.screenshot({
      path: info.outputPath('prepaid-admin-refund-required.png'),
      scale: 'css',
    });
    await inspection.getByRole('button', { name: 'Kiểm tra & hoàn tiền', exact: true }).click();
    const refundDialog = admin.getByRole('dialog', {
      name: 'Hoàn tiền - Bàn ' + code,
      exact: true,
    });
    const create = refundDialog.locator('form').filter({
      has: admin.getByRole('heading', { name: 'Lập hồ sơ hoàn tiền', exact: true }),
    });
    await expect(create.locator('input[name="amount"]')).toHaveValue('49000');
    await create.getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true }).click();
    await admin
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true })
      .click();
    await expect(create).toHaveCount(0);
    const approved = await get<Bill>(admin, '/core/sessions/' + sessionId + '/bill');
    expect(approved.refunds).toHaveLength(1);
    expect(approved.refunds[0]!.approved_at).toBeTruthy();
    expect(approved.refunds[0]!.approval_required).toBe(false);
    expect(approved.account.refunded_total).toBe('0');
    const approvedHistory = await get<{ rows: UnavailableHistoryRecord[] }>(
      admin,
      '/core/history/order-unavailable?period=all&itemId=' + item.id,
    );
    expect(approvedHistory.rows).toHaveLength(1);
    expect(approvedHistory.rows[0]!.refund_history).toMatchObject({
      scope: 'ITEM',
      amount: '49000',
      refunded_amount: '0',
      remaining_amount: '49000',
    });
    await expect(
      refundDialog.getByRole('button', { name: 'Xác nhận đã hoàn', exact: true }),
    ).toHaveCount(0);
    await expect(
      refundDialog.getByRole('button', { name: 'Đã hoàn tiền cho khách', exact: true }),
    ).toHaveCount(0);
    await expect(
      refundDialog.getByRole('heading', { name: 'Đã chuyển cho nhân viên hoàn tiền', exact: true }),
    ).toBeVisible();
    await expect(refundDialog.locator('form')).toHaveCount(0);
    const forbiddenComplete = await admin.request.post(
      '/api/core/refunds/' + approved.refunds[0]!.id + '/complete',
      {
        headers: { origin: new URL(admin.url()).origin, 'x-csrf-protection': '1' },
        data: { method: 'CASH', amount: '49000', requestId: randomUUID() },
      },
    );
    expect(forbiddenComplete.status()).toBe(403);
    await admin.screenshot({
      path: info.outputPath('admin-refund-waiting-for-staff.png'),
      scale: 'css',
    });

    // A real refund job appears only now; creating its document did not itself return any cash.
    await expect(
      staff.locator('.queue-table-card[data-table-id="' + table.id + '"]'),
    ).toContainText('Cần hoàn tiền');
    await staff
      .locator('.queue-table-card[data-table-id="' + table.id + '"]')
      .getByRole('button', { name: 'Chi tiết bàn', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Việc tại bàn', exact: true }).click();
    await expect(dialog.locator('.dish-guest-task')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Mở xác nhận hoàn tiền', exact: true }).click();
    const complete = staffRefund.locator('form').filter({
      has: staff.getByRole('heading', { name: 'Còn phải hoàn 49.000 đ', exact: true }),
    });
    await expect(complete.locator('input[name="amount"]')).toHaveValue('49000');
    await expect(complete).toContainText('Quản trị đã duyệt');
    await expect(complete.locator('input[name="reference"]')).toHaveCount(0);
    await complete.locator('select[name="method"]').selectOption('BANK_TRANSFER');
    await expect(
      complete.getByRole('textbox', { name: 'Mã giao dịch chuyển khoản', exact: true }),
    ).toHaveAttribute('required', '');
    await complete.locator('select[name="method"]').selectOption('CASH');
    await expect(complete.locator('input[name="reference"]')).toHaveCount(0);

    await complete.getByRole('button', { name: 'Đã hoàn tiền cho khách', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(complete).toHaveCount(0);
    await expect
      .poll(async () => (await get<Bill>(staff, '/core/sessions/' + sessionId + '/bill')).account)
      .toMatchObject({
        charge_total: '0',
        paid_total: '49000',
        refunded_total: '49000',
        refund_due_amount: '0',
      });

    await expect(refundDialog.locator('.admin-approved-refund')).toHaveCount(0);
    await expect(
      refundDialog
        .locator('.bill-balance-grid > div')
        .filter({ hasText: 'Đã thanh toán (sau hoàn)' })
        .locator('strong'),
    ).toHaveText('0 đ');

    const standard = dialog.getByRole('button', { name: 'Phiếu thường', exact: true });
    const detailed = dialog.getByRole('button', {
      name: 'Phiếu chi tiết theo người gọi',
      exact: true,
    });
    const receipt = dialog.getByRole('region', { name: 'Phiếu thanh toán', exact: true });
    await expect(receipt).not.toBeVisible();
    await standard.click();
    await expect(receipt).toBeVisible();
    await expect(standard).toHaveAttribute('aria-expanded', 'true');
    await standard.click();
    await expect(receipt).not.toBeVisible();
    await detailed.click();
    await expect(receipt).toBeVisible();
    await expect(detailed).toHaveAttribute('aria-expanded', 'true');
    await standard.click();
    await expect(receipt).toBeVisible();
    await expect(standard).toHaveAttribute('aria-expanded', 'true');
    await expect(detailed).toHaveAttribute('aria-expanded', 'false');
    await standard.click();
    await expect(receipt).not.toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /^(Ẩn phiếu|Xem phiếu thanh toán)$/ }),
    ).toHaveCount(0);
    await staff.screenshot({
      path: info.outputPath('prepaid-staff-refund-complete.png'),
      scale: 'css',
    });

    await guest
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    const guestStats = guest.locator('.guest-content > .core-card > .core-stats');
    for (const label of ['Đã thanh toán (sau hoàn)', 'Còn phải thanh toán'])
      await expect(guestStats.locator('p').filter({ hasText: label }).locator('strong')).toHaveText(
        '0 đ',
      );
    const guestRefund = guest.getByRole('region', { name: 'Thông tin hoàn tiền', exact: true });
    await expect(guestRefund).toContainText('Đã hoàn tất các khoản cần hoàn');
    await expect(guestRefund.locator('.guest-refund-history li')).toHaveCount(1);
    await expect(guestRefund.locator('.guest-refund-history li strong')).toHaveText('49.000 đ');
    await guest.screenshot({
      path: info.outputPath('prepaid-guest-net-payment-zero.png'),
      scale: 'css',
      fullPage: true,
    });
    // A later unpaid dish in the same session must not inherit the earlier item's refund.
    const unpaidName = 'Món chưa trả ' + code;
    const unpaidProduct = await post<Entity>(admin, '/core/products', {
      code: code + '-UNPAID',
      name: unpaidName,
      categoryId: catalog.categories[0]!.id,
      price: '25000',
      stockManaged: false,
      complimentary: false,
    });
    const unpaidBatch = await post<Entity>(staff, '/core/sessions/' + sessionId + '/orders', {
      requestId: randomUUID(),
      lines: [{ productId: unpaidProduct.id, quantity: 1 }],
    });
    const updatedOrders = await get<(Entity & { items: Entity[] })[]>(staff, '/core/orders');
    const unpaidItem = updatedOrders.find((row) => row.id === unpaidBatch.id)!.items[0]!;
    await post(kitchen, '/core/items/' + unpaidItem.id + '/accept', {});
    await post(kitchen, '/core/items/' + unpaidItem.id + '/unavailable', {
      reasonCode: 'OUT_OF_STOCK',
    });
    expect((await get<Bill>(staff, '/core/sessions/' + sessionId + '/bill')).account).toMatchObject(
      {
        charge_total: '0',
        refunded_total: '49000',
        refund_due_amount: '0',
      },
    );
    await refundDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(inspection).toBeVisible();
    await inspection.getByRole('button', { name: 'Đóng', exact: true }).click();
    await selectAdmin(admin, 'Báo cáo', 'Tra cứu & xử lý món');
    await admin.getByRole('button', { name: 'Dừng trước chế biến', exact: true }).click();
    await admin
      .getByRole('textbox', { name: /Tìm bàn,.*lý do…/ })
      .fill(sessionId.slice(0, 8).toUpperCase());
    const history = admin.locator('.unavailable-history-case');
    await expect(history).toHaveCount(2);
    const sessionHeading = 'Bàn ' + code + ' · Phiên #' + sessionId.slice(0, 8).toUpperCase();
    await expect(history.getByRole('heading', { name: sessionHeading, exact: true })).toHaveCount(
      2,
    );
    await expect(history.getByText(/^(Đã báo khách|Chờ báo khách)$/)).toHaveCount(0);
    const refundedHistory = history.filter({ hasText: name });
    await expect(refundedHistory).toHaveCount(1);
    await expect(refundedHistory.getByText('Đã hoàn: 49.000 đ', { exact: true })).toBeVisible();
    const unpaidHistory = history.filter({ hasText: unpaidName });
    await expect(unpaidHistory).toHaveCount(1);
    await expect(unpaidHistory.getByText(/Đã hoàn:|Chờ hoàn:/)).toHaveCount(0);
    await expect(unpaidHistory).not.toContainText('49.000');
    const completedHistory = await get<{ rows: UnavailableHistoryRecord[] }>(
      admin,
      '/core/history/order-unavailable?period=all&itemId=' + item.id,
    );
    expect(completedHistory.rows).toHaveLength(1);
    expect(completedHistory.rows[0]!.guest_notified).toBe(true);
    expect(completedHistory.rows[0]!.refund_history).toMatchObject({
      scope: 'ITEM',
      amount: '49000',
      refunded_amount: '49000',
      remaining_amount: '0',
    });
    expect(completedHistory.rows[0]!.refund_history.cases).toHaveLength(1);
    expect(completedHistory.rows[0]!.refund_history.cases[0]!.related_item_ids).toEqual([item.id]);
    const unpaidHistoryData = await get<{ rows: UnavailableHistoryRecord[] }>(
      admin,
      '/core/history/order-unavailable?period=all&itemId=' + unpaidItem.id,
    );
    expect(unpaidHistoryData.rows).toHaveLength(1);
    expect(unpaidHistoryData.rows[0]!.refund_history).toMatchObject({
      scope: 'NONE',
      refunded_amount: '0',
      cases: [],
    });
    await admin.screenshot({
      path: info.outputPath('prepaid-history-item-refund-scope.png'),
      scale: 'css',
      fullPage: true,
    });
    for (const page of [staff, guest, admin])
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});
