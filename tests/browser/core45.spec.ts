import { test, expect, type Page } from '@playwright/test';
async function login(page: Page, name: string) {
  await page.goto('/login');
  await page.locator('#username').fill(name);
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + name));
}
test('CORE screens support QR guest order through review, kitchen, settlement and close', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({ baseURL, viewport: info.project.use.viewport }),
    ),
  );
  const [admin, guest, staff, kitchen] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const page of [admin!, guest!, staff!, kitchen!])
    page.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(admin!, 'admin');
    await admin!.getByRole('button', { name: 'Bàn & QR', exact: true }).click();
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
    const link = admin!.getByRole('link', { name: 'Mở thực đơn của bàn' });
    await expect(link).toBeVisible();
    const url = await link.getAttribute('href');
    await admin!.screenshot({ path: info.outputPath('admin-qr.png'), fullPage: true });
    await guest!.goto(url!);
    await guest!.getByLabel('Tên của bạn').fill('Khách thử trình duyệt');
    await guest!.getByRole('button', { name: 'Xem thực đơn' }).click();
    await expect(guest!.getByRole('heading', { name: 'Hôm nay bạn muốn dùng gì?' })).toBeVisible();
    const dish = guest!
      .locator('article')
      .filter({ has: guest!.getByRole('heading', { name: 'Cơm gà', exact: true }) });
    await dish.getByRole('button', { name: 'Thêm vào giỏ' }).click();
    await guest!.getByRole('button', { name: 'Gửi các món của tôi' }).click();
    await expect(guest!.getByText('Chờ nhân viên duyệt', { exact: true })).toBeVisible();
    await login(staff!, 'staff');
    const order = staff!
      .locator('article')
      .filter({ has: staff!.getByRole('heading', { name: 'Bàn ' + code, exact: true }) });
    await order.getByRole('button', { name: 'Duyệt gửi bếp' }).click();
    await login(kitchen!, 'kitchen');
    const ticket = kitchen!
      .locator('article')
      .filter({ has: kitchen!.getByRole('heading', { name: 'Bàn ' + code, exact: true }) });
    await ticket.getByRole('button', { name: 'Bếp nhận cả lượt' }).click();
    await ticket.getByRole('button', { name: 'Bắt đầu chế biến' }).click();
    await ticket.getByRole('button', { name: 'Món đã xong' }).click();
    await kitchen!.screenshot({ path: info.outputPath('kitchen.png'), fullPage: true });
    await order.getByRole('button', { name: 'Đã mang ra bàn' }).click();
    await expect(guest!.getByText('Đã phục vụ', { exact: true })).toBeVisible();
    const payment = guest!
      .locator('form')
      .filter({ has: guest!.getByRole('heading', { name: 'Yêu cầu thanh toán', exact: true }) });
    await payment.getByLabel('Số tiền (đồng)').fill('55000');
    await payment.getByRole('button', { name: 'Báo nhân viên thu tiền' }).click();
    const staffTable = staff!
      .locator('article')
      .filter({ has: staff!.getByRole('heading', { name: code, exact: true }) });
    await staffTable.getByRole('button', { name: 'Xem bàn / tính tiền' }).click();
    await staff!.getByRole('button', { name: 'Tôi đã nhận tiền' }).click();
    await staff!.screenshot({ path: info.outputPath('staff-bill.png'), fullPage: true });
    await guest!.screenshot({ path: info.outputPath('guest.png'), fullPage: true });
    expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await staff!.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất' }).click();
    await staffTable.getByRole('button', { name: 'Đã dọn xong' }).click();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
