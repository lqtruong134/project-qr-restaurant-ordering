import { test, expect, type Locator } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

async function noClippedFields(dialog: Locator) {
  const geometry = await dialog.evaluate((node) => {
    const body = node.querySelector('.dialog-body')!;
    const bodyBox = body.getBoundingClientRect();
    const fields = Array.from(node.querySelectorAll('input, select, textarea')).map((field) => {
      const box = field.getBoundingClientRect();
      return {
        name: field.getAttribute('name'),
        left: box.left,
        right: box.right,
        width: box.width,
      };
    });
    const title = node.querySelector('h2')!.getBoundingClientRect();
    const close = node.querySelector('.icon-button')!.getBoundingClientRect();
    return {
      dialogWidth: node.clientWidth,
      dialogScroll: node.scrollWidth,
      bodyWidth: body.clientWidth,
      bodyScroll: body.scrollWidth,
      bodyLeft: bodyBox.left,
      bodyRight: bodyBox.right,
      overlap:
        title.right > close.left + 1 &&
        title.bottom > close.top + 1 &&
        close.bottom > title.top + 1,
      fields,
    };
  });
  expect(geometry.dialogScroll).toBeLessThanOrEqual(geometry.dialogWidth + 1);
  expect(geometry.bodyScroll).toBeLessThanOrEqual(geometry.bodyWidth + 1);
  expect(geometry.overlap).toBe(false);
  expect(geometry.fields).toHaveLength(3);
  for (const field of geometry.fields) {
    expect(field.width, field.name ?? '').toBeGreaterThan(100);
    expect(field.left, field.name ?? '').toBeGreaterThanOrEqual(geometry.bodyLeft - 1);
    expect(field.right, field.name ?? '').toBeLessThanOrEqual(geometry.bodyRight + 1);
  }
}

test('stock count and waste dialog keeps empty and filled fields visible with long ingredient and storage names', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ingredient =
    'Bánh phở tươi dùng cho món phở bò và món cuốn của nhà hàng, bảo quản trong kho mát';
  await page.route('**/api/core/inventory', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.balances[0] = {
      ...data.balances[0],
      ingredient_name: ingredient,
      unit: 'KG',
      location_name: 'Kho mát và nguyên liệu bếp ở khu vực chế biến dành cho món nước',
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  await selectAdmin(page, 'Kho & công thức', 'Tồn kho');
  const row = page.locator('.inv-table tbody tr').filter({ hasText: ingredient });
  await row.getByRole('button', { name: 'Kiểm kê / xuất hủy', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Kiểm kê / xuất hủy - ' + ingredient,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Số lượng (KG)', { exact: true })).toHaveValue('');
  const widths = info.project.use.isMobile ? [390, 320] : [1440, 1024, 768, 540, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await noClippedFields(dialog);
  }
  await dialog.getByLabel('Loại ghi nhận', { exact: true }).selectOption('WASTE');
  await dialog.getByLabel('Số lượng (KG)', { exact: true }).fill('1.25');
  await dialog
    .getByLabel('Lý do / biên bản kiểm kê hoặc hư hỏng', { exact: true })
    .fill(
      'Nguyên liệu hỏng được đối chiếu tại kho và xuất hủy theo biên bản kiểm kê của ca làm việc. '.repeat(
        4,
      ),
    );
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await noClippedFields(dialog);
    if (width === 1440 || width === 390) {
      await page.screenshot({
        path: info.outputPath('stock-adjustment-' + width + 'px.png'),
        fullPage: false,
      });
    }
  }
  await dialog.getByRole('button', { name: 'Điều chỉnh tồn', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Kiểm tra trước khi xác nhận',
    exact: true,
  });
  await expect(confirmation).toContainText('Xuất hủy lượng nguyên liệu 1.25 KG');
  await confirmation.getByRole('button', { name: 'Quay lại chỉnh sửa', exact: true }).click();
  await expect(dialog.getByLabel('Số lượng (KG)', { exact: true })).toHaveValue('1.25');
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Bỏ thay đổi chưa lưu?', exact: true })
    .getByRole('button', { name: 'Bỏ thay đổi', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
