import { test, expect, type Page } from '@playwright/test';
import {
  restaurantCategories,
  restaurantCategorySortOrder,
  restaurantMenu,
  restaurantCombos,
  restaurantProductCategoryCodes,
} from '../../packages/database/src/restaurant-data.js';
import { menuMedia } from '../../packages/database/src/menu-media.js';
import { selectAdmin } from './admin-navigation.js';

const categories = restaurantCategories
  .map(([code, name, description]) => ({
    id: code,
    code,
    name,
    description,
    is_active: true,
    sort_order: restaurantCategorySortOrder(code),
  }))
  .sort((a, b) => a.sort_order - b.sort_order);
const products = [
  ...restaurantMenu.map((d) => ({
    id: d.code,
    code: d.code,
    name: d.name,
    description: d.description,
    base_price: String(d.price),
    version: 1,
    is_active: true,
    availability_status: 'AVAILABLE',
    configured_availability_status: 'AVAILABLE',
    product_kind: 'DISH' as const,
    stock_managed: true,
    is_complimentary: false,
    category_id: restaurantProductCategoryCodes[d.code],
    category_name: categories.find((c) => c.code === restaurantProductCategoryCodes[d.code])!.name,
    image_url: menuMedia[d.code] ?? null,
  })),
  ...restaurantCombos.map((d) => ({
    id: d.code,
    code: d.code,
    name: d.name,
    description: d.description,
    base_price: String(d.price),
    version: 1,
    is_active: true,
    availability_status: 'AVAILABLE',
    configured_availability_status: 'AVAILABLE',
    product_kind: 'COMBO' as const,
    stock_managed: true,
    is_complimentary: false,
    category_id: 'COMBO',
    category_name: 'Combo',
    image_url: menuMedia[d.code] ?? null,
    regular_price: String(
      d.components.reduce(
        (sum, c) => sum + restaurantMenu.find((p) => p.code === c.code)!.price * c.quantity,
        0,
      ),
    ),
    components: d.components.map((c) => ({
      product_id: c.code,
      code: c.code,
      name: restaurantMenu.find((p) => p.code === c.code)!.name,
      quantity: c.quantity,
      image_url: menuMedia[c.code] ?? null,
      unit_price: String(restaurantMenu.find((p) => p.code === c.code)!.price),
    })),
  })),
].sort(
  (a, b) =>
    categories.find((c) => c.code === a.category_id)!.sort_order -
      categories.find((c) => c.code === b.category_id)!.sort_order ||
    a.name.localeCompare(b.name, 'vi'),
);
const state = {
  participant: { id: 'guest', displayName: 'Khách kiểm tra' },
  participants: [{ id: 'guest', display_name: 'Khách kiểm tra' }],
  session: {
    id: 'image-qa-session',
    table_id: 'image-qa-table',
    table_name: 'Bàn A10',
    area_name: 'Trong nhà',
    access_code: '1234',
    version: 1,
    session_status: 'ACTIVE',
    verification_status: 'VERIFIED',
  },
  products,
  promotions: [],
  discountPrograms: [],
  cart: { cart_version: 1 },
  items: [],
  orders: [],
  support: [],
  payments: [],
  refundTransactions: [],
  account: {
    id: 'account',
    charge_total: '0',
    paid_total: '0',
    refunded_total: '0',
    outstanding_amount: '0',
    refund_due_amount: '0',
  },
};
async function mock(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path.startsWith('/menu-images/')) {
      expect(route.request().method()).toBe('GET');
      return route.continue();
    }
    if (route.request().method() !== 'GET')
      throw Error('Unexpected business mutation during image QA: ' + path);
    let json: unknown = [];
    if (path === '/guest/state') json = state;
    else if (path === '/guest/promotion') json = { programs: [], locked: false };
    else if (path.startsWith('/workspaces/'))
      json = { user: { id: 'qa-admin', displayName: 'Quản trị', role: 'ADMIN', permissions: [] } };
    else if (path === '/core/catalog') json = { categories, products };
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
        updatedAt: new Date().toISOString(),
        day: '2026-10-14',
        timezone: 'Asia/Ho_Chi_Minh',
        tables: { total: 0, occupied: 0, cleaning: 0, available: 0 },
        participants: 0,
        support: { new: 0, inProgress: 0 },
        workforce: { clockedIn: 0, scheduledToday: 0, pendingAttendance: 0 },
        finance: { payable: '0', collected: '0', refunded: '0', outstanding: '0', refundDue: '0' },
        inventory: { unavailable: 0, low: 0, draftReceipts: 0 },
        topSales: [],
      };
    else if (path === '/core/admin/overview/statistics')
      json = {
        period: 'week',
        updatedAt: new Date().toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        startDay: '2026-10-08',
        endDay: '2026-10-14',
        previousStartDay: '2026-10-01',
        previousEndDay: '2026-10-07',
        granularity: 'day',
        current: { collected: '0', refunded: '0', net: '0', orders: 0, sessions: 0 },
        previous: { collected: '0', refunded: '0', net: '0', orders: 0, sessions: 0 },
        series: [],
        topSales: [],
      };
    await route.fulfill({ json });
  });
  return errors;
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
test('guest sees all products, separate Canh and Lau, correct combo order and real supplied image files', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors = await mock(page);
  await page.goto('/guest');
  const filters = page.getByRole('group', { name: 'Danh mục món', exact: true });
  await expect(filters.getByRole('button')).toHaveCount(12);
  expect(await filters.getByRole('button').allTextContents()).toEqual([
    'Tất cả',
    'Combo',
    ...categories.filter((c) => c.code !== 'COMBO').map((c) => c.name),
  ]);
  await expect(page.locator('.dish-card')).toHaveCount(91);
  for (const name of [
    'Canh khổ qua nhồi thịt',
    'Cơm gà kho gừng',
    'Trà dâu',
    'Vịt kho gừng',
    'Bún gà sả',
    'Rau cải xào tỏi (phần cơm)',
    'Lẩu Thái bò & tôm',
    'Canh rau củ (phần cơm)',
    'Rau câu dừa sữa',
  ]) {
    const card = page
      .locator('.dish-card')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.scrollIntoViewIfNeeded();
    const img = card.locator('.dish-media img').first();
    await expect(img).toBeVisible();
    await expect
      .poll(() =>
        img.evaluate(
          (e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 1,
        ),
      )
      .toBe(true);
    expect(
      await img.evaluate((e) => ['cover', 'contain'].includes(getComputedStyle(e).objectFit)),
    ).toBe(true);
  }
  await filters.getByRole('button', { name: 'Canh', exact: true }).click();
  await expect(page.locator('.dish-card')).toHaveCount(11);
  await expect(
    page.getByRole('heading', { name: 'Canh khổ qua nhồi thịt', exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
  await page.screenshot({
    path: info.outputPath('canh-images-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await filters.getByRole('button', { name: 'Lẩu', exact: true }).click();
  await expect(page.locator('.dish-card')).toHaveCount(5);
  await expect(
    page.getByRole('heading', { name: 'Canh khổ qua nhồi thịt', exact: true }),
  ).toHaveCount(0);
  await filters.getByRole('button', { name: 'Combo', exact: true }).click();
  await expect(page.locator('.dish-card')).toHaveCount(5);
  await fits(page);
  expect(errors).toEqual([]);
});
test('admin category editor and product filter use the same 11 groups and new images', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors = await mock(page);
  await page.goto('/workspace/admin');
  await selectAdmin(page, 'Thực đơn', 'Danh mục món');
  const panel = page.getByRole('region', { name: 'Danh mục thực đơn', exact: true });
  await expect(panel.locator('details')).toHaveCount(11);
  await expect(panel.locator('summary').filter({ hasText: /^Canh\s*-\s*11 món$/ })).toHaveCount(1);
  await expect(panel.locator('summary').filter({ hasText: /^Lẩu\s*-\s*5 món$/ })).toHaveCount(1);
  await selectAdmin(page, 'Thực đơn', 'Danh sách món');
  const select = page.getByLabel('Lọc danh mục món', { exact: true });
  await expect(select.locator('option')).toHaveCount(12);
  await select.selectOption('CANH');
  await expect(
    page.getByRole('button', { name: 'Chỉnh sửa Canh khổ qua nhồi thịt', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa Canh khổ qua nhồi thịt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Danh mục', { exact: true })).toHaveValue('CANH');
  const img = dialog
    .locator('img')
    .filter({ hasNot: page.locator('.brand-lockup') })
    .first();
  await expect
    .poll(() =>
      img.evaluate(
        (e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 1,
      ),
    )
    .toBe(true);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
  await dialog.screenshot({
    path: info.outputPath('admin-canh-image-320.png'),
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
