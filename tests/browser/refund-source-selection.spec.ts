import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

type Entity = { id: string };
type Bill = {
  account: { refund_due_amount: string; refunded_total: string };
  payments: (Entity & { amount: string })[];
  refunds: (Entity & {
    amount: string;
    source_payment_transaction_id: string;
    approved_at: string;
    request_key: string;
  })[];
};

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

async function refreshAdmin(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Quản trị', exact: true });
  const expand = nav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
  const wasCollapsed = (await expand.count()) > 0;
  if (wasCollapsed) await expand.click();
  const reload = nav.getByRole('button', { name: 'Tải lại dữ liệu', exact: true });
  await reload.click();
  await expect(reload).toBeEnabled();
  if (wasCollapsed)
    await nav.getByRole('button', { name: 'Thu gọn thanh điều hướng', exact: true }).click();
}

for (const loseResponse of [false, true]) {
  test(
    loseResponse
      ? 'refund creation recovers a committed document after response loss and gives the next source a new request key'
      : 'refund creation caps each original payment and excludes a source after its money has been returned',
    async ({ browser, baseURL }, info) => {
      test.setTimeout(140000);
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
        await login(staff, 'pv007', 'staff');
        await login(kitchen, 'bep003', 'kitchen');
        const code = 'SOURCES-' + randomUUID().slice(0, 8);
        const areas = await get<Entity[]>(admin, '/core/areas');
        const catalog = await get<{ categories: Entity[] }>(admin, '/core/catalog');
        const products = [];
        for (const price of ['45000', '49000'])
          products.push(
            await post<Entity>(admin, '/core/products', {
              code: code + '-' + price,
              name: 'Món kiểm tra hoàn ' + price + ' ' + code,
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
        const session = await post<Entity>(staff, '/core/tables/' + table.id + '/open', {});
        const sid = session.id;
        const batch = await post<Entity>(staff, '/core/sessions/' + sid + '/orders', {
          requestId: randomUUID(),
          lines: products.map((product) => ({ productId: product.id, quantity: 1 })),
        });
        const order = (
          await get<(Entity & { status: string; items: Entity[] })[]>(staff, '/core/orders')
        ).find((row) => row.id === batch.id)!;
        if (order.status === 'PENDING_REVIEW')
          await post(staff, '/core/orders/' + order.id + '/review', { approve: true });
        for (const item of order.items) {
          for (const action of ['accept', 'prepare', 'ready'])
            await post(kitchen, '/core/items/' + item.id + '/' + action, {});
          await post(staff, '/core/items/' + item.id + '/serve', {});
        }
        const sources: Record<string, string> = {};
        for (const amount of ['45000', '49000']) {
          const intent = await post<Entity>(staff, '/core/sessions/' + sid + '/payments', {
            requestId: randomUUID(),
            method: 'CASH',
            amount,
          });
          const payment = await post<Entity>(staff, '/core/payments/' + intent.id + '/confirm', {
            amount,
            receivedAmount: '100000',
          });
          sources[amount] = payment.id;
          await post(staff, '/core/payment-transactions/' + payment.id + '/change-returned', {});
        }
        for (const item of order.items)
          await post(admin, '/core/items/' + item.id + '/waive', {
            reasonCode: 'QUALITY_ISSUE',
            note: 'Khách phản ánh món không đạt chất lượng',
          });
        expect(
          (await get<Bill>(admin, '/core/sessions/' + sid + '/bill')).account.refund_due_amount,
        ).toBe('94000');

        await refreshAdmin(admin);
        await selectAdmin(admin, 'Việc cần xử lý', 'Khoản cần hoàn');
        await admin
          .locator('.inbox-case')
          .filter({ hasText: code })
          .getByRole('button', { name: 'Xử lý hoàn tiền', exact: true })
          .click();
        const dialog = admin.getByRole('dialog', { name: 'Hoàn tiền - Bàn ' + code, exact: true });
        const creation = dialog.getByRole('region', { name: 'Lập hồ sơ hoàn tiền', exact: true });
        const selector = creation.getByLabel('Giao dịch gốc', { exact: true });
        const amount = creation.locator('input[name="amount"]');
        await expect(selector.locator('option')).toHaveCount(2);
        await expect(creation).toContainText('Tổng chưa lập phiếu của bàn: 94.000 đ');
        const initial = await selector.inputValue();
        const initialCap = initial === sources['45000'] ? '45000' : '49000';
        expect([sources['45000'], sources['49000']]).toContain(initial);
        await expect(amount).toHaveAttribute('max', initialCap);
        await expect(amount).toHaveValue(initialCap);

        await selector.selectOption(sources['49000']!);
        await expect(amount).toHaveAttribute('max', '49000');
        await expect(amount).toHaveValue('49000');
        await selector.selectOption(sources['45000']!);
        await expect(amount).toHaveAttribute('max', '45000');
        await expect(amount).toHaveValue('45000');
        await expect(creation).toContainText(
          'Lập phiếu cho giao dịch này, rồi tiếp tục với giao dịch còn lại',
        );

        await amount.fill('46000');
        await creation.getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true }).click();
        expect(
          await amount.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow),
        ).toBe(true);
        await expect(
          admin.getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true }),
        ).toHaveCount(0);
        expect((await get<Bill>(admin, '/core/sessions/' + sid + '/bill')).refunds).toHaveLength(0);

        let simulatedLoss = false;
        if (loseResponse)
          await admin.route(
            '**/api/core/sessions/' + sid + '/refunds',
            async (route) => {
              // Commit on the real API first, then make only this client response fail.
              const committed = await route.fetch();
              expect(committed.ok(), await committed.text()).toBe(true);
              simulatedLoss = true;
              await route.fulfill({
                status: 503,
                json: { userMessage: 'Mất phản hồi sau khi máy chủ đã lập phiếu.' },
              });
            },
            { times: 1 },
          );
        await amount.fill('45000');
        await creation.getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true }).click();
        const confirmation = admin.getByRole('dialog', {
          name: 'Kiểm tra trước khi xác nhận',
          exact: true,
        });
        await expect(confirmation).toContainText('Duyệt hoàn 45.000 đ từ giao dịch 45.000 đ');
        await confirmation
          .getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true })
          .click();
        await expect
          .poll(
            async () => (await get<Bill>(admin, '/core/sessions/' + sid + '/bill')).refunds.length,
          )
          .toBe(1);
        const approved = (await get<Bill>(admin, '/core/sessions/' + sid + '/bill')).refunds[0]!;
        expect(approved).toMatchObject({
          amount: '45000',
          source_payment_transaction_id: sources['45000'],
        });
        expect(approved.approved_at).toBeTruthy();
        if (loseResponse) {
          expect(simulatedLoss).toBe(true);
          await expect(dialog).toBeVisible();
          await expect(selector.locator('option')).toHaveCount(1);
          await expect(selector).toHaveValue(sources['49000']!);
          await expect(amount).toHaveValue('49000');
          await expect(amount).toHaveAttribute('max', '49000');
          await creation.getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true }).click();
          const nextConfirmation = admin.getByRole('dialog', {
            name: 'Kiểm tra trước khi xác nhận',
            exact: true,
          });
          await expect(nextConfirmation).toContainText('Duyệt hoàn 49.000 đ từ giao dịch 49.000 đ');
          await nextConfirmation
            .getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (await get<Bill>(admin, '/core/sessions/' + sid + '/bill')).refunds.length,
            )
            .toBe(2);
          const recovered = await get<Bill>(admin, '/core/sessions/' + sid + '/bill');
          expect(recovered.refunds.filter((document) => document.id === approved.id)).toHaveLength(
            1,
          );
          expect(new Set(recovered.refunds.map((document) => document.id)).size).toBe(2);
          expect(
            recovered.refunds.map((document) => document.source_payment_transaction_id).sort(),
          ).toEqual([sources['45000'], sources['49000']].sort());
          expect(new Set(recovered.refunds.map((document) => document.request_key)).size).toBe(2);
          for (const document of recovered.refunds) {
            expect(document.request_key).toBeTruthy();
            expect(document.approved_at).toBeTruthy();
          }
          expect(
            recovered.refunds.reduce((total, document) => total + BigInt(document.amount), 0n),
          ).toBe(94000n);
          expect(recovered.account).toMatchObject({
            refunded_total: '0',
            refund_due_amount: '94000',
          });
          await expect(creation).toHaveCount(0);
          await expect(dialog.locator('.admin-approved-refund')).toHaveCount(2);
          await dialog.screenshot({
            path: info.outputPath('refund-source-response-loss-recovered.png'),
            scale: 'css',
          });
          expect(
            await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true);
          expect(errors).toEqual([]);
          return;
        }
        await post(staff, '/core/refunds/' + approved.id + '/complete', {
          requestId: randomUUID(),
          method: 'CASH',
          amount: '45000',
        });
        await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
        await refreshAdmin(admin);
        await admin
          .locator('.inbox-case')
          .filter({ hasText: code })
          .getByRole('button', { name: 'Xử lý hoàn tiền', exact: true })
          .click();

        await expect(selector.locator('option')).toHaveCount(1);
        await expect(selector).toHaveValue(sources['49000']!);
        await expect(selector.locator('option')).toContainText('Còn có thể hoàn 49.000 đ');
        await expect(selector.locator('option[value="' + sources['45000'] + '"]')).toHaveCount(0);
        await expect(amount).toHaveValue('49000');
        await expect(amount).toHaveAttribute('max', '49000');
        await expect(creation).toContainText('Tổng chưa lập phiếu của bàn: 49.000 đ');
        const partial = await get<Bill>(admin, '/core/sessions/' + sid + '/bill');
        expect(partial.account).toMatchObject({
          refunded_total: '45000',
          refund_due_amount: '49000',
        });
        await creation.screenshot({
          path: info.outputPath('refund-source-capacity.png'),
          scale: 'css',
        });
        expect(
          await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await Promise.allSettled(contexts.map((context) => context.close()));
      }
    },
  );
}
