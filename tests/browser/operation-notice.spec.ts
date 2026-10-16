import { test, expect } from '@playwright/test';

test('staff partial order cancellation reports the exact result inside the table dialog and keeps skipped dishes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const now = new Date().toISOString();
  const table = {
    id: 'notice-table',
    name: 'Bàn thông báo hủy món',
    code: 'NOTICE-CANCEL',
    area_name: 'Sảnh kiểm thử',
    table_status: 'OCCUPIED',
    is_active: true,
    capacity: 4,
    session_id: 'notice-session',
    verification_status: 'VERIFIED',
    opened_at: now,
    charge_total: '70000',
    outstanding_amount: '70000',
    pending_payments: 0,
  };
  const order = {
    id: 'notice-order',
    session_id: table.session_id,
    table_code: table.code,
    area_name: table.area_name,
    created_at: now,
    status: 'SUBMITTED',
    total_amount: '70000',
    items: [
      {
        id: 'notice-cancelled-item',
        product_name_snapshot: 'Canh rau chưa chế biến',
        quantity: 1,
        unit_price_snapshot: '30000',
        line_total: '30000',
        status: 'SUBMITTED',
      },
      {
        id: 'notice-skipped-item',
        product_name_snapshot: 'Cơm chiên đã làm xong',
        quantity: 1,
        unit_price_snapshot: '40000',
        line_total: '40000',
        status: 'READY',
        ready_at: now,
      },
    ],
  };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const unexpectedWrites: string[] = [];
  // All business writes are mocked, including fail-closed handling for unexpected mutations.
  await page.route('**/api/core/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path === '/api/core/orders') return route.fulfill({ json: [order] });
      if (path === '/api/core/tables') return route.fulfill({ json: [table] });
      if (path === '/api/core/support' || path === '/api/core/alerts')
        return route.fulfill({ json: [] });
      if (path === '/api/core/catalog')
        return route.fulfill({ json: { products: [], categories: [] } });
      return route.continue();
    }
    writes.push({ path, body: request.postDataJSON() as Record<string, unknown> });
    if (request.method() === 'POST' && path === '/api/core/orders/notice-order/cancel') {
      order.items[0]!.status = 'CANCELLED';
      table.charge_total = '40000';
      table.outstanding_amount = '40000';
      return route.fulfill({
        json: {
          cancelled: [order.items[0]!.id],
          skipped: [order.items[1]!.id],
        },
      });
    }
    unexpectedWrites.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { userMessage: 'Unexpected mocked core mutation' } });
  });

  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('pv008');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/staff/);
  await page
    .locator('.table-tile')
    .filter({ has: page.getByRole('heading', { name: table.name, exact: true }) })
    .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Chi tiết - ' + table.name, exact: true });
  await expect(dialog).toBeVisible();
  const card = dialog.locator('.order-card');
  await card.getByText('Hủy các món chưa chế biến trong lượt', { exact: true }).click();
  const form = card
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Hủy món chưa chế biến', exact: true }) });
  await form.getByLabel('Ghi chú thêm', { exact: true }).fill('Khách đổi món chưa chế biến.');
  const selectedReason = await form.getByLabel('Lý do xử lý', { exact: true }).inputValue();
  await form.getByRole('button', { name: 'Xác nhận hủy', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
    .getByRole('button', { name: 'Xác nhận hủy', exact: true })
    .click();

  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog).toBeVisible();
  const partial = dialog
    .getByRole('status')
    .filter({ hasText: 'Đã hủy 1 món; giữ lại 1 món không còn đủ điều kiện.' });
  await expect(partial).toBeVisible();
  await expect(partial.locator('p')).toHaveText(
    'Đã hủy 1 món; giữ lại 1 món không còn đủ điều kiện.',
  );
  await expect(partial).toContainText('Thông tin');
  await expect(partial).not.toContainText(/Thành công|Đã hủy 2 món|Đã hủy toàn bộ/i);
  await expect(
    card
      .locator('.core-order-item')
      .filter({ hasText: 'Canh rau chưa chế biến' })
      .locator('.status-pill'),
  ).toHaveText('Đã hủy');
  await expect(
    card
      .locator('.core-order-item')
      .filter({ hasText: 'Cơm chiên đã làm xong' })
      .locator('.status-pill'),
  ).toHaveText('Chờ mang ra');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const box = await partial.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  await page.screenshot({
    path: info.outputPath('staff-partial-cancellation-notice-320px.png'),
    fullPage: false,
  });
  await partial.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();
  await expect(partial).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(writes).toEqual([
    {
      path: '/api/core/orders/notice-order/cancel',
      body: { reasonCode: selectedReason, note: 'Khách đổi món chưa chế biến.' },
    },
  ]);
  expect(unexpectedWrites).toEqual([]);
  expect(errors).toEqual([]);
});
