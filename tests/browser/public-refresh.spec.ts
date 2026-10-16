import { test, expect, type Page } from '@playwright/test';

async function fits(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}
test('internal entry has one background and a login form without restaurant promotions', async ({
  page,
}, info) => {
  if (info.project.name !== 'desktop') await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Đăng nhập nội bộ', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tên đăng nhập', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.locator('.internal-login-background img')).toHaveCount(1);
  await expect(
    page.locator('.marketing-carousel,.landing-dishes,.landing-header,.landing-features'),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('.internal-login-background img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth > 0),
    )
    .toBe(true);
  await fits(page);
  await page.screenshot({
    path:
      '/mnt/c/Users/Admin/.codex/.chatgpt-projects/g-p-6abb725d13508191b0b02a8845acc6cd/restaurant-v4/internal-home-' +
      info.project.name +
      '.png',
    fullPage: true,
  });
});

test('internal login keeps password controls and useful error feedback', async ({ page }, info) => {
  if (info.project.name !== 'desktop') await page.setViewportSize({ width: 320, height: 844 });
  let request: unknown;
  await page.route('**/api/auth/login', async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({
      status: 401,
      json: {
        errorCode: 'INVALID_CREDENTIALS',
        userMessage: 'Tên đăng nhập hoặc mật khẩu chưa đúng.',
      },
    });
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập nội bộ' })).toBeVisible();
  const password = page.getByLabel('Mật khẩu', { exact: true });
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('tai-khoan-kiem-tra');
  await password.fill('mat-khau-kiem-tra');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Hiện mật khẩu' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ẩn mật khẩu' }).click();
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('.internal-login-card').getByRole('alert')).toHaveText(
    'Tên đăng nhập hoặc mật khẩu chưa đúng.',
  );
  expect(request).toEqual({ username: 'tai-khoan-kiem-tra', password: 'mat-khau-kiem-tra' });
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  await fits(page);
  await page.screenshot({
    path:
      '/mnt/c/Users/Admin/.codex/.chatgpt-projects/g-p-6abb725d13508191b0b02a8845acc6cd/restaurant-v4/internal-login-' +
      info.project.name +
      '.png',
    fullPage: true,
  });
});
