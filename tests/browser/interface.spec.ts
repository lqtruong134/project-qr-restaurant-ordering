import { browserTableCode } from './table-code-fixture';
import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
}
async function fits(page: Page) {
  const sizes = await page.evaluate(() => ({
    width: visualViewport?.width ?? innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(sizes.scroll, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.width + 1);
}
test('catalog filters, editing and uploaded photographs work for guest on phones and desktops', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await selectAdmin(page, 'Thực đơn');
  await expect(page.locator('.managed-dish')).toHaveCount(12);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Phân trang thực đơn' })).toContainText(
    '13–24',
  );
  await page.getByRole('textbox', { name: 'Tìm tên hoặc mã món…' }).fill('CHINH-01');
  await expect(page.locator('.managed-dish')).toHaveCount(1);
  await page.getByRole('button', { name: 'Chỉnh sửa Cơm tấm sườn nướng', exact: true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  await fits(page);
  await editor.locator('input[type="file"]').setInputFiles({
    name: 'khong-phai-anh.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invalid'),
  });
  await expect(editor.getByRole('alert')).toContainText('Chọn ảnh PNG, JPEG hoặc WebP');
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const draw = canvas.getContext('2d')!;
    draw.fillStyle = '#bc623b';
    draw.fillRect(0, 0, 900, 1200);
    draw.fillStyle = '#f4e6d5';
    draw.beginPath();
    draw.arc(450, 600, 260, 0, Math.PI * 2);
    draw.fill();
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await editor.getByLabel('Mô tả món', { exact: true }).fill('Nội dung chưa lưu');
  await editor.locator('input[type="file"]').setInputFiles({
    name: 'com-tam-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(fixture, 'base64'),
  });
  const discardWarning = page.getByRole('dialog', {
    name: 'Bỏ thay đổi chưa lưu?',
    exact: true,
  });
  await discardWarning.getByRole('button', { name: 'Tiếp tục chỉnh sửa', exact: true }).click();
  await expect(discardWarning).toHaveCount(0);
  await expect(editor.getByLabel('Mô tả món', { exact: true })).toHaveValue('Nội dung chưa lưu');
  await editor.getByRole('button', { name: 'Đóng', exact: true }).click();
  await discardWarning.getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Chỉnh sửa Cơm tấm sườn nướng', exact: true }).click();
  await editor.locator('input[type="file"]').setInputFiles({
    name: 'com-tam-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(fixture, 'base64'),
  });
  await expect(editor.locator('.image-upload').getByRole('status')).toContainText(
    'Đã thay ảnh món',
  );
  const img = editor.locator('.product-editor > aside > .dish-media img');
  await expect(img).toHaveAttribute('src', /\/api\/menu-images\/.*\.png$/);
  await expect
    .poll(() => img.evaluate((node) => (node as HTMLImageElement).naturalHeight))
    .toBe(1200);
  await editor.getByRole('button', { name: 'Đóng', exact: true }).click();
  // Verify the public menu uses the same persisted upload, not only a local preview.
  const nav = page.getByRole('navigation', { name: 'Quản trị', exact: true });
  const expand = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
  if (await expand.count()) await expand.click();
  await selectAdmin(page, 'Bàn & QR');
  await page.getByText('Thêm bàn mới', { exact: true }).click();
  const code = 'PHOTO-' + Date.now();
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Thêm bàn', exact: true }) });
  await form.getByLabel('Mã', { exact: true }).fill(code);
  await form.getByLabel('Tên', { exact: true }).fill(code);
  await form.getByRole('button', { name: 'Lưu', exact: true }).click();
  const tableSaved = page.getByRole('status').filter({ hasText: 'Đã thêm bàn mới.' });
  await expect(tableSaved).toBeVisible();
  await expect(tableSaved.locator('p')).toHaveText('Đã thêm bàn mới.');
  await expect(page.getByRole('heading', { name: code, exact: true })).toBeVisible();
  await selectAdmin(page, 'Bàn & QR', 'Mã QR tại bàn');
  const table = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: code, exact: true }) });
  await table.getByRole('button', { name: 'Cấp mã QR mới' }).click();
  await page
    .getByRole('dialog', { name: 'Thay mã QR của bàn?', exact: true })
    .getByRole('button', { name: 'Cấp mã QR mới', exact: true })
    .click();
  const url = await page.getByRole('link', { name: 'Mở thực đơn của bàn' }).getAttribute('href');
  const context = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    deviceScaleFactor: info.project.use.deviceScaleFactor,
    userAgent: info.project.use.userAgent,
  });
  try {
    const guest = await context.newPage();
    guest.on('pageerror', (error) => errors.push(error.message));
    await guest.goto(url!);
    await guest.getByLabel('Mã vào bàn', { exact: true }).fill(await browserTableCode(page, url!));
    await guest.getByLabel('Tên của bạn', { exact: true }).fill('Khách xem ảnh');
    await guest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      guest.getByRole('heading', { name: 'Hôm nay bạn muốn dùng món gì?' }),
    ).toBeVisible();
    const dish = guest
      .locator('.dish-card')
      .filter({ has: guest.getByRole('heading', { name: 'Cơm tấm sườn nướng', exact: true }) });
    const photo = dish.locator('.dish-media img');
    await expect(photo).toHaveAttribute('src', /\/api\/menu-images\/.*\.png$/);
    await dish.scrollIntoViewIfNeeded();
    await expect
      .poll(() => photo.evaluate((node) => (node as HTMLImageElement).naturalHeight))
      .toBe(1200);
    const fit = await photo.evaluate((node) => ({
      fit: getComputedStyle(node).objectFit,
      position: getComputedStyle(node).objectPosition,
    }));
    expect(fit).toEqual({ fit: 'cover', position: '50% 50%' });
    await fits(guest);
    await dish.getByRole('button', { name: 'Chọn Cơm tấm sườn nướng', exact: true }).click();
    await expect(guest.getByRole('dialog').locator('.dish-media img')).toHaveAttribute(
      'src',
      /\/api\/menu-images\/.*\.png$/,
    );
    await guest.getByRole('button', { name: 'Đóng', exact: true }).click();
    // A failed image request must fall back without moving or breaking the card.
    await guest.route('**/api/menu-images/*.png', (route) =>
      route.fulfill({ status: 404, body: '' }),
    );
    await guest.reload();
    await dish.scrollIntoViewIfNeeded();
    await expect(photo).toHaveAttribute('src', '/images/placeholders/dish.svg');
    await expect(dish.getByText('Ảnh đang cập nhật', { exact: true })).toBeVisible();
    if (!info.project.use.isMobile) {
      for (const width of [1440, 1024, 768, 540, 390, 320]) {
        await guest.setViewportSize({ width, height: 900 });
        await fits(guest);
        await expect(guest.getByRole('navigation', { name: 'Điều hướng khách' })).toBeVisible();
      }
    }
    await guest.evaluate(() => scrollTo(0, 0));
    await guest.screenshot({ path: info.outputPath('guest-redesign.png'), fullPage: false });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
