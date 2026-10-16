import { test, expect } from '@playwright/test';

test('restaurant entry has working photographs, readable sections and real navigation at small widths', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Món Việt quen thuộc');
  for (const image of await page.locator('.landing-visual img, .landing-dishes img').all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(image).not.toHaveAttribute('src', /placeholders|\.svg$/);
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.getByRole('link', { name: 'Cách gọi món tại bàn', exact: true }).click();
    await expect(page).toHaveURL(/#tai-ban$/);
    await expect(
      page.getByRole('heading', { name: 'Ngồi thoải mái, chọn món trên điện thoại' }),
    ).toBeInViewport();
    await page.getByRole('link', { name: 'Khám phá món Việt', exact: true }).click();
    await expect(page).toHaveURL(/#mon-viet$/);
    await expect(
      page.getByRole('heading', { name: 'Một vài món cho bữa ăn của bạn' }),
    ).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath('landing-' + width + '.png'), fullPage: true });
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
  const photograph = page.locator('.auth-story-photo');
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
