import { browserTableCode } from './table-code-fixture';
import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test';

async function login(p: Page, user: string, workspace: string) {
  await p.bringToFront();
  await p.goto('/login');
  await p.locator('#username').fill(user);
  await p.locator('#password').fill(process.env.SEED_PASSWORD!);
  await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(p).toHaveURL(new RegExp('workspace/' + workspace));
}
async function post(p: Page, path: string, data: unknown) {
  const response = await p.request.post('/api' + path, {
    headers: { origin: new URL(p.url()).origin, 'x-csrf-protection': '1' },
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
  for (const context of contexts) context.setDefaultTimeout(10000);
  const [admin, guest, staff] = await Promise.all(contexts.map((c) => c.newPage()));
  await login(admin!, 'quyettruong05', 'admin');
  await login(staff!, 'pv005', 'staff');
  const prefix = 'MT' + info.project.name[0] + '-' + String(Date.now()).slice(-7);
  const a = await post(admin!, '/core/areas', {
    code: prefix + 'A',
    name: 'Khu phòng - ' + prefix,
  });
  const b = await post(admin!, '/core/areas', { code: prefix + 'B', name: 'Khu sân - ' + prefix });
  const make = (name: string, capacity: number, areaId = a.id) =>
    post(admin!, '/core/tables', {
      areaId,
      code: prefix + name,
      name,
      capacity,
    });
  const source = await make('P01', 4),
    exact = await make('A05', 4),
    large = await make('A06', 6),
    biggest = await make('A10', 10),
    small = await make('A02', 2),
    other = await make('V01', 4, b.id);
  const qr = await post(admin!, '/core/tables/' + source.id + '/qr', {});
  await guest!.bringToFront();
  await guest!.goto(qr.joinPath);
  await guest!
    .getByLabel('Mã vào bàn', { exact: true })
    .fill(await browserTableCode(admin!, qr.joinPath, staff!));
  await guest!.getByLabel('Tên của bạn').fill('An chuyển bàn');
  await guest!
    .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
    .check();
  await guest!.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
  await expect(
    guest!.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => (await (await guest!.request.get('/api/guest/state')).json()).session?.table_id,
    )
    .toBe(source.id);
  // STAFF must stay visible so its 3 s polling observes transfers by another employee.
  await staff!.bringToFront();
  await staff!
    .locator('.service-tools')
    .getByRole('button', { name: 'Làm mới', exact: true })
    .click();
  await staff!.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(prefix);
  await staff!
    .locator('.table-tile')
    .filter({ has: staff!.getByRole('heading', { name: 'P01', exact: true }) })
    .getByRole('button', { name: 'Mở chi tiết bàn' })
    .click();
  await staff!
    .getByRole('dialog')
    .getByRole('button', { name: 'Thêm thao tác', exact: true })
    .click();
  const session = (await (await guest!.request.get('/api/guest/state')).json()).session;
  return {
    contexts,
    admin: admin!,
    guest: guest!,
    staff: staff!,
    prefix,
    a,
    b,
    source,
    exact,
    large,
    biggest,
    small,
    other,
    session,
  };
}
test('picker filters and capacity, keyboard confirmation, same guest cart, immediate tables and history on all viewport sizes', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info),
    { staff, guest, admin } = f;
  const errors: string[] = [];
  staff.on('pageerror', (e) => errors.push(e.message));
  guest.on('pageerror', (e) => errors.push(e.message));
  try {
    const detail = staff.getByRole('dialog', { name: 'Chi tiết - P01' });
    await detail.getByRole('button', { name: 'Lịch sử chuyển bàn', exact: true }).click();
    const history = staff.getByRole('dialog', { name: 'Lịch sử chuyển của phiên' });
    await expect(history).toContainText('Phiên này chưa từng chuyển bàn.');
    await staff.keyboard.press('Escape');
    await expect(
      detail.getByRole('button', { name: 'Lịch sử chuyển bàn', exact: true }),
    ).toBeFocused();
    const category = await post(admin, '/core/categories', {
      code: f.prefix + 'C',
      name: 'Đồ uống kiểm thử chuyển bàn',
    });
    const product = await post(admin, '/core/products', {
      categoryId: category.id,
      code: f.prefix + 'M',
      name: 'Nước chanh thử chuyển bàn',
      price: '35000',
      stockManaged: false,
    });
    const state = await (await guest.request.get('/api/guest/state')).json();
    const line = await post(guest, '/guest/cart', {
      productId: product.id,
      quantity: 2,
      cartVersion: state.cart.cart_version,
      note: 'Giữ qua chuyển bàn',
    });
    await detail.getByRole('button', { name: 'Chuyển bàn', exact: true }).click();
    let picker = staff.getByRole('dialog', { name: 'Chọn bàn để chuyển' });
    await expect(picker).toBeVisible();
    await picker.getByLabel('Số khách thực tế', { exact: true }).fill('4');
    await picker.getByRole('textbox', { name: 'Tìm mã hoặc tên bàn…' }).fill(f.prefix);
    await expect(picker.getByRole('radio')).toHaveCount(4);
    expect(
      await picker
        .getByRole('radio')
        .evaluateAll((radios) => radios.map((r) => (r as HTMLInputElement).value)),
    ).toEqual([f.exact.id, f.large.id, f.biggest.id, f.other.id]);
    await picker.getByLabel('Khu vực', { exact: true }).selectOption(f.a.id);
    await expect(picker.getByRole('radio')).toHaveCount(3);
    const radio = picker.getByRole('radio', {
      name: 'A05 - ' + f.a.name + ' - 4 chỗ - Sẵn sàng',
      exact: true,
    });
    await radio.focus();
    await staff.keyboard.press('Space');
    await expect(radio).toBeChecked();
    await expect(picker.locator('.is-selected')).toContainText('Đã chọn');
    await picker.getByLabel('Số khách thực tế', { exact: true }).fill('6');
    await expect(picker).toContainText('Bàn A05 chỉ có 4 chỗ nên không còn phù hợp');
    await expect(
      picker.getByRole('button', { name: 'Xác nhận chuyển bàn', exact: true }),
    ).toBeDisabled();
    await picker
      .getByRole('radio', { name: 'A06 - ' + f.a.name + ' - 6 chỗ - Sẵn sàng', exact: true })
      .check();
    await picker.getByLabel('Lý do chuyển bàn', { exact: true }).selectOption('OTHER');
    await expect(picker.getByLabel('Nội dung lý do (bắt buộc)')).toHaveAttribute('required', '');
    await picker.getByLabel('Nội dung lý do (bắt buộc)').fill('Khách muốn ngồi rộng hơn');
    for (const width of [320, 768, 1440]) {
      await staff.setViewportSize({ width, height: 900 });
      expect(await picker.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await staff.setViewportSize(info.project.use.viewport!);
    await picker.screenshot({ path: info.outputPath('transfer-picker.png') });
    await picker.getByRole('button', { name: 'Xác nhận chuyển bàn', exact: true }).click();
    let review = staff.getByRole('dialog', { name: 'Xác nhận chuyển bàn', exact: true });
    await expect(review).toContainText('6 khách');
    await expect(review).toContainText('Chờ dọn');
    await expect(review.getByRole('button', { name: 'Hủy', exact: true })).toBeFocused();
    await review.getByRole('button', { name: 'Hủy', exact: true }).click();
    picker = staff.getByRole('dialog', { name: 'Chọn bàn để chuyển' });
    await expect(
      picker.getByRole('button', { name: 'Xác nhận chuyển bàn', exact: true }),
    ).toBeFocused();
    expect((await (await guest.request.get('/api/guest/state')).json()).session.table_id).toBe(
      f.source.id,
    );
    await picker.getByRole('button', { name: 'Xác nhận chuyển bàn', exact: true }).click();
    review = staff.getByRole('dialog', { name: 'Xác nhận chuyển bàn', exact: true });
    await review.screenshot({ path: info.outputPath('transfer-review.png') });
    await review.getByRole('button', { name: 'Chuyển bàn', exact: true }).click();
    await expect(review).toHaveCount(0);
    const moved = staff.getByRole('dialog', { name: 'Chi tiết - A06' });
    await expect(moved).toContainText('Đã chuyển P01 → A06.');
    await expect(moved.getByRole('button', { name: 'Chuyển bàn', exact: true })).toBeFocused();
    await guest.bringToFront();
    await expect(guest.locator('.operation-notice-region').getByRole('status')).toContainText(
      'Bàn của bạn đã được chuyển sang A06. Giỏ, món và thanh toán được giữ nguyên.',
      { timeout: 15000 }, // Guest polls every 5s; allow its current read to complete.
    );
    const after = await (await guest.request.get('/api/guest/state')).json();
    expect(after.session.id).toBe(state.session.id);
    expect(after.participant.id).toBe(state.participant.id);
    expect(after.items.find((i: { id: string }) => i.id === line.id).quantity).toBe(2);
    await staff.bringToFront();
    await moved.getByRole('button', { name: 'Lịch sử chuyển bàn', exact: true }).click();
    await expect(history.locator('.transfer-timeline li')).toHaveCount(1);
    await expect(history).toContainText('P01');
    await expect(history).toContainText('A06');
    await expect(history).toContainText('pv005');
    await expect(history).toContainText('Khách muốn ngồi rộng hơn');
    await expect(history).toBeVisible();
    const historyBox = await history.boundingBox();
    expect(historyBox).not.toBeNull();
    expect(historyBox!.width).toBeGreaterThan(0);
    expect(historyBox!.height).toBeGreaterThan(0);
    // WebKit can suspend locator screenshot's RAF stability check after a background tab.
    // Capture the same visible dialog region without changing the history or focus assertions.
    await staff.screenshot({
      path: info.outputPath('transfer-history.png'),
      clip: historyBox!,
      animations: 'disabled',
    });
    await staff.keyboard.press('Escape');
    await expect(history).toHaveCount(0);
    await expect(moved).toBeVisible();
    const closeDetail = moved.getByRole('button', { name: 'Đóng', exact: true });
    await expect(closeDetail).toBeVisible();
    await expect(closeDetail).toBeEnabled();
    // Use the parent dialog's native cancel action after its child history is removed.
    // This avoids competing with history's queued focus restoration or WebKit's RAF click checks.
    await staff.keyboard.press('Escape');
    await expect(moved).toHaveCount(0);
    // Names repeat across earlier scenarios; identify this fixture by its unique table codes.
    const tableSearch = staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' });
    await tableSearch.fill(f.prefix);
    await expect(tableSearch).toHaveValue(f.prefix);
    await expect(
      staff
        .locator('.table-tile')
        .filter({ has: staff.getByRole('heading', { name: 'P01', exact: true }) }),
    ).toHaveAttribute('data-status', 'NEEDS_CLEANING');
    await expect(
      staff
        .locator('.table-tile')
        .filter({ has: staff.getByRole('heading', { name: 'A06', exact: true }) }),
    ).toHaveAttribute('data-status', 'OCCUPIED');
    await guest.bringToFront();
    // The seeded menu is taller than WebKit's image limit at mobile DPR.
    // Keep a diagnostic of the visible guest view; cart/session assertions above cover continuity.
    await guest.screenshot({
      path: info.outputPath('transfer-guest.png'),
      fullPage: false,
      scale: 'css',
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});
test('empty filter, occupied destination error with refreshed selection, and externally moved source', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90000);
  const f = await setup(browser, baseURL, info),
    { staff } = f;
  try {
    await staff
      .getByRole('dialog', { name: 'Chi tiết - P01' })
      .getByRole('button', { name: 'Chuyển bàn', exact: true })
      .click();
    let picker = staff.getByRole('dialog', { name: 'Chọn bàn để chuyển' });
    await picker.getByLabel('Số khách thực tế', { exact: true }).fill('4');
    await picker.getByRole('textbox', { name: 'Tìm mã hoặc tên bàn…' }).fill('Không có mã này');
    await expect(picker).toContainText('Không có bàn khớp bộ lọc.');
    await expect(
      picker.getByRole('button', { name: 'Xác nhận chuyển bàn', exact: true }),
    ).toBeDisabled();
    await picker.getByRole('textbox', { name: 'Tìm mã hoặc tên bàn…' }).fill(f.prefix);
    await picker.getByLabel('Khu vực', { exact: true }).selectOption(f.a.id);
    await picker
      .getByRole('radio', { name: 'A05 - ' + f.a.name + ' - 4 chỗ - Sẵn sàng', exact: true })
      .check();
    await picker.getByRole('button', { name: 'Xác nhận chuyển bàn', exact: true }).click();
    const snapshot = await (await staff.request.get('/api/core/tables')).json();
    // Keep the displayed list at its last response to reproduce a genuine race.
    // Opening and transferring still use the real API and real test database.
    let showSnapshot = true;
    await staff.route('**/api/core/tables', (route) =>
      showSnapshot ? route.fulfill({ json: snapshot }) : route.continue(),
    );
    await post(staff, '/core/tables/' + f.exact.id + '/open', {});
    await staff
      .getByRole('dialog', { name: 'Xác nhận chuyển bàn', exact: true })
      .getByRole('button', { name: 'Chuyển bàn', exact: true })
      .click();
    picker = staff.getByRole('dialog', { name: 'Chọn bàn để chuyển' });
    await expect(picker.getByRole('alert')).toContainText('Bàn A05 vừa được sử dụng');
    // Keep interception installed while the workspace starts parallel polls. Removing
    // it here can strand Chromium requests paused during Fetch-domain teardown.
    showSnapshot = false;
    await picker.getByRole('button', { name: 'Tải lại bàn', exact: true }).click();
    await expect(picker.getByRole('radio', { name: /^A05 -/ })).toHaveCount(0);
    await expect(
      picker.getByRole('button', { name: 'Xác nhận chuyển bàn', exact: true }),
    ).toBeDisabled();
    const tables = await (await staff.request.get('/api/core/tables')).json();
    expect(tables.find((t: { id: string }) => t.id === f.source.id).session_id).toBe(f.session.id);
    await post(staff, '/core/sessions/' + f.session.id + '/transfer', {
      fromTableId: f.source.id,
      tableId: f.large.id,
      partySize: 4,
      reasonCode: 'CUSTOMER_REQUEST',
    });

    await expect(picker.getByRole('alert')).toContainText(
      'Phiên đã được chuyển bởi nhân viên khác',
    );
    await picker.getByRole('button', { name: 'Xem bàn hiện tại', exact: true }).click();
    await expect(staff.getByRole('dialog', { name: 'Chi tiết - A06' })).toBeVisible();
  } finally {
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});
