import { test, expect } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

test('ADMIN sidebar keeps expanded stock and reports in one scrollable column', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  await selectAdmin(page, 'Nhân viên');

  const nav = page.getByRole('navigation', { name: 'Quản trị', exact: true });
  const viewports = info.project.use.isMobile
    ? [info.project.use.viewport!, { width: 320, height: 640 }]
    : [
        { width: 1440, height: 600 },
        { width: 1024, height: 600 },
        { width: 801, height: 600 },
        { width: 1440, height: 1000 },
      ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const expand = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
    if (await expand.count()) await expand.click();

    for (const name of ['Kho & công thức', 'Báo cáo']) {
      const parent = nav.getByRole('button', { name, exact: true });
      if ((await parent.getAttribute('aria-expanded')) !== 'true') await parent.click();
      await expect(parent).toHaveAttribute('aria-expanded', 'true');

      await expect
        .poll(() =>
          nav.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const groups = Array.from(element.querySelectorAll(':scope > .sidebar-group'))
              .map((group) => group.getBoundingClientRect())
              .filter((rect) => rect.height > 0);
            const children = Array.from(
              element.querySelectorAll('.sidebar-submenu:not([hidden]) button'),
            ).map((button) => button.getBoundingClientRect());
            return {
              noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1,
              groupsStackVertically: groups.every((rect, i) => {
                const first = groups[0];
                const previous = groups[i - 1];
                return (
                  first !== undefined &&
                  Math.abs(rect.left - first.left) <= 1 &&
                  (previous === undefined || rect.top >= previous.bottom - 1)
                );
              }),
              childrenStayInsideSidebar: children.every(
                (rect) => rect.left >= bounds.left && rect.right <= bounds.right + 1,
              ),
            };
          }),
        )
        .toEqual({
          noHorizontalOverflow: true,
          groupsStackVertically: true,
          childrenStayInsideSidebar: true,
        });

      const lastChild = nav.locator('.sidebar-submenu:not([hidden]) button').last();
      await lastChild.focus();
      await expect(lastChild).toBeInViewport();
      await expect
        .poll(() =>
          lastChild.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            const bounds = button.closest('nav')!.getBoundingClientRect();
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1;
          }),
        )
        .toBe(true);

      if (viewport.height === 600 && viewport.width > 800) {
        expect(await nav.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
          true,
        );
      }
      if (viewport === viewports[0]) {
        await page.screenshot({
          path: info.outputPath(name === 'Báo cáo' ? 'sidebar-reports.png' : 'sidebar-stock.png'),
          fullPage: true,
          scale: 'css',
        });
      }
    }
  }
});

test('ADMIN grouped sidebar separates content, preserves edits, supports keys and follows shortcuts', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  const nav = page.getByRole('navigation', { name: 'Quản trị', exact: true });
  const heading = page.locator('.admin-content > .section-heading h2');
  await expect(heading).toHaveText('Tổng quan nhà hàng');
  const report = nav.getByRole('button', { name: 'Báo cáo', exact: true, includeHidden: true });
  await report.focus();
  await page.keyboard.press('Enter');
  await expect(report).toHaveAttribute('aria-expanded', 'true');
  await expect(heading).toHaveText('Tổng quan nhà hàng');
  await page.keyboard.press('Space');
  await expect(report).toHaveAttribute('aria-expanded', 'false');
  await selectAdmin(page, 'Thực đơn', 'Danh mục món');
  await expect(page.locator('.category-editor')).toBeVisible();
  await expect(page.locator('.managed-dish')).toHaveCount(0);
  await selectAdmin(page, 'Thực đơn', 'Danh sách món');
  await expect(page.locator('.managed-dish')).toHaveCount(12);
  await expect(page.locator('.category-editor')).toHaveCount(0);
  await selectAdmin(page, 'Bàn & QR', 'Khu vực phục vụ');
  await expect(page.getByRole('button', { name: 'Chỉnh sửa bàn', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cấp mã QR mới', exact: true })).toHaveCount(0);
  await selectAdmin(page, 'Bàn & QR', 'Mã QR tại bàn');
  await expect(
    page.getByRole('button', { name: 'Xem / in QR hiện tại', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chỉnh sửa bàn', exact: true })).toHaveCount(0);
  await selectAdmin(page, 'Bàn & QR', 'Danh sách bàn');
  await expect(
    page.getByRole('button', { name: 'Chỉnh sửa bàn', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cấp mã QR mới', exact: true })).toHaveCount(0);
  await selectAdmin(page, 'Kho & công thức', 'Tồn kho');
  await page.getByRole('button', { name: 'Xem phiếu chờ nhập', exact: false }).click();
  const receipts = nav.getByRole('button', {
    name: 'Phiếu nhập',
    exact: true,
    includeHidden: true,
  });
  await expect(receipts).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Trạng thái phiếu', { exact: true })).toHaveValue('DRAFT');
  await expect(page.getByRole('navigation', { name: 'Quản lý kho' })).toHaveCount(0);
  await selectAdmin(page, 'Kho & công thức', 'Đơn vị tính');
  await expect(page.getByRole('button', { name: 'Thêm đơn vị', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thêm nguyên liệu', exact: true })).toHaveCount(0);
  await selectAdmin(page, 'Kiểm soát gọi món', 'Quy tắc gọi món');
  const setting = page.locator('.risk-app input').first();
  const old = await setting.inputValue();
  await setting.fill(String(Number(old) + 1));
  // Merely expanding another group must not discard the current form.
  const menuToggle = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
  if (await menuToggle.count()) await menuToggle.click();
  const payroll = nav.getByRole('button', { name: 'Ca làm & lương', exact: true });
  if ((await payroll.getAttribute('aria-expanded')) !== 'true') await payroll.click();
  await expect(setting).toHaveValue(String(Number(old) + 1));
  await selectAdmin(page, 'Tổng quan');
  const discardWarning = page.getByRole('dialog', {
    name: 'Bỏ thay đổi chưa lưu?',
    exact: true,
  });
  await discardWarning.getByRole('button', { name: 'Tiếp tục chỉnh sửa', exact: true }).click();
  await expect(discardWarning).toHaveCount(0);
  await expect(heading).toHaveText('Quy tắc gọi món');
  await expect(setting).toHaveValue(String(Number(old) + 1));
  await selectAdmin(page, 'Tổng quan');
  await discardWarning.getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(heading).toHaveText('Tổng quan nhà hàng');
  await page.getByRole('button', { name: 'Xem báo cáo bán hàng', exact: false }).click();
  await expect(heading).toHaveText('Báo cáo doanh số món');
  await expect(report).toHaveAttribute(
    'aria-expanded',
    info.project.use.isMobile ? 'false' : 'true',
  );
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Nhóm báo cáo' })).toHaveCount(0);
  await selectAdmin(page, 'Báo cáo', 'Tiền đã thu');
  await expect(heading).toHaveText('Báo cáo tiền đã thu');
  await expect(page.getByText('Giá vốn', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Nhóm chính sách' })).toHaveCount(0);
  if (!info.project.use.isMobile) {
    await nav.getByRole('button', { name: 'Thu gọn thanh điều hướng', exact: true }).click();
    const stock = nav.getByRole('button', { name: 'Kho & công thức', exact: true });
    await stock.click();
    await expect(stock).toHaveAttribute('aria-expanded', 'true');
    await selectAdmin(page, 'Báo cáo', 'Tiền đã thu');
  }
  for (const width of info.project.use.isMobile
    ? [info.project.use.viewport!.width]
    : [1440, 1024, 768, 390, 320]) {
    if (!info.project.use.isMobile) await page.setViewportSize({ width, height: 960 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await selectAdmin(page, 'Báo cáo', 'Tiền đã thu');
    const expand = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
    if (await expand.count()) await expand.click();
    await expect(nav.getByRole('button', { name: 'Tiền đã thu', exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath('admin-sidebar-' + width + '.png'),
      fullPage: true,
      scale: 'css',
    });
  }
  expect(errors).toEqual([]);
});
