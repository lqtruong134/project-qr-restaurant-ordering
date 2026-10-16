import { browserTableCode } from './table-code-fixture';
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(p: Page, user: string, role: string) {
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
async function fits(p: Page) {
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
test('four compact role layouts, precise paid-but-unserved blockers, shared cleaning and cross-tab renewal', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, staffB, kitchen, guest] = (await Promise.all(
    contexts.map((c) => c.newPage()),
  )) as [Page, Page, Page, Page, Page];
  const errors: string[] = [];
  for (const p of [admin, staff, staffB, kitchen, guest])
    p.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv004', 'staff');
    await login(staffB, 'pv005', 'staff');
    await login(kitchen, 'bep002', 'kitchen');
    const areas = await (await admin.request.get('/api/core/areas')).json(),
      prefix = 'OPS-' + randomUUID().slice(0, 8);
    const table = await post(admin, '/core/tables', {
      areaId: areas[0].id,
      code: prefix,
      name: 'Bàn kiểm tra ' + prefix,
      capacity: 4,
    });
    const qr = await post(admin, '/core/tables/' + table.id + '/qr', {});
    await guest.goto(qr.joinPath);
    await guest
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin!, qr.joinPath, staff!));
    await guest.getByLabel('Tên của bạn').fill('Khách kiểm tra vận hành');
    await guest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      guest.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
    for (const [role, p] of [
      ['admin', admin],
      ['staff', staff],
      ['kitchen', kitchen],
      ['guest', guest],
    ] as const) {
      for (const width of [320, 390, 768, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        await fits(p);
        if (role === 'guest' && width <= 800)
          expect(
            await p
              .locator('.dish-card')
              .first()
              .evaluate((card) => {
                const image = card.querySelector('.dish-visual')!.getBoundingClientRect(),
                  content = card.querySelector('.dish-content')!.getBoundingClientRect();
                return image.right <= content.left + 1 && image.width > 0 && content.width > 0;
              }),
          ).toBe(true);
      }
      await p.setViewportSize(info.project.use.viewport!);
      await p.screenshot({ path: info.outputPath(role + '-experience.png'), scale: 'css' });
      if (role !== 'guest') await expect(p.locator('.workspace-title')).toHaveCount(0);
    }
    let state = await (await guest.request.get('/api/guest/state')).json();
    const product = state.products.find((p: { name: string }) => p.name === 'Chả giò giòn');
    await post(guest, '/guest/cart', {
      productId: product.id,
      quantity: 1,
      cartVersion: state.cart.cart_version,
    });
    state = await (await guest.request.get('/api/guest/state')).json();
    const batch = await post(guest, '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: state.cart.cart_version,
      itemIds: state.items.map((i: { id: string }) => i.id),
    });
    const bill = await (
      await staff.request.get('/api/core/sessions/' + state.session.id + '/bill')
    ).json();
    const payment = await post(staff, '/core/sessions/' + state.session.id + '/payments', {
      method: 'CASH',
      amount: bill.account.outstanding_amount,
      requestId: randomUUID(),
    });
    await post(staff, '/core/payments/' + payment.id + '/confirm', {
      amount: payment.amount,
      receivedAmount: payment.amount,
    });
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(prefix);
    await staff.getByRole('button', { name: 'Mở chi tiết bàn', exact: true }).click();
    const dialog = staff.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    const checklist = dialog.getByRole('status', { name: 'Điều kiện kết thúc bàn' });
    await expect(checklist).toContainText('Bếp chưa nhận món');
    await expect(checklist).toContainText('1 × Chả giò giòn');
    await expect(
      dialog.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }),
    ).toBeDisabled();
    await checklist.scrollIntoViewIfNeeded();
    await staff.screenshot({ path: info.outputPath('close-blocked-exact-dish.png'), scale: 'css' });
    await checklist.getByRole('button', { name: 'Xem món', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Món đã gọi', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const order = (await (await staff.request.get('/api/core/orders')).json()).find(
        (o: { id: string }) => o.id === batch.id,
      ),
      item = order.items[0];
    for (const action of ['accept', 'prepare', 'ready'])
      await post(kitchen, '/core/items/' + item.id + '/' + action, {});
    await post(staff, '/core/items/' + item.id + '/serve', {});
    await dialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    await dialog.getByRole('button', { name: 'Khách không cần phiếu giấy', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Xác nhận thao tác', exact: true })
      .getByRole('button', { name: 'Tiếp tục', exact: true })
      .click();
    await expect(dialog.getByRole('status', { name: 'Điều kiện kết thúc bàn' })).toContainText(
      'Bàn đã đủ điều kiện kết thúc',
    );
    await dialog.getByRole('button', { name: 'Đóng phiên sau khi hoàn tất', exact: true }).click();
    await staff
      .getByRole('dialog', { name: 'Xác nhận thao tác' })
      .getByRole('button', { name: 'Tiếp tục', exact: true })
      .click();
    await expect(staff.locator('.service-notice')).toContainText(/dọn bàn/i);
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staffB
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await staffB.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(prefix);
    const card = staffB.locator('.queue-table-card[data-table-id="' + table.id + '"]');
    await expect(card).toContainText('Dọn bàn để đón khách mới');
    await expect(card.getByRole('button')).toHaveCount(1);
    await card.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    await expect(staffB.getByRole('dialog')).toContainText('Chuẩn bị bàn cho lượt khách tiếp theo');
    await staffB.screenshot({ path: info.outputPath('shared-cleaning-detail.png'), scale: 'css' });
    await staffB
      .getByRole('dialog')
      .getByRole('button', { name: 'Đã dọn xong', exact: true })
      .click();
    await staffB
      .getByRole('dialog', { name: 'Xác nhận thao tác' })
      .getByRole('button', { name: 'Đã dọn xong', exact: true })
      .click();
    await expect(card).toHaveCount(0);
    let refreshCount = 0;
    contexts[1]!.on('request', (r) => {
      if (r.url().endsWith('/api/auth/refresh')) refreshCount++;
    });
    await contexts[1]!.clearCookies({ name: 'access' });
    const secondTab = await contexts[1]!.newPage();
    secondTab.on('pageerror', (e) => errors.push(e.message));
    await Promise.all([staff.reload(), secondTab.goto('/workspace/staff')]);
    for (const p of [staff, secondTab]) {
      await expect(p.getByRole('navigation', { name: 'Phục vụ' })).toBeVisible();
      await expect(p.getByRole('dialog', { name: 'Phiên làm việc hết hạn' })).toHaveCount(0);
    }
    expect(refreshCount).toBe(1);
    await secondTab.close();
    await contexts[1]!.clearCookies({ name: 'access' });
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(prefix);
    await staff.getByRole('button', { name: 'Mở bàn', exact: true }).click();
    await expect(staff.getByRole('button', { name: 'Mở chi tiết bàn', exact: true })).toBeVisible();
    const reopened = (await (await staff.request.get('/api/core/tables')).json()).find(
      (t: { id: string }) => t.id === table.id,
    );
    expect(reopened.table_status).toBe('OCCUPIED');
    expect(reopened.session_id).not.toBe(state.session.id);
    expect(refreshCount).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
