import { test, expect } from '@playwright/test';
test('public landing renders restaurant entry while API is ready', async ({
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
  await expect(page.getByRole('heading', { name: /Món ngon trên bàn/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Đăng nhập nội bộ/ })).toHaveAttribute(
    'href',
    '/login',
  );
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
