import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#username').fill('quyettruong05');
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
}
async function menu(page: Page, name: string) {
  await selectAdmin(page, name);
}

test('overview charts switch real periods and numeric views without changing live operating scope', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const stats = page.getByRole('region', { name: 'Thống kê theo thời gian', exact: true });
  await expect(stats.getByRole('heading', { name: 'Tiền thu & hoàn', exact: true })).toBeVisible();
  const periods = stats.getByRole('group', { name: 'Khoảng thống kê' });
  await expect(periods.getByRole('button', { name: '7 ngày qua', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(stats.getByRole('img', { name: /Tiền thu & hoàn/ })).toBeVisible();
  await expect(stats).toContainText('chưa trừ chi phí');
  const liveBefore = await page
    .getByRole('button', { name: /Bàn đang phục vụ:/ })
    .getAttribute('aria-label');
  for (const [label, period] of [
    ['Hôm nay', 'today'],
    ['Tháng này', 'month'],
    ['7 ngày qua', 'week'],
  ]) {
    const response = page.waitForResponse(
      (r) => r.url().includes('/overview/statistics?period=' + period) && r.status() === 200,
    );
    await periods.getByRole('button', { name: label, exact: true }).click();
    const data = await (await response).json();
    expect(data.period).toBe(period);
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    await expect(periods.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(data.series.length).toBeLessThanOrEqual(period === 'today' ? 24 : 31);
    await expect(page.getByRole('button', { name: /Bàn đang phục vụ:/ })).toHaveAttribute(
      'aria-label',
      liveBefore!,
    );
  }
  await stats.getByRole('button', { name: 'Bảng số liệu', exact: true }).click();
  await expect(stats.locator('.overview-data-table')).toHaveCount(2);
  await expect(stats.locator('.overview-trend')).toHaveCount(0);
  await expect(stats.locator('.overview-data-table').first().locator('tbody tr')).toHaveCount(7);
  await page.screenshot({
    path: info.outputPath('overview-statistics-table.png'),
    fullPage: true,
    scale: 'css',
  });
  await stats.getByRole('button', { name: 'Biểu đồ', exact: true }).click();
  await stats.getByLabel('Mốc thời gian: Tiền thu & hoàn').selectOption('0');
  await expect(stats.getByLabel('Mốc thời gian: Tiền thu & hoàn')).toHaveValue('0');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({
      path: info.outputPath('overview-charts-' + width + '.png'),
      fullPage: true,
      scale: 'css',
    });
  }
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect(stats).toHaveAttribute('aria-busy', 'false');
  expect(errors).toEqual([]);
});

test('populated charts expose exact point values and recover from a failed period without showing the wrong range', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  let failToday = true;
  const series = Array.from({ length: 7 }, (_, i) => ({
    label: `${28 + i > 30 ? i - 2 : 28 + i}/${i < 3 ? '09' : '10'}`,
    collected: String((i + 1) * 20000),
    refunded: String(i * 2000),
    orders: i + 1,
    sessions: i % 3,
  }));
  await page.route('**/api/core/admin/overview/statistics?*', (route) => {
    const period = new URL(route.request().url()).searchParams.get('period');
    if (period === 'today' && failToday)
      return route.fulfill({
        status: 503,
        json: { userMessage: 'Thống kê tạm thời chưa tải được.' },
      });
    return route.fulfill({
      json: {
        period,
        updatedAt: '2026-10-04T05:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        startDay: period === 'today' ? '2026-10-04' : '2026-09-28',
        endDay: '2026-10-04',
        previousStartDay: '2026-09-21',
        previousEndDay: '2026-09-27',
        granularity: period === 'today' ? 'hour' : 'day',
        current: { collected: '560000', refunded: '42000', net: '518000', orders: 28, sessions: 6 },
        previous: {
          collected: '300000',
          refunded: '20000',
          net: '280000',
          orders: 15,
          sessions: 3,
        },
        series: period === 'today' ? [{ ...series[0], label: '12:00' }] : series,
        topSales: [
          { product_id: 'dish-1', name: 'Gỏi cuốn tôm thịt', quantity: '8', amount: '360000' },
          { product_id: 'dish-2', name: 'Chả giò giòn', quantity: '4', amount: '220000' },
          { product_id: 'dish-3', name: 'Đậu hũ chiên sả', quantity: '3', amount: '147000' },
        ],
      },
    });
  });
  await login(page);
  const stats = page.getByRole('region', { name: 'Thống kê theo thời gian', exact: true });
  await expect(stats.locator('.top-product-bars')).toContainText('Gỏi cuốn tôm thịt');
  await stats.getByLabel('Mốc thời gian: Tiền thu & hoàn').selectOption('0');
  await expect(stats.locator('.chart-readout').first()).toContainText('20.000');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({
      path: info.outputPath('populated-overview-' + width + '.png'),
      fullPage: true,
      scale: 'css',
    });
  }
  await stats.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await expect(stats.getByRole('alert')).toContainText('Chưa tải được thống kê');
  await expect(stats.locator('.period-metric')).toHaveCount(0);
  await expect(stats).toHaveAttribute('aria-busy', 'false');
  failToday = false;
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect(stats.locator('.period-metric')).toHaveCount(4);
  await expect(stats.getByRole('alert')).toHaveCount(0);
});
test('ADMIN operating scope, contextual guides, keyboard close and module deep links', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await expect(page.getByRole('heading', { name: 'Tiền trong các phiên đang mở' })).toBeVisible();
  await expect(
    page.getByText(/nhân viên được phân ca hôm nay - theo ghi nhận chấm công/),
  ).toBeVisible();
  await expect(page.getByText('Tài khoản nhân viên hoạt động', { exact: true })).toHaveCount(0);
  const help = page.getByRole('button', { name: 'Hướng dẫn quản trị', exact: true });
  await help.click();
  const guide = page.getByRole('dialog', { name: 'Hướng dẫn quản trị' });
  await expect(guide.locator('li')).toHaveCount(5);
  await expect(guide).not.toContainText('charge');
  await expect(guide).not.toContainText('Write-off');
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(help).toBeFocused();
  await page.screenshot({
    path: info.outputPath('admin-overview.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('button', { name: 'Xem báo cáo bán hàng', exact: false }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Quản trị', exact: true })
      .getByRole('button', { name: 'Doanh số món', exact: true, includeHidden: true }),
  ).toHaveAttribute('aria-current', 'page');
  await menu(page, 'Tổng quan');
  await page.getByRole('button', { name: 'Kiểm tra hàng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Phiếu nhập hàng', exact: true })).toBeVisible();
  const topics: [string, string, string, number][] = [
    [
      'Kho & công thức',
      'Nhập hàng & điều chỉnh kho',
      'Các thay đổi đã ghi nhận không được xóa lịch sử.',
      4,
    ],
    ['Nhân viên', 'Quản lý quyền truy cập', 'Các phiên đăng nhập cũ', 4],
    [
      'Ca làm & lương',
      'Chốt công & lương',
      'Bảng lương nháp dùng công đã duyệt và mức lương đã lưu.',
      7,
    ],
    [
      'Kiểm soát gọi món',
      'Thay đổi quy tắc vận hành',
      'Thay đổi áp dụng cho nghiệp vụ tiếp theo.',
      3,
    ],
  ];
  for (const [section, title, text, steps] of topics) {
    if (section === 'Ca làm & lương') await selectAdmin(page, section, 'Bảng lương');
    else await menu(page, section);
    await page.getByRole('button', { name: title, exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toContainText(text, { ignoreCase: true });
    await expect(dialog.locator('li')).toHaveCount(steps);
    if (section === 'Ca làm & lương') {
      await expect(dialog).toContainText('Kỳ chỉ đã chi đủ khi mọi phiếu cần trả đều có xác nhận.');
      await expect(dialog).toContainText('Bảng lương nháp chưa hiển thị cho nhân viên.');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  await menu(page, 'Tổng quan');
  await page.getByRole('button', { name: 'Kiểm tra bảng lương', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Quản trị', exact: true })
      .getByRole('button', { name: 'Bảng lương', exact: true, includeHidden: true }),
  ).toHaveAttribute('aria-current', 'page');
  await menu(page, 'Việc cần xử lý');
  await expect(page.locator('.operations-inbox')).toBeVisible();
  await page.screenshot({ path: info.outputPath('admin-inbox.png'), fullPage: true, scale: 'css' });
  await menu(page, 'Tổng quan');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({
      path: info.outputPath('overview-' + width + '.png'),
      fullPage: true,
      scale: 'css',
    });
  }
  expect(errors).toEqual([]);
});

test('decision inbox sorts real age, separates refunds and shows clear state-conflict recovery', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const sid = '00000000-0000-4000-8000-000000000001',
    oldId = '00000000-0000-4000-8000-000000000002';
  const issue = (id: string, code: string, minutes: number) => ({
    id,
    session_id: sid,
    table_code: code,
    product_name_snapshot: 'Món kiểm thử',
    quantity: 1,
    line_total: '120000',
    status: 'CANCELLED',
    has_charge: true,
    reported_issue: true,
    report_id: id,
    reported_reason_code: 'QUALITY_ISSUE',
    reported_by_name: 'Bếp kiểm thử',
    reported_note: 'Món không đạt chất lượng',
    reported_at: new Date(Date.now() - minutes * 60000).toISOString(),
  });
  await page.route('**/api/core/order-exceptions?pending=true', (route) =>
    route.fulfill({ json: [issue(oldId, 'UX-OLD', 18), issue('new-id', 'UX-NEW', 2)] }),
  );
  await page.route('**/api/core/alerts', (route) =>
    route.fulfill({
      json: [
        {
          id: 'refund',
          session_id: sid,
          table_code: 'UX-REF',
          alert_type: 'REFUND_REQUIRED',
          status: 'ACKNOWLEDGED',
          refund_due_amount: '120000',
          created_at: new Date(Date.now() - 30000).toISOString(),
        },
      ],
    }),
  );
  await page.route('**/api/core/outstanding', (route) =>
    route.fulfill({
      json: [
        { id: 'closed', status: 'WRITTEN_OFF' },
        {
          id: 'open',
          session_id: sid,
          table_code: 'UX-MONEY',
          status: 'IN_RECOVERY',
          outstanding_amount: '30000',
          created_at: new Date().toISOString(),
        },
      ],
    }),
  );
  await page.route('**/api/core/reports/sessions/' + sid, (route) =>
    route.fulfill({
      json: {
        bill: {
          account: {
            charge_total: '120000',
            paid_total: '120000',
            refunded_total: '0',
            outstanding_amount: '0',
            refund_due_amount: '0',
          },
        },
        exceptions: [
          {
            reason: 'Bếp báo món không đạt chất lượng',
            display_name: 'Bếp kiểm thử',
            created_at: new Date().toISOString(),
          },
        ],
      },
    }),
  );
  let attempted = 0;
  await page.route('**/api/core/items/' + oldId + '/late-cancel', (route) => {
    attempted++;
    return route.fulfill({
      status: 409,
      json: { userMessage: 'Báo cáo đã được quyết định bằng thao tác khác.' },
    });
  });
  await login(page);
  await menu(page, 'Việc cần xử lý');
  await expect(page.locator('.inbox-summary')).toContainText('Việc cần xử lý - 4');
  await expect(page.locator('.inbox-case').first()).toContainText('UX-OLD');
  await expect(page.locator('.inbox-case').first()).toContainText('Đã chờ 18 phút');
  await selectAdmin(page, 'Việc cần xử lý', 'Món & nguyên liệu');
  await expect(page.locator('.inbox-case')).toHaveCount(2);
  await page
    .locator('.inbox-case')
    .first()
    .getByRole('button', { name: 'Kiểm tra & quyết định', exact: true })
    .click();
  const detail = page.getByRole('dialog', { name: 'Món & kho cần xử lý - Bàn UX-OLD' });
  await expect(detail).toContainText('Nếu xác nhận lỗi nhà hàng: bỏ tính tiền 120.000 đ.');
  await expect(detail).toContainText(
    'Hệ thống sẽ đối chiếu tiền đã phân bổ theo từng giao dịch sau quyết định.',
  );
  await expect(detail).toContainText('khách chỉ nhận lại tiền khi có xác nhận hoàn thực tế.');
  await detail.getByRole('button', { name: 'Cách xử lý món lỗi', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Cách xử lý món lỗi' });
  await expect(help).toContainText('Bếp dừng món nhưng chưa quyết định tiền.');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await detail.getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: 'Xác nhận lỗi nhà hàng?' });
  await expect(confirmation).toContainText('Nguyên liệu đã sử dụng vẫn tính là tiêu hao.');
  await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click();
  expect(attempted).toBe(0);
  await detail.getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: 'Xác nhận lỗi nhà hàng?' });
  await confirmation.getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Dữ liệu đã được làm mới');
  expect(attempted).toBe(1);
  await page.screenshot({ path: info.outputPath('admin-decision-conflict.png'), scale: 'css' });
  await selectAdmin(page, 'Việc cần xử lý', 'Khoản cần hoàn');
  await expect(page.locator('.inbox-case')).toHaveCount(1);
  await expect(page.locator('.inbox-case')).toContainText('Đã có người tiếp nhận');
});
