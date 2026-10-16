import { test, expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
type Row = { id: string; [key: string]: string | number | boolean | null };
type Product = Row & { name: string; code: string; base_price: string };
type Order = {
  id: string;
  session_id: string;
  table_code: string;
  area_name: string;
  created_at: string;
  status: string;
  total_amount: string;
  items: Row[];
};
type GuestState = {
  participant: { id: string; displayName: string };
  participants: Row[];
  session: Row;
  cart: { cart_version: number };
  items: Row[];
  products: Product[];
  orders: Row[];
  support: Row[];
  account: Row;
};

const longName =
  'Gỏi rau củ theo mùa với đậu phộng rang, rau thơm và nước sốt riêng dành cho khách ăn chay';
const longNote = 'Không hành, ít cay, để nước sốt riêng và mang thêm chén nhỏ. '
  .repeat(5)
  .slice(0, 300);
const longPerson = 'Nguyễn Hoàng Phương Anh cùng gia đình và các bạn đến dùng bữa tại nhà hàng';
const longTable = 'Bàn gia đình ở khu vực sân vườn cạnh cửa sổ và lối đi chính';
const product: Product = {
  id: 'ui-product',
  name: longName,
  code: 'UI-01',
  base_price: '9999000',
  version: 1,
  is_active: true,
  availability_status: 'AVAILABLE',
  category_id: 'ui-category',
  category_name: 'Các món rau củ dùng kèm nước sốt và đậu phộng rang',
  stock_managed: true,
  description: longNote,
};
const identifierProduct: Product = {
  ...product,
  id: 'ui-token-product',
  name: 'MON'.repeat(40),
  code: 'M'.repeat(40),
};
const now = new Date().toISOString();
async function login(page: Page, user: string, role: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(user);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function surface(page: Page, root: Locator = page.locator('main')) {
  const issues = await root.evaluate((node) => {
    const problems: string[] = [];
    const width = visualViewport?.width ?? innerWidth;
    if (document.documentElement.scrollWidth > width + 1) problems.push('page overflow');
    for (const el of Array.from(
      node.querySelectorAll<HTMLElement>(
        '.order-card, .table-tile, .managed-dish, .shopping-cart-row, .guest-support-row, .app-dialog, .queue-table-card, .wf-person, .wf-clock-card, .inv-recipe-card, .staff-card, .product-editor',
      ),
    )) {
      if (el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 1)
        problems.push(el.className + ': overflowing content');
    }
    for (const svg of Array.from(
      node.querySelectorAll<SVGSVGElement>('svg[aria-hidden="true"][width]'),
    )) {
      const box = svg.getBoundingClientRect();
      const expected = Number(svg.getAttribute('width'));
      if (box.width && expected <= 32 && box.width < expected - 1)
        problems.push('compressed icon in ' + svg.parentElement?.className);
    }
    return problems;
  });
  expect(issues).toEqual([]);
}
async function servingControls(page: Page) {
  const selection = page.locator('.serve-selection').first();
  await expect(selection).toBeVisible();
  const sizes = await selection.locator('.serve-select-row').evaluateAll((rows) =>
    rows.map((row) => {
      const input = row.querySelector('input')!.getBoundingClientRect();
      const text = row.querySelector('span')!;
      const box = text.getBoundingClientRect();
      return {
        width: input.width,
        height: input.height,
        gap: box.left - input.right,
        lineOffset: Math.abs(
          input.top +
            input.height / 2 -
            box.top -
            Number.parseFloat(getComputedStyle(text).lineHeight) / 2,
        ),
        rowHeight: row.getBoundingClientRect().height,
      };
    }),
  );
  for (const size of sizes) {
    expect(size.width).toBe(18);
    expect(size.height).toBe(18);
    expect(size.gap).toBe(10);
    expect(size.lineOffset).toBeLessThanOrEqual(2);
    expect(size.rowHeight).toBeGreaterThanOrEqual(44);
  }
  const selectAll = selection.getByRole('checkbox', {
    name: 'Chọn tất cả món đang chờ',
    exact: true,
  });
  await selectAll.check();
  await expect(selection.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await expect(
    selection.getByRole('button', { name: 'Đã phục vụ 2 món', exact: true }),
  ).toBeVisible();
  await selectAll.uncheck();
  await expect(selection.getByRole('checkbox', { checked: true })).toHaveCount(0);
}
async function dialogFits(page: Page) {
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await surface(page, dialog);
  const geometry = await dialog.locator('.dialog-heading').evaluate((heading) => {
    const title = heading.querySelector('h2')!.getBoundingClientRect();
    const button = heading.querySelector('.icon-button')!.getBoundingClientRect();
    return {
      width: button.width,
      height: button.height,
      overlap:
        title.right > button.left + 1 &&
        title.bottom > button.top + 1 &&
        button.bottom > title.top + 1,
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.overlap).toBe(false);
}
async function captureWidth(page: Page, info: TestInfo, name: string, width: number) {
  if ([1440, 768, 390].includes(width))
    await page.screenshot({
      path: info.outputPath(`${name}-${width}px.png`),
      fullPage: true,
      scale: 'css',
    });
}
function widths(mobile: boolean | undefined) {
  return mobile ? [390, 320] : [1440, 1024, 768, 390, 320];
}

test('guest empty, long shared cart, orders, support and payment states keep controls usable', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let state: GuestState = {
    participant: { id: 'ui-me', displayName: longPerson },
    participants: [
      { id: 'ui-me', display_name: longPerson },
      { id: 'ui-other', display_name: longPerson + ' 2' },
    ],
    session: {
      id: 'ui-session',
      table_id: 'ui-table',
      table_name: longTable,
      area_name: 'Khu vực sân vườn có mái che cạnh nhà hàng',
      access_code: '0123',
      version: 1,
    },
    cart: { cart_version: 1 },
    items: [],
    products: [],
    orders: [],
    support: [],
    account: {
      id: 'ui-account',
      charge_total: '0',
      paid_total: '0',
      outstanding_amount: '0',
      refunded_total: '0',
      refund_due_amount: '0',
    },
  };
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: state }));
  await page.goto('/guest');
  await expect(page.getByRole('heading', { name: 'Thực đơn đang được cập nhật' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Điều hướng khách' });
  await nav.getByRole('button', { name: /Giỏ món/ }).click();
  await expect(page.getByRole('heading', { name: 'Chưa có món trong giỏ' })).toBeVisible();
  await expect(page.locator('.shopping-cart-checkout')).toHaveCount(0);
  await nav.getByRole('button', { name: 'Thanh toán', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Bàn chưa có món cần thanh toán', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('guest-true-empty.png'),
    fullPage: true,
    scale: 'css',
  });
  state = {
    ...state,
    products: [product, { ...product, id: 'ui-product-2', name: 'Trà đá', base_price: '5000' }],
    items: [
      {
        id: 'ui-foreign',
        product_id: product.id,
        name: longName,
        code: product.code,
        quantity: 9,
        unit_price_preview: product.base_price,
        owner_participant_id: 'ui-other',
        owner_name: longPerson,
        note: longNote,
        available: true,
        created_at: now,
      },
    ],
  };
  await page.reload();
  await expect(page.locator('.dish-card')).toHaveCount(2);
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    await page.getByRole('button', { name: 'Chọn ' + longName, exact: true }).click();
    await dialogFits(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    await captureWidth(page, info, 'guest-long-menu', width);
  }
  await nav.getByRole('button', { name: /Giỏ món/ }).click();
  await page.getByRole('button', { name: /Cả bàn/ }).click();
  await expect(page.locator('.shopping-cart-row.is-readonly')).toHaveCount(1);
  await expect(page.locator('.shopping-cart-row.is-readonly').getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.shopping-cart-checkout')).toHaveCount(0);
  await surface(page);
  await page.screenshot({
    path: info.outputPath('guest-long-shared-cart.png'),
    fullPage: true,
    scale: 'css',
  });
  state = {
    ...state,
    orders: [
      {
        id: 'ui-order',
        item_id: 'ui-item',
        product_name_snapshot: longName,
        quantity: 9,
        unit_price_snapshot: '9999000',
        line_total: '89991000',
        original_amount: '89991000',
        status: 'IN_PROGRESS',
        item_status: 'READY',
        charge_status: 'ACTIVE',
        created_by_participant_id: 'ui-other',
        owner_participant_id: 'ui-other',
        owner_name: longPerson,
        note: longNote,
        created_at: now,
      },
    ],
    support: [
      {
        id: 'ui-request',
        request_type: 'OTHER',
        content: longNote,
        status: 'ACKNOWLEDGED',
        created_at: now,
        retry_at: new Date(Date.now() + 180000).toISOString(),
      },
      {
        id: 'ui-bill',
        request_type: 'BILL',
        payment_method: 'CASH',
        status: 'ACKNOWLEDGED',
        created_at: now,
        retry_at: new Date(Date.now() + 180000).toISOString(),
      },
    ],
    account: {
      id: 'ui-account',
      charge_total: '89991000',
      paid_total: '0',
      outstanding_amount: '89991000',
      refunded_total: '0',
      refund_due_amount: '0',
    },
  };
  await page.reload();
  for (const view of ['Món đã gọi', 'Thanh toán', 'Hỗ trợ']) {
    await nav.getByRole('button', { name: view, exact: true }).click();
    for (const width of widths(info.project.use.isMobile)) {
      await page.setViewportSize({ width, height: 900 });
      await surface(page);
    }
    await page.screenshot({
      path: info.outputPath('guest-long-' + view + '.png'),
      fullPage: true,
      scale: 'css',
    });
  }
  expect(errors).toEqual([]);
});

function orders(): Order[] {
  return ['SUBMITTED', 'ACCEPTED', 'IN_PREPARATION', 'READY'].map((status, index) => ({
    id: 'ui-order-' + index,
    session_id: 'ui-session',
    table_code: 'TABLE-CODE-LONG-12345',
    area_name: 'Khu sân vườn có mái che và khu vực phục vụ dành cho gia đình',
    created_at: now,
    status: status === 'SUBMITTED' ? status : 'IN_PROGRESS',
    total_amount: '89991000',
    items: [
      {
        id: 'ui-item-' + index,
        product_name_snapshot: longName,
        quantity: 9,
        unit_price_snapshot: '9999000',
        line_total: '89991000',
        note: longNote,
        status,
        ready_at: now,
      },
    ],
  }));
}
test('kitchen real empty lanes, all preparation stages and long notes retain icons and actions', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page, 'bep003', 'kitchen');
  let rows: Order[] = [];
  await page.route('**/api/core/kitchen', (route) => route.fulfill({ json: rows }));
  await page.reload();
  await expect(page.locator('.kanban .empty-state')).toHaveCount(3);
  await surface(page);
  await page.screenshot({
    path: info.outputPath('kitchen-true-empty.png'),
    fullPage: true,
    scale: 'css',
  });
  rows = orders();
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
  await expect(page.locator('.order-card')).toHaveCount(4);
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    await captureWidth(page, info, 'kitchen-long-populated', width);
  }
  await page.screenshot({
    path: info.outputPath('kitchen-long-populated.png'),
    fullPage: true,
    scale: 'css',
  });
  for (const title of ['Chờ tiếp nhận', 'Bếp đang xử lý', 'Chờ mang ra']) {
    await page
      .getByRole('navigation', { name: 'Trạng thái bếp' })
      .getByRole('button', { name: new RegExp('^' + title) })
      .click();
    await expect(page.locator('.kanban-column:visible')).toHaveCount(1);
    await surface(page);
  }
});

test('staff empty floor and jobs, dense table signals, serving and long dialog titles stay contained', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page, 'pv003', 'staff');
  let tables: Row[] = [],
    batches: Order[] = [],
    requests: Row[] = [];
  for (const [path, read] of [
    ['tables', () => tables],
    ['orders', () => batches],
    ['support', () => requests],
    ['alerts', () => []],
  ] as const)
    await page.route('**/api/core/' + path, (route) => route.fulfill({ json: read() }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chưa có bàn trong sơ đồ' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Phục vụ' });
  await nav.getByRole('button', { name: /Việc cần làm/ }).click();
  await expect(page.getByRole('heading', { name: 'Chưa có công việc tại bàn' })).toBeVisible();
  await surface(page);
  tables = [
    {
      id: 'ui-table',
      name: longTable,
      code: 'TABLE-CODE-LONG-12345',
      area_name: longTable,
      table_status: 'OCCUPIED',
      is_active: true,
      capacity: 99,
      session_id: 'ui-session',
      verification_status: 'VERIFIED',
      opened_at: now,
      charge_total: '89991000',
      outstanding_amount: '89991000',
    },
    {
      id: 'ui-clean',
      name: longTable + ' cần dọn',
      code: 'UI-CLEAN',
      area_name: longTable,
      table_status: 'NEEDS_CLEANING',
      is_active: true,
      capacity: 6,
      session_id: null,
      cleaning_since: now,
    },
  ];
  batches = orders();
  const ready = batches[3]!;
  ready.items = [
    { ...ready.items[0]!, quantity: 1, product_name_snapshot: 'Khoai tây chiên', note: '' },
    { ...ready.items[0]!, id: 'ui-ready-long', product_name_snapshot: longName, note: longNote },
  ];
  requests = Array.from({ length: 7 }, (_, i) => ({
    id: 'ui-request-' + i,
    table_id: 'ui-table',
    session_id: 'ui-session',
    display_name: longPerson,
    request_type: 'OTHER',
    content: longNote,
    status: 'NEW',
    created_at: now,
  }));
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
  await expect(page.locator('.queue-table-card')).toHaveCount(2);
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    await captureWidth(page, info, 'staff-dense-queue', width);
  }
  await page.screenshot({
    path: info.outputPath('staff-dense-queue.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill('KHONG-CO-BAN-UI');
  await expect(
    page.getByRole('heading', { name: 'Không có bàn trong nhóm đang xem' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill('');
  await page
    .locator('.queue-table-card[data-table-id="ui-clean"]')
    .getByRole('button', { name: 'Chi tiết bàn' })
    .click();
  await dialogFits(page);
  await page.screenshot({
    path: info.outputPath('staff-long-dialog.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  for (const name of ['Sơ đồ bàn', 'Gọi món']) {
    await nav.getByRole('button', { name, exact: true }).click();
    if (name === 'Sơ đồ bàn') {
      await page.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill('KHONG-CO-BAN-UI');
      await expect(page.getByRole('heading', { name: 'Không có bàn phù hợp' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill('');
    }
    for (const width of widths(info.project.use.isMobile)) {
      await page.setViewportSize({ width, height: 900 });
      await surface(page);
      if (name === 'Gọi món') {
        await servingControls(page);
        if ([1440, 390, 320].includes(width))
          await page
            .locator('.serve-selection')
            .first()
            .screenshot({
              path: info.outputPath(`serve-selection-${width}px.png`),
              scale: 'css',
            });
      }
    }
  }
  await nav.getByRole('button', { name: 'Sơ đồ bàn', exact: true }).click();
  await page
    .locator('.table-tile')
    .filter({ has: page.locator('[data-status="OCCUPIED"]') })
    .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Món đã gọi', exact: true }).click();
  await servingControls(page);
  await page
    .locator('.serve-selection')
    .first()
    .screenshot({
      path: info.outputPath('serve-selection-dialog.png'),
      scale: 'css',
    });
});

test('admin empty catalog and stock, long cards, filtered counts and single-point report are readable', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page, 'quyettruong05', 'admin');
  const catalog = await (await page.request.get('/api/core/catalog')).json();
  const inventory = await (await page.request.get('/api/core/inventory')).json();
  inventory.balances = inventory.balances.slice(0, 3).map((b: Row, index: number) => ({
    ...b,
    ingredient_name:
      index === 0
        ? 'Rau củ dùng làm món gỏi và các loại rau thơm đã sơ chế trong ngày'
        : b.ingredient_name,
    location_name: 'Kho nguyên liệu dùng cho khu vực bếp chính của nhà hàng',
    available_qty: index === 0 ? '0' : '1000',
    on_hand_qty: index === 0 ? '0' : '1000',
    reserved_qty: '0',
  }));
  inventory.recipes = [
    { id: 'ui-recipe', product_id: identifierProduct.id, yield_quantity: '1', version_no: 1 },
  ];
  inventory.recipeItems = [
    {
      id: 'ui-recipe-line',
      recipe_bom_id: 'ui-recipe',
      ingredient_id: inventory.balances[0].ingredient_id,
      ingredient_name: 'RAU'.repeat(40),
      quantity: '1',
      unit: 'g',
      waste_percent: '0',
    },
  ];
  const report = await (
    await page.request.get('/api/core/admin/reports?view=payments&period=today&sort=newest&page=1')
  ).json();
  let empty = true;
  await page.route('**/api/core/catalog', (route) =>
    route.fulfill({
      json: empty
        ? { categories: [], products: [] }
        : {
            ...catalog,
            products: [
              { ...catalog.products[0], ...product },
              { ...catalog.products[1], name: 'Trà đá', description: '' },
              { ...catalog.products[0], ...identifierProduct },
            ],
          },
    }),
  );
  await page.route('**/api/core/inventory', (route) =>
    route.fulfill({
      json: empty
        ? {
            units: [],
            ingredients: [],
            locations: [],
            balances: [],
            movements: [],
            receipts: [],
            recipes: [],
            recipeItems: [],
          }
        : inventory,
    }),
  );
  await page.reload();
  await selectAdmin(page, 'Thực đơn');
  await expect(page.locator('.empty-state')).toBeVisible();
  await surface(page);
  await selectAdmin(page, 'Kho & công thức');
  await expect(page.locator('.inv-panel .empty-state')).toBeVisible();
  await surface(page);
  await page.screenshot({
    path: info.outputPath('admin-stock-true-empty.png'),
    fullPage: true,
    scale: 'css',
  });
  await selectAdmin(page, 'Kho & công thức', 'Công thức món');
  await expect(page.getByRole('heading', { name: 'Chưa có món quản lý kho' })).toBeVisible();
  empty = false;
  await page.reload();
  await selectAdmin(page, 'Thực đơn');
  await expect(page.locator('.managed-dish')).toHaveCount(3);
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    await captureWidth(page, info, 'admin-long-menu', width);
  }
  await page.screenshot({
    path: info.outputPath('admin-long-menu.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('button', { name: 'Chỉnh sửa ' + longName, exact: true }).click();
  await dialogFits(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await page
    .getByRole('button', { name: 'Chỉnh sửa ' + identifierProduct.name, exact: true })
    .click();
  await dialogFits(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await selectAdmin(page, 'Kho & công thức');
  await page.getByLabel('Tình trạng', { exact: true }).selectOption('empty');
  await expect(page.locator('.inv-stats article').first()).toContainText('1 loại');
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.getByLabel('Tình trạng', { exact: true })).toHaveValue('all');
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    await captureWidth(page, info, 'admin-stock-populated', width);
  }
  await page.screenshot({
    path: info.outputPath('admin-stock-populated.png'),
    fullPage: true,
    scale: 'css',
  });
  await selectAdmin(page, 'Kho & công thức', 'Công thức món');
  await expect(
    page.locator('.inv-recipe-card').filter({ hasText: identifierProduct.name }),
  ).toBeVisible();
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    await captureWidth(page, info, 'admin-long-recipe', width);
  }
  await page.getByRole('textbox', { name: 'Tìm món hoặc mã món…' }).fill('KHONG-CO-MON-UI');
  await expect(page.getByRole('heading', { name: 'Không có món phù hợp' })).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Tìm món hoặc mã món…' })).toHaveValue('');
  await page.route('**/api/core/admin/reports?*', (route) =>
    route.fulfill({
      json: {
        ...report,
        series: [{ at: now, label: '12:00', primary: '450000', secondary: '25000' }],
      },
    }),
  );
  await selectAdmin(page, 'Báo cáo', 'Tiền đã thu');
  const chart = page.getByRole('img', { name: /^Thu & hoàn tiền theo thời gian/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator('circle')).toHaveCount(2);
  await expect(page.locator('.report-chart-values').first()).toContainText('450.000 đ');
  await surface(page);
  await page
    .locator('.report-chart')
    .first()
    .screenshot({
      path: info.outputPath('admin-chart-single-point.png'),
      scale: 'css',
    });
  await page.screenshot({
    path: info.outputPath('admin-report-single-point.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.route('**/api/core/admin/reports?*', (route) =>
    route.fulfill({
      json: {
        ...report,
        summary: {},
        rows: [],
        total: 0,
        series: [],
        breakdown: [],
      },
    }),
  );
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  const emptyIcon = page.locator('.report-chart .empty-state .ui-icon').first();
  await expect(emptyIcon).toBeVisible();
  const iconSize = await emptyIcon.evaluate((icon) => ({
    width: icon.getBoundingClientRect().width,
    height: icon.getBoundingClientRect().height,
  }));
  expect(iconSize).toEqual({ width: 28, height: 28 });
  await expect(
    page.getByRole('heading', { name: 'Không có kết quả phù hợp', exact: true }),
  ).toBeVisible();
  await surface(page);
  await page.screenshot({
    path: info.outputPath('admin-report-true-empty.png'),
    fullPage: true,
    scale: 'css',
  });
});

test('workforce empty schedules and long names keep week navigation, monthly cards and personal shifts usable', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90000);
  await login(page, 'quyettruong05', 'admin');
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const person = {
    id: 'ui-person',
    display_name: longPerson,
    username: 'NHAN-VIEN-TEN-DAI',
    role: 'STAFF',
    status: 'ACTIVE',
  };
  const assignment = {
    id: 'ui-assignment',
    user_id: person.id,
    username: person.username,
    display_name: longPerson,
    shift_id: 'ui-shift',
    shift_name: 'Ca phục vụ tại khu vực sân vườn và bàn gia đình có đặt trước',
    area_name: 'Khu sân vườn có mái che và lối đi cạnh cửa sổ',
    area_id: null,
    starts_at: new Date(Date.now() - 3600000).toISOString(),
    ends_at: new Date(Date.now() + 14400000).toISOString(),
    checked_in_at: new Date(Date.now() - 3500000).toISOString(),
    checked_out_at: null,
    status: 'ASSIGNED',
    attendance_status: 'PENDING',
    can_check_in: false,
    can_check_out: true,
    break_minutes: 30,
    clock_in_early_minutes: 15,
    approved_minutes: 0,
    approved_amount: '0',
  };
  let filled = false;
  await page.route('**/api/core/users', (route) => route.fulfill({ json: [person] }));
  await page.route(/\/api\/core\/workforce(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        templates: [],
        shifts: filled ? [{ ...assignment, id: assignment.shift_id }] : [],
        assignments: filled ? [assignment] : [],
        rates: [],
      },
    }),
  );
  await page.reload();
  await selectAdmin(page, 'Ca làm & lương', 'Lịch phân ca');
  await expect(page.locator('.wf-schedule')).toBeVisible();
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
  }
  await page.screenshot({
    path: info.outputPath('workforce-empty-schedule.png'),
    fullPage: true,
    scale: 'css',
  });
  filled = true;
  await page.reload();
  await selectAdmin(page, 'Ca làm & lương', 'Lịch phân ca');
  await expect(page.locator('.wf-schedule')).toContainText(longPerson);
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    await captureWidth(page, info, 'workforce-long-week', width);
  }
  await page.screenshot({
    path: info.outputPath('workforce-long-week.png'),
    fullPage: true,
    scale: 'css',
  });
  await selectAdmin(page, 'Ca làm & lương', 'Chấm công & duyệt');
  await page.getByLabel('Tháng chấm công', { exact: true }).fill(day.slice(0, 7));
  await expect(page.locator('.wf-app')).toContainText(longPerson);
  await surface(page);
  await page.screenshot({
    path: info.outputPath('workforce-long-month.png'),
    fullPage: true,
    scale: 'css',
  });
  const context = await browser.newContext({ baseURL, ...info.project.use });
  try {
    const staff = await context.newPage();
    await login(staff, 'pv003', 'staff');
    await staff.route('**/api/core/workforce/me?*', (route) =>
      route.fulfill({ json: { assignments: [assignment], currentAssignments: [assignment] } }),
    );
    await staff.route('**/api/core/payroll/me', (route) =>
      route.fulfill({ json: { slips: [], lines: [], runs: [] } }),
    );
    await staff.getByRole('button', { name: 'Lịch làm & lương của tôi', exact: true }).click();
    await expect(staff.locator('.wf-clock-card')).toContainText(assignment.shift_name);
    for (const width of widths(info.project.use.isMobile)) {
      await staff.setViewportSize({ width, height: 900 });
      await surface(staff);
      await captureWidth(staff, info, 'workforce-personal-long-shift', width);
    }
    await staff.screenshot({
      path: info.outputPath('workforce-personal-long-shift.png'),
      fullPage: true,
      scale: 'css',
    });
    await staff.getByRole('button', { name: 'Cả tuần', exact: true }).click();
    await surface(staff);
    await staff.getByRole('button', { name: 'Xem chi tiết ca →', exact: true }).first().click();
    await dialogFits(staff);
  } finally {
    await context.close();
  }
});

test('admin employee cards distinguish empty groups and contain long valid identifiers', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page, 'quyettruong05', 'admin');
  let employees: Row[] = [];
  await page.route('**/api/core/users', (route) => route.fulfill({ json: employees }));
  await page.reload();
  await selectAdmin(page, 'Nhân viên');
  await expect(page.getByRole('heading', { name: 'Chưa có nhân viên phục vụ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chưa có nhân viên bếp' })).toBeVisible();
  await surface(page);
  employees = ['STAFF', 'KITCHEN'].map((role, i) => ({
    id: 'ui-employee-' + i,
    display_name: longPerson,
    username: 'U'.repeat(59) + i,
    staff_code: 'N'.repeat(59) + i,
    role,
    status: 'ACTIVE',
  }));
  await page.reload();
  await selectAdmin(page, 'Nhân viên');
  await expect(page.locator('.staff-card')).toHaveCount(2);
  for (const width of widths(info.project.use.isMobile)) {
    await page.setViewportSize({ width, height: 900 });
    await surface(page);
    const avatar = await page.locator('.staff-avatar').first().boundingBox();
    expect(avatar?.width).toBe(40);
    await captureWidth(page, info, 'admin-long-employees', width);
  }
  await page.locator('.staff-card').first().locator('summary').click();
  await surface(page);
  await expect(
    page.locator('.staff-card').first().getByLabel('Tên hiển thị', { exact: true }),
  ).toHaveValue(longPerson);
});
