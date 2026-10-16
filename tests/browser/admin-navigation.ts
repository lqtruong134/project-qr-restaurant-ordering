import { expect, type Page } from '@playwright/test';
const defaults: Record<string, string> = {
  'Việc cần xử lý': 'Tất cả việc đang chờ',
  'Thực đơn': 'Danh sách món',
  'Bàn & QR': 'Danh sách bàn',
  'Kho & công thức': 'Tồn kho',
  'Ca làm & lương': 'Lịch phân ca',
  'Kiểm soát gọi món': 'Quy tắc gọi món',
  'Báo cáo': 'Doanh số món',
};
export async function selectAdmin(page: Page, group: string, child = defaults[group]) {
  const nav = page.getByRole('navigation', { name: 'Quản trị', exact: true });
  const expand = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
  if (await expand.count()) await expand.click();
  const parent = nav.getByRole('button', { name: group, exact: true });
  if (child) {
    if ((await parent.getAttribute('aria-expanded')) !== 'true') await parent.click();
    const item = nav
      .locator('.sidebar-group')
      .filter({ has: page.getByRole('button', { name: group, exact: true, includeHidden: true }) })
      .getByRole('button', { name: child, exact: true, includeHidden: true });
    await item.click();
    await expect(item).toHaveAttribute('aria-current', 'page');
  } else await parent.click();
}
