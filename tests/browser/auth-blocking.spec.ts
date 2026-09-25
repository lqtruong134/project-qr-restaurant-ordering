import { test, expect } from '@playwright/test';
test('global locked screen removes business data, traps escape, and has a single login action', async ({
  page,
}) => {
  await page.goto('/login');
  await page.locator('#username').fill('pv002');
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace/);
  await expect(page.getByRole('navigation', { name: 'Phục vụ' })).toBeVisible();
  await page.route('**/api/core/**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        errorCode: 'ACCOUNT_LOCKED',
        userMessage: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên.',
      }),
    }),
  );
  // Visible workspace polls the intercepted business route automatically.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Tài khoản đã bị khóa');
  await expect(page.locator('.workspace-shell')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('auth-blocked.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Về trang đăng nhập' }).click();
  await expect(page).toHaveURL(/login/);
});
test('incorrect login blocks and permission denial keeps authenticated workspace', async ({
  page,
}) => {
  await page.goto('/login');
  await page.locator('#username').fill('pv003');
  await page.locator('#password').fill('incorrect');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Tên đăng nhập hoặc mật khẩu không chính xác.',
  );
  await page.getByRole('button', { name: 'Về trang đăng nhập' }).click();
  await page.locator('#username').fill('pv003');
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Phục vụ' })).toBeVisible();
  await page.route('**/api/core/orders', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        errorCode: 'PERMISSION_DENIED',
        userMessage: 'Bạn không có quyền thực hiện thao tác này.',
      }),
    }),
  );
  // Visible workspace polls the intercepted business route automatically.
  await expect(page.locator('.permission-toast')).toContainText(
    'Bạn không có quyền thực hiện nghiệp vụ này.',
  );
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
