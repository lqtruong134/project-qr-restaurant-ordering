import { test, expect } from '@playwright/test';
test('foundation page reflects actual API and database readiness', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect
    .poll(async () => (await request.get('http://127.0.0.1:4000/health/ready')).status())
    .toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Môi trường đã sẵn sàng' })).toBeVisible();
  await expect(page.getByLabel('Trạng thái hệ thống')).toContainText('Hoạt động');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('foundation.png'), fullPage: true });
});
