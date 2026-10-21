import { browserTableCode } from './table-code-fixture';
import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
import { restaurantPolicy } from '../../packages/contracts/src/index.js';
async function login(page: Page, user: string, area: string) {
  await page.goto('/login');
  await page.locator('#username').fill(user);
  await page.locator('#password').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + area));
}
async function post(page: Page, path: string, data: unknown) {
  const r = await page.request.post('/api' + path, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test('policy validation, keyboard/mobile reading, cart review, payment/leave confirmations and kitchen-admin fault decision', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({
        baseURL,
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        deviceScaleFactor: info.project.use.deviceScaleFactor,
        userAgent: info.project.use.userAgent,
      }),
    ),
  );
  const [admin, guest, kitchen, staff] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const p of [admin!, guest!, kitchen!, staff!])
    p.on('pageerror', (e) => errors.push(e.message));
  let joinRequests = 0;
  guest!.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/guest/join' && request.method() === 'POST')
      joinRequests++;
  });
  try {
    await login(admin!, 'quyettruong05', 'admin');
    await login(staff!, 'pv007', 'staff');
    await guest!.goto('/guest');
    const guestMessage = guest!.locator('.guest-welcome').getByRole('alert');
    await expect(guestMessage).toContainText('quét QR');
    await expect(guestMessage).not.toContainText('đăng nhập');
    const tables = await (await admin!.request.get('/api/core/admin/tables')).json();
    const code = 'POLICY-' + info.project.name + '-' + Date.now();
    const table = await post(admin!, '/core/tables', {
      areaId: tables[0].area_id,
      code,
      name: code,
      capacity: 4,
    });
    const qr = await post(admin!, '/core/tables/' + table.id + '/qr', {});
    await guest!.goto(qr.joinPath);
    await guest!
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin!, qr.joinPath, staff!));
    const accept = guest!.getByRole('checkbox', {
      name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn',
    });
    await expect(accept).not.toBeChecked();
    await guest!.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(guest!.locator('.guest-join-form').getByRole('alert')).toHaveText(
      'Vui lòng nhập tên của bạn (tối đa 80 ký tự).',
    );
    await expect(guest!.getByLabel('Tên của bạn', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(joinRequests).toBe(0);
    await guest!.getByLabel('Tên của bạn').fill('Khách kiểm tra chính sách');
    await guest!.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(guest!.locator('.guest-join-form').getByRole('alert')).toHaveText(
      'Vui lòng đồng ý với quy định để vào bàn gọi món.',
    );
    expect(joinRequests).toBe(0);
    await guest!.getByRole('button', { name: 'Quy định & chính sách', exact: true }).focus();
    await guest!.keyboard.press('Enter');
    const dialog = guest!.getByRole('dialog', { name: restaurantPolicy.title });
    const policyDate = new Date(restaurantPolicy.updatedAt + 'T00:00:00Z').toLocaleDateString(
      'vi-VN',
      { timeZone: 'UTC' },
    );
    await expect(dialog.locator('.policy-date')).toHaveText('Cập nhật ' + policyDate);
    await expect(dialog.locator('summary')).toHaveText(
      restaurantPolicy.sections.map((section) => section.title),
    );
    for (const width of [320, 390, 768, 1440]) {
      await guest!.setViewportSize({ width, height: 844 });
      await expect(dialog).toBeVisible();
      expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await guest!.setViewportSize(info.project.use.viewport!);
    await dialog.locator('summary').filter({ hasText: 'Hủy món trước chế biến' }).focus();
    await guest!.keyboard.press('Enter');
    await expect(
      dialog.getByText('Bạn tự hủy món của mình khi còn chờ bếp nhận.', { exact: false }),
    ).toBeVisible();
    await guest!.screenshot({ path: info.outputPath('policy-dialog.png'), fullPage: false });
    await guest!.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
      guest!.getByRole('button', { name: 'Quy định & chính sách', exact: true }),
    ).toBeFocused();
    await accept.check();
    const joined = guest!.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/guest/join' &&
        response.request().method() === 'POST',
    );
    await guest!.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    const joinedResponse = await joined;
    expect(joinedResponse.ok(), await joinedResponse.text()).toBe(true);
    expect(joinRequests).toBe(1);
    await expect(
      guest!.getByRole('heading', { name: 'Hôm nay bạn muốn dùng món gì?', exact: true }),
    ).toBeVisible();
    const state = await (await guest!.request.get('/api/guest/state')).json();
    expect(state.participant.acceptedPolicyVersion).toBe(restaurantPolicy.version);
    expect(state.participant.acceptedPolicyAt).toBeTruthy();
    await guest!.reload();
    await expect(accept).toHaveCount(0);
    await guest!.goto(qr.joinPath);
    await expect(
      guest!.getByRole('heading', { name: 'Hôm nay bạn muốn dùng món gì?', exact: true }),
    ).toBeVisible();
    await expect(accept).toHaveCount(0);
    expect((await (await guest!.request.get('/api/guest/state')).json()).participant.id).toBe(
      state.participant.id,
    );
    expect(joinRequests).toBe(1);
    const otherTable = await post(admin!, '/core/tables', {
      areaId: tables[0].area_id,
      code: code + '-B',
      name: code + '-B',
      capacity: 4,
    });
    const otherQr = await post(admin!, '/core/tables/' + otherTable.id + '/qr', {});
    await guest!.goto(otherQr.joinPath);
    await expect(accept).toBeVisible();
    await expect(accept).not.toBeChecked();
    await expect(guest!.getByRole('navigation', { name: 'Điều hướng khách' })).toHaveCount(0);
    await guest!.goto(qr.joinPath);
    await expect(
      guest!.getByRole('heading', { name: 'Hôm nay bạn muốn dùng món gì?', exact: true }),
    ).toBeVisible();
    await expect(accept).toHaveCount(0);
    expect(joinRequests).toBe(1);
    expect((await (await guest!.request.get('/api/guest/state')).json()).session.id).toBe(
      state.session.id,
    );
    await guest!.getByRole('button', { name: 'Quy định & chính sách', exact: true }).click();
    await expect(guest!.getByRole('dialog')).toContainText('Hoàn tiền');
    await guest!.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    const dish = guest!
      .locator('article')
      .filter({ has: guest!.getByRole('heading', { name: 'Nước suối 500 ml', exact: true }) });
    await dish.getByRole('button', { name: 'Chọn Nước suối 500 ml', exact: true }).click();
    await guest!
      .getByRole('dialog')
      .getByRole('button', { name: 'Thêm vào giỏ', exact: true })
      .click();
    const nav = guest!.getByRole('navigation', { name: 'Điều hướng khách' });
    await nav.getByRole('button', { name: /Giỏ món/ }).click();
    await expect(guest!.locator('.submit-order-review')).toContainText(
      'Lần gửi này: 1 món & combo',
    );
    await expect(guest!.locator('.submit-order-review')).toContainText('15.000');
    await guest!.screenshot({ path: info.outputPath('guest-order-review.png'), fullPage: false });
    const ordered = guest!.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/guest/orders' &&
        response.request().method() === 'POST',
    );
    await guest!.getByRole('button', { name: 'Gửi món đã chọn', exact: true }).click();
    const orderResponse = await ordered;
    expect(orderResponse.ok(), await orderResponse.text()).toBe(true);
    const submitted = await (await guest!.request.get('/api/guest/state')).json();
    const item = submitted.orders[0];
    const sid = submitted.session.id;
    const tableHeading = 'Bàn ' + code + ' · Phiên #' + sid.slice(0, 8).toUpperCase();
    if (item.status === 'PENDING_REVIEW')
      await post(staff!, '/core/orders/' + item.id + '/review', { approve: true });
    await nav.getByRole('button', { name: 'Thanh toán', exact: true }).click();
    const payment = guest!.getByRole('form', { name: 'Yêu cầu thanh toán', exact: true });
    await payment.getByRole('button', { name: 'Báo nhân viên thu tiền', exact: true }).click();
    await expect(
      guest!.getByText('Bạn đã báo nhân viên hỗ trợ thanh toán', { exact: true }),
    ).toBeVisible();
    const bill = await (await staff!.request.get('/api/core/sessions/' + sid + '/bill')).json();
    expect(bill.intents).toHaveLength(0);
    expect(bill.paymentRequests).toHaveLength(1);
    expect(bill.account.paid_total).toBe('0');
    expect(bill.account.reserved_payment_amount).toBe('0');
    await guest!.reload();
    await nav.getByRole('button', { name: 'Thanh toán', exact: true }).click();
    await expect(
      guest!.getByText('Bạn đã báo nhân viên hỗ trợ thanh toán', { exact: true }),
    ).toBeVisible();
    await login(kitchen!, 'bep001', 'kitchen');
    await kitchen!.getByRole('button', { name: 'Hướng dẫn bếp', exact: true }).click();
    const kitchenHelp = kitchen!.getByRole('dialog', { name: 'Hướng dẫn bếp', exact: true });
    await kitchenHelp.getByText('Sự cố trong khi chế biến', { exact: true }).click();
    await expect(kitchenHelp.getByText(/Không tự miễn tiền/)).toBeVisible();
    await kitchen!.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    const ticket = kitchen!
      .locator('article')
      .filter({ has: kitchen!.getByRole('heading', { name: tableHeading, exact: true }) });
    await ticket.getByRole('button', { name: 'Bếp nhận cả lượt', exact: true }).click();
    await ticket.getByRole('button', { name: 'Bắt đầu chế biến', exact: true }).click();
    await ticket.locator('summary').filter({ hasText: 'Báo sự cố và dừng món' }).click();
    await ticket.getByRole('button', { name: 'Lỗi chế biến của nhà hàng', exact: true }).click();
    await ticket.getByRole('button', { name: 'Dừng món và báo sự cố', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await admin!.request.get('/api/core/order-exceptions')).json()).find(
            (i: { id: string }) => i.id === item.item_id,
          )?.reported_issue,
      )
      .toBe(true);
    const adminNav = admin!.getByRole('navigation', { name: 'Quản trị', exact: true });
    const expand = adminNav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
    if (await expand.count()) await expand.click();
    await selectAdmin(admin!, 'Việc cần xử lý');
    const incident = admin!
      .locator('.inbox-case')
      .filter({ has: admin!.getByRole('heading', { name: tableHeading, exact: true }) });
    await expect(incident).toContainText('Lỗi chế biến');
    await incident.getByRole('button', { name: 'Kiểm tra & quyết định', exact: true }).click();
    await admin!
      .getByRole('dialog')
      .getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true })
      .click();
    const faultDecision = admin!.getByRole('dialog', {
      name: 'Xác nhận lỗi nhà hàng?',
      exact: true,
    });
    await expect(faultDecision).toContainText('Khách không phải trả 15.000 đ cho món này.');
    await expect(faultDecision).toContainText('Nguyên liệu đã sử dụng vẫn tính là tiêu hao.');
    await expect(faultDecision).toContainText('cần hoàn tiền thực tế và xác nhận giao dịch riêng.');
    await faultDecision.getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await staff!.request.get('/api/core/sessions/' + sid + '/bill')).json()).account
            .charge_total,
      )
      .toBe('0');
    await guest!.reload();
    await nav.getByRole('button', { name: 'Thanh toán', exact: true }).click();
    const adjustedDish = guest!.locator('.guest-bill-item').filter({ hasText: 'Nước suối 500 ml' });
    await expect(adjustedDish).toContainText('Nhà hàng hủy - Không tính tiền');
    await expect(adjustedDish.locator('[data-label="Đơn giá"]')).toHaveText('15.000 đ');
    await expect(adjustedDish.locator('[data-label="Thành tiền"]')).toHaveText('0 đ');
    await guest!.screenshot({ path: info.outputPath('guest-fault-bill.png'), fullPage: false });
    await guest!.getByRole('button', { name: /Người cùng bàn, \d+ người/ }).click();
    await guest!.getByRole('button', { name: 'Tên của bạn và rời bàn', exact: true }).click();
    await guest!.getByRole('button', { name: 'Rời bàn', exact: true }).click();
    await expect(
      guest!.getByRole('dialog', { name: 'Rời bàn trên thiết bị này?', exact: true }),
    ).toContainText('Giỏ chưa gửi');
    await expect(
      guest!.getByRole('dialog', { name: 'Rời bàn trên thiết bị này?', exact: true }),
    ).toContainText('Món đã gửi');
    await guest!
      .getByRole('dialog', { name: 'Rời bàn trên thiết bị này?', exact: true })
      .getByRole('button', { name: 'Hủy', exact: true })
      .click();
    expect((await guest!.request.get('/api/guest/state')).ok()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
  }
});
