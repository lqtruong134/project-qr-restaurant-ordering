import { test, expect } from '@playwright/test';

test('internal entry has a real photograph, readable controls and a keyboard skip link at small widths', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập nội bộ');
  const photograph = page.locator('.internal-login-background img');
  await expect(photograph).toHaveCount(1);
  await expect
    .poll(() => photograph.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(photograph).not.toHaveAttribute('src', /placeholders|\.svg$/);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    const skip = page.getByRole('link', { name: 'Đến biểu mẫu đăng nhập', exact: true });
    await skip.focus();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#login-form$/);
    await expect(page.locator('#login-form')).toBeFocused();
    await expect(page.getByLabel('Tên đăng nhập', { exact: true })).toBeInViewport();
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeInViewport();
    await page.screenshot({
      path: info.outputPath('internal-entry-' + width + '.png'),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test('internal login keeps its fields visible over the photograph and reports a failed login clearly', async ({
  page,
}, info) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      json: {
        errorCode: 'INVALID_CREDENTIALS',
        userMessage: 'Tên đăng nhập hoặc mật khẩu chưa đúng.',
      },
    }),
  );
  await page.goto('/login');
  const photograph = page.locator('.internal-login-background img');
  await expect
    .poll(() => photograph.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect(page.getByLabel('Tên đăng nhập', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeVisible();
    const field = await page.getByLabel('Mật khẩu', { exact: true }).boundingBox();
    const toggle = await page
      .getByRole('button', { name: 'Hiện mật khẩu', exact: true })
      .boundingBox();
    expect(field).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(field!.y + field!.height + 1);
    await page.screenshot({ path: info.outputPath('login-' + width + '.png'), fullPage: true });
  }
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('pv001');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('invalid-login');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'Tên đăng nhập hoặc mật khẩu chưa đúng.',
  );
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
});
