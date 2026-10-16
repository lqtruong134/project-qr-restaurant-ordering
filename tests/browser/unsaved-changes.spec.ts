import { test, expect, type Locator, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

const ingredientName = 'Nguyên liệu kiểm thử bỏ thay đổi';
const inventory = {
  units: [{ id: 'discard-unit', code: 'KG', name: 'Kilôgam' }],
  ingredients: [
    {
      id: 'discard-ingredient',
      code: 'DISCARD-01',
      name: ingredientName,
      unit: 'KG',
      min_stock: '2',
      is_active: true,
    },
  ],
  locations: [{ id: 'discard-location', code: 'DISCARD-KHO', name: 'Kho kiểm thử' }],
  balances: [
    {
      id: 'discard-balance',
      ingredient_id: 'discard-ingredient',
      ingredient_name: ingredientName,
      location_id: 'discard-location',
      location_name: 'Kho kiểm thử',
      unit: 'KG',
      on_hand_qty: '10',
      reserved_qty: '0',
      available_qty: '10',
      version: 1,
    },
  ],
  movements: [],
  receipts: [],
  recipes: [],
  recipeItems: [],
};

async function scrollLocked(page: Page, locked: boolean) {
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow === 'hidden'))
    .toBe(locked);
}

async function warningFits(warning: Locator) {
  const geometry = await warning.evaluate((node) => {
    const width = visualViewport?.width ?? innerWidth;
    const bounds = node.getBoundingClientRect();
    const buttons = Array.from(node.querySelectorAll('button'));
    return {
      noPageOverflow: document.documentElement.scrollWidth <= width + 1,
      noDialogOverflow: node.scrollWidth <= node.clientWidth + 1,
      insideViewport: bounds.left >= 0 && bounds.right <= width + 1,
      buttonsFit: buttons.every((button) => {
        const box = button.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.left >= bounds.left &&
          box.right <= bounds.right + 1 &&
          button.scrollWidth <= button.clientWidth + 1
        );
      }),
    };
  });
  expect(geometry).toEqual({
    noPageOverflow: true,
    noDialogOverflow: true,
    insideViewport: true,
    buttonsFit: true,
  });
}

async function readOnlyPage(page: Page) {
  const errors: string[] = [];
  const nativeDialogs: string[] = [];
  const mutations: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  // Exercise local form state without allowing a business write, even if a control regresses.
  await page.route('**/api/core/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.continue();
      return;
    }
    mutations.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 500,
      json: { userMessage: 'Kiểm thử này không ghi dữ liệu.' },
    });
  });
  return { errors, nativeDialogs, mutations };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
}

test('unsaved-change dialog preserves edits on safe exits, discards explicitly and keeps nested scroll locks', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const { errors, nativeDialogs, mutations } = await readOnlyPage(page);
  await page.route('**/api/core/catalog', (route) =>
    route.fulfill({ json: { categories: [], products: [] } }),
  );
  await page.route('**/api/core/inventory', (route) => route.fulfill({ json: inventory }));
  await login(page);
  await selectAdmin(page, 'Kho & công thức', 'Tồn kho');

  const open = page
    .locator('.inv-table tbody tr')
    .filter({ hasText: ingredientName })
    .getByRole('button', { name: 'Kiểm kê / xuất hủy', exact: true });
  const editor = page.getByRole('dialog', {
    name: 'Kiểm kê / xuất hủy - ' + ingredientName,
    exact: true,
  });
  const warning = page.getByRole('dialog', { name: 'Bỏ thay đổi chưa lưu?', exact: true });
  const continueEditing = warning.getByRole('button', {
    name: 'Tiếp tục chỉnh sửa',
    exact: true,
  });
  const close = editor.getByRole('button', { name: 'Đóng', exact: true });
  const quantity = editor.getByLabel('Số lượng (KG)', { exact: true });
  const reason = editor.getByLabel('Lý do / biên bản kiểm kê hoặc hư hỏng', { exact: true });

  await open.click();
  await expect(editor).toBeVisible();
  await scrollLocked(page, true);
  await close.click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(warning).toHaveCount(0);
  await scrollLocked(page, false);
  await expect(open).toBeFocused();

  await open.click();
  await quantity.fill('1.25');
  await reason.fill('Nội dung kiểm kê chưa lưu');
  await close.click();
  await expect(warning).toContainText(
    'Những thay đổi bạn vừa nhập chưa được lưu. Chọn “Bỏ thay đổi” sẽ bỏ phần chỉnh sửa này.',
  );
  await expect(page.locator('dialog[open]')).toHaveCount(2);
  await expect(continueEditing).toBeFocused();
  await scrollLocked(page, true);
  await page.screenshot({ path: info.outputPath('unsaved-warning.png'), scale: 'css' });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: viewport.height });
  await warningFits(warning);
  await page.screenshot({ path: info.outputPath('unsaved-warning-320px.png'), scale: 'css' });
  await page.setViewportSize(viewport);
  await continueEditing.click();
  await expect(warning).toHaveCount(0);
  await expect(quantity).toHaveValue('1.25');
  await expect(reason).toHaveValue('Nội dung kiểm kê chưa lưu');
  await expect(close).toBeFocused();
  await scrollLocked(page, true);

  // Closing the warning with its X is also a safe exit.
  await close.click();
  await warning.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(reason).toHaveValue('Nội dung kiểm kê chưa lưu');
  await expect(close).toBeFocused();
  await scrollLocked(page, true);

  // Esc on the dirty form opens the warning; Esc on that warning keeps the form.
  await reason.focus();
  await page.keyboard.press('Escape');
  await expect(warning).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(quantity).toHaveValue('1.25');
  await expect(reason).toHaveValue('Nội dung kiểm kê chưa lưu');
  await expect(reason).toBeFocused();
  await scrollLocked(page, true);

  // A separate confirmation above the form must release only its own scroll lock.
  const submit = editor.getByRole('button', { name: 'Điều chỉnh tồn', exact: true });
  await submit.click();
  const confirmation = page.getByRole('dialog', {
    name: 'Kiểm tra trước khi xác nhận',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(2);
  await scrollLocked(page, true);
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(submit).toBeFocused();
  await scrollLocked(page, true);

  await close.click();
  await warning.getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await scrollLocked(page, false);
  await expect(open).toBeFocused();
  await open.click();
  await expect(quantity).toHaveValue('');
  await expect(reason).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(warning).toHaveCount(0);
  await scrollLocked(page, false);
  expect(nativeDialogs).toEqual([]);
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('editing a shift template uses the unsaved-change dialog and preserves values until explicit discard', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const { errors, nativeDialogs, mutations } = await readOnlyPage(page);
  const template = {
    id: 'discard-shift-template',
    code: 'CA_SANG',
    name: 'Ca sáng',
    start_time: '09:00:00',
    end_time: '15:00:00',
    ends_next_day: false,
    break_minutes: 30,
    hourly_rate_override: null,
    sort_order: 1,
    is_active: true,
    scheduled_count: 0,
    version: 1,
  };
  await page.route(/\/api\/core\/workforce(?:\?|$)/, (route) =>
    route.fulfill({
      json: { templates: [template], shifts: [], assignments: [], rates: [] },
    }),
  );
  await login(page);
  await selectAdmin(page, 'Ca làm & lương', 'Quản lý ca làm');
  const open = page
    .locator('.wf-template-card')
    .filter({ has: page.getByRole('heading', { name: template.name, exact: true }) })
    .getByRole('button', { name: 'Sửa mẫu ca', exact: true });
  await open.click();
  const editor = page.getByRole('dialog', { name: 'Sửa mẫu ca', exact: true });
  const name = editor.getByLabel('Tên mẫu ca', { exact: true });
  const start = editor.getByLabel('Giờ bắt đầu', { exact: true });
  const reason = editor.getByLabel('Lý do cập nhật', { exact: true });
  const close = editor.getByRole('button', { name: 'Đóng', exact: true });
  const warning = page.getByRole('dialog', { name: 'Bỏ thay đổi chưa lưu?', exact: true });
  await expect(name).toHaveValue(template.name);
  await name.fill('Ca sáng đã chỉnh nhưng chưa lưu');
  await start.fill('08:30');
  await reason.fill('Đổi giờ bắt đầu ca');
  await close.click();
  await expect(warning).toBeVisible();
  await page.screenshot({
    path: info.outputPath('shift-template-unsaved-warning.png'),
    scale: 'css',
  });
  await warning.getByRole('button', { name: 'Tiếp tục chỉnh sửa', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(name).toHaveValue('Ca sáng đã chỉnh nhưng chưa lưu');
  await expect(start).toHaveValue('08:30');
  await expect(reason).toHaveValue('Đổi giờ bắt đầu ca');
  await expect(close).toBeFocused();
  await scrollLocked(page, true);

  await name.focus();
  await page.keyboard.press('Escape');
  await expect(warning).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  await expect(name).toHaveValue('Ca sáng đã chỉnh nhưng chưa lưu');
  await expect(name).toBeFocused();

  await close.click();
  await warning.getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await scrollLocked(page, false);
  await expect(open).toBeFocused();
  await open.click();
  await expect(name).toHaveValue(template.name);
  await expect(start).toHaveValue('09:00');
  await expect(reason).toHaveValue('');
  await close.click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await scrollLocked(page, false);
  expect(nativeDialogs).toEqual([]);
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});
