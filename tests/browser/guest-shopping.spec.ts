import { browserTableCode } from './table-code-fixture';
import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post('/api' + path, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function setup(browser: Browser, baseURL: string | undefined, info: TestInfo) {
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () =>
      browser.newContext({
        baseURL,
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        userAgent: info.project.use.userAgent,
      }),
    ),
  );
  const [admin, a, b] = (await Promise.all(contexts.map((c) => c.newPage()))) as [Page, Page, Page];
  await admin.goto('/login');
  await admin.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await admin.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await admin.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(admin).toHaveURL(/workspace\/admin/);
  const areas = await (await admin.request.get('/api/core/areas')).json();
  const code = 'SHOP-' + randomUUID().slice(0, 8);
  const table = await post(admin, '/core/tables', {
    areaId: areas[0].id,
    code,
    name: code,
    capacity: 4,
  });
  const qr = await post(admin, '/core/tables/' + table.id + '/qr', {});
  for (const [page, name] of [
    [a, 'Lan'],
    [b, 'Minh'],
  ] as const) {
    await page.goto(qr.joinPath);
    await page
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin!, qr.joinPath));
    await page.getByLabel('Tên của bạn', { exact: true }).fill(name);
    await page
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await page.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
  }
  return { a, b, contexts };
}
const state = async (page: Page) => (await page.request.get('/api/guest/state')).json();
const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng khách' });
async function add(page: Page, name: string, note = '') {
  const dish = page.locator('.dish-card').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
  await expect(dish.getByRole('button')).toHaveCount(1);
  await expect(dish.getByRole('button')).toHaveText('Chọn món');
  await dish.getByRole('button', { name: 'Chọn ' + name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chọn món', exact: true });
  await expect(dialog.getByRole('button', { name: 'Thêm vào giỏ', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Gọi ngay', exact: true })).toBeVisible();
  if (note) await dialog.getByLabel(/Ghi chú cho bếp/).fill(note);
  await dialog.getByRole('button', { name: 'Thêm vào giỏ', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true })).toBeVisible();
  await expect(page.locator('.operation-notice.success')).toContainText('Đã thêm');
}
async function addForOther(page: Page) {
  const s = await state(page);
  const product = s.products.find((p: { name: string }) => p.name === 'Nước suối 500 ml');
  await post(page, '/guest/cart', {
    productId: product.id,
    quantity: 1,
    cartVersion: s.cart.cart_version,
  });
}

test('guest selects part of own cart, keeps unchecked dishes and distinguishes shared totals', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info),
    errors: string[] = [];
  f.a.on('pageerror', (e) => errors.push(e.message));
  try {
    await add(f.a, 'Chả giò giòn', 'Ít cay');
    await add(f.a, 'Đậu hũ chiên sả');
    await addForOther(f.b);
    await nav(f.a)
      .getByRole('button', { name: /Giỏ món/ })
      .click();
    const first = f.a
      .locator('.shopping-cart-row')
      .filter({ has: f.a.getByRole('heading', { name: 'Chả giò giòn', exact: true }) });
    await expect(first).toBeVisible();
    await expect(
      f.a.getByRole('checkbox', { name: 'Chọn gửi Chả giò giòn', exact: true }),
    ).toBeChecked();
    const second = f.a.getByRole('checkbox', { name: 'Chọn gửi Đậu hũ chiên sả', exact: true });
    await expect(second).toBeChecked();
    await second.uncheck();
    await expect(f.a.locator('.cart-scope-totals')).toContainText('119.000');
    await first.getByRole('button', { name: 'Tăng số lượng chả giò giòn', exact: true }).click();
    await expect(first.getByRole('spinbutton')).toHaveValue('2');
    await expect(f.a.locator('.shopping-cart-checkout')).toContainText('110.000');
    await first.getByRole('spinbutton').fill('3');
    await first.getByRole('spinbutton').press('Enter');
    await expect(f.a.locator('.shopping-cart-checkout')).toContainText('165.000');
    await first.getByRole('button', { name: 'Giảm số lượng chả giò giòn', exact: true }).click();
    await expect(f.a.locator('.shopping-cart-checkout')).toContainText('110.000');
    await f.a.route('**/api/guest/cart/*', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ userMessage: 'Giỏ đã thay đổi. Vui lòng kiểm tra lại.' }),
      }),
    );
    await first.getByRole('button', { name: 'Tăng số lượng chả giò giòn', exact: true }).click();
    await expect(f.a.locator('.shopping-cart').getByRole('alert')).toContainText('Giỏ đã thay đổi');
    await expect(first.getByRole('spinbutton')).toHaveValue('2');
    await f.a.unroute('**/api/guest/cart/*');
    await first.getByRole('button', { name: 'Sửa ghi chú', exact: true }).click();
    await f.a
      .getByRole('dialog')
      .getByLabel(/^Ghi chú cho bếp/)
      .fill('Không hành');
    await f.a.getByRole('button', { name: 'Cập nhật ghi chú', exact: true }).click();
    await expect(f.a.getByRole('dialog')).toHaveCount(0);
    await expect(first).toContainText('Không hành');
    await expect(f.a.locator('.shopping-cart-checkout')).toContainText('110.000');
    await expect(f.a.locator('.cart-scope-totals')).toContainText('159.000');
    await expect(f.a.locator('.cart-scope-totals')).toContainText('174.000');
    await f.a.getByRole('button', { name: /Cả bàn/ }).click();
    const other = f.a.locator('.cart-other-person');
    await expect(other).toContainText('Minh');
    await expect(other.getByRole('checkbox')).toHaveCount(0);
    await expect(other.getByRole('button')).toHaveCount(0);
    await f.a.getByRole('link', { name: 'Quyết Trường: về thực đơn', exact: true }).click();
    await expect(f.a).toHaveURL(/\/guest$/);
    await expect(f.a.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true })).toBeVisible();
    await nav(f.a)
      .getByRole('button', { name: /Giỏ món/ })
      .click();
    await expect(second).not.toBeChecked();
    await f.a.getByRole('button', { name: 'Gửi món đã chọn', exact: true }).click();
    await expect(first).toHaveCount(0);
    await expect(second).not.toBeChecked();
    await expect(f.a.getByRole('button', { name: 'Gửi món đã chọn', exact: true })).toBeDisabled();
    const s = await state(f.a);
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0]).toMatchObject({
      product_name_snapshot: 'Chả giò giòn',
      quantity: 2,
      note: 'Không hành',
      status: 'SUBMITTED',
    });
    expect(s.items).toHaveLength(2);
    expect(s.items.map((i: { name: string }) => i.name).sort()).toEqual(
      ['Nước suối 500 ml', 'Đậu hũ chiên sả'].sort(),
    );
    for (const width of info.project.use.isMobile ? [390, 320] : [1440, 1024, 768, 390, 320]) {
      await f.a.setViewportSize({ width, height: 844 });
      await expect
        .poll(() => f.a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
    }
    await f.a.setViewportSize(info.project.use.viewport!);
    await f.a.screenshot({
      path: info.outputPath('guest-selected-cart.png'),
      fullPage: true,
      scale: 'css',
      animations: 'disabled',
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});

test('call now reviews only the new dish; bulk removal is atomic and protects other guests', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info);
  try {
    await add(f.a, 'Chả giò giòn');
    await add(f.a, 'Đậu hũ chiên sả');
    await addForOther(f.b);
    await f.a.reload();
    await expect(f.a.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true })).toBeVisible();
    await f.a.screenshot({
      path: info.outputPath('guest-menu-with-cart.png'),
      scale: 'css',
      animations: 'disabled',
    });
    let s = await state(f.a);
    const own = s.items.filter(
      (i: { owner_participant_id: string }) => i.owner_participant_id === s.participant.id,
    );
    const foreign = s.items.find(
      (i: { owner_participant_id: string }) => i.owner_participant_id !== s.participant.id,
    );
    const headers = { origin: new URL(f.a.url()).origin, 'x-csrf-protection': '1' };
    const beforeVersion = s.cart.cart_version;
    const forbidden = await f.a.request.delete('/api/guest/cart', {
      headers,
      data: { cartVersion: beforeVersion, itemIds: [own[0].id, foreign.id] },
    });
    expect(forbidden.status()).toBe(403);
    s = await state(f.a);
    expect(s.items).toHaveLength(3);
    expect(s.cart.cart_version).toBe(beforeVersion);
    const stale = await f.a.request.delete('/api/guest/cart', {
      headers,
      data: { cartVersion: beforeVersion - 1, itemIds: own.map((i: { id: string }) => i.id) },
    });
    expect(stale.status()).toBe(409);
    const duplicate = await f.a.request.delete('/api/guest/cart', {
      headers,
      data: { cartVersion: beforeVersion, itemIds: [own[0].id, own[0].id] },
    });
    expect(duplicate.status()).toBe(400);
    await f.a.getByRole('button', { name: 'Chọn Gỏi cuốn tôm thịt', exact: true }).click();
    const picker = f.a.getByRole('dialog', { name: 'Chọn món', exact: true });
    await picker.getByRole('button', { name: 'Đóng', exact: true }).click();
    expect((await state(f.a)).items).toHaveLength(3);
    await f.a.getByRole('button', { name: 'Chọn Gỏi cuốn tôm thịt', exact: true }).focus();
    await f.a.keyboard.press('Enter');
    await expect(picker).toBeVisible();
    await picker.getByRole('spinbutton').fill('2');
    await picker.getByLabel(/Ghi chú cho bếp/).fill('Không hành');
    await f.a.screenshot({
      path: info.outputPath('guest-dish-picker.png'),
      scale: 'css',
      animations: 'disabled',
    });
    await f.a.getByRole('dialog').getByRole('button', { name: 'Gọi ngay', exact: true }).click();
    await expect(f.a.getByRole('dialog')).toHaveCount(0);
    await expect(f.a.getByRole('heading', { name: 'Giỏ món', exact: true })).toBeVisible();
    await expect(f.a.locator('.shopping-cart-row').first().getByRole('heading')).toHaveText(
      'Gỏi cuốn tôm thịt',
    );
    await expect(
      f.a.getByRole('checkbox', { name: 'Chọn gửi Gỏi cuốn tôm thịt', exact: true }),
    ).toBeChecked();
    await expect(
      f.a.getByRole('checkbox', { name: 'Chọn gửi Chả giò giòn', exact: true }),
    ).not.toBeChecked();
    await expect(
      f.a.getByRole('checkbox', { name: 'Chọn gửi Đậu hũ chiên sả', exact: true }),
    ).not.toBeChecked();
    await expect(f.a.locator('.shopping-cart-checkout')).toContainText('90.000');
    expect((await state(f.a)).orders).toHaveLength(0);
    await f.a.screenshot({
      path: info.outputPath('guest-call-now.png'),
      fullPage: true,
      scale: 'css',
      animations: 'disabled',
    });
    if (info.project.use.isMobile) {
      await f.a.setViewportSize({ width: 320, height: 844 });
      await f.a.screenshot({
        path: info.outputPath('guest-cart-320.png'),
        scale: 'css',
        animations: 'disabled',
      });
      await f.a.setViewportSize(info.project.use.viewport!);
    }
    await f.a.getByRole('button', { name: 'Gửi món đã chọn', exact: true }).click();
    await expect(
      f.a.getByRole('checkbox', { name: 'Chọn gửi Gỏi cuốn tôm thịt', exact: true }),
    ).toHaveCount(0);
    await f.a.getByRole('button', { name: 'Chỉnh sửa giỏ', exact: true }).click();
    await expect(
      f.a.getByRole('checkbox', { name: 'Chọn xóa Chả giò giòn', exact: true }),
    ).not.toBeChecked();
    await f.a.getByRole('checkbox', { name: 'Chọn xóa Chả giò giòn', exact: true }).check();
    await f.a.getByRole('button', { name: 'Xóa món đã chọn (1)', exact: true }).click();
    await f.a.getByRole('dialog').getByRole('button', { name: 'Giữ lại', exact: true }).click();
    expect((await state(f.a)).items).toHaveLength(3);
    await f.a.getByRole('button', { name: 'Xóa tất cả món của tôi', exact: true }).click();
    await f.a
      .getByRole('dialog')
      .getByRole('button', { name: 'Xác nhận xóa', exact: true })
      .click();
    await expect(f.a.getByRole('dialog')).toHaveCount(0);
    s = await state(f.a);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].id).toBe(foreign.id);
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0].product_name_snapshot).toBe('Gỏi cuốn tôm thịt');
    expect(s.orders[0].quantity).toBe(2);
    expect(s.orders[0].note).toBe('Không hành');
    const otherState = await state(f.b);
    await post(f.b, '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: otherState.cart.cart_version,
      itemIds: [foreign.id],
    });
    await f.a.reload();
    await nav(f.a).getByRole('button', { name: 'Món đã gọi', exact: true }).click();
    await expect(f.a.getByLabel('Thời gian', { exact: true })).toHaveCount(0);
    await expect(f.a.locator('.order-owner').filter({ hasText: 'Bạn gọi' })).toHaveCount(1);
    await expect(f.a.locator('.order-owner').filter({ hasText: 'Minh gọi' })).toHaveCount(1);
    const otherOrder = f.a.locator('.guest-order-group').filter({ hasText: 'Minh gọi' });
    await expect(otherOrder.getByRole('button', { name: /Hủy/ })).toHaveCount(0);
    await f.a.getByRole('button', { name: 'Món của tôi', exact: true }).click();
    await expect(f.a.locator('.guest-order-group')).toHaveCount(1);
    await expect(f.a.locator('.guest-order-group')).toContainText('Bạn gọi');
    await f.a.screenshot({
      path: info.outputPath('guest-own-orders.png'),
      scale: 'css',
      animations: 'disabled',
    });
    await nav(f.a).getByRole('button', { name: 'Thực đơn', exact: true }).click();
    await f.a.screenshot({
      path: info.outputPath('guest-menu.png'),
      fullPage: false,
      scale: 'css',
      animations: 'disabled',
    });
  } finally {
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});

test('shared cart remains readable when only another guest has selected dishes', async ({
  browser,
  baseURL,
}, info) => {
  const f = await setup(browser, baseURL, info);
  try {
    await addForOther(f.b);
    await nav(f.a)
      .getByRole('button', { name: /Giỏ món/ })
      .click();
    await expect(
      f.a.getByRole('heading', { name: 'Giỏ của bạn đang trống', exact: true }),
    ).toBeVisible();
    await f.a.getByRole('button', { name: /Cả bàn/ }).click();
    await expect(f.a.locator('.cart-other-person')).toContainText('Minh');
    await expect(f.a.locator('.cart-other-person')).toContainText('Nước suối 500 ml');
    await expect(
      f.a.getByRole('heading', { name: /Giỏ của bạn đang trống|Chưa có món trong giỏ/ }),
    ).toHaveCount(0);
    await expect(f.a.locator('.cart-other-person').getByRole('checkbox')).toHaveCount(0);
    expect(await f.a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await f.a.screenshot({
      path: info.outputPath('guest-others-only-cart.png'),
      scale: 'css',
      animations: 'disabled',
    });
  } finally {
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});
