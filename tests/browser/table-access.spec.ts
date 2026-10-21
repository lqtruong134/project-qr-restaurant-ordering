import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(p: Page, user: string, role: string) {
  await p.bringToFront();
  await p.goto('/login');
  await p.getByLabel('Tên đăng nhập', { exact: true }).fill(user);
  await p.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(p).toHaveURL(new RegExp('workspace/' + role));
}
async function post(p: Page, path: string, data: unknown) {
  const r = await p.request.post('/api' + path, {
    headers: { origin: new URL(p.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test('guest requests code, staff claims and issues it at table, members share code and ordinary orders reach kitchen', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, guest, other] = (await Promise.all(contexts.map((c) => c.newPage()))) as [
    Page,
    Page,
    Page,
    Page,
  ];
  const errors: string[] = [];
  for (const p of [staff, guest, other]) p.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv002', 'staff');
    const areas = await (await admin.request.get('/api/core/areas')).json(),
      code = 'ACCESS-' + randomUUID().slice(0, 8);
    const table = await post(admin, '/core/tables', {
      areaId: areas[0].id,
      code,
      name: code,
      capacity: 4,
    });
    const qr = await post(admin, '/core/tables/' + table.id + '/qr', {});
    await guest.bringToFront();
    await guest.goto(qr.joinPath);
    await guest.getByLabel('Tên của bạn', { exact: true }).fill('Trường');
    await expect(guest.getByText('Dùng tên dễ nhận biết', { exact: false })).toHaveCount(0);
    await expect(
      guest.getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' }),
    ).not.toBeChecked();
    await expect(guest.getByLabel('Mã vào bàn', { exact: true })).toHaveAttribute(
      'placeholder',
      'Nhập 4 số',
    );
    await guest.getByRole('button', { name: 'Yêu cầu nhân viên cấp mã', exact: true }).click();
    await expect(guest.locator('.access-request')).toContainText('Đã gửi yêu cầu cấp mã');
    await expect(guest.locator('.access-request button')).toBeDisabled();
    await guest.screenshot({ path: info.outputPath('guest-code-request.png'), fullPage: false });
    await staff.bringToFront();
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    const tile = staff.locator('.queue-table-card[data-table-id="' + table.id + '"]');
    await expect(tile).toContainText('Cấp mã tham gia bàn');
    await tile.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    const dialog = staff.getByRole('dialog', { name: 'Cấp mã - ' + code });
    await dialog.getByRole('button', { name: 'Nhận xử lý', exact: true }).click();
    await expect(dialog).toContainText('Bạn đang phụ trách');
    await dialog.getByRole('button', { name: 'Xác nhận tại bàn & cấp mã', exact: true }).click();
    await staff.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    const pin = await dialog.locator('.staff-table-code strong').innerText();
    expect(pin).toMatch(/^\d{4}$/);
    await staff.screenshot({ path: info.outputPath('staff-issued-code.png'), fullPage: false });
    await dialog.getByRole('button', { name: 'Đã đọc mã cho khách', exact: true }).click();
    await staff.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(dialog.locator('[data-support-id]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Sơ đồ bàn/ })
      .click();
    const activeTable = staff
      .locator('.table-tile')
      .filter({ has: staff.getByRole('heading', { name: code, exact: true }) });
    await activeTable.getByRole('button', { name: 'Mở chi tiết bàn', exact: true }).click();
    await staff
      .getByRole('dialog')
      .getByRole('button', { name: 'Việc tại bàn', exact: true })
      .click();
    const quickCode = staff.getByRole('dialog').locator('.staff-code-details');
    let releaseCodeRead!: () => void;
    const codeReadGate = new Promise<void>((resolve) => {
      releaseCodeRead = resolve;
    });
    const codeUrl = '**/api/core/tables/' + table.id + '/access-code';
    await staff.route(codeUrl, async (route) => {
      if (route.request().method() === 'GET') await codeReadGate;
      await route.continue();
    });
    await quickCode.locator('summary').click();
    try {
      await expect(quickCode.getByRole('status')).toHaveText('Đang lấy mã vào bàn…');
      await expect(
        quickCode.getByRole('button', { name: 'Xác nhận tại bàn & cấp mã', exact: true }),
      ).toHaveCount(0);
    } finally {
      releaseCodeRead();
    }
    await expect(quickCode.locator('.staff-table-code strong')).toHaveText(pin);
    await staff.unroute(codeUrl);
    // Reopening reads the current visit code instead of issuing or confirming it again.
    let codeReads = 0;
    let codeWrites = 0;
    await staff.route(codeUrl, async (route) => {
      if (route.request().method() === 'GET') codeReads++;
      else codeWrites++;
      await route.continue();
    });
    await quickCode.locator('summary').click();
    await quickCode.locator('summary').click();
    await expect(quickCode.locator('.staff-table-code strong')).toHaveText(pin);
    await expect.poll(() => codeReads).toBe(1);
    expect(codeWrites).toBe(0);
    await staff.unroute(codeUrl);
    await expect(
      quickCode.getByRole('button', { name: 'Xác nhận tại bàn & cấp mã', exact: true }),
    ).toHaveCount(0);
    await staff.screenshot({ path: info.outputPath('staff-code-quick-view.png'), scale: 'css' });
    await staff.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    await guest.bringToFront();
    await guest.getByLabel('Mã vào bàn', { exact: true }).fill(pin);
    await guest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(guest.locator('.session-code strong')).toHaveText(pin);
    await other.bringToFront();
    await other.goto(qr.joinPath);
    await other.getByLabel('Tên của bạn', { exact: true }).fill('Lữ Trường');
    await other.getByLabel('Mã vào bàn', { exact: true }).fill(pin);
    await other
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await other.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await guest.bringToFront();
    await expect(guest.getByRole('button', { name: 'Người cùng bàn, 2 người' })).toBeVisible();
    await guest.getByRole('button', { name: 'Lưu ý khi chia sẻ mã vào bàn', exact: true }).focus();
    await guest.keyboard.press('Enter');
    await expect(
      guest.getByRole('dialog', { name: 'Chia sẻ mã với người cùng bàn' }),
    ).toContainText('Không gửi mã cho người ngoài bàn');
    await guest.keyboard.press('Escape');
    await expect(
      guest.getByRole('button', { name: 'Lưu ý khi chia sẻ mã vào bàn', exact: true }),
    ).toBeFocused();
    for (const width of [320, 390, 768, 1440]) {
      await guest.setViewportSize({ width, height: 844 });
      expect(
        await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await guest.setViewportSize(info.project.use.viewport!);
    await guest.screenshot({ path: info.outputPath('guest-code-header.png'), fullPage: false });
    const state = await (await guest.request.get('/api/guest/state')).json(),
      p = state.products.find((p: { code: string }) => p.code === 'DRINK-07');
    const item = await post(guest, '/guest/cart', {
      productId: p.id,
      quantity: 1,
      cartVersion: state.cart.cart_version,
    });
    const updated = await (await guest.request.get('/api/guest/state')).json();
    const batch = await post(guest, '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: updated.cart.cart_version,
      itemIds: [item.id],
    });
    expect(batch.status).toBe('SUBMITTED');
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test('staff calls multiple dishes, shows customer review and follows the normal live order statuses', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 2 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff] = (await Promise.all(contexts.map((c) => c.newPage()))) as [Page, Page];
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv002', 'staff');
    const areas = await (await admin.request.get('/api/core/areas')).json(),
      code = 'HELP-' + randomUUID().slice(0, 8);
    const table = await post(admin, '/core/tables', {
      areaId: areas[0].id,
      code,
      name: code,
      capacity: 4,
    });
    await post(staff, '/core/tables/' + table.id + '/open', {});
    await staff
      .locator('.service-tools')
      .getByRole('button', { name: 'Làm mới', exact: true })
      .click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    const tile = staff
      .locator('article')
      .filter({ has: staff.getByRole('heading', { name: code, exact: true }) });
    await tile.getByRole('button', { name: 'Mở chi tiết bàn', exact: true }).click();
    await staff.getByRole('button', { name: 'Gọi món cho bàn', exact: true }).click();
    await expect(staff.getByRole('region', { name: 'Gọi món cho bàn' })).toBeVisible();
    const menu = staff.locator('.assisted-menu');
    await menu.getByRole('textbox', { name: 'Tìm tên món…' }).fill('Nước suối');
    await menu.getByRole('button', { name: 'Thêm món', exact: true }).click();
    const cart = staff.getByRole('complementary', { name: 'Giỏ món nhân viên gọi hộ' });
    await cart.getByRole('button', { name: 'Tăng số lượng Nước suối' }).click();
    await cart.getByLabel('Ghi chú cho bếp').fill('Để nguyên chai');
    await menu.getByRole('textbox', { name: 'Tìm tên món…' }).fill('Chả giò giòn');
    await menu.getByRole('button', { name: 'Thêm món', exact: true }).click();
    await expect(cart).toContainText('Giỏ món - 3 phần');
    await staff.getByRole('button', { name: 'Trở về chi tiết bàn' }).click();
    const leaving = staff.getByRole('dialog', { name: 'Rời màn hình gọi hộ?' });
    await expect(leaving).toContainText('chưa được gửi');
    await leaving.getByRole('button', { name: 'Tiếp tục gọi món' }).click();
    await expect(cart).toContainText('Giỏ món - 3 phần');
    await staff.screenshot({ path: info.outputPath('staff-assisted-menu.png'), fullPage: false });
    for (const width of [320, 768, 1440]) {
      await staff.setViewportSize({ width, height: 900 });
      expect(
        await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await staff.setViewportSize(info.project.use.viewport!);
    await cart.getByRole('button', { name: 'Cho khách kiểm tra & gửi món' }).click();
    const review = staff.getByRole('dialog', { name: 'Kiểm tra lượt gọi - ' + code });
    await expect(review).toContainText('2 × Nước suối');
    await expect(review).toContainText('1 × Chả giò giòn');
    await expect(review).toContainText('Để nguyên chai');
    await staff.screenshot({ path: info.outputPath('staff-assisted-review.png'), fullPage: false });
    await review.getByRole('button', { name: 'Gửi món đến bếp', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(staff.getByRole('region', { name: 'Gọi món cho bàn' })).toContainText(
      'Đã gửi lượt gọi đến bếp',
    );
    await staff.getByRole('button', { name: /Món đã gửi -/ }).click();
    await expect(staff.locator('.assisted-sent')).toContainText('Chờ bếp nhận');
    await expect(staff.locator('.assisted-sent')).toContainText('Để nguyên chai');
    const tables = await (await staff.request.get('/api/core/tables')).json();
    expect(tables.find((t: { id: string }) => t.id === table.id).participants).toBe(0);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test('a later guest receives the existing verified table code after staff claims support and the request stays open until read to the guest', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  for (const context of contexts) context.setDefaultTimeout(15000);
  const [admin, firstStaff, nextStaff, firstGuest, nextGuest] = (await Promise.all(
    contexts.map((c) => c.newPage()),
  )) as [Page, Page, Page, Page, Page];
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(firstStaff, 'pv002', 'staff');
    await login(nextStaff, 'pv003', 'staff');
    const areas = await (await admin.request.get('/api/core/areas')).json();
    const code = 'REPEAT-' + randomUUID().slice(0, 8);
    const table = await post(admin, '/core/tables', {
      areaId: areas[0].id,
      code,
      name: code,
      capacity: 4,
    });
    const qr = await post(admin, '/core/tables/' + table.id + '/qr', {});
    await post(firstStaff, '/core/tables/' + table.id + '/open', {});
    await firstStaff.bringToFront();
    await firstStaff
      .locator('.service-tools')
      .getByRole('button', { name: 'Làm mới', exact: true })
      .click();
    await firstStaff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    const tile = firstStaff
      .locator('.table-tile')
      .filter({ has: firstStaff.getByRole('heading', { name: code, exact: true }) });
    await tile.getByRole('button', { name: 'Mở chi tiết bàn', exact: true }).click();
    const firstDialog = firstStaff.getByRole('dialog');
    await firstDialog.getByRole('button', { name: 'Việc tại bàn', exact: true }).click();
    await firstDialog.locator('.staff-code-details summary').click();
    await expect(
      firstDialog.getByRole('button', { name: 'Xác nhận tại bàn & cấp mã', exact: true }),
    ).toHaveCount(0);
    const pin = await firstDialog.locator('.staff-table-code strong').innerText();
    expect(pin).toMatch(/^\d{4}$/);
    const firstCode = await (
      await firstStaff.request.get('/api/core/tables/' + table.id + '/access-code')
    ).json();
    await firstGuest.bringToFront();
    await firstGuest.goto(qr.joinPath);
    await firstGuest.getByLabel('Tên của bạn', { exact: true }).fill('Khách đầu tiên');
    await firstGuest.getByLabel('Mã vào bàn', { exact: true }).fill(pin);
    await firstGuest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await firstGuest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(firstGuest.locator('.session-code strong')).toHaveText(pin);

    await nextGuest.bringToFront();
    await nextGuest.goto(qr.joinPath);
    await nextGuest.getByLabel('Tên của bạn', { exact: true }).fill('Khách đến sau');
    await nextGuest.getByRole('button', { name: 'Yêu cầu nhân viên cấp mã', exact: true }).click();
    await expect(nextGuest.locator('.access-request')).toContainText('Đã gửi yêu cầu cấp mã');
    await nextStaff.bringToFront();
    await nextStaff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await nextStaff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    const task = nextStaff.locator('.queue-table-card[data-table-id="' + table.id + '"]');
    await task.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    const dialog = nextStaff.getByRole('dialog');
    const request = dialog.locator('[data-support-id]');
    let issueWrites = 0;
    const writes = (r: import('@playwright/test').Request) => {
      if (r.method() === 'POST' && r.url().endsWith('/access-code')) issueWrites++;
    };
    nextStaff.on('request', writes);
    await request.getByRole('button', { name: 'Nhận xử lý', exact: true }).click();
    await expect(request.locator('.staff-table-code strong')).toHaveText(pin);
    await expect(
      request.getByRole('button', { name: 'Xác nhận tại bàn & cấp mã', exact: true }),
    ).toHaveCount(0);
    const requestId = await request.getAttribute('data-support-id');
    const pending = await (await nextStaff.request.get('/api/core/support')).json();
    expect(pending.find((x: { id: string }) => x.id === requestId)).toMatchObject({
      status: 'ACKNOWLEDGED',
      session_id: firstCode.sessionId,
    });
    expect(issueWrites).toBe(0);
    await nextStaff.screenshot({
      path: info.outputPath('staff-existing-code-on-claim.png'),
      scale: 'css',
    });
    await request.getByRole('button', { name: 'Đã đọc mã cho khách', exact: true }).click();
    await nextStaff.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(request).toHaveCount(0);
    const history = await (
      await nextStaff.request.get('/api/core/support/' + requestId + '/history')
    ).json();
    expect(history.request.status).toBe('RESOLVED');
    expect(history.audit.map((x: { action: string }) => x.action)).not.toContain(
      'SUPPORT_ACCESS_CODE_ISSUED',
    );
    const currentCode = await (
      await nextStaff.request.get('/api/core/tables/' + table.id + '/access-code')
    ).json();
    expect(currentCode).toEqual(firstCode);
    expect(issueWrites).toBe(0);
    nextStaff.off('request', writes);
    await nextGuest.bringToFront();
    await nextGuest.getByLabel('Mã vào bàn', { exact: true }).fill(pin);
    await nextGuest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await nextGuest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(nextGuest.locator('.session-code strong')).toHaveText(pin);
    const refreshedRoster = firstGuest.waitForResponse(async (response) => {
      if (new URL(response.url()).pathname !== '/api/guest/state' || !response.ok()) return false;
      const snapshot = await response.json();
      return snapshot.participants.length === 2;
    });
    await firstGuest.bringToFront();
    await refreshedRoster;
    await expect(firstGuest.getByRole('button', { name: 'Người cùng bàn, 2 người' })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
