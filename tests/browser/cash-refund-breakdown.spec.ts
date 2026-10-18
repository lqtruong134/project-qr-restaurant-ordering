import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
import { browserTableCode } from './table-code-fixture';

type Entity = { id: string };
async function login(page: Page, username: string, role: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function get<T>(page: Page, route: string): Promise<T> {
  const response = await page.request.get('/api' + route);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function post<T>(page: Page, route: string, data: unknown): Promise<T> {
  const response = await page.request.post('/api' + route, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function verifyBreakdown(region: Locator, compact = false) {
  for (const [label, value] of [
    ['Tiền mặt khách đưa', '200.000 đ'],
    ['Tiền thối đã trả', '106.000 đ'],
    ['Tiền đã nhận (trước hoàn)', '94.000 đ'],
    ['Đã hoàn lại khách', '94.000 đ'],
    ['Tiền còn giữ (sau hoàn)', '0 đ'],
    ['Nhà hàng còn giữ', '0 đ'],
  ]) {
    if (compact && ['Tiền đã nhận (trước hoàn)', 'Tiền còn giữ (sau hoàn)'].includes(label!))
      continue;
    const fact = region.getByText(label!, { exact: true }).locator('..');
    await expect(fact.locator('dd')).toHaveText(value!);
    await expect(fact.locator('dt')).toBeVisible();
  }
  await expect(region).not.toContainText('Tiền thối chưa trả');
  if (compact) {
    await expect(region.locator('.payment-flow-equation')).toHaveCount(0);
    return;
  }
  await expect(region.locator('.payment-flow-equation')).toContainText(
    '200.000 đ khách đưa − 106.000 đ đã thối − 94.000 đ hoàn lại khách = 0 đ còn giữ.',
  );
}

test('two cash tenders and full cancellation refunds reconcile for guest, staff, admin and receipt', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(170000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, kitchen, guest] = (await Promise.all(
    contexts.map((context) => context.newPage()),
  )) as [Page, Page, Page, Page];
  const errors: string[] = [];
  for (const page of [admin, staff, kitchen, guest])
    page.on('pageerror', (error) => errors.push(error.message));
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv007', 'staff');
    await login(kitchen, 'bep003', 'kitchen');
    const code = 'MONEY-' + randomUUID().slice(0, 8);
    const areas = await get<Entity[]>(admin, '/core/areas');
    const catalog = await get<{ categories: Entity[] }>(admin, '/core/catalog');
    const products = [];
    for (const price of ['45000', '49000'])
      products.push(
        await post<Entity>(admin, '/core/products', {
          code: code + '-' + price,
          name: 'Món kiểm tra ' + price + ' ' + code,
          categoryId: catalog.categories[0]!.id,
          price,
          stockManaged: false,
          complimentary: false,
        }),
      );
    const table = await post<Entity>(admin, '/core/tables', {
      areaId: areas[0]!.id,
      code,
      name: code,
      capacity: 4,
    });
    const qr = await post<{ joinPath: string }>(admin, '/core/tables/' + table.id + '/qr', {});
    await guest.goto(qr.joinPath);
    await guest
      .getByLabel('Mã vào bàn', { exact: true })
      .fill(await browserTableCode(admin, qr.joinPath, staff));
    await guest.getByLabel('Tên của bạn').fill('Khách kiểm tra tiền');
    await guest
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      guest.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
    const state = await get<{ session: Entity }>(guest, '/guest/state');
    const sid = state.session.id;
    const batch = await post<Entity>(staff, '/core/sessions/' + sid + '/orders', {
      requestId: randomUUID(),
      lines: products.map((product) => ({ productId: product.id, quantity: 1 })),
    });
    const order = (
      await get<(Entity & { status: string; items: Entity[] })[]>(staff, '/core/orders')
    ).find((row) => row.id === batch.id)!;
    if (order.status === 'PENDING_REVIEW')
      await post(staff, '/core/orders/' + order.id + '/review', { approve: true });
    for (const amount of ['45000', '49000']) {
      const intent = await post<Entity>(staff, '/core/sessions/' + sid + '/payments', {
        requestId: randomUUID(),
        method: 'CASH',
        amount,
      });
      await post(staff, '/core/payments/' + intent.id + '/confirm', {
        amount,
        receivedAmount: '100000',
      });
    }
    const paid = await get<{ payments: (Entity & { amount: string })[] }>(
      staff,
      '/core/sessions/' + sid + '/bill',
    );
    await guest
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    await expect(guest.getByText('Còn chờ nhận tiền thối:', { exact: false })).toContainText(
      '106.000 đ',
    );
    for (const payment of paid.payments)
      await post(staff, '/core/payment-transactions/' + payment.id + '/change-returned', {});
    for (const item of order.items) {
      await post(kitchen, '/core/items/' + item.id + '/accept', {});
      await post(kitchen, '/core/items/' + item.id + '/unavailable', {
        reasonCode: 'EQUIPMENT_FAILURE',
      });
    }
    for (const payment of paid.payments) {
      const refund = await post<Entity>(admin, '/core/sessions/' + sid + '/refunds', {
        requestId: randomUUID(),
        paymentId: payment.id,
        amount: payment.amount,
        useDecisionReason: true,
      });
      await post(staff, '/core/refunds/' + refund.id + '/complete', {
        requestId: randomUUID(),
        amount: payment.amount,
        method: 'CASH',
      });
    }
    await guest
      .locator('details')
      .filter({ has: guest.getByText('Chi tiết thu và hoàn tiền', { exact: true }) })
      .locator('summary')
      .click();
    const guestFlow = guest.locator(
      '.guest-content > .core-card > details .payment-flow-breakdown',
    );
    await verifyBreakdown(guestFlow);
    await guestFlow.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    const flowBox = await guestFlow.boundingBox();
    const navBox = await guest.getByRole('navigation', { name: 'Điều hướng khách' }).boundingBox();
    expect(flowBox!.y + flowBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
    await guestFlow.screenshot({ path: info.outputPath('cash-breakdown-guest.png'), scale: 'css' });

    await staff.getByRole('button', { name: 'Làm mới', exact: true }).click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await staff
      .locator('.table-tile')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
      .click();
    const staffDialog = staff.getByRole('dialog', { name: 'Chi tiết - ' + code, exact: true });
    await staffDialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    await staffDialog.locator('.bill-transaction-history > summary').click();
    const staffFlow = staffDialog.locator('.bill-transaction-history > .payment-flow-breakdown');
    await verifyBreakdown(staffFlow);
    await staffFlow.screenshot({ path: info.outputPath('cash-breakdown-staff.png'), scale: 'css' });
    await staffDialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
    const receipt = staffDialog.getByRole('region', { name: 'Phiếu thanh toán', exact: true });
    await verifyBreakdown(receipt.locator('.payment-flow-breakdown'), true);
    await expect(
      receipt
        .locator('.receipt-totals > div')
        .filter({ hasText: 'Đã tính vào tiền món' })
        .locator('strong'),
    ).toHaveText('0 đ');
    await expect(receipt.locator('.receipt-payment-entry .cash-history')).toHaveCount(2);
    await receipt
      .locator('.receipt-money-breakdown')
      .screenshot({ path: info.outputPath('cash-breakdown-receipt.png'), scale: 'css' });

    await admin
      .getByRole('navigation', { name: 'Quản trị', exact: true })
      .getByRole('button', { name: 'Tải lại dữ liệu', exact: true })
      .click();
    await selectAdmin(admin, 'Việc cần xử lý', 'Món & nguyên liệu');
    await admin.getByRole('textbox', { name: 'Tìm bàn, món hoặc mã phiên…' }).fill(code);
    await admin
      .locator('.inbox-case')
      .filter({ hasText: code })
      .first()
      .getByRole('button', { name: 'Kiểm tra kho & khả năng phục vụ', exact: true })
      .click();
    const inspection = admin.getByRole('dialog', {
      name: 'Kiểm tra nguyên liệu - Bàn ' + code,
      exact: true,
    });
    const facts = inspection.getByRole('region', { name: 'Thanh toán cả bàn', exact: true });
    await facts
      .locator('summary')
      .filter({ hasText: /^Chi tiết thu và hoàn tiền$/ })
      .click();
    const adminFlow = facts.locator('.payment-flow-breakdown');
    await verifyBreakdown(adminFlow);
    await adminFlow.screenshot({ path: info.outputPath('cash-breakdown-admin.png'), scale: 'css' });
    for (const page of [admin, staff, guest]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
        false,
      );
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
