import { browserTableCode } from './table-code-fixture';
import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
async function login(page: Page, username: string, workspace: string) {
  await page.goto('/login');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + workspace));
}
test('CORE screens support QR guest order through review, kitchen, settlement and close', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({
        baseURL,
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        deviceScaleFactor: info.project.use.deviceScaleFactor,
        userAgent: info.project.use.userAgent,
      }),
    ),
  );
  const [admin, guest, staff, kitchen] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const page of [admin!, guest!, staff!, kitchen!])
    page.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(admin!, 'quyettruong05', 'admin');
    await expect(
      admin!.getByRole('region', { name: 'Tình trạng vận hành', exact: true }),
    ).toBeVisible();
    await admin!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('admin-overview.png'),
      fullPage: true,
    });
    await selectAdmin(admin!, 'Bàn & QR');
    await admin!.getByText('Thêm bàn mới', { exact: true }).click();
    const code = 'E2E-' + Date.now();
    const form = admin!
      .locator('form')
      .filter({ has: admin!.getByRole('heading', { name: 'Thêm bàn', exact: true }) });
    await form.getByLabel('Mã', { exact: true }).fill(code);
    await form.getByLabel('Tên', { exact: true }).fill(code);
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(admin!.locator('.operation-notice[role="status"]')).toContainText(
      'Đã thêm bàn mới.',
    );
    await selectAdmin(admin!, 'Bàn & QR', 'Mã QR tại bàn');
    const table = admin!
      .locator('article')
      .filter({ has: admin!.getByRole('heading', { name: code, exact: true }) });
    await table.getByRole('button', { name: 'Cấp mã QR mới' }).click();
    await admin!
      .getByRole('dialog', { name: 'Thay mã QR của bàn?', exact: true })
      .getByRole('button', { name: 'Cấp mã QR mới', exact: true })
      .click();
    const link = admin!.getByRole('link', { name: 'Mở thực đơn của bàn' });
    await expect(link).toBeVisible();
    const url = await link.getAttribute('href');
    await admin!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('admin-qr.png'),
      fullPage: true,
    });
    await admin!.emulateMedia({ media: 'print' });
    await expect(admin!.locator('.core-qr img')).toBeVisible();
    await expect(link).toBeHidden();
    await admin!.emulateMedia({ media: 'screen' });
    await guest!.goto(url!);
    await guest!
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin!, url!));
    await guest!.getByLabel('Tên của bạn').fill('Khách thử trình duyệt');
    await guest!
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest!.getByRole('button', { name: 'Xem thực đơn' }).click();
    await expect(
      guest!.getByRole('heading', { name: 'Hôm nay bạn muốn dùng món gì?' }),
    ).toBeVisible();
    for (const name of ['Giỏ món', 'Món đã gọi', 'Thanh toán', 'Hỗ trợ', 'Thực đơn']) {
      await guest!
        .getByRole('navigation', { name: 'Điều hướng khách' })
        .getByRole('button', { name: new RegExp(name) })
        .click();
      const dimensions = await guest!.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: visualViewport?.width ?? innerWidth,
      }));
      expect(dimensions.scroll, name).toBeLessThanOrEqual(dimensions.width + 1);
    }
    await guest!
      .getByRole('textbox', { name: 'Tìm món bạn yêu thích…', exact: true })
      .fill('Cơm tấm sườn nướng');
    const dish = guest!
      .locator('article')
      .filter({ has: guest!.getByRole('heading', { name: 'Cơm tấm sườn nướng', exact: true }) });
    expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await guest!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('guest-menu.png'),
      fullPage: false,
    });
    await dish.getByRole('button', { name: 'Chọn Cơm tấm sườn nướng' }).click();
    await expect(guest!.getByRole('dialog')).toBeVisible();
    expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await guest!.getByRole('dialog').getByRole('button', { name: 'Thêm vào giỏ' }).click();
    await expect(guest!.getByRole('dialog')).toHaveCount(0);
    await guest!
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: /Giỏ món/ })
      .click();
    await guest!.getByRole('button', { name: 'Gửi món đã chọn' }).click();
    await expect(
      guest!.getByRole('heading', { name: 'Chưa có món trong giỏ', exact: true }),
    ).toBeVisible();
    await guest!
      .getByRole('navigation', { name: 'Điều hướng khách', exact: true })
      .getByRole('button', { name: 'Món đã gọi', exact: true })
      .click();
    await expect(guest!.getByRole('heading', { name: 'Món đã gọi', exact: true })).toBeVisible();
    await expect(
      guest!.locator('.guest-content .status-pill[data-status="SUBMITTED"]').first(),
    ).toBeVisible();
    await login(staff!, 'pv001', 'staff');
    await expect(staff!.getByRole('button', { name: /Sơ đồ bàn/ })).toBeVisible();
    await staff!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('staff-floor.png'),
      fullPage: true,
    });
    await staff!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Gọi món/ })
      .click();
    const order = staff!.locator('article').filter({
      has: staff!.getByRole('heading', {
        name: new RegExp('^Bàn ' + code + ' · Phiên #[A-F0-9]{8}$'),
      }),
    });
    await expect(order.getByRole('button', { name: 'Duyệt gửi bếp' })).toHaveCount(0);
    await login(kitchen!, 'bep001', 'kitchen');
    const ticket = kitchen!.locator('article').filter({
      has: kitchen!.getByRole('heading', {
        name: new RegExp('^Bàn ' + code + ' · Phiên #[A-F0-9]{8}$'),
      }),
    });
    await ticket.getByRole('button', { name: 'Bếp nhận cả lượt' }).click();
    await ticket.getByRole('button', { name: 'Bắt đầu chế biến' }).click();
    await ticket.getByRole('button', { name: 'Món đã xong' }).click();
    await expect(ticket.getByText('Chờ mang ra', { exact: true })).toBeVisible();
    await kitchen!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('kitchen.png'),
      fullPage: true,
    });
    const readyGroup = staff!.locator('section.core-card').filter({
      has: staff!.getByRole('heading', {
        name: new RegExp('^Bàn ' + code + ' · Phiên #[A-F0-9]{8} - 1 món chờ mang$'),
      }),
    });
    await readyGroup.getByLabel('Chọn tất cả món đang chờ').check();
    await readyGroup.getByRole('button', { name: 'Đã phục vụ 1 món', exact: true }).click();
    await expect(
      guest!.locator('.guest-content .status-pill[data-status="SERVED"]').first(),
    ).toBeVisible();
    await guest!
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    const payment = guest!.getByRole('form', { name: 'Yêu cầu thanh toán', exact: true });
    await payment.getByRole('button', { name: 'Báo nhân viên thu tiền' }).click();
    await expect(
      guest!.getByText('Bạn đã báo nhân viên hỗ trợ thanh toán', { exact: true }),
    ).toBeVisible();
    await staff!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Sơ đồ bàn/ })
      .click();
    const staffTable = staff!
      .locator('article')
      .filter({ has: staff!.getByRole('heading', { name: code, exact: true }) });
    await staffTable.getByRole('button', { name: 'Mở chi tiết bàn' }).click();
    await staff!
      .getByRole('dialog')
      .getByRole('button', { name: 'Thu tiền & phiếu', exact: true })
      .click();
    await staff!
      .getByRole('dialog')
      .getByRole('button', { name: 'Nhận việc & đến bàn', exact: true })
      .click();
    await staff!.getByLabel('Tiền mặt khách đưa (đồng)', { exact: true }).fill('100000');
    await expect(staff!.locator('.cash-preview')).toContainText('21.000');
    // A polling refresh or preferred request update must not overwrite the tender entered.
    await staff!.waitForTimeout(3200);
    await expect(staff!.getByLabel('Tiền mặt khách đưa (đồng)', { exact: true })).toHaveValue(
      '100.000',
    );
    await expect(staff!.locator('.cash-preview')).toContainText('21.000');
    await staff!.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(staff!.locator('.last-payment')).toContainText('21.000');
    await staff!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('staff-bill.png'),
      fullPage: true,
    });
    await staff!.emulateMedia({ media: 'print' });
    await expect(staff!.locator('.receipt-sheet')).toContainText('Cơm tấm sườn nướng');
    await expect(staff!.getByRole('heading', { name: 'Thu tiền lần này' })).toBeHidden();
    await staff!.emulateMedia({ media: 'screen' });
    await staff!.getByRole('button', { name: 'Xác nhận đã trả tiền thừa', exact: true }).click();
    await staff!
      .getByRole('dialog', { name: 'Xác nhận thao tác', exact: true })
      .getByRole('button', { name: 'Đã trả đủ tiền thừa', exact: true })
      .click();
    await expect(staff!.locator('.last-payment')).toContainText('Đã xác nhận thối tiền');
    await staff!.getByRole('button', { name: 'Đã in và giao phiếu', exact: true }).click();
    await staff!
      .getByRole('dialog', { name: 'Xác nhận thao tác', exact: true })
      .getByRole('button', { name: 'Tiếp tục', exact: true })
      .click();
    await expect(
      staff!.getByRole('region', { name: 'Giao phiếu cho khách', exact: true }),
    ).toContainText('Đã in và giao phiếu cho khách');
    await expect(
      staff!.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }),
    ).toBeEnabled();
    await guest!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('guest.png'),
      fullPage: true,
    });
    expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await staff!.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất' }).click();
    await staff!.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(staff!.locator('.receipt-sheet')).toBeVisible();
    await expect(staff!.locator('.receipt-sheet')).toContainText('PHIẾU THANH TOÁN');
    await expect(staff!.locator('.receipt-sheet')).toContainText('21.000');
    await expect(staff!.locator('.receipt-sheet')).not.toContainText('Đang phục vụ');
    await staff!.screenshot({
      caret: 'initial',
      scale: 'css',
      path: info.outputPath('closed-receipt.png'),
      fullPage: true,
    });
    await staff!.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staffTable.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    await staff!
      .getByRole('dialog')
      .getByRole('button', { name: 'Đã dọn xong', exact: true })
      .click();
    await staff!
      .getByRole('dialog', { name: 'Xác nhận thao tác' })
      .getByRole('button', { name: 'Đã dọn xong', exact: true })
      .click();
    await expect(guest!.getByRole('heading', { name: 'Quét QR tại bàn để bắt đầu' })).toBeVisible();
    await staff!.getByRole('button', { name: 'Phiếu đã chốt', exact: true }).click();
    await staff!
      .locator('.task-card')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Xem / in lại' })
      .click();
    await expect(staff!.locator('.receipt-sheet')).toBeVisible();
    await expect(staff!.locator('.receipt-sheet')).toContainText('PHIẾU THANH TOÁN');
    for (const page of [admin!, guest!, staff!, kitchen!]) {
      const dimensions = await page.evaluate(() => ({
        url: location.pathname,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
      }));
      expect(dimensions.scrollWidth <= dimensions.innerWidth, JSON.stringify(dimensions)).toBe(
        true,
      );
    }
    await admin!.goto('/workspace/admin');
    await selectAdmin(admin!, 'Báo cáo', 'Đối soát phiên');
    await admin!
      .getByRole('row')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Xem đối soát' })
      .click();
    await expect(admin!.getByRole('dialog')).toContainText('PHIẾU THANH TOÁN');
    await expect(admin!.getByRole('dialog')).toContainText('Giờ vào');
    await expect(admin!.getByRole('dialog')).toContainText('21.000');
    await admin!.screenshot({
      path: info.outputPath('admin-reconciliation.png'),
      fullPage: true,
      scale: 'css',
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test('admin records stock waste with reason and sees immutable movement history', async ({
  page,
}, info) => {
  await login(page, 'quyettruong05', 'admin');
  await selectAdmin(page, 'Kho & công thức');
  await expect(page.getByRole('heading', { name: 'Tồn kho', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kiểm kê / xuất hủy' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Loại ghi nhận', exact: true }).selectOption('WASTE');
  await dialog.getByRole('spinbutton', { name: /^Số lượng \([^)]+\)$/ }).fill('0.000001');
  const reason = 'Kiểm tra xuất hủy ' + info.project.name + ' ' + Date.now();
  await dialog.getByLabel('Lý do / biên bản kiểm kê hoặc hư hỏng', { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: 'Điều chỉnh tồn', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
    .getByRole('button', { name: 'Xác nhận điều chỉnh tồn', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await selectAdmin(page, 'Kho & công thức', 'Lịch sử kho');
  await expect(page.getByText(reason, { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('stock-ledger.png'), fullPage: false });
});
