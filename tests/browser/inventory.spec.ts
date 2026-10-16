import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
test.use({ actionTimeout: 15000 });
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  await selectAdmin(page, 'Kho & công thức');
  await expect(page.getByRole('heading', { name: 'Tồn kho', exact: true })).toBeVisible();
}
async function inventory(page: Page) {
  const response = await page.request.get('/api/core/inventory');
  expect(response.ok()).toBe(true);
  return await response.json();
}
async function fits(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: visualViewport?.width ?? innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.width + 1);
}
const nav = (page: Page, name: string) => ({
  click: () => selectAdmin(page, 'Kho & công thức', name),
});
function failures(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500)
      errors.push(r.status() + ' ' + new URL(r.url()).pathname);
  });
  return errors;
}
test('inventory tasks have readable stock filters, pagination, recipe details, history and setup on every viewport', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors = failures(page);
  await login(page);
  const data = await inventory(page);
  const rows = page.locator('.inv-app .inv-table tbody tr');
  await expect(rows).toHaveCount(Math.min(data.balances.length, 12));
  await expect(page.getByRole('heading', { name: 'Lịch sử kho', exact: true })).toHaveCount(0);
  await fits(page);
  await page.screenshot({
    path: info.outputPath('inventory-stock.png'),
    fullPage: !info.project.use.isMobile,
  });
  if (data.balances.length > 12) {
    const oldName = await rows.first().locator('.inv-name-button').innerText();
    await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
    await expect(rows.first().locator('.inv-name-button')).not.toHaveText(oldName);
  }
  const location = data.locations.find((l: { id: string }) =>
    data.balances.some((b: { location_id: string }) => b.location_id === l.id),
  );
  await page.getByLabel('Kho', { exact: true }).selectOption(location.id);
  for (const row of await rows.all())
    await expect(row.locator('[data-label="Kho"]')).toHaveText(location.name);
  const balance = data.balances.find((b: { location_id: string }) => b.location_id === location.id);
  await page
    .getByRole('textbox', { name: 'Tìm nguyên liệu, mã hoặc kho…' })
    .fill(balance.ingredient_name);
  await page.locator('.inv-name-button').first().click();
  await expect(page.getByRole('dialog')).toContainText('Giữ cho món');
  await fits(page);
  await page.getByRole('button', { name: 'Xem lịch sử của nguyên liệu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lịch sử kho', exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Tìm nguyên liệu, mã phiếu, người hoặc lý do…' })
    .fill('');
  await page.getByLabel('Loại biến động', { exact: true }).selectOption('WASTE');
  await fits(page);
  await nav(page, 'Phiếu nhập').click();
  await page.getByLabel('Trạng thái phiếu', { exact: true }).selectOption('DRAFT');
  await fits(page);
  await nav(page, 'Công thức món').click();
  await expect(page.locator('.inv-recipe-card')).toHaveCount(12);
  await page.screenshot({
    path: info.outputPath('inventory-recipes.png'),
    fullPage: !info.project.use.isMobile,
  });
  await page.getByRole('button', { name: 'Xem công thức', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Định lượng cho');
  await expect(page.getByRole('dialog').locator('tbody tr')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Thay công thức', exact: true }).click();
  await expect(page.getByLabel('Số phần công thức tạo ra')).toHaveValue('1');
  await expect(page.getByLabel('Nguyên liệu 1', { exact: true })).not.toHaveValue('');
  await fits(page);
  await page.screenshot({ path: info.outputPath('inventory-form.png'), fullPage: false });
  await page.getByLabel('Số phần công thức tạo ra').fill('2');
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  const discardWarning = page.getByRole('dialog', {
    name: 'Bỏ thay đổi chưa lưu?',
    exact: true,
  });
  await discardWarning.getByRole('button', { name: 'Tiếp tục chỉnh sửa', exact: true }).click();
  await expect(discardWarning).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Số phần công thức tạo ra')).toHaveValue('2');
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await discardWarning.getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const name of ['Nguyên liệu', 'Kho lưu trữ', 'Đơn vị tính']) {
    await selectAdmin(page, 'Kho & công thức', name);
    await fits(page);
  }
  await page.getByRole('button', { name: 'Thêm đơn vị', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await fits(page);
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await nav(page, 'Tồn kho').click();
  await page.getByLabel('Tình trạng', { exact: true }).selectOption('empty');
  await page.getByLabel('Kho', { exact: true }).selectOption(location.id);
  const empty = data.balances.filter(
    (b: { location_id: string; available_qty: string }) =>
      b.location_id === location.id && Number(b.available_qty) <= 0,
  );
  await expect(rows).toHaveCount(Math.min(empty.length, 12));
  if (!empty.length)
    await expect(page.getByRole('heading', { name: 'Không có nguyên liệu phù hợp' })).toBeVisible();
  if (!info.project.use.isMobile) {
    for (const width of [1024, 801, 800, 540, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(page);
    }
  }
  expect(errors).toEqual([]);
});
test('receipt draft is readable, editable, approved once into stock and cancellable without changing stock', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors = failures(page);
  await login(page);
  const before = await inventory(page);
  const balance = before.balances[0];
  const number = 'UI-PN-' + info.project.name + '-' + Date.now();
  const create = async (code: string) => {
    await page.getByRole('button', { name: 'Lập phiếu nhập', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Kho nhận', { exact: true }).selectOption(balance.location_id);
    await expect(dialog).toContainText('Tự động tạo khi lưu');
    await dialog.getByLabel('Mã chứng từ bên ngoài', { exact: false }).fill(code);
    await dialog.getByLabel('Nhà cung cấp', { exact: false }).fill('Nhà cung cấp kiểm thử');
    await dialog.getByLabel('Nguyên liệu 1', { exact: true }).selectOption(balance.ingredient_id);
    await dialog.getByLabel('Số lượng dòng 1', { exact: true }).fill('2');
    await dialog.getByLabel('Đơn giá dòng 1', { exact: true }).fill('35000');
    await fits(page);
    await dialog.getByRole('button', { name: 'Lưu phiếu nháp', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Tìm số phiếu, chứng từ hoặc nguồn mua…' }).fill(code);
    await page.getByRole('button', { name: 'Xem phiếu', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(code);
    await expect(page.getByRole('dialog')).toContainText(/PN-\d{6,}/);
  };
  await create(number);
  let state = await inventory(page);
  expect(state.balances.find((b: { id: string }) => b.id === balance.id).on_hand_qty).toBe(
    balance.on_hand_qty,
  );
  await page.getByRole('button', { name: 'Sửa phiếu nháp', exact: true }).click();
  await page.getByLabel('Lý do sửa', { exact: true }).fill('Đối chiếu phiếu giao hàng');
  await page.getByLabel('Số lượng dòng 1', { exact: true }).fill('3');
  await page.getByLabel('Đơn giá dòng 1', { exact: true }).fill('40000');
  await page.getByRole('button', { name: 'Lưu phiếu nháp', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xem phiếu', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('120.000');
  await page.screenshot({
    path: info.outputPath('inventory-receipt.png'),
    fullPage: !info.project.use.isMobile,
  });
  await page.getByRole('button', { name: 'Duyệt nhập kho', exact: true }).click();
  const approveDialog = page.getByRole('dialog', { name: 'Xác nhận thao tác' });
  await expect(approveDialog).toContainText('Sau duyệt, phiếu không còn sửa như bản nháp.');
  await approveDialog.getByRole('button', { name: 'Duyệt nhập kho', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  state = await inventory(page);
  expect(Number(state.balances.find((b: { id: string }) => b.id === balance.id).on_hand_qty)).toBe(
    Number(balance.on_hand_qty) + 3,
  );
  expect(
    state.receipts.find((r: { external_reference: string }) => r.external_reference === number)
      .status,
  ).toBe('APPROVED');
  await page.getByLabel('Trạng thái phiếu', { exact: true }).selectOption('APPROVED');
  await page.getByRole('button', { name: 'Xem phiếu', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Duyệt nhập kho', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await create(number + '-HUY');
  await page.getByRole('button', { name: 'Hủy phiếu nháp', exact: true }).click();
  await page.getByLabel('Lý do hủy', { exact: true }).fill('Phiếu nhập trùng');
  await page.getByRole('button', { name: 'Xác nhận hủy phiếu nháp', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Hủy phiếu nhập nháp?', exact: true })
    .getByRole('button', { name: 'Hủy phiếu nháp', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  state = await inventory(page);
  expect(
    state.receipts.find(
      (r: { external_reference: string }) => r.external_reference === number + '-HUY',
    ).status,
  ).toBe('CANCELLED');
  expect(Number(state.balances.find((b: { id: string }) => b.id === balance.id).on_hand_qty)).toBe(
    Number(balance.on_hand_qty) + 3,
  );
  expect(errors).toEqual([]);
});
