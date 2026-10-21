import { browserTableCode } from './table-code-fixture';
import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
async function login(p: Page, user: string, workspace: string) {
  await p.bringToFront();
  await p.goto('/login');
  await p.locator('#username').fill(user);
  await p.locator('#password').fill(process.env.SEED_PASSWORD!);
  await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(p).toHaveURL(new RegExp('workspace/' + workspace));
}
async function post(p: Page, path: string, data: unknown) {
  const r = await p.request.post('/api' + path, {
    headers: { origin: new URL(p.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
const card = (p: Page, id: string) => p.locator(`[data-support-id="${id}"]`);
const preview = (p: Page, id: string) => p.locator('[data-queue-request-id="' + id + '"]');
async function openQueueTable(p: Page, id: string) {
  await p.bringToFront();
  const tile = p.locator('.queue-table-card').filter({ has: preview(p, id) });
  await expect(tile).toHaveCount(1);
  await expect(tile.getByRole('button')).toHaveCount(1);
  await tile.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
}
async function closeTable(p: Page) {
  await p.bringToFront();
  await p.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
}

test('guest support, duplicate notice, owner-only actions, recipient acceptance/decline, history and responsive keyboard UI', async ({
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
        userAgent: info.project.use.userAgent,
      }),
    ),
  );
  const [admin, guest, staff, target] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const p of [admin!, guest!, staff!, target!])
    p.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(admin!, 'quyettruong05', 'admin');
    await login(staff!, 'pv005', 'staff');
    await login(target!, 'pv006', 'staff');
    const tables = await (await admin!.request.get('/api/core/admin/tables')).json();
    const code = 'SUPPORT-' + info.project.name + '-' + Date.now();
    const table = await post(admin!, '/core/tables', {
      areaId: tables[0].area_id,
      code,
      name: code,
      capacity: 4,
    });
    const qr = await post(admin!, '/core/tables/' + table.id + '/qr', {});
    await guest!.bringToFront();
    await guest!.goto(qr.joinPath);
    await guest!
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin!, qr.joinPath, staff!));
    await guest!.getByLabel('Tên của bạn').fill('An hỗ trợ');
    await guest!
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest!.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await guest!
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Hỗ trợ', exact: true })
      .click();
    await guest!.getByLabel('Bạn cần gì?').selectOption('OTHER');
    await expect(guest!.getByLabel('Nội dung yêu cầu (bắt buộc)')).toHaveAttribute('required', '');
    await guest!.getByLabel('Bạn cần gì?').selectOption('WATER');
    await guest!.getByLabel('Nội dung thêm (không bắt buộc)').fill('Thêm 2 ly nước lọc');
    await guest!.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
    await expect(guest!.locator('.support-feedback')).toContainText('Đã gửi yêu cầu.');
    const state = await (await guest!.request.get('/api/guest/state')).json(),
      id = state.support[0].id;
    await expect(card(guest!, id)).toContainText('Đã gửi yêu cầu');
    await expect(card(guest!, id)).toContainText('Đã gửi lúc');
    await guest!.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
    await expect(guest!.locator('.support-feedback')).toContainText(
      'Yêu cầu này đã được gửi và đang được xử lý.',
    );
    expect((await (await guest!.request.get('/api/guest/state')).json()).support).toHaveLength(1);
    await staff!.bringToFront();
    await staff!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    // Test the age presentation against a delayed response fixture; mutations still use real API.
    await staff!.route('**/api/core/support', async (route) => {
      const response = await route.fetch();
      const rows = await response.json();
      for (const row of rows)
        if (row.id === id && row.status === 'NEW')
          row.created_at = new Date(Date.now() - 6 * 60000).toISOString();
      await route.fulfill({ response, json: rows });
    });
    await staff!
      .locator('.service-tools')
      .getByRole('button', { name: 'Làm mới', exact: true })
      .click();
    await expect(preview(staff!, id)).toContainText('Chưa có người nhận');
    const supportRows = await (await staff!.request.get('/api/core/support')).json();
    const newCount = supportRows.filter((row: { status: string }) => row.status === 'NEW').length;
    expect(
      parseInt(
        await staff!
          .getByRole('navigation', { name: 'Người phụ trách công việc' })
          .getByRole('button', { name: /Việc chung/ })
          .locator('b')
          .innerText(),
      ),
    ).toBeGreaterThanOrEqual(newCount);
    await expect(staff!.getByRole('heading', { name: 'Việc tại bàn', exact: true })).toBeVisible();
    await openQueueTable(staff!, id);
    await expect(card(staff!, id)).toContainText('Cần chú ý');
    await card(staff!, id).getByRole('button', { name: 'Nhận xử lý', exact: true }).focus();
    await staff!.keyboard.press('Enter');
    await expect(card(staff!, id)).toContainText('Bạn đang phụ trách');
    await guest!.bringToFront();
    await expect(card(guest!, id)).toContainText('Nhân viên đã tiếp nhận');
    await target!.bringToFront();
    await target!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await target!
      .getByRole('navigation', { name: 'Người phụ trách công việc' })
      .getByRole('button', { name: /Đồng nghiệp phụ trách/ })
      .click();
    await expect(preview(target!, id)).toContainText('đang phụ trách');
    await openQueueTable(target!, id);
    await expect(
      card(target!, id).getByRole('button', { name: 'Đã xử lý', exact: true }),
    ).toHaveCount(0);
    const people = await (
      await staff!.request.get('/api/core/support-assignees?requestId=' + id)
    ).json();
    const to = people.find((x: { username: string }) => x.username === 'pv006');
    await staff!.bringToFront();
    await card(staff!, id).getByRole('button', { name: 'Bàn giao', exact: true }).click();
    let dialog = staff!.getByRole('dialog', { name: 'Đề nghị bàn giao hỗ trợ' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Người nhận').selectOption(to.id);
    await dialog.getByLabel('Lý do bàn giao').fill('Sắp hết ca, nhờ hỗ trợ tiếp');
    await dialog.getByRole('button', { name: 'Gửi đề nghị bàn giao' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card(staff!, id)).toContainText('Bạn vẫn phụ trách');
    await closeTable(target!);
    await target!.getByLabel('Loại công việc').selectOption('review');
    await target!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Sơ đồ bàn/ })
      .click();
    await expect(
      target!.locator('.support-alert-banner').filter({ hasText: 'Bàn giao đến bạn' }),
    ).toContainText('Bàn giao đến bạn - 1');
    await target!.getByRole('button', { name: 'Xem bàn giao', exact: true }).click();
    await openQueueTable(target!, id);
    await expect(card(target!, id)).toContainText('Sắp hết ca');
    for (const width of [320, 768, 1440]) {
      await target!.setViewportSize({ width, height: 900 });
      await expect(card(target!, id)).toBeVisible();
      expect(await target!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await target!.setViewportSize(info.project.use.viewport!);
    await target!.screenshot({ path: info.outputPath('support-incoming.png'), fullPage: true });
    await card(target!, id).getByRole('button', { name: 'Từ chối', exact: true }).click();
    dialog = target!.getByRole('dialog', { name: 'Từ chối bàn giao' });
    await dialog.getByLabel('Lý do từ chối').fill('Đang phục vụ bàn khác');
    await dialog.getByRole('button', { name: 'Xác nhận từ chối' }).click();
    await expect(dialog).toHaveCount(0);
    await staff!.bringToFront();
    await expect(card(staff!, id)).toContainText('Đồng nghiệp đã từ chối');
    await expect(card(staff!, id)).toContainText('Bạn đang phụ trách');
    await card(staff!, id).getByRole('button', { name: 'Bàn giao', exact: true }).click();
    dialog = staff!.getByRole('dialog', { name: 'Đề nghị bàn giao hỗ trợ' });
    await dialog.getByLabel('Người nhận').selectOption(to.id);
    await dialog.getByLabel('Lý do bàn giao').fill('Đồng nghiệp đã xong việc, nhờ nhận');
    await dialog.getByRole('button', { name: 'Gửi đề nghị bàn giao' }).click();
    await target!.bringToFront();
    await expect(
      card(target!, id).getByRole('button', { name: 'Nhận bàn giao', exact: true }),
    ).toBeVisible();
    await card(target!, id).getByRole('button', { name: 'Nhận bàn giao', exact: true }).click();
    await expect(card(target!, id)).toContainText('Bạn đang phụ trách');
    await closeTable(staff!);
    await staff!
      .getByRole('navigation', { name: 'Người phụ trách công việc' })
      .getByRole('button', { name: /Đồng nghiệp phụ trách/ })
      .click();
    await expect(preview(staff!, id)).toContainText('đang phụ trách');
    await openQueueTable(staff!, id);
    await expect(
      card(staff!, id).getByRole('button', { name: 'Đã xử lý', exact: true }),
    ).toHaveCount(0);
    await guest!.bringToFront();
    await expect(card(guest!, id)).toContainText('Nhân viên đã tiếp nhận');
    await expect(card(guest!, id)).not.toContainText('bàn giao');
    await target!.bringToFront();
    await card(target!, id).getByRole('button', { name: 'Lịch sử hỗ trợ', exact: true }).click();
    dialog = target!.getByRole('dialog', { name: 'Lịch sử hỗ trợ tại bàn' });
    await expect(dialog).toContainText('Đã từ chối');
    await expect(dialog).toContainText('Đã nhận');
    await expect(dialog).toContainText('An hỗ trợ');
    await target!.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
      card(target!, id).getByRole('button', { name: 'Lịch sử hỗ trợ', exact: true }),
    ).toBeFocused();
    await card(target!, id).getByRole('button', { name: 'Đã xử lý', exact: true }).click();
    await expect(card(target!, id)).toHaveCount(0);
    await guest!.bringToFront();
    await expect(card(guest!, id)).toContainText('Đã xử lý', { timeout: 15000 });
    for (const width of [320, 768, 1440]) {
      await guest!.setViewportSize({ width, height: 900 });
      expect(await guest!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await guest!.setViewportSize(info.project.use.viewport!);
    await guest!.screenshot({ path: info.outputPath('support-guest.png'), fullPage: true });
    await admin!.bringToFront();
    const adminNav = admin!.getByRole('navigation', { name: 'Quản trị', exact: true });
    const expand = adminNav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
    if (await expand.count()) await expand.click();

    await selectAdmin(admin!, 'Báo cáo', 'Hỗ trợ tại bàn');
    await expect(
      admin!.getByRole('heading', { name: 'Hỗ trợ tại bàn & lịch sử bàn giao' }),
    ).toBeVisible();
    const report = admin!.locator('.support-task').filter({ hasText: code });
    await report.getByRole('button', { name: 'Lịch sử hỗ trợ' }).click();
    await expect(admin!.getByRole('dialog', { name: 'Lịch sử hỗ trợ tại bàn' })).toContainText(
      'Hoàn tất hỗ trợ',
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
