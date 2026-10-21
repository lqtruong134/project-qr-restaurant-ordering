import { browserTableCode } from './table-code-fixture';
import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 10000 });
async function login(p: Page, user: string, role: string) {
  await p.bringToFront();
  await p.goto('/login');
  await p.locator('#username').fill(user);
  await p.locator('#password').fill(process.env.SEED_PASSWORD!);
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
async function setup(browser: Browser, baseURL: string | undefined, info: TestInfo, guests = 1) {
  const contexts = await Promise.all(
    Array.from({ length: 3 + guests }, () =>
      browser.newContext({
        baseURL,
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        userAgent: info.project.use.userAgent,
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [admin, staff, kitchen] = pages as [Page, Page, Page];
  await login(admin, 'quyettruong05', 'admin');
  await login(staff, 'pv001', 'staff');
  await login(kitchen, 'bep001', 'kitchen');
  const code = 'PAY-' + info.project.name[0] + '-' + randomUUID().slice(0, 8);
  const areas = await (await admin.request.get('/api/core/areas')).json();
  const table = await post(admin, '/core/tables', {
    areaId: areas[0].id,
    code,
    name: code,
    capacity: 4,
  });
  const qr = await post(admin, '/core/tables/' + table.id + '/qr', {});
  const guestPages = pages.slice(3);
  for (let i = 0; i < guestPages.length; i++) {
    const p = guestPages[i]!;
    await p.bringToFront();
    await p.goto(qr.joinPath);
    await p
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin!, qr.joinPath, staff!));
    await p.getByLabel('Tên của bạn').fill(i === 0 ? 'Lan' : 'Minh');
    await p
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await p.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(p.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true })).toBeVisible();
  }
  const state = await (await guestPages[0]!.request.get('/api/guest/state')).json();
  return {
    contexts,
    admin,
    staff,
    kitchen,
    guests: guestPages,
    table,
    code,
    sid: state.session.id,
  };
}
async function serve(guest: Page, staff: Page, kitchen: Page, name: string, quantity: number) {
  let state = await (await guest.request.get('/api/guest/state')).json();
  const product = state.products.find((p: { name: string }) => p.name === name);
  await post(guest, '/guest/cart', {
    productId: product.id,
    quantity,
    cartVersion: state.cart.cart_version,
  });
  state = await (await guest.request.get('/api/guest/state')).json();
  const batch = await post(guest, '/guest/orders', {
    requestId: randomUUID(),
    cartVersion: state.cart.cart_version,
    itemIds: state.items
      .filter(
        (i: { owner_participant_id: string }) => i.owner_participant_id === state.participant.id,
      )
      .map((i: { id: string }) => i.id),
  });
  const orders = await (await staff.request.get('/api/core/orders')).json();
  const order = orders.find((o: { id: string }) => o.id === batch.id);
  if (order.status === 'PENDING_REVIEW')
    await post(staff, '/core/orders/' + batch.id + '/review', { approve: true });
  const item = order.items[0];
  for (const action of ['accept', 'prepare', 'ready'])
    await post(kitchen, '/core/items/' + item.id + '/' + action, {});
  await post(staff, '/core/items/' + item.id + '/serve', {});
  return item;
}
async function requestPayment(p: Page, method = 'Tiền mặt') {
  await p.bringToFront();
  await p.reload();
  await p
    .getByRole('navigation', { name: 'Điều hướng khách' })
    .getByRole('button', { name: 'Thanh toán', exact: true })
    .click();
  const form = p.getByRole('form', { name: 'Yêu cầu thanh toán', exact: true });
  await expect(form.getByRole('spinbutton')).toHaveCount(0);
  await form.getByRole('button', { name: method, exact: true }).click();
  await form.getByRole('button', { name: 'Báo nhân viên thu tiền', exact: true }).click();
  await expect(
    p.getByText('Bạn đã báo nhân viên hỗ trợ thanh toán', { exact: true }),
  ).toBeVisible();
  await expect(p.getByRole('dialog')).toHaveCount(0);
}

const preview = (p: Page, id: string) => p.locator('[data-queue-request-id="' + id + '"]');
async function openQueueTable(p: Page, id: string) {
  await p.bringToFront();
  const tile = p.locator('.queue-table-card').filter({ has: preview(p, id) });
  await expect(tile).toHaveCount(1);
  await expect(tile.getByRole('button')).toHaveCount(1);
  await tile.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
}

async function openPayment(staff: Page, code: string) {
  await staff.bringToFront();
  await staff.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await staff
    .getByRole('navigation', { name: 'Phục vụ' })
    .getByRole('button', { name: /Việc cần làm/ })
    .click();
  await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
  await staff
    .locator('.queue-table-card')
    .getByRole('button', { name: 'Chi tiết bàn', exact: true })
    .click();
  await staff
    .getByRole('dialog')
    .getByRole('button', { name: 'Nhận việc & đến bàn', exact: true })
    .click();
  const dialog = staff.getByRole('dialog');
  await expect(dialog.locator('.latest-table-job')).toContainText('Khách gọi thu tiền');
  await expect(dialog.locator('.latest-table-job')).toHaveClass(/task-payment/);
  await expect(
    dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  return dialog;
}
test('guest calls staff without amount; cash partial/full collection clearly separates tender, change and invoice credit', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info);
  const guest = f.guests[0]!;
  const errors: string[] = [];
  f.staff.on('pageerror', (e) => errors.push(e.message));
  guest.on('pageerror', (e) => errors.push(e.message));
  try {
    await serve(guest, f.staff, f.kitchen, 'Gỏi cuốn tôm thịt', 2);
    await requestPayment(guest);
    await guest.reload();
    await guest
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    await expect(
      guest.getByText('Bạn đã báo nhân viên hỗ trợ thanh toán', { exact: true }),
    ).toBeVisible();
    await guest.locator('.guest-payment-sent').scrollIntoViewIfNeeded();
    await guest.screenshot({ path: info.outputPath('payment-guest-request.png'), scale: 'css' });
    let bill = await (await f.staff.request.get('/api/core/sessions/' + f.sid + '/bill')).json();
    expect(bill.paymentRequests).toHaveLength(1);
    expect(bill.intents).toHaveLength(0);
    expect(bill.account.reserved_payment_amount).toBe('0');
    const dialog = await openPayment(f.staff, f.code);
    await f.staff.screenshot({ path: info.outputPath('payment-table.png'), scale: 'css' });
    const form = dialog.getByRole('form', { name: 'Thu tiền tại bàn' });
    await form.getByRole('button', { name: /Số tiền khác/ }).click();
    const amountInput = form.getByLabel('Số tiền thu lần này (đồng)', { exact: true });
    await amountInput.fill('1e5');
    await expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    await expect(
      form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }),
    ).toBeDisabled();
    await amountInput.fill('5');
    const amountSuggestions = form
      .locator('.money-entry')
      .filter({ has: f.staff.getByLabel('Số tiền thu lần này (đồng)', { exact: true }) })
      .locator('.money-suggestions');
    await expect(amountSuggestions).toContainText('5.000 đ');
    await expect(amountSuggestions).toContainText('50.000 đ');
    await expect(amountInput).toHaveValue('5');
    await amountInput.fill('');
    await expect(amountInput).toHaveValue('');
    await amountInput.pressSequentially('40000');
    await expect(amountInput).toHaveValue('40.000');
    await form
      .getByRole('button', { name: 'Tăng 10.000 đ: Số tiền thu lần này (đồng)', exact: true })
      .click();
    await expect(amountInput).toHaveValue('50.000');
    await form
      .getByRole('button', { name: 'Giảm 10.000 đ: Số tiền thu lần này (đồng)', exact: true })
      .click();
    await expect(amountInput).toHaveValue('40.000');
    await form.getByLabel('Số tiền thu lần này (đồng)', { exact: true }).fill('40000');
    await form.getByRole('button', { name: '500.000 đ', exact: true }).click();
    await expect(form.locator('.cash-preview')).toContainText('40.000');
    await expect(form.locator('.cash-preview')).toContainText('500.000');
    await expect(form.locator('.cash-preview')).toContainText('460.000');
    for (const width of [320, 768, 1440]) {
      await f.staff.setViewportSize({ width, height: 900 });
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await f.staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await f.staff.setViewportSize(info.project.use.viewport!);
    await form.locator('.cash-preview').scrollIntoViewIfNeeded();
    await f.staff.screenshot({ path: info.outputPath('payment-cash-preview.png'), scale: 'css' });
    await form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(dialog.locator('.last-payment')).toContainText('460.000');
    bill = await (await f.staff.request.get('/api/core/sessions/' + f.sid + '/bill')).json();
    expect(bill.account.paid_total).toBe('40000');
    expect(bill.account.outstanding_amount).toBe('50000');
    expect(bill.payments).toHaveLength(1);
    expect(bill.paymentRequests).toHaveLength(0);
    await form.getByRole('button', { name: /Cả bàn/ }).click();
    await form.getByRole('button', { name: 'Đủ tiền', exact: true }).click();
    await form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(dialog.locator('.last-payment')).toContainText('50.000');
    bill = await (await f.staff.request.get('/api/core/sessions/' + f.sid + '/bill')).json();
    expect(bill.account.paid_total).toBe('90000');
    expect(bill.account.outstanding_amount).toBe('0');
    expect(bill.payments).toHaveLength(2);
    await dialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
    await expect(dialog.locator('.receipt-sheet')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Phiếu thường', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await dialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
    await expect(dialog.locator('.receipt-sheet')).toBeHidden();
    await dialog
      .getByRole('button', { name: 'Phiếu chi tiết theo người gọi', exact: true })
      .click();
    await expect(dialog.locator('.receipt-sheet')).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Phiếu chi tiết theo người gọi', exact: true })
      .click();
    await expect(dialog.locator('.receipt-sheet')).toBeHidden();
    await dialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Ẩn phiếu', exact: true })).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: 'Xem phiếu thanh toán', exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator('.receipt-sheet')).toContainText('460.000');
    await dialog.screenshot({ path: info.outputPath('payment-recorded.png'), scale: 'css' });
    await guest.bringToFront();
    await expect(
      guest.getByRole('heading', { name: 'Bàn đã thanh toán đủ', exact: true }),
    ).toBeVisible({ timeout: 15000 }); // Guest polls every 5s; allow its current read to finish.
    await f.staff.bringToFront();
    await expect(
      dialog.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('button', { name: 'Xác nhận đã trả tiền thừa', exact: true }).click();
    await f.staff.getByRole('button', { name: 'Đã trả đủ tiền thừa', exact: true }).click();
    await expect(dialog.locator('.cash-handover')).toHaveCount(0);
    await dialog
      .getByRole('button', { name: 'Phiếu chi tiết theo người gọi', exact: true })
      .click();
    await expect(dialog.locator('.receipt-owner-group')).toContainText(
      'Tiền nhóm này sau khuyến mãi',
    );
    await expect(dialog.locator('.receipt-owner-group > p strong')).toHaveText('90.000 đ');
    await dialog.screenshot({ path: info.outputPath('detailed-receipt.png'), scale: 'css' });
    await dialog.getByRole('button', { name: 'Đã in và giao phiếu', exact: true }).click();
    await f.staff.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }),
    ).toBeEnabled();
    await dialog.locator('.bill-transaction-history summary').click();
    await expect(dialog.locator('.bill-transaction-history')).toContainText(
      'Đã xác nhận thối tiền',
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});
test('one work queue shares ownership across two staff accounts, table map and payment; accepted handoff transfers rights', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info);
  const c = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    userAgent: info.project.use.userAgent,
  });
  const other = await c.newPage(),
    guest = f.guests[0]!;
  const errors: string[] = [];
  for (const p of [f.staff, other]) p.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(other, 'pv002', 'staff');
    await serve(guest, f.staff, f.kitchen, 'Gỏi cuốn tôm thịt', 2);
    await requestPayment(guest);
    const state = await (await guest.request.get('/api/guest/state')).json(),
      id = state.support[0].id;
    const task = (p: Page) => p.locator(`[data-support-id="${id}"]`);
    for (const p of [f.staff, other]) {
      await p.bringToFront();
      await p
        .getByRole('navigation', { name: 'Phục vụ' })
        .getByRole('button', { name: /Việc cần làm/ })
        .click();
      await p.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(f.code);
      await expect(
        p
          .getByRole('navigation', { name: 'Phục vụ' })
          .getByRole('button', { name: /Hỗ trợ khách/ }),
      ).toHaveCount(0);
      await expect(preview(p, id)).toHaveCount(1);
      await expect(preview(p, id)).toContainText('Chưa có người nhận');
    }
    await openQueueTable(f.staff, id);
    await expect(task(f.staff)).toContainText('Chưa có người nhận');
    await other.bringToFront();
    await expect(preview(other, id)).toContainText('Chưa có người nhận');
    await f.staff.bringToFront();
    await task(f.staff).getByRole('button', { name: 'Nhận việc & đến bàn', exact: true }).click();
    await expect(f.staff.getByRole('dialog').locator('.latest-table-job')).toContainText(
      'Bạn đang phụ trách',
    );
    await other.bringToFront();
    await expect(preview(other, id)).toHaveCount(0);
    await other
      .getByRole('navigation', { name: 'Người phụ trách công việc' })
      .getByRole('button', { name: /Đồng nghiệp phụ trách/ })
      .click();
    await expect(preview(other, id)).toContainText('Nguyễn Minh Anh đang phụ trách');
    await expect(other.locator('.queue-table-card').getByRole('button')).toHaveCount(1);
    await expect(
      other
        .locator('.queue-table-card')
        .getByRole('button', { name: 'Nhận việc & đến bàn', exact: true }),
    ).toHaveCount(0);
    await expect(
      other
        .locator('.queue-table-card')
        .getByRole('button', { name: 'Thu tiền tại bàn', exact: true }),
    ).toHaveCount(0);
    for (const width of [320, 768, 1440]) {
      await other.setViewportSize({ width, height: 900 });
      expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await other.setViewportSize(info.project.use.viewport!);
    await preview(other, id).scrollIntoViewIfNeeded();
    await other.screenshot({ path: info.outputPath('work-queue-colleague.png'), scale: 'css' });
    await other
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Sơ đồ bàn/ })
      .click();
    const tile = other
      .locator('.table-tile')
      .filter({ has: other.getByRole('heading', { name: f.code, exact: true }) });
    await expect(tile).toContainText('Nguyễn Minh Anh đang phụ trách');
    await tile.getByRole('button', { name: 'Mở chi tiết bàn' }).click();
    await other
      .getByRole('dialog')
      .getByRole('button', { name: 'Thu tiền & phiếu', exact: true })
      .click();
    await expect(other.getByRole('form', { name: 'Thu tiền tại bàn' })).toHaveCount(0);
    await expect(
      other.getByRole('dialog').getByRole('region', { name: 'Lời gọi thu tiền tại bàn' }),
    ).toContainText('Nguyễn Minh Anh đang phụ trách');
    await other.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    await other
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    const assignees = await (
      await f.staff.request.get('/api/core/support-assignees?requestId=' + id)
    ).json();
    const target = assignees.find((p: { username: string }) => p.username === 'pv002');
    await f.staff.bringToFront();
    await f.staff
      .getByRole('dialog')
      .locator('[data-support-id="' + id + '"]')
      .getByRole('button', { name: 'Bàn giao', exact: true })
      .click();
    const handoff = f.staff.getByRole('dialog', { name: 'Đề nghị bàn giao hỗ trợ' });
    await handoff.getByLabel('Người nhận').selectOption(target.id);
    await handoff.getByLabel('Lý do bàn giao').fill('Nhờ thu tiền, tôi cần phục vụ bàn khác');
    await handoff.getByRole('button', { name: 'Gửi đề nghị bàn giao' }).click();
    await other.bringToFront();
    await other.getByRole('button', { name: 'Xem bàn giao', exact: true }).click();
    await openQueueTable(other, id);
    await expect(task(other)).toContainText('Người gửi vẫn phụ trách');
    await task(other).getByRole('button', { name: 'Nhận bàn giao', exact: true }).click();
    await expect(task(other)).toContainText('Bạn đang phụ trách');
    // Bill reads pause in a background tab; foreground recovery must revoke the old owner's form.
    await f.staff.bringToFront();
    await expect(f.staff.getByRole('form', { name: 'Thu tiền tại bàn' })).toHaveCount(0, {
      timeout: 15000,
    });
    await other.bringToFront();
    await task(other).getByRole('button', { name: 'Thu tiền tại bàn', exact: true }).click();
    const form = other.getByRole('form', { name: 'Thu tiền tại bàn' });
    await form.getByRole('button', { name: /Số tiền khác/ }).click();
    await form.getByLabel('Số tiền thu lần này (đồng)', { exact: true }).fill('40000');
    await form.getByRole('button', { name: '500.000 đ', exact: true }).click();
    await expect(form.getByLabel('Lời gọi thu tiền')).not.toContainText('Thu trực tiếp');
    await form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(other.getByRole('dialog').locator('.last-payment')).toContainText('460.000');
    await f.staff.bringToFront();
    await expect(task(f.staff)).toHaveCount(0, { timeout: 15000 });
    await other.bringToFront();
    const bill = await (await other.request.get('/api/core/sessions/' + f.sid + '/bill')).json();
    expect(bill.paymentRequests).toHaveLength(0);
    expect(bill.payments).toHaveLength(1);
    expect(bill.account.paid_total).toBe('40000');
    expect(bill.account.outstanding_amount).toBe('50000');
    expect((await (await guest.request.get('/api/guest/state')).json()).support[0].status).toBe(
      'RESOLVED',
    );
    await other
      .getByRole('dialog')
      .screenshot({ path: info.outputPath('work-queue-payment-completed.png'), scale: 'css' });
    expect(errors).toEqual([]);
  } finally {
    await c.close();
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});
test('bank screenshot or reference supports own-dish collection, without allocating to the earlier guest', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info, 2);
  const [lan, minh] = f.guests as [Page, Page];
  try {
    const a = await serve(lan, f.staff, f.kitchen, 'Nước suối 500 ml', 1),
      b = await serve(minh, f.staff, f.kitchen, 'Gỏi cuốn tôm thịt', 2);
    await requestPayment(minh, 'Chuyển khoản');
    const dialog = await openPayment(f.staff, f.code);
    const form = dialog.getByRole('form', { name: 'Thu tiền tại bàn' });
    await form.getByRole('button', { name: /Món của một khách/ }).click();
    await expect(form.getByLabel('Khách thanh toán món riêng')).toContainText('Minh');
    await expect(form).toContainText('90.000');
    await expect(
      form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }),
    ).toBeDisabled();
    const png = Buffer.concat([
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=',
        'base64',
      ),
      Buffer.from(randomUUID()),
    ]);
    await form
      .getByLabel('Ảnh chứng từ chuyển khoản', { exact: true })
      .setInputFiles({ name: 'chuyen-khoan.png', mimeType: 'image/png', buffer: png });
    await expect(form.getByText('Đã chọn chuyen-khoan.png', { exact: true })).toBeVisible();
    let bill = await (await f.staff.request.get('/api/core/sessions/' + f.sid + '/bill')).json();
    expect(bill.account.paid_total).toBe('0');
    await form.locator('.bank-evidence').scrollIntoViewIfNeeded();
    await f.staff.screenshot({ path: info.outputPath('payment-bank-evidence.png'), scale: 'css' });
    await form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(
      dialog.locator('.last-payment').getByRole('link', { name: 'Xem ảnh chứng từ', exact: true }),
    ).toBeVisible();
    const href = await dialog
      .locator('.last-payment')
      .getByRole('link', { name: 'Xem ảnh chứng từ', exact: true })
      .getAttribute('href');
    expect((await lan.request.get(href!)).status()).toBe(401);
    expect((await f.staff.request.get(href!)).status()).toBe(200);
    bill = await (await f.staff.request.get('/api/core/sessions/' + f.sid + '/bill')).json();
    expect(bill.account.outstanding_amount).toBe('15000');
    expect(
      bill.charges.find((c: { order_item_id: string }) => c.order_item_id === a.id).unpaid_amount,
    ).toBe('15000');
    expect(
      bill.charges.find((c: { order_item_id: string }) => c.order_item_id === b.id).unpaid_amount,
    ).toBe('0');
    await form.getByRole('button', { name: /Cả bàn/ }).click();
    await form
      .getByLabel('Mã giao dịch ngân hàng (hoặc ảnh chứng từ)')
      .fill('BANK-' + randomUUID());
    await form.getByRole('button', { name: 'Ghi nhận đã nhận tiền', exact: true }).click();
    await expect(dialog.locator('.last-payment')).toContainText('15.000');
    bill = await (await f.staff.request.get('/api/core/sessions/' + f.sid + '/bill')).json();
    expect(bill.account.outstanding_amount).toBe('0');
    expect(bill.account.paid_total).toBe('105000');
  } finally {
    await Promise.all(f.contexts.map((c) => c.close()));
  }
});
