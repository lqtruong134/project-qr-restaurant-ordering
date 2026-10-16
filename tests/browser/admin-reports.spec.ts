import { test, expect, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#username').fill('quyettruong05');
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
}

test('report queries preserve financial totals, isolate periods, validate dates and restrict staff', async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page);
  const read = (path: string) =>
    page.evaluate(async (path) => {
      const response = await fetch('/api' + path);
      return { status: response.status, body: await response.json() };
    }, path);
  const legacy = await read('/core/reports');
  expect(legacy.status).toBe(200);
  for (const view of ['sales', 'payments', 'reconciliation', 'outstanding', 'support']) {
    const report = await read(`/core/admin/reports?view=${view}&period=all`);
    expect(report.status).toBe(200);
    expect(report.body.pageSize).toBe(10);
    expect(report.body.rows.length).toBeLessThanOrEqual(10);
    expect(report.body.total).toBeGreaterThanOrEqual(report.body.rows.length);
    expect(report.body.scope.timezone).toBeTruthy();
    if (view === 'sales') {
      const sum = (key: string) =>
        legacy.body.sales
          .reduce((s: bigint, r: Record<string, string>) => s + BigInt(r[key] ?? '0'), 0n)
          .toString();
      expect(report.body.summary.sales).toBe(sum('sales'));
      expect(report.body.summary.cost).toBe(sum('cost'));
      expect(
        report.body.series
          .reduce((s: bigint, r: { primary: string }) => s + BigInt(r.primary), 0n)
          .toString(),
      ).toBe(report.body.summary.sales);
    }
    if (view === 'payments')
      expect(report.body.summary.collected).toBe(
        legacy.body.payments
          .reduce((s: bigint, r: { amount: string }) => s + BigInt(r.amount), 0n)
          .toString(),
      );
    if (view === 'reconciliation') {
      expect(report.body.total).toBe(legacy.body.reconciliation.length);
      for (const r of report.body.rows)
        expect(BigInt(r.balance)).toBe(
          BigInt(r.payable) - BigInt(r.collected) + BigInt(r.refunded) - BigInt(r.written_off),
        );
    }
    const empty = await read(
      `/core/admin/reports?view=${view}&period=custom&start=2000-01-01&end=2000-01-02`,
    );
    expect(empty.status).toBe(200);
    expect(empty.body.total).toBe(0);
    expect(empty.body.rows).toEqual([]);
    if (empty.body.series)
      expect(
        empty.body.series.every(
          (r: { primary: string; secondary: string }) => r.primary === '0' && r.secondary === '0',
        ),
      ).toBe(true);
  }
  for (const query of [
    'period=custom&start=2026-02-29&end=2026-03-01',
    'period=custom&start=2026-10-06&end=2026-10-05',
    'view=unknown',
    'view=constructor',
    'page=0',
  ])
    expect((await read('/core/admin/reports?' + query)).status).toBe(400);
  const staffContext = await browser.newContext({ baseURL });
  try {
    const staff = await staffContext.newPage();
    await staff.goto('/login');
    await staff.locator('#username').fill('pv001');
    await staff.locator('#password').fill(process.env.SEED_PASSWORD!);
    await staff.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(staff).toHaveURL(/workspace\/staff/);
    expect(
      await staff.evaluate(async () => (await fetch('/api/core/admin/reports?view=sales')).status),
    ).toBe(403);
  } finally {
    await staffContext.close();
  }
});

test('reports have working dates, category/search filters, pagination, charts and aligned long labels', async ({
  page,
}, info) => {
  await login(page);
  const requests: URL[] = [];
  let failing = false;
  await page.route('**/api/core/admin/reports?*', (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (failing)
      return route.fulfill({
        status: 500,
        json: { message: 'Không thể lấy số liệu. Vui lòng thử lại.' },
      });
    const pageNumber = Number(url.searchParams.get('page') ?? 1),
      filtered = Boolean(url.searchParams.get('search'));
    const period = url.searchParams.get('period');
    const startDay =
      period === 'custom'
        ? url.searchParams.get('start')!
        : period === 'month'
          ? '2026-10-01'
          : period === 'all'
            ? '2026-09-01'
            : '2026-10-05';
    const endDay = period === 'custom' ? url.searchParams.get('end')! : '2026-10-05';
    return route.fulfill({
      json: {
        scope: {
          period: url.searchParams.get('period'),
          startDay,
          endDay,
          timezone: 'Asia/Ho_Chi_Minh',
          updatedAt: '2026-10-05T04:00:00Z',
          granularity: startDay === endDay ? 'hour' : 'day',
        },
        summary: {
          subtotal: '3700000',
          discountAmount: '250000',
          sales: '3450000',
          vat: '255556',
          beforeVatSales: '3194444',
          legacyTaxUnavailable: false,
          cost: '1200000',
          margin: '1994444',
          quantity: '32',
        },
        total: filtered ? 1 : 13,
        page: pageNumber,
        pageSize: 10,
        options:
          url.searchParams.get('period') === 'today' && url.searchParams.get('filter')
            ? []
            : [{ id: 'category-1', name: 'Món chính & món đặc biệt' }],
        rows: Array.from({ length: filtered ? 1 : pageNumber === 1 ? 10 : 3 }, (_, i) => ({
          id: `${pageNumber}-${i}`,
          name:
            i === 0
              ? 'Cá kho tộ đặc biệt kèm rau xanh và nước sốt truyền thống của nhà hàng'
              : `Món ${i + (pageNumber - 1) * 10 + 1}`,
          category: 'Món chính & món đặc biệt',
          quantity: '8',
          subtotal: '260000',
          discountAmount: '20000',
          sales: '240000',
          vat: '17778',
          beforeVatSales: '222222',
          legacyTaxUnavailable: false,
          cost: '75000',
          margin: '147222',
        })),
        series: [
          {
            at: startDay,
            label:
              startDay === endDay ? '09:00' : startDay.split('-').reverse().slice(0, 2).join('/'),
            primary: '1000000',
            secondary: '400000',
          },
          {
            at: endDay + 'T15:00:00',
            label:
              startDay === endDay ? '15:00' : endDay.split('-').reverse().slice(0, 2).join('/'),
            primary: '2450000',
            secondary: '800000',
          },
        ],
        breakdown: [
          {
            name: 'Cá kho tộ đặc biệt kèm rau xanh và nước sốt truyền thống của nhà hàng',
            value: '3450000',
          },
        ],
      },
    });
  });
  await selectAdmin(page, 'Báo cáo', 'Doanh số món');
  const reports = page.getByRole('region', { name: 'Báo cáo quản trị' });
  await expect(reports.getByRole('heading', { name: 'Chi tiết doanh số theo món' })).toBeVisible();
  await expect(reports.locator('tbody tr')).toHaveCount(10);
  await reports.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(reports.locator('tbody tr')).toHaveCount(3);
  await reports.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('today');
  await expect(reports.locator('tbody tr')).toHaveCount(10);
  await reports.getByRole('button', { name: 'Tuần này', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('week');
  await reports.getByRole('button', { name: 'Chọn ngày', exact: true }).click();
  await reports.getByLabel('Từ ngày', { exact: true }).fill('2026-09-01');
  await reports.getByLabel('Đến ngày', { exact: true }).fill('2026-09-30');
  await reports.getByRole('button', { name: 'Áp dụng khoảng ngày' }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('start')).toBe('2026-09-01');
  await reports.getByLabel('Phân loại báo cáo', { exact: true }).selectOption('category-1');
  await expect.poll(() => requests.at(-1)?.searchParams.get('filter')).toBe('category-1');
  await reports.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('today');
  await expect(reports.locator('tbody tr')).toHaveCount(10);
  await expect(reports.getByLabel('Phân loại báo cáo', { exact: true })).toHaveValue('category-1');
  await reports.getByLabel('Tìm trong báo cáo').fill('Cá kho');
  await expect(reports.locator('tbody tr')).toHaveCount(1);
  await expect(reports.getByLabel('Phân loại báo cáo', { exact: true })).toHaveValue('category-1');
  await reports
    .getByLabel('Mốc thời gian: Doanh số gồm VAT & giá vốn theo thời gian', { exact: true })
    .selectOption('1');
  await expect(reports.locator('.report-chart-values')).toContainText('2.450.000');
  await reports.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(reports.locator('tbody tr')).toHaveCount(10);
  const viewports = info.project.use.isMobile
    ? [info.project.use.viewport!, { width: 320, height: 640 }]
    : [
        { width: 1440, height: 1000 },
        { width: 1024, height: 768 },
      ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    if (viewport.width >= 700)
      expect(
        await reports
          .locator('tbody tr')
          .first()
          .evaluate((row) => {
            const a = Array.from(row.querySelectorAll('td')).map((cell) =>
              cell.getBoundingClientRect(),
            );
            const headers = Array.from(row.closest('table')!.querySelectorAll('th')).map((cell) =>
              cell.getBoundingClientRect(),
            );
            const next = Array.from(row.nextElementSibling!.querySelectorAll('td')).map((cell) =>
              cell.getBoundingClientRect(),
            );
            return a.every(
              (rect, i) =>
                Math.abs(rect.left - headers[i]!.left) <= 1 &&
                Math.abs(rect.width - next[i]!.width) <= 1,
            );
          }),
      ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`reports-${viewport.width}.png`),
      fullPage: true,
      scale: 'css',
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`reports-top-${viewport.width}.png`),
      scale: 'css',
    });
    await reports
      .locator('.report-charts')
      .screenshot({ path: info.outputPath(`reports-charts-${viewport.width}.png`), scale: 'css' });
  }
  failing = true;
  await reports.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect(reports.getByRole('alert')).toBeVisible();
  await expect(reports.locator('tbody tr')).toHaveCount(0);
  failing = false;
  await reports.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(reports.locator('tbody tr')).toHaveCount(10);
});
