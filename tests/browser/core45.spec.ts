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
      admin!.getByText('Chủ quán nắm được mọi điểm quan trọng trong một màn hình.', {
        exact: true,
      }),
    ).toBeVisible();
    await admin!.screenshot({
      caret: 'initial',
      path: info.outputPath('admin-overview.png'),
      fullPage: true,
    });
    await admin!.getByRole('button', { name: 'Bàn & QR', exact: true }).click();
    await admin!.getByText('Thêm bàn hoặc khu vực', { exact: true }).click();
    const code = 'E2E-' + Date.now();
    const form = admin!
      .locator('form')
      .filter({ has: admin!.getByRole('heading', { name: 'Thêm bàn', exact: true }) });
    await form.getByLabel('Mã', { exact: true }).fill(code);
    await form.getByLabel('Tên', { exact: true }).fill(code);
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    const table = admin!
      .locator('article')
      .filter({ has: admin!.getByRole('heading', { name: code, exact: true }) });
    await table.getByRole('button', { name: 'Cấp QR mới, thay QR cũ' }).click();
    await admin!.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    const link = admin!.getByRole('link', { name: 'Mở thực đơn của bàn' });
    await expect(link).toBeVisible();
    const url = await link.getAttribute('href');
    await admin!.screenshot({
      caret: 'initial',
      path: info.outputPath('admin-qr.png'),
      fullPage: true,
    });
    await admin!.emulateMedia({ media: 'print' });
    await expect(admin!.locator('.core-qr img')).toBeVisible();
    await expect(link).toBeHidden();
    await admin!.emulateMedia({ media: 'screen' });
    await guest!.goto(url!);
    await guest!.getByLabel('Tên của bạn').fill('Khách thử trình duyệt');
    await guest!.getByRole('button', { name: 'Xem thực đơn' }).click();
    await expect(guest!.getByRole('heading', { name: 'Hôm nay bạn muốn dùng gì?' })).toBeVisible();
    const dish = guest!
      .locator('article')
      .filter({ has: guest!.getByRole('heading', { name: 'Cơm tấm sườn nướng', exact: true }) });
    expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await guest!.screenshot({
      caret: 'initial',
      path: info.outputPath('guest-menu.png'),
      fullPage: false,
    });
    await dish.getByRole('button', { name: 'Chọn Cơm tấm sườn nướng' }).click();
    await guest!.getByRole('dialog').getByRole('button', { name: 'Thêm vào giỏ' }).click();
    await expect(guest!.getByRole('dialog')).toHaveCount(0);
    await guest!
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: /Giỏ món/ })
      .click();
    await guest!.getByRole('button', { name: 'Gửi các món của tôi' }).click();
    await guest!.getByRole('button', { name: 'Món đã gọi', exact: true }).click();
    await expect(guest!.getByText('Chờ nhân viên duyệt', { exact: true })).toBeVisible();
    await login(staff!, 'pv001', 'staff');
    await expect(staff!.getByRole('button', { name: /Sơ đồ bàn/ })).toBeVisible();
    await staff!.screenshot({
      caret: 'initial',
      path: info.outputPath('staff-floor.png'),
      fullPage: true,
    });
    await staff!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Gọi món/ })
      .click();
    const order = staff!
      .locator('article')
      .filter({ has: staff!.getByRole('heading', { name: 'Bàn ' + code, exact: true }) });
    await order.getByRole('button', { name: 'Duyệt gửi bếp' }).click();
    await login(kitchen!, 'bep001', 'kitchen');
    const ticket = kitchen!
      .locator('article')
      .filter({ has: kitchen!.getByRole('heading', { name: 'Bàn ' + code, exact: true }) });
    await ticket.getByRole('button', { name: 'Bếp nhận cả lượt' }).click();
    await ticket.getByRole('button', { name: 'Bắt đầu chế biến' }).click();
    await ticket.getByRole('button', { name: 'Món đã xong' }).click();
    await kitchen!.screenshot({
      caret: 'initial',
      path: info.outputPath('kitchen.png'),
      fullPage: true,
    });
    await order.getByRole('button', { name: 'Đã mang ra bàn' }).click();
    await expect(guest!.getByText('Đã phục vụ', { exact: true })).toBeVisible();
    await guest!
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    const payment = guest!
      .locator('form')
      .filter({ has: guest!.getByRole('heading', { name: 'Yêu cầu thanh toán', exact: true }) });
    await payment.getByLabel('Số tiền (đồng)').fill('79000');
    await payment.getByRole('button', { name: 'Báo nhân viên thu tiền' }).click();
    await staff!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Sơ đồ bàn/ })
      .click();
    const staffTable = staff!
      .locator('article')
      .filter({ has: staff!.getByRole('heading', { name: code, exact: true }) });
    await staffTable.getByRole('button', { name: 'Mở chi tiết bàn' }).click();
    await staff!.getByLabel('Tiền mặt khách đưa (đồng)').fill('100000');
    await staff!.getByRole('button', { name: 'Tôi đã nhận tiền' }).click();
    await staff!.screenshot({
      caret: 'initial',
      path: info.outputPath('staff-bill.png'),
      fullPage: true,
    });
    await staff!.emulateMedia({ media: 'print' });
    await expect(staff!.locator('.receipt-sheet')).toContainText('Cơm tấm sườn nướng');
    await expect(staff!.getByRole('heading', { name: 'Lập yêu cầu thu tiền' })).toBeHidden();
    await staff!.emulateMedia({ media: 'screen' });
    await guest!.screenshot({
      caret: 'initial',
      path: info.outputPath('guest.png'),
      fullPage: true,
    });
    expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await staff!.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất' }).click();
    await staff!.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(staff!.locator('.receipt-sheet')).toContainText('PHIẾU THANH TOÁN');
    await expect(staff!.locator('.receipt-sheet')).toContainText('21.000');
    await expect(staff!.locator('.receipt-sheet')).not.toContainText('Đang phục vụ');
    await staff!.screenshot({
      caret: 'initial',
      path: info.outputPath('closed-receipt.png'),
      fullPage: true,
    });
    await staff!.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staffTable.getByRole('button', { name: 'Đã dọn xong' }).click();
    await expect(guest!.getByRole('heading', { name: 'Quét QR tại bàn để bắt đầu' })).toBeVisible();
    await staff!.getByRole('button', { name: 'Phiếu đã chốt', exact: true }).click();
    await staff!
      .locator('.task-card')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Xem / in lại' })
      .click();
    await staff!.getByRole('button', { name: 'Xem phiếu thanh toán' }).click();
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
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
