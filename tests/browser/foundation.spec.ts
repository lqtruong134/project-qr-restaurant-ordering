import { test, expect } from '@playwright/test';
test('internal entry and QR guest entry render while the API is ready', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect
    .poll(async () =>
      (
        await request.get((process.env.API_BASE_URL ?? 'http://127.0.0.1:4000') + '/health/ready')
      ).status(),
    )
    .toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Đăng nhập nội bộ', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tên đăng nhập', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  await page.goto('/guest');
  await expect(
    page.getByRole('heading', { name: 'Quét QR tại bàn để bắt đầu', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.screenshot({
    caret: 'initial',
    path: testInfo.outputPath('foundation.png'),
    fullPage: true,
  });
});
