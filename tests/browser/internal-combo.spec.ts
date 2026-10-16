import { test, expect, type Page, type Locator } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

type Component = {
  product_id: string;
  code: string;
  name: string;
  quantity: number;
  image_url: null;
  unit_price: string;
  available: boolean;
};
type Product = {
  id: string;
  code: string;
  name: string;
  category_id: string;
  base_price: string;
  regular_price?: string;
  product_kind: 'DISH' | 'COMBO';
  stock_managed: boolean;
  is_active: boolean;
  is_complimentary: boolean;
  availability_status: string;
  configured_availability_status?: string;
  image_url: string | null;
  version: number;
  components: Component[];
};
const dish = (id: string, name: string, price: string): Product => ({
  id,
  code: id.toUpperCase(),
  name,
  category_id: 'main',
  base_price: price,
  product_kind: 'DISH',
  stock_managed: true,
  is_active: true,
  is_complimentary: false,
  availability_status: 'AVAILABLE',
  image_url: null,
  version: 1,
  components: [],
});
const rice = dish('rice', 'Cơm tấm sườn nướng', '79000');
const tea = dish('tea', 'Trà tắc mật ong', '39000');
const soup = dish('soup', 'Súp bắp gà', '45000');
const parts = (products: Product[], quantities: number[]): Component[] =>
  products.map((p, at) => ({
    product_id: p.id,
    code: p.code,
    name: p.name,
    quantity: quantities[at]!,
    image_url: null,
    unit_price: p.base_price,
    available: true,
  }));
const combo: Product = {
  ...dish('combo', 'Combo cơm và trà', '109000'),
  category_id: 'combo-category',
  product_kind: 'COMBO',
  regular_price: '118000',
  version: 7,
  components: parts([rice, tea], [1, 1]),
};
const sid = 'f63b91bc-0000-0000-0000-000000000001';
const table = {
  id: 'combo-table',
  name: 'Bàn A10',
  code: 'A10',
  area_id: 'area',
  area_name: 'Trong nhà',
  is_active: true,
  table_status: 'OCCUPIED',
  session_id: sid,
  session_status: 'ACTIVE',
  capacity: 4,
  opened_at: '2026-10-11T03:00:00Z',
  verification_status: 'VERIFIED',
  charge_total: '218000',
  outstanding_amount: '218000',
  pending_payments: 0,
};
const frozenParts = [
  { product_id: 'rice', code: 'RICE', name: 'Cơm tấm tại lúc gọi', quantity: 1 },
  { product_id: 'tea', code: 'TEA', name: 'Trà tắc tại lúc gọi', quantity: 1 },
];
const frozenOrder = () => ({
  id: 'frozen-order',
  session_id: sid,
  table_code: 'A10',
  area_name: 'Trong nhà',
  status: 'SUBMITTED',
  total_amount: '218000',
  created_at: '2026-10-11T03:00:00Z',
  items: [
    {
      id: 'frozen-item',
      product_id: 'combo',
      product_name_snapshot: 'Combo cơm và trà tại lúc gọi',
      product_kind_snapshot: 'COMBO',
      combo_components_snapshot: frozenParts,
      quantity: 2,
      status: 'SUBMITTED',
      unit_price_snapshot: '109000',
      line_total: '218000',
      note: 'Ít đá',
    },
  ],
});
const inventoryFixture = () => ({
  units: [],
  ingredients: [],
  locations: [],
  balances: [],
  movements: [],
  receipts: [],
  recipes: [{ id: 'combo-bom', product_id: 'combo', version_no: 3, yield_quantity: '1' }],
  recipeItems: [
    {
      id: 'bom-rice',
      recipe_bom_id: 'combo-bom',
      ingredient_id: 'grain',
      ingredient_name: 'Gạo tấm',
      unit: 'KG',
      quantity: '0.2',
      waste_percent: '0',
    },
  ],
});
const billFixture = () => ({
  session: { id: sid, session_status: 'ACTIVE', table_code: 'A10', opened_at: table.opened_at },
  account: {
    id: 'account',
    charge_total: '218000',
    paid_total: '0',
    refunded_total: '0',
    outstanding_amount: '218000',
    refund_due_amount: '0',
  },
  charges: [
    {
      id: 'charge',
      order_item_id: 'frozen-item',
      status: 'ACTIVE',
      amount: '218000',
      item_status: 'SUBMITTED',
      ...frozenOrder().items[0],
    },
  ],
  complimentaryItems: [],
  waivedItems: [],
  cancelledItems: [],
  payments: [],
  intents: [],
  refunds: [],
  refundTransactions: [],
  store: { id: 'store', name: 'Quyết Trường Bistro', timezone: 'Asia/Ho_Chi_Minh' },
  generatedAt: '2026-10-11T03:00:00Z',
  closedBy: null,
  closure: { canClose: false, blockers: [] },
});

async function mockInternal(page: Page) {
  const state = {
    catalog: {
      categories: [
        { id: 'main', code: 'CHINH', name: 'Món chính', is_active: true },
        { id: 'combo-category', code: 'COMBO', name: 'Combo', is_active: true },
      ],
      products: structuredClone([rice, tea, soup, combo]),
    },
    inventory: inventoryFixture(),
    orders: [] as ReturnType<typeof frozenOrder>[],
    bill: billFixture(),
  };
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [],
    errors: string[] = [];
  let rejectOrder = false;
  page.on('pageerror', (error) => errors.push(error.message));
  // All core writes fail closed except these mocked operations, independent of live business data.
  await page.route('**/api/core/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    if (method === 'GET') {
      if (path === '/api/core/catalog') return route.fulfill({ json: state.catalog });
      if (path === '/api/core/inventory') return route.fulfill({ json: state.inventory });
      if (path === '/api/core/tables' || path === '/api/core/admin/tables')
        return route.fulfill({ json: [table] });
      if (path === '/api/core/orders' || path === '/api/core/kitchen')
        return route.fulfill({ json: state.orders });
      if (path === '/api/core/support' || path === '/api/core/alerts')
        return route.fulfill({ json: [] });
      if (path === `/api/core/sessions/${sid}/bill`) return route.fulfill({ json: state.bill });
      return route.continue();
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    writes.push({ path, method, body });
    if (path === '/api/core/menu-images' && method === 'POST')
      return route.fulfill({
        json: { imageUrl: '/api/menu-images/12345678-1234-4234-8234-123456789abc.webp' },
      });
    if (
      (path === '/api/core/products' && method === 'POST') ||
      (path === '/api/core/products/combo' && method === 'PATCH')
    ) {
      const old =
        method === 'PATCH' ? state.catalog.products.find((p) => p.id === 'combo')! : combo;
      const components = body.components as { productId: string; quantity: number }[] | undefined;
      const updated: Product = {
        ...old,
        id: method === 'PATCH' ? old.id : 'created-combo',
        code: String(body.code ?? old.code),
        name: String(body.name),
        base_price: String(body.price),
        version: old.version + 1,
        image_url: String(body.imageUrl ?? old.image_url ?? '') || null,
        components: components
          ? parts(
              components.map((c) => state.catalog.products.find((p) => p.id === c.productId)!),
              components.map((c) => c.quantity),
            )
          : old.components,
      };
      state.catalog.products =
        method === 'PATCH'
          ? state.catalog.products.map((p) => (p.id === old.id ? updated : p))
          : [...state.catalog.products, updated];
      return route.fulfill({ json: updated });
    }
    if (path === `/api/core/sessions/${sid}/orders` && method === 'POST') {
      if (rejectOrder)
        return route.fulfill({
          status: 409,
          json: { userMessage: 'Combo đã thay đổi. Chọn lại trước khi gửi.' },
        });
      return route.fulfill({ json: { id: 'new-order', status: 'SUBMITTED' } });
    }
    if (path === '/api/core/items/frozen-item/accept' && method === 'POST') {
      state.orders[0]!.items[0]!.status = 'ACCEPTED';
      return route.fulfill({ json: state.orders[0]!.items[0] });
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 500, json: { userMessage: 'Unexpected mocked mutation' } });
  });
  return {
    state,
    writes,
    unexpected,
    errors,
    rejectOrder: () => {
      rejectOrder = true;
    },
  };
}
async function login(page: Page, role: 'admin' | 'staff' | 'kitchen' = 'admin') {
  await page.goto('/login');
  await page
    .getByLabel('Tên đăng nhập', { exact: true })
    .fill(role === 'admin' ? 'quyettruong05' : role === 'staff' ? 'pv001' : 'bep001');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`workspace/${role}`));
}
async function editCombo(page: Page) {
  await selectAdmin(page, 'Thực đơn');
  await page.getByRole('button', { name: 'Chỉnh sửa Combo cơm và trà', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Chỉnh sửa combo - Combo cơm và trà',
    exact: true,
  });
  await expect(editor).toBeVisible();
  return editor;
}
async function fits(dialog: Locator) {
  const data = await dialog.evaluate((node) => {
    const body = node.querySelector('.dialog-body')!;
    const bounds = node.getBoundingClientRect();
    return {
      inside: bounds.left >= -1 && bounds.right <= innerWidth + 1,
      dialog: node.scrollWidth <= node.clientWidth + 1,
      body: body.scrollWidth <= body.clientWidth + 1,
      fields: Array.from(node.querySelectorAll('input:not([type=file]), select, textarea')).every(
        (field) => {
          const box = field.getBoundingClientRect();
          return box.width > 20 && box.left >= bounds.left && box.right <= bounds.right + 1;
        },
      ),
    };
  });
  expect(data).toEqual({ inside: true, dialog: true, body: true, fields: true });
}
const discard = (page: Page) =>
  page.getByRole('dialog', { name: 'Bỏ thay đổi chưa lưu?', exact: true });

test('admin creates and updates a managed combo without disabling its derived stock', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  await login(page);
  await selectAdmin(page, 'Thực đơn');
  await page.getByRole('button', { name: 'Thêm combo', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Thêm combo mới', exact: true });
  await expect(
    create.getByLabel('Quản lý nguyên liệu theo công thức', { exact: true }),
  ).toHaveCount(0);
  await create.getByLabel('Tên món', { exact: true }).fill('Combo trưa mới');
  await create.getByLabel('Mã món', { exact: true }).fill('COMBO-TEST');
  await create.getByLabel('Giá bán (đồng)', { exact: true }).fill('109000');
  await create
    .getByRole('combobox', { name: 'Món thành phần 1', exact: true })
    .selectOption('rice');
  await create.getByRole('combobox', { name: 'Món thành phần 2', exact: true }).selectOption('tea');
  await expect(
    create
      .getByRole('combobox', { name: 'Món thành phần 2', exact: true })
      .locator('option[value="rice"]'),
  ).toHaveCount(0);
  await create.getByLabel('Số phần của món 2', { exact: true }).fill('2');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(create);
    if (width === 1440 || width === 320)
      await page.screenshot({
        path: info.outputPath(`admin-combo-create-${width}.png`),
        animations: 'disabled',
      });
  }
  await create.getByRole('button', { name: 'Lưu combo', exact: true }).click();
  await expect(create).toHaveCount(0);
  const created = mock.writes.find((w) => w.path === '/api/core/products')!;
  expect(created.body).toMatchObject({
    productKind: 'COMBO',
    components: [
      { productId: 'rice', quantity: 1 },
      { productId: 'tea', quantity: 2 },
    ],
  });
  expect(created.body).not.toHaveProperty('stockManaged');
  const editor = await editCombo(page);
  await editor.getByLabel('Số phần của món 1', { exact: true }).fill('2');
  await editor.getByRole('button', { name: 'Lưu combo', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const updated = mock.writes.at(-1)!;
  expect(updated.body).toMatchObject({
    productKind: 'COMBO',
    version: 7,
    components: [
      { productId: 'rice', quantity: 2 },
      { productId: 'tea', quantity: 1 },
    ],
  });
  expect(updated.body).not.toHaveProperty('stockManaged');
  expect(mock.unexpected).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('adding and removing members mark the combo dirty; discarding before image save restores persisted members', async ({
  page,
}) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  await login(page);
  const editor = await editCombo(page);
  await editor.getByRole('button', { name: 'Thêm món thành phần', exact: true }).click();
  await editor.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(discard(page)).toBeVisible();
  await discard(page).getByRole('button', { name: 'Tiếp tục chỉnh sửa', exact: true }).click();
  await editor
    .getByRole('combobox', { name: 'Món thành phần 3', exact: true })
    .selectOption('soup');
  await editor.getByLabel('Số phần của món 1', { exact: true }).fill('3');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const draw = canvas.getContext('2d')!;
    draw.fillStyle = '#a26035';
    draw.fillRect(0, 0, 48, 48);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await editor.locator('input[type=file]').setInputFiles({
    name: 'combo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(discard(page)).toBeVisible();
  await discard(page).getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(editor.locator('.image-upload').getByRole('status')).toContainText(
    'Đã thay ảnh món',
  );
  await expect(editor.locator('.combo-editor-row')).toHaveCount(2);
  await expect(editor.getByLabel('Số phần của món 1', { exact: true })).toHaveValue('1');
  const imagePatch = mock.writes.find((w) => w.path === '/api/core/products/combo')!;
  expect(imagePatch.body).not.toHaveProperty('components');
  expect(imagePatch.body).not.toHaveProperty('stockManaged');
  await editor.getByRole('button', { name: 'Thêm món thành phần', exact: true }).click();
  await editor
    .getByRole('combobox', { name: 'Món thành phần 3', exact: true })
    .selectOption('soup');
  await editor.getByRole('button', { name: 'Lưu combo', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const reopened = await editCombo(page);
  await reopened.getByRole('button', { name: 'Bỏ món thành phần 3', exact: true }).click();
  await reopened.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(discard(page)).toBeVisible();
  await discard(page).getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(reopened).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('admin preserves its configured selling state when stock blocks the combo during edit or image upload', async ({
  page,
}) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  const current = mock.state.catalog.products.find((p) => p.id === 'combo')!;
  current.availability_status = 'UNAVAILABLE';
  current.configured_availability_status = 'AVAILABLE';
  await login(page);
  let editor = await editCombo(page);
  await expect(editor.getByRole('combobox', { name: 'Nhận món', exact: true })).toHaveValue(
    'AVAILABLE',
  );
  await expect(editor).toContainText('Hiện tại: chưa thể nhận món');
  await editor.getByLabel('Giá bán (đồng)', { exact: true }).fill('108000');
  await editor.getByRole('button', { name: 'Lưu combo', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(mock.writes.at(-1)!.body.availability).toBe('AVAILABLE');
  editor = await editCombo(page);
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const draw = canvas.getContext('2d')!;
    draw.fillStyle = '#a26035';
    draw.fillRect(0, 0, 48, 48);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await editor.locator('input[type=file]').setInputFiles({
    name: 'combo-stock.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(editor.locator('.image-upload').getByRole('status')).toContainText(
    'Đã thay ảnh món',
  );
  expect(mock.writes.at(-1)!.body).toMatchObject({
    availability: 'AVAILABLE',
    imageUrl: '/api/menu-images/12345678-1234-4234-8234-123456789abc.webp',
  });
  expect(mock.writes.at(-1)!.body).not.toHaveProperty('components');
  expect(mock.state.catalog.products.find((p) => p.id === 'combo')).toMatchObject({
    configured_availability_status: 'AVAILABLE',
    availability_status: 'UNAVAILABLE',
  });
  expect(mock.unexpected).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('combo recipes remain derived and read only, including a missing recipe', async ({ page }) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  mock.state.catalog.products.push({
    ...combo,
    id: 'missing',
    code: 'COMBO-MISSING',
    name: 'Combo chưa có công thức',
  });
  await login(page);
  await selectAdmin(page, 'Kho & công thức', 'Công thức món');
  const card = page
    .locator('.inv-recipe-card')
    .filter({ has: page.getByRole('heading', { name: combo.name, exact: true }) });
  await card.getByRole('button', { name: 'Xem công thức', exact: true }).click();
  const editor = page.getByRole('dialog', { name: `Công thức - ${combo.name}`, exact: true });
  await expect(editor).toContainText('Nguyên liệu của mỗi combo được cộng từ công thức');
  await expect(editor).toContainText('Gạo tấm');
  await expect(editor.getByRole('button', { name: 'Thay công thức', exact: true })).toHaveCount(0);
  await expect(editor.locator('input, select, textarea')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page
    .locator('.inv-recipe-card')
    .filter({ hasText: 'Combo chưa có công thức' })
    .getByRole('button', { name: 'Xem công thức', exact: true })
    .click();
  const missing = page.getByRole('dialog', {
    name: 'Công thức - Combo chưa có công thức',
    exact: true,
  });
  await expect(missing).toContainText('Combo chưa có đủ công thức');
  await expect(missing.locator('input, select, textarea, form')).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});

async function callForTable(page: Page) {
  await page
    .locator('.table-tile')
    .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Gọi món cho bàn', exact: true })
    .click();
  const card = page
    .locator('.assisted-products .core-card')
    .filter({ has: page.getByRole('heading', { name: combo.name, exact: true }) });
  await expect(card.locator('.combo-contents')).toContainText('1 × Cơm tấm sườn nướng');
  await card.getByRole('button', { name: 'Thêm món', exact: true }).click();
  return page.getByRole('complementary', { name: 'Giỏ món nhân viên gọi hộ', exact: true });
}

test('staff assisted order reviews combo contents and sends its version; rejection keeps the unsent cart', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  await login(page, 'staff');
  const cart = await callForTable(page);
  await expect(cart.locator('.combo-contents')).toContainText('1 × Trà tắc mật ong');
  await cart.getByRole('button', { name: `Tăng số lượng ${combo.name}`, exact: true }).click();
  await cart.getByLabel('Ghi chú cho bếp', { exact: true }).fill('Ít đá');
  await cart.getByRole('button', { name: 'Cho khách kiểm tra & gửi món', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Kiểm tra lượt gọi - Bàn A10', exact: true });
  await expect(review).toContainText('2 × Combo cơm và trà');
  await expect(review.locator('.combo-contents')).toContainText('1 × Cơm tấm sườn nướng');
  await page.setViewportSize({ width: 320, height: 844 });
  await fits(review);
  await page.screenshot({
    path: info.outputPath('assisted-combo-review-320.png'),
    animations: 'disabled',
  });
  mock.rejectOrder();
  await review.getByRole('button', { name: 'Gửi món đến bếp', exact: true }).click();
  await expect(review.getByRole('alert')).toHaveText('Combo đã thay đổi. Chọn lại trước khi gửi.');
  expect(mock.writes.at(-1)!.body.lines).toEqual([
    { productId: 'combo', quantity: 2, note: 'Ít đá', productVersion: 7 },
  ]);
  await expect(cart.getByLabel('Ghi chú cho bếp', { exact: true })).toHaveValue('Ít đá');
  expect(mock.unexpected).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('same-price component changes block a staff draft until the combo is selected again', async ({
  page,
}) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  await page.clock.install();
  await login(page, 'staff');
  const cart = await callForTable(page);
  const current = mock.state.catalog.products.find((p) => p.id === 'combo')!;
  current.version = 8;
  current.components = parts([rice, soup], [1, 2]);
  await page.clock.runFor(7000);
  await expect(cart).toContainText('combo đổi thành phần');
  await expect(
    cart.getByRole('button', { name: 'Cho khách kiểm tra & gửi món', exact: true }),
  ).toBeDisabled();
  await expect(cart.locator('.combo-contents')).toContainText('Trà tắc mật ong');
  await cart.getByRole('button', { name: `Bỏ ${combo.name}`, exact: true }).click();
  await page
    .locator('.assisted-products .core-card')
    .filter({ hasText: combo.name })
    .getByRole('button', { name: 'Thêm món', exact: true })
    .click();
  await expect(cart.locator('.combo-contents')).toContainText('2 × Súp bắp gà');
  await cart.getByRole('button', { name: 'Cho khách kiểm tra & gửi món', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Gửi món đến bếp', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mock.writes.at(-1)!.body.lines).toEqual([
    { productId: 'combo', quantity: 1, note: '', productVersion: 8 },
  ]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('kitchen receives the entire combo and keeps frozen member names and quantities', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  mock.state.orders.push(frozenOrder());
  await login(page, 'kitchen');
  const order = page.locator('.order-card');
  await expect(order).toContainText('2 × Combo cơm và trà tại lúc gọi');
  await expect(order.locator('.combo-contents')).toContainText('1 × Cơm tấm tại lúc gọi');
  await expect(order.locator('.combo-contents')).toContainText('1 × Trà tắc tại lúc gọi');
  await expect(order).not.toContainText('Cơm tấm sườn nướng');
  await expect(order.getByRole('button', { name: 'Nhận món này', exact: true })).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath('kitchen-combo-frozen.png'),
    animations: 'disabled',
  });
  await order.getByRole('button', { name: 'Nhận món này', exact: true }).click();
  await expect(order).toContainText('Bếp đã nhận');
  expect(mock.writes.map((w) => w.path)).toEqual(['/api/core/items/frozen-item/accept']);
  expect(mock.unexpected).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('staff receipts show frozen whole-combo contents and each receipt button expands or collapses', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mock = await mockInternal(page);
  mock.state.orders.push(frozenOrder());
  await login(page, 'staff');
  await page
    .locator('.table-tile')
    .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
  const receipt = dialog.getByRole('region', { name: 'Phiếu thanh toán', exact: true });
  await expect(receipt).not.toBeVisible();
  const normal = dialog.getByRole('button', { name: 'Phiếu thường', exact: true });
  const detailed = dialog.getByRole('button', {
    name: 'Phiếu chi tiết theo người gọi',
    exact: true,
  });
  await normal.click();
  await expect(receipt).toBeVisible();
  const row = receipt.locator('.receipt-row').filter({ hasText: 'Combo cơm và trà tại lúc gọi' });
  await expect(row.locator('.combo-contents')).toContainText('1 × Trà tắc tại lúc gọi');
  await expect(row).toContainText('218.000 đ');
  await expect(row.locator(':scope > span').nth(1)).toHaveText('2');
  await expect(receipt).not.toContainText('Cơm tấm sườn nướng');
  await normal.click();
  await expect(receipt).not.toBeVisible();
  await detailed.click();
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Món chung / nhân viên gọi hộ');
  await expect(dialog.getByRole('button', { name: 'Ẩn phiếu', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  await fits(dialog);
  await receipt.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('receipt-combo-frozen-320.png'),
    animations: 'disabled',
  });
  await detailed.click();
  await expect(receipt).not.toBeVisible();
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});
