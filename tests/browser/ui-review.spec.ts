import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
test.use({ actionTimeout: 15000 });
async function login(page: Page, username: string, role: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function fits(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = visualViewport?.width ?? innerWidth;
    return { width, scroll: document.documentElement.scrollWidth };
  });
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 1);
}
function failures(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500)
      errors.push(r.status() + ' ' + new URL(r.url()).pathname);
  });
  return errors;
}
test('all admin sections remain usable with an expanded or collapsed sidebar, dialogs and narrow layouts', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors = failures(page);
  await login(page, 'quyettruong05', 'admin');
  await expect(
    page.getByRole('region', { name: 'Tình trạng vận hành', exact: true }),
  ).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Quản trị', exact: true });
  const sections = [
    ['Tổng quan', 'Tổng quan nhà hàng'],
    ['Thực đơn', 'Quản lý món ăn'],
    ['Bàn & QR', 'Danh sách bàn'],
    ['Kho & công thức', 'Tồn kho nguyên liệu'],
    ['Nhân viên', 'Đội ngũ của bạn'],
    ['Ca làm & lương', 'Lịch phân ca'],
    ['Kiểm soát gọi món', 'Quy tắc gọi món'],
    ['Báo cáo', 'Báo cáo doanh số món'],
  ];
  for (const [label, heading] of sections) {
    const expand = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
    if (await expand.count()) await expand.click();
    await selectAdmin(page, label!);
    await expect(page.locator('.admin-content > .section-heading h2')).toHaveText(heading!);
    await fits(page);
    if (!info.project.use.isMobile) {
      await nav.getByRole('button', { name: 'Thu gọn thanh điều hướng', exact: true }).click();
      const reload = nav.getByRole('button', { name: 'Tải lại dữ liệu', exact: true });
      const dimensions = await reload.evaluate((button) => ({
        width: button.getBoundingClientRect().width,
        rail: button.closest('nav')!.getBoundingClientRect().width,
        scroll: button.scrollWidth,
        client: button.clientWidth,
        height: button.getBoundingClientRect().height,
      }));
      expect(dimensions.width).toBeLessThanOrEqual(dimensions.rail);
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      expect(dimensions.height).toBeLessThanOrEqual(50);
      await reload.click();
      await expect(reload).toBeEnabled();
      await expect(reload).toHaveAttribute('aria-busy', 'false');
      await expect(reload.locator('svg')).toBeVisible();
      await expect(reload.locator('.sidebar-label')).toBeHidden();
      await fits(page);
    }
    await page.screenshot({
      path: info.outputPath('admin-' + label + '.png'),
      fullPage: !info.project.use.isMobile,
    });
    if (label === 'Báo cáo') {
      for (const name of [
        'Doanh số món',
        'Tiền đã thu',
        'Lịch sử thiếu tiền',
        'Tra cứu & xử lý món',
        'Đối soát phiên',
      ]) {
        await selectAdmin(page, 'Báo cáo', name);
        await fits(page);
      }
    }
    if (label === 'Kiểm soát gọi món') {
      for (const name of ['Bàn & thanh toán', 'Ca & chấm công', 'Quy tắc gọi món']) {
        await selectAdmin(page, 'Kiểm soát gọi món', name);
        await fits(page);
      }
    }
  }
  const expand = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
  if (await expand.count()) await expand.click();
  await selectAdmin(page, 'Bàn & QR');
  await page.getByRole('button', { name: 'Chỉnh sửa bàn', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await fits(page);
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (!info.project.use.isMobile) {
    for (const width of [1280, 1024, 801, 800, 540, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(page);
      await page.screenshot({
        path: info.outputPath('admin-width-' + width + '.png'),
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});
for (const [username, role] of [
  ['pv003', 'staff'],
  ['bep003', 'kitchen'],
]) {
  test(`${role} operational and personal screens fit with search, filters and receipt history`, async ({
    page,
  }, info) => {
    const errors = failures(page);
    await login(page, username!, role!);
    await expect(page.locator('.service-overview')).toBeVisible();
    await fits(page);
    if (role === 'staff') {
      for (const name of ['Sơ đồ bàn', 'Việc cần làm', 'Gọi món', 'Phiếu đã chốt']) {
        await page
          .getByRole('navigation', { name: 'Phục vụ', exact: true })
          .getByRole('button', { name: new RegExp(name) })
          .click();
        await page
          .getByRole('textbox', {
            name:
              name === 'Phiếu đã chốt'
                ? 'Tìm số phiếu, mã bàn hoặc người kết thúc…'
                : 'Tìm tên hoặc mã bàn…',
          })
          .fill('KHÔNG TÌM THẤY');
        await fits(page);
        await page
          .getByRole('textbox', {
            name:
              name === 'Phiếu đã chốt'
                ? 'Tìm số phiếu, mã bàn hoặc người kết thúc…'
                : 'Tìm tên hoặc mã bàn…',
          })
          .fill('');
        await fits(page);
        await page.screenshot({
          path: info.outputPath('staff-' + name + '.png'),
          fullPage: !info.project.use.isMobile,
        });
      }
    } else {
      await page.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill('KHÔNG TÌM THẤY');
      await fits(page);
      await page.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill('');
      await page.screenshot({
        path: info.outputPath('kitchen-queue.png'),
        fullPage: !info.project.use.isMobile,
      });
    }
    await page.getByRole('button', { name: 'Lịch làm & lương của tôi', exact: true }).click();
    for (const name of ['Lịch của tôi', 'Lịch sử chấm công', 'Phiếu lương']) {
      await page.getByRole('button', { name, exact: true }).click();
      await fits(page);
    }
    if (!info.project.use.isMobile) {
      for (const width of [1024, 768, 540, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.getByRole('button', { name: 'Lịch sử chấm công', exact: true }).click();
        await fits(page);
        await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
        await fits(page);
      }
    }
    expect(errors).toEqual([]);
  });
}
