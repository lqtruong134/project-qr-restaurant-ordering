import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
test('internal login, role workspace, direct forbidden navigation and logout', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await page.locator('#username').fill('staff');
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/staff/);
  await expect(page.getByText('Đã xác thực quyền truy cập')).toBeVisible();
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Không gian quản trị' }),
  ).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('staff.png'), fullPage: true });
  await page.goto('/workspace/admin');
  await expect(page.getByRole('alert').filter({ hasText: 'Không thể truy cập' })).toContainText(
    'Bạn không có quyền',
  );
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.goto('/workspace/staff');
  await expect(page).toHaveURL(/login/);
  await page.screenshot({ path: test.info().outputPath('login.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
