import { selectAdmin } from './admin-navigation';
import { browserTableCode } from './table-code-fixture';
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(page: Page, user: string, role: string) {
  await page.goto('/login');
  await page.locator('#username').fill(user);
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function post(page: Page, route: string, data: unknown) {
  const r = await page.request.post('/api' + route, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test('admin approves refund before staff can execute; guest sees pending, partial and full history', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150000);
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
    page.on('pageerror', (e) => errors.push(e.message));
  }
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv006', 'staff');
    await login(kitchen, 'bep004', 'kitchen');
    const areas = await (await admin.request.get('/api/core/areas')).json();
    const code = 'REF-' + randomUUID().slice(0, 8);
    const table = await post(admin, '/core/tables', {
      areaId: areas[0].id,
      code,
      name: code,
      capacity: 4,
    });
    const qr = await post(admin, '/core/tables/' + table.id + '/qr', {});
    await guest.goto(qr.joinPath);
    await guest
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin!, qr.joinPath, staff!));
    await guest.getByLabel('Tên của bạn').fill('Khách kiểm tra hoàn tiền');
    await guest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      guest.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
    let state = await (await guest.request.get('/api/guest/state')).json();
    const product = state.products.find((p: { name: string }) => p.name === 'Gỏi cuốn tôm thịt');
    await post(guest, '/guest/cart', {
      productId: product.id,
      quantity: 2,
      cartVersion: state.cart.cart_version,
    });
    state = await (await guest.request.get('/api/guest/state')).json();
    const batch = await post(guest, '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: state.cart.cart_version,
      itemIds: state.items.map((i: { id: string }) => i.id),
    });
    const sid = state.session.id;
    const order = (await (await staff.request.get('/api/core/orders')).json()).find(
      (o: { id: string }) => o.id === batch.id,
    );
    if (order.status === 'PENDING_REVIEW')
      await post(staff, '/core/orders/' + batch.id + '/review', { approve: true });
    await post(staff, '/core/sessions/' + sid + '/verify', {});
    const item = order.items[0];
    const payment = await post(staff, '/core/sessions/' + sid + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '90000',
    });
    await post(staff, '/core/payments/' + payment.id + '/confirm', {
      amount: '90000',
      receivedAmount: '90000',
    });
    for (const action of ['accept', 'prepare'])
      await post(kitchen, '/core/items/' + item.id + '/' + action, {});
    await post(kitchen, '/core/items/' + item.id + '/report-issue', {
      reasonCode: 'QUALITY_ISSUE',
    });
    await admin.locator('.inbox-summary button').filter({ hasText: 'món & kho cần xử lý' }).click();
    await admin
      .getByRole('textbox', { name: 'Tìm bàn, món hoặc mã phiên…', exact: true })
      .fill(code);
    const issue = admin.locator('.inbox-case').filter({ hasText: code });
    await issue.getByRole('button', { name: 'Kiểm tra & quyết định', exact: true }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true })
      .click();
    await admin
      .getByRole('dialog', { name: 'Xác nhận lỗi nhà hàng?' })
      .getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true })
      .click();
    await guest
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    const summary = guest.getByRole('region', { name: 'Thông tin hoàn tiền' });
    await expect(summary).toContainText('Cả bàn còn tiền chờ hoàn');
    await expect(
      summary.locator('.refund-summary-grid > div').filter({ hasText: 'Còn chờ hoàn tiền món' }),
    ).toContainText('90.000');
    await guest.screenshot({
      path: info.outputPath('guest-refund-pending.png'),
      scale: 'css',
      fullPage: true,
    });
    const beforeApproval = await (await staff.request.get('/api/core/alerts')).json();
    expect(
      beforeApproval.filter(
        (a: { session_id: string; alert_type: string }) =>
          a.session_id === sid && a.alert_type === 'REFUND_REQUIRED',
      ),
    ).toHaveLength(0);
    const denied = await staff.request.post('/api/core/sessions/' + sid + '/refunds', {
      headers: { origin: new URL(staff.url()).origin, 'x-csrf-protection': '1' },
      data: {
        paymentId: payment.id,
        amount: '90000',
        useDecisionReason: true,
        requestId: randomUUID(),
      },
    });
    expect(denied.status()).toBe(403);
    await selectAdmin(admin, 'Việc cần xử lý', 'Khoản cần hoàn');
    await admin
      .locator('.inbox-case')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Xử lý hoàn tiền', exact: true })
      .click();
    const adminRefund = admin.getByRole('dialog', { name: 'Hoàn tiền - Bàn ' + code });
    const create = adminRefund.locator('form').filter({
      has: admin.getByRole('heading', { name: 'Lập hồ sơ hoàn tiền', exact: true }),
    });
    await create.getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true }).click();
    await admin
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true })
      .click();
    await expect(create).toHaveCount(0);
    await expect(adminRefund.getByText(/Quản trị đã duyệt:/)).toBeVisible();
    await expect(adminRefund.locator('form')).toHaveCount(0);
    await expect(
      adminRefund.getByRole('button', { name: 'Xác nhận đã hoàn', exact: true }),
    ).toHaveCount(0);
    await expect(
      adminRefund.getByRole('heading', { name: 'Đã chuyển cho nhân viên hoàn tiền', exact: true }),
    ).toBeVisible();

    await adminRefund.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    const card = staff.locator('.queue-table-card[data-table-id="' + table.id + '"]');
    await expect(card).toContainText('Cần hoàn tiền');
    await card.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    const dialog = staff.getByRole('dialog', { name: 'Chi tiết - ' + code });
    await dialog.getByRole('button', { name: 'Việc tại bàn', exact: true }).click();
    const refundAlert = dialog
      .locator('.alert-card')
      .filter({ has: staff.getByRole('button', { name: 'Mở xác nhận hoàn tiền', exact: true }) });
    await expect(refundAlert).not.toContainText('Nội dung đã xử lý');
    await refundAlert.getByRole('button', { name: 'Mở xác nhận hoàn tiền', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const refundPanel = dialog.getByRole('region', { name: 'Hoàn tiền cho khách' });
    await expect(refundPanel).toBeFocused();
    await expect(refundPanel).toContainText('Lý do hoàn tiền');
    await expect(refundPanel).toContainText('Món không đạt chất lượng');
    await expect(refundPanel.getByRole('textbox', { name: 'Lý do hoàn', exact: true })).toHaveCount(
      0,
    );
    await expect
      .poll(async () => {
        const reason = await refundPanel.locator('.refund-decision-reason').boundingBox();
        const heading = await dialog.locator('.dialog-heading').boundingBox();
        return Boolean(reason && heading && reason.y >= heading.y + heading.height);
      })
      .toBe(true);
    await staff.screenshot({
      path: info.outputPath('staff-refund-admin-reason.png'),
      scale: 'css',
    });
    await expect(
      refundPanel.getByRole('heading', { name: 'Lập hồ sơ hoàn tiền', exact: true }),
    ).toHaveCount(0);
    await expect(refundPanel.getByText(/Quản trị đã duyệt:/)).toBeVisible();
    let complete = refundPanel
      .locator('form')
      .filter({ has: staff.getByRole('heading', { name: 'Còn phải hoàn 90.000 đ', exact: true }) });
    await complete.locator('input[name="amount"]').fill('20000');
    await complete.getByRole('button', { name: 'Đã hoàn tiền cho khách', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(summary).toContainText('Đã hoàn một phần');
    await expect(
      summary.locator('.refund-summary-grid > div').filter({ hasText: 'Đã hoàn tiền món' }),
    ).toContainText('20.000');
    await expect(
      summary.locator('.refund-summary-grid > div').filter({ hasText: 'Còn chờ hoàn tiền món' }),
    ).toContainText('70.000');
    await expect(summary.locator('.guest-refund-history li')).toHaveCount(1);
    await guest.screenshot({
      path: info.outputPath('guest-refund-partial.png'),
      scale: 'css',
      fullPage: true,
    });
    complete = refundPanel
      .locator('form')
      .filter({ has: staff.getByRole('heading', { name: 'Còn phải hoàn 70.000 đ', exact: true }) });
    await complete.getByRole('button', { name: 'Đã hoàn tiền cho khách', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(summary).toContainText('Đã hoàn tất các khoản cần hoàn');
    await expect(
      summary.locator('.refund-summary-grid > div').filter({ hasText: 'Đã hoàn tiền món' }),
    ).toContainText('90.000');
    await expect(
      summary.locator('.refund-summary-grid > div').filter({ hasText: 'Còn chờ hoàn tiền món' }),
    ).toContainText('0 đ');
    await expect(summary.locator('.guest-refund-history li')).toHaveCount(2);
    await expect(
      guest.getByText('Hiện không có khoản cần thanh toán', { exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await staff.request.get('/api/core/alerts')).json()).filter(
            (a: { session_id: string; alert_type: string }) =>
              a.session_id === sid && a.alert_type === 'REFUND_REQUIRED',
          ).length,
      )
      .toBe(0);
    for (const page of [staff, guest]) {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
      }
      await page.setViewportSize(info.project.use.viewport!);
    }
    await guest.screenshot({
      path: info.outputPath('guest-refund-complete.png'),
      scale: 'css',
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
