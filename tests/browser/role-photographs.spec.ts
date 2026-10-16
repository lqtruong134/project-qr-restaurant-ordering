import { test, expect, type Page } from '@playwright/test';

type Role = 'admin' | 'staff' | 'kitchen';

async function mockWorkspace(page: Page, role: Role, populated: boolean) {
  const orders = populated
    ? [
        {
          id: 'order-1',
          session_id: 'session-1',
          table_code: 'A01',
          area_name: 'Khu trong nhà',
          created_at: new Date().toISOString(),
          status: role === 'kitchen' ? 'SUBMITTED' : 'ACCEPTED',
          total_amount: '69000',
          items: [
            {
              id: 'item-1',
              product_name_snapshot: 'Gỏi cuốn tôm thịt cuốn rau sống và bún tươi',
              quantity: 2,
              status: role === 'kitchen' ? 'SUBMITTED' : 'READY',
              unit_price_snapshot: '69000',
            },
          ],
        },
      ]
    : [];
  const tables = populated
    ? [
        {
          id: 'table-1',
          code: 'A01',
          name: 'Bàn A01',
          capacity: 4,
          is_active: true,
          area_name: 'Khu trong nhà',
          table_status: 'OCCUPIED',
          session_id: 'session-1',
          session_status: 'ACTIVE',
          verification_status: 'VERIFIED',
          pending_payments: 0,
          paid_total: '0',
          charge_total: '138000',
          refunded_total: '0',
          refund_due_amount: '0',
          outstanding_amount: '138000',
        },
      ]
    : [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    if (route.request().method() !== 'GET')
      return route.fulfill({ status: 405, json: { userMessage: 'Chỉ kiểm tra giao diện.' } });
    let json: unknown = [];
    if (path.startsWith('/workspaces/'))
      json = {
        user: {
          id: 'user-1',
          displayName: 'Nguyễn Minh Anh',
          role: role.toUpperCase(),
          permissions: [],
        },
      };
    else if (['/core/orders', '/core/kitchen'].includes(path)) json = orders;
    else if (['/core/tables', '/core/admin/tables'].includes(path)) json = tables;
    else if (path === '/core/catalog') json = { products: [], categories: [] };
    else if (path === '/core/inventory')
      json = {
        units: [],
        ingredients: [],
        locations: [],
        balances: [],
        movements: [],
        receipts: [],
        recipes: [],
        recipeItems: [],
      };
    else if (path === '/core/risk') json = { defaults: {}, policies: [] };
    else if (path === '/core/reports')
      json = { store: {}, sales: [], payments: [], reconciliation: [] };
    else if (path === '/core/admin/overview')
      json = {
        updatedAt: '2026-10-10T05:00:00Z',
        day: '2026-10-10',
        timezone: 'Asia/Ho_Chi_Minh',
        tables: {
          total: populated ? 12 : 0,
          occupied: populated ? 5 : 0,
          cleaning: 0,
          available: 7,
        },
        participants: populated ? 12 : 0,
        support: { new: populated ? 2 : 0, inProgress: 0 },
        workforce: { clockedIn: populated ? 5 : 0, scheduledToday: 8, pendingAttendance: 0 },
        finance: {
          payable: populated ? '1380000' : '0',
          collected: populated ? '690000' : '0',
          refunded: '0',
          outstanding: populated ? '690000' : '0',
          refundDue: '0',
        },
        inventory: { unavailable: 0, low: 0, draftReceipts: 0 },
        topSales: [],
      };
    else if (path === '/core/admin/overview/statistics')
      json = {
        period: url.searchParams.get('period') ?? 'week',
        updatedAt: '2026-10-10T05:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        startDay: '2026-10-04',
        endDay: '2026-10-10',
        previousStartDay: '2026-09-27',
        previousEndDay: '2026-10-03',
        granularity: 'day',
        current: {
          collected: populated ? '690000' : '0',
          refunded: '0',
          net: populated ? '690000' : '0',
          orders: populated ? 5 : 0,
          sessions: populated ? 2 : 0,
        },
        previous: { collected: '0', refunded: '0', net: '0', orders: 0, sessions: 0 },
        series: [],
        topSales: [],
      };
    await route.fulfill({ json });
  });
}

for (const role of ['admin', 'staff', 'kitchen'] as const) {
  for (const populated of [false, true]) {
    test(`${role} photograph fits empty and populated workspaces (${populated ? 'populated' : 'empty'})`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await mockWorkspace(page, role, populated);
      await page.goto('/workspace/' + role);
      const banner = page.locator('.role-visual');
      await expect(banner).toHaveCount(1);
      const photograph = banner.locator('img');
      await expect(photograph).toHaveAttribute('alt', '');
      await expect
        .poll(() => photograph.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      const widths =
        process.env.ROLE_VISUAL_MOBILE_ONLY === '1' ? [320, 390] : [320, 390, 768, 1440];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true);
        await expect(banner).toBeVisible();
        const dimensions = await banner.evaluate((element) => {
          const heading = element
            .querySelector('.service-overview > div:first-child, .overview-context > p')!
            .getBoundingClientRect();
          const photo = element.querySelector('.role-visual-photo')!.getBoundingClientRect();
          const toolbar = element.querySelector('.service-tools')?.getBoundingClientRect();
          return {
            headingWidth: heading.width,
            photoWidth: photo.width,
            photoHeight: photo.height,
            overlaps: heading.right > photo.left + 1,
            bannerWidth: element.getBoundingClientRect().width,
            toolbarWidth: toolbar?.width,
            toolbarTop: toolbar?.top,
            photoBottom: photo.bottom,
          };
        });
        expect(dimensions.headingWidth).toBeGreaterThan(150);
        expect(dimensions.photoWidth).toBeGreaterThan(60);
        expect(dimensions.overlaps).toBe(false);
        if (width <= 600) {
          expect(dimensions.photoHeight).toBeLessThanOrEqual(81);
          if (role !== 'admin') {
            expect(dimensions.toolbarWidth).toBeGreaterThan(dimensions.bannerWidth - 4);
            expect(dimensions.toolbarTop).toBeGreaterThanOrEqual(dimensions.photoBottom);
          }
        }
        await page.screenshot({
          path: info.outputPath(`${role}-${populated ? 'populated' : 'empty'}-${width}.png`),
          scale: 'css',
          animations: 'disabled',
        });
      }
      expect(errors).toEqual([]);
    });
  }
}
