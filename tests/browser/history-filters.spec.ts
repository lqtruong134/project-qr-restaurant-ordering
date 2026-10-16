import { test, expect, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
}
test('history combines periods, search, location, status and pagination without stale results or overflow', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const inventory = await (await page.request.get('/api/core/inventory')).json();
  const requests: URL[] = [];
  await page.route('**/api/core/history/receipts?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const filtered = Boolean(url.searchParams.get('q')),
      p = Number(url.searchParams.get('page') ?? 0);
    const empty = url.searchParams.get('from') === '2000-01-01';
    const total = empty ? 0 : filtered ? 1 : 25;
    const rows = Array.from({ length: Math.max(0, Math.min(12, total - p * 12)) }, (_, i) => ({
      id: 'row-' + (p * 12 + i),
      receipt_no: 'PN-' + String(p * 12 + i + 1).padStart(6, '0'),
      supplier_name_snapshot: 'Chợ Tân An và đơn vị giao nguyên liệu cho bếp nhà hàng',
      external_reference: 'HD-000534',
      location_id: inventory.locations[0].id,
      total_value: '1800000',
      status: 'DRAFT',
      created_at: '2026-10-06T06:00:00Z',
      creator_name: 'Người lập phiếu',
    }));
    await route.fulfill({
      json: {
        rows,
        total,
        page: p,
        pageSize: 12,
        timezone: 'Asia/Ho_Chi_Minh',
        range:
          url.searchParams.get('period') === 'all'
            ? null
            : { startDay: '2026-10-01', endDay: '2026-10-06' },
      },
    });
  });
  await selectAdmin(page, 'Kho & công thức', 'Phiếu nhập');
  const history = page.locator('.inv-panel .history-view');
  await expect(history.locator('tbody tr')).toHaveCount(12);
  expect(
    await history.locator('.search-field').evaluate((el) => getComputedStyle(el).display),
  ).toBe('flex');
  expect(
    await history
      .locator('.search-field input')
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
  ).toBe('0px');
  await history.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('page')).toBe('1');
  await history.getByLabel('Thời gian', { exact: true }).selectOption('today');
  await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('today');
  await history.getByLabel('Thời gian', { exact: true }).selectOption('week');
  await expect.poll(() => requests.at(-1)?.searchParams.get('page')).toBe('0');
  await history.getByLabel('Thời gian', { exact: true }).selectOption('month');
  await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('month');
  await history.getByLabel('Kho', { exact: true }).selectOption(inventory.locations[0].id);
  await history.getByLabel('Trạng thái phiếu', { exact: true }).selectOption('DRAFT');
  await history
    .getByRole('textbox', { name: 'Tìm số phiếu, chứng từ hoặc nguồn mua…' })
    .fill('HD-000534');
  await expect(history.locator('tbody tr')).toHaveCount(1);
  expect(requests.at(-1)?.searchParams.get('scope')).toBe(inventory.locations[0].id);
  expect(requests.at(-1)?.searchParams.get('status')).toBe('DRAFT');
  await history.getByLabel('Thời gian', { exact: true }).selectOption('custom');
  await history.getByLabel('Từ ngày', { exact: true }).fill('2000-01-01');
  await history.getByLabel('Đến ngày', { exact: true }).fill('2000-01-02');
  await expect(history).toContainText('Không có lịch sử phù hợp');
  await history.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(history.locator('tbody tr')).toHaveCount(12);
  await expect(history.getByLabel('Kho', { exact: true })).toHaveValue('all');
  await expect(history.getByLabel('Trạng thái phiếu', { exact: true })).toHaveValue('all');
  for (const width of info.project.use.isMobile ? [390, 320] : [1440, 1024, 540, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  }
  await page.screenshot({
    path: info.outputPath('history-filters.png'),
    fullPage: !info.project.use.isMobile,
  });
  expect(errors).toEqual([]);
});
test('market purchase needs no manual number or invoice and stale approval reloads the reviewed amount', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page);
  const inv = await (await page.request.get('/api/core/inventory')).json();
  await selectAdmin(page, 'Kho & công thức', 'Phiếu nhập');
  await page.getByRole('button', { name: 'Lập phiếu nhập', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Tự động tạo khi lưu');
  await expect(dialog.locator('input[name="number"]')).toHaveCount(0);
  await dialog.getByLabel('Nguyên liệu 1', { exact: true }).selectOption(inv.ingredients[0].id);
  await dialog.getByLabel('Số lượng dòng 1', { exact: true }).fill('10');
  await dialog.getByLabel('Đơn giá dòng 1', { exact: true }).fill('180000');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/core/receipts') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Lưu phiếu nháp', exact: true }).click();
  const created = await (await response).json();
  expect(created.receipt_no).toMatch(/^PN-\d{6,}$/);
  expect(created.external_reference).toBeNull();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Tìm số phiếu, chứng từ hoặc nguồn mua…' })
    .fill(created.receipt_no);
  await page.getByRole('button', { name: 'Xem phiếu', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1.800.000');
  const changed = await page.evaluate(
    async (body) => {
      const r = await fetch('/api/core/receipts/' + body.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: JSON.stringify({
          locationId: body.location_id,
          expectedVersion: body.version,
          reason: 'Người khác đã kiểm đếm lại hàng',
          lines: [{ ingredientId: body.ingredientId, quantity: '12', unitCost: '180000' }],
        }),
      });
      return r.status;
    },
    { ...created, ingredientId: inv.ingredients[0].id },
  );
  expect(changed).toBe(200);
  await page.getByRole('button', { name: 'Duyệt nhập kho', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Xác nhận thao tác' });
  await expect(confirm).toContainText('1.800.000');
  await confirm.getByRole('button', { name: 'Duyệt nhập kho', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Phiếu đã được sửa ở nơi khác');
  await expect(page.getByRole('dialog')).toContainText('2.160.000');
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(1);
  const detail = await (await page.request.get('/api/core/receipts/' + created.id)).json();
  expect(detail.status).toBe('DRAFT');
  expect(detail.audit.some((e: { action: string }) => e.action === 'EDIT_DRAFT_RECEIPT')).toBe(
    true,
  );
  await page.screenshot({
    path: info.outputPath('stale-receipt.png'),
    fullPage: !info.project.use.isMobile,
  });
});
