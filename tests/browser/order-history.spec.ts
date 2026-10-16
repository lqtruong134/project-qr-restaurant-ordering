import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { selectAdmin } from './admin-navigation';

async function login(page: Page, username: string, role: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function post(page: Page, route: string, data: unknown) {
  const response = await page.request.post('/api' + route, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test('cancelled history shows session and actual refund, and a closed session has no cancellation or waiver controls', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, kitchen] = (await Promise.all(
    contexts.map((context) => context.newPage()),
  )) as [Page, Page, Page];
  const errors: string[] = [];
  for (const page of [admin, staff, kitchen]) {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  }
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv008', 'staff');
    await login(kitchen, 'bep002', 'kitchen');
    const tag = 'LS-' + randomUUID().slice(0, 8);
    const name = 'Món đã hủy có hoàn tiền ' + tag;
    const catalog = await (await admin.request.get('/api/core/catalog')).json();
    const areas = await (await admin.request.get('/api/core/areas')).json();
    const table = await post(admin, '/core/tables', {
      areaId: areas[0].id,
      code: tag,
      name: tag,
      capacity: 4,
    });
    const session = await post(staff, '/core/tables/' + table.id + '/open', {});
    const product = await post(admin, '/core/products', {
      code: tag,
      name,
      categoryId: catalog.categories[0].id,
      price: '49000',
      stockManaged: false,
      complimentary: false,
    });
    const batch = await post(staff, '/core/sessions/' + session.id + '/orders', {
      requestId: randomUUID(),
      lines: [{ productId: product.id, quantity: 1 }],
    });
    const orders = await (await staff.request.get('/api/core/orders')).json();
    const item = orders.find((order: { id: string }) => order.id === batch.id).items[0];
    for (const action of ['accept', 'prepare', 'ready'])
      await post(kitchen, '/core/items/' + item.id + '/' + action, {});
    const intent = await post(staff, '/core/sessions/' + session.id + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '49000',
    });
    const payment = await post(staff, '/core/payments/' + intent.id + '/confirm', {
      amount: '49000',
      receivedAmount: '49000',
    });
    await post(admin, '/core/items/' + item.id + '/late-cancel', {
      reasonCode: 'QUALITY_ISSUE',
      note: 'Món không đạt chất lượng',
    });
    const refund = await post(admin, '/core/sessions/' + session.id + '/refunds', {
      paymentId: payment.id,
      amount: '49000',
      useDecisionReason: true,
      requestId: randomUUID(),
    });
    await post(staff, '/core/refunds/' + refund.id + '/complete', {
      method: 'CASH',
      amount: '49000',
      requestId: randomUUID(),
    });
    const bill = await (
      await staff.request.get('/api/core/sessions/' + session.id + '/bill')
    ).json();
    await post(staff, '/core/sessions/' + session.id + '/receipt-provided', {
      delivery: 'DECLINED',
      layout: 'standard',
      billKey: bill.completion.receiptKey,
    });
    await post(staff, '/core/sessions/' + session.id + '/close', {});
    await selectAdmin(admin, 'Báo cáo', 'Tra cứu & xử lý món');
    await admin.getByRole('button', { name: 'Món đã hủy', exact: true }).click();
    await admin
      .getByRole('textbox', { name: 'Tìm bàn, món hoặc mã phiên…', exact: true })
      .fill(tag);
    const card = admin.locator('.exceptions-app .inbox-case').filter({ hasText: name });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Phiên #' + session.id.slice(0, 8).toUpperCase());
    await expect(card).toContainText('Phiên đã chốt');
    await expect(card).toContainText('Món không đạt chất lượng');
    await expect(card).toContainText('Xử lý:');
    await expect(card).toContainText('Đã hoàn: 49.000 đ');
    await expect(card).not.toContainText('Đã báo khách');
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await admin.screenshot({
      path: info.outputPath('cancelled-history-session-refund.png'),
      scale: 'css',
      fullPage: true,
    });
    await card.getByRole('button', { name: 'Xem chi tiết món', exact: true }).click();
    const dialog = admin.getByRole('dialog', { name: 'Xử lý món - ' + name, exact: true });
    await expect(dialog).toContainText('Phiên #' + session.id.slice(0, 8).toUpperCase());
    await expect(dialog).toContainText('Phiên bàn đã chốt. Chỉ xem lịch sử');
    await expect(dialog.locator('form')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Miễn tiền', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Xác nhận hủy món', exact: true })).toHaveCount(
      0,
    );
    await admin.screenshot({ path: info.outputPath('closed-item-readonly.png'), scale: 'css' });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
