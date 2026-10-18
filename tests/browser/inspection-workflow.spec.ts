import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

type Entity = { id: string };
type Ingredient = Entity & { name: string; code: string };
type Balance = Entity & {
  ingredient_id: string;
  location_id: string;
  on_hand_qty: string;
  reserved_qty: string;
  available_qty: string;
};
type Inventory = {
  units: (Entity & { code: string })[];
  balances: Balance[];
};
type Bill = {
  account: { charge_total: string; paid_total: string; refund_due_amount: string };
  refundContext: { reason: string; decisions: { action: string }[] } | null;
};
type InspectionHistory = Entity & {
  reported_by_name: string;
  reported_at: string;
  stock_check_status: string;
  stock_check_note: string;
  stock_checked_by_name: string;
  stock_checked_at: string;
  guest_notified: boolean;
  refund_history: {
    scope: 'ITEM' | 'SHARED_SESSION' | 'SESSION' | 'NONE';
    amount: string | null;
    refunded_amount: string | null;
    remaining_amount: string | null;
    cases: { related_item_ids: string[] }[];
  };
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
  return (await response.json()) as T;
}

async function post<T>(page: Page, route: string, data: unknown): Promise<T> {
  const response = await page.request.post('/api' + route, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test('admin follows a paid dish inspection through editing, ingredient adjustment, refund and permanent history', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, kitchen] = (await Promise.all(contexts.map((c) => c.newPage()))) as [
    Page,
    Page,
    Page,
  ];
  const errors: string[] = [];
  for (const page of [admin, staff, kitchen]) {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 500)
        errors.push(String(r.status()) + ' ' + new URL(r.url()).pathname);
    });
  }
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv008', 'staff');
    await login(kitchen, 'bep002', 'kitchen');
    const code = 'CHECK-' + randomUUID().slice(0, 8);
    const name = 'Món kiểm tra quy trình ' + code;
    const catalog = await get<{ categories: Entity[] }>(admin, '/core/catalog');
    const inventory = await get<Inventory>(admin, '/core/inventory');
    const areas = await get<Entity[]>(admin, '/core/areas');
    const unit = inventory.units[0]!;
    const location = await post<Entity>(admin, '/core/locations', {
      code,
      name: 'Kho kiểm tra ' + code,
    });
    const ingredients = await Promise.all(
      ['Nguyên liệu chính', 'Nguyên liệu phụ', 'Nguyên liệu ngoài công thức'].map((label, index) =>
        post<Ingredient>(admin, '/core/ingredients', {
          code: code + '-' + index,
          name: label + ' ' + code,
          unitId: unit.id,
          minStock: '1',
        }),
      ),
    );
    const [mainIngredient, otherIngredient, unrelatedIngredient] = ingredients as [
      Ingredient,
      Ingredient,
      Ingredient,
    ];
    const product = await post<Entity>(admin, '/core/products', {
      code,
      name,
      categoryId: catalog.categories[0]!.id,
      price: '25000',
      stockManaged: true,
      complimentary: false,
    });
    await post(admin, '/core/products/' + product.id + '/bom', {
      yield: '1',
      lines: [
        { ingredientId: mainIngredient.id, quantity: '1', waste: '0' },
        { ingredientId: otherIngredient.id, quantity: '2', waste: '0' },
      ],
    });
    const receipt = await post<Entity & { version: number }>(admin, '/core/receipts', {
      locationId: location.id,
      supplier: 'Nhà cung cấp kiểm thử',
      externalReference: code,
      lines: ingredients.map((ingredient) => ({
        ingredientId: ingredient.id,
        quantity: '20',
        unitCost: '1000',
      })),
    });
    await post(admin, '/core/receipts/' + receipt.id + '/approve', {
      expectedVersion: receipt.version,
    });
    const table = await post<Entity>(admin, '/core/tables', {
      areaId: areas[0]!.id,
      code,
      name: code,
      capacity: 4,
    });
    const session = await post<Entity>(staff, '/core/tables/' + table.id + '/open', {});
    const batch = await post<Entity>(staff, '/core/sessions/' + session.id + '/orders', {
      requestId: randomUUID(),
      lines: [{ productId: product.id, quantity: 1 }],
    });
    const orders = await get<(Entity & { items: Entity[] })[]>(staff, '/core/orders');
    const item = orders.find((order) => order.id === batch.id)!.items[0]!;
    await post(kitchen, '/core/items/' + item.id + '/accept', {});
    const payment = await post<Entity>(staff, '/core/sessions/' + session.id + '/payments', {
      requestId: randomUUID(),
      method: 'CASH',
      amount: '25000',
    });
    await post(staff, '/core/payments/' + payment.id + '/confirm', {
      amount: '25000',
      receivedAmount: '25000',
    });
    await post(kitchen, '/core/items/' + item.id + '/unavailable', {
      reasonCode: 'EQUIPMENT_FAILURE',
    });
    const beforeRefund = await get<Bill>(staff, '/core/sessions/' + session.id + '/bill');
    expect(beforeRefund.account).toMatchObject({
      charge_total: '0',
      paid_total: '25000',
      refund_due_amount: '25000',
    });
    expect(beforeRefund.refundContext?.decisions).toEqual([
      expect.objectContaining({ action: 'ITEM_UNAVAILABLE' }),
    ]);

    // There is one guest conversation task. The administrator's inspection must never appear here.
    await staff.getByRole('button', { name: 'Làm mới', exact: true }).click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await staff
      .locator('.table-tile')
      .filter({ has: staff.getByRole('heading', { name: code, exact: true }) })
      .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
      .click();
    const staffDialog = staff.getByRole('dialog', { name: 'Chi tiết - ' + code, exact: true });
    await staffDialog.getByRole('button', { name: 'Việc tại bàn', exact: true }).click();
    await expect(staffDialog.locator('.dish-guest-task')).toHaveCount(1);
    await expect(staffDialog.getByRole('region', { name: 'Việc của quản trị' })).toHaveCount(0);
    await expect(staffDialog).not.toContainText('Chờ quản trị kiểm tra');
    await staffDialog
      .getByRole('button', { name: 'Đã trao đổi với khách tại bàn', exact: true })
      .click();
    await expect(staffDialog.locator('.dish-guest-task')).toHaveCount(0);
    await expect(staffDialog).not.toContainText('Quản trị cần kiểm tra');
    await staffDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await staff
      .getByRole('navigation', { name: 'Người phụ trách công việc' })
      .getByRole('button', { name: /Việc chung/ })
      .click();
    await staff.getByLabel('Loại công việc').selectOption('issue');
    await expect(staff.locator('.queue-table-card').filter({ hasText: code })).toHaveCount(0);
    await staff.getByLabel('Loại công việc').selectOption('refund');
    await expect(staff.locator('.queue-table-card').filter({ hasText: code })).toHaveCount(0);
    // A refund becomes a staff task only after the administrator approves the document.

    await admin
      .getByRole('navigation', { name: 'Quản trị', exact: true })
      .getByRole('button', { name: 'Tải lại dữ liệu', exact: true })
      .click();
    await selectAdmin(admin, 'Việc cần xử lý', 'Món & nguyên liệu');
    await admin.getByRole('textbox', { name: 'Tìm bàn, món hoặc mã phiên…' }).fill(code);
    const incident = admin.locator('.inbox-case').filter({ hasText: code });
    await expect(incident).toHaveCount(1);
    await incident
      .getByRole('button', { name: 'Kiểm tra kho & khả năng phục vụ', exact: true })
      .click();
    const inspection = admin.getByRole('dialog', {
      name: 'Kiểm tra nguyên liệu - Bàn ' + code,
      exact: true,
    });
    await expect(inspection.getByText('Không tính tiền - 0 đ', { exact: true })).toBeVisible();
    const tablePayment = inspection.getByRole('region', { name: 'Thanh toán cả bàn', exact: true });
    await expect(tablePayment).toContainText(
      'Món đang kiểm tra không tính tiền. Số tiền bên dưới là của cả bàn, không phải riêng món này.',
    );
    await expect(
      tablePayment.getByRole('heading', { name: 'Thanh toán cả bàn', exact: true }),
    ).toBeVisible();
    for (const [label, amount] of [
      ['Đã tính vào tiền món', '0 đ'],
      ['Đã nhận (trước hoàn)', '25.000 đ'],
      ['Còn phải thanh toán', '0 đ'],
      ['Cần hoàn lại khách', '25.000 đ'],
    ]) {
      await expect(
        tablePayment
          .locator(':scope > .inbox-facts > div')
          .filter({ hasText: label })
          .locator('dd'),
      ).toHaveText(amount!);
    }
    await expect(tablePayment.locator('.billing-payable dd')).toHaveText('0 đ');
    await expect(tablePayment.locator(':scope > .inbox-facts > div')).toHaveCount(4);
    await expect(tablePayment.getByText('Đã hoàn cho khách', { exact: true })).toHaveCount(0);
    const completionNote = 'Đã hoàn tất kiểm tra nguyên liệu / thiết bị.';
    await expect(inspection.getByLabel('Đã kiểm tra và xử lý gì?', { exact: true })).toHaveCount(0);
    await expect(inspection.locator('textarea')).toHaveCount(0);
    await expect(
      inspection.getByRole('heading', { name: 'Kết quả kiểm tra', exact: true }),
    ).toHaveCount(0);
    await expect(inspection.getByRole('button', { name: 'Kiểm tra & hoàn tiền' })).toBeVisible();
    await inspection.getByRole('button', { name: 'Chỉnh sửa món này', exact: true }).click();
    const editor = admin.getByRole('dialog', { name: 'Chỉnh sửa món - ' + name, exact: true });
    await expect(editor.getByLabel('Tên món', { exact: true })).toHaveValue(name);
    await editor.getByLabel('Giá bán (đồng)', { exact: true }).fill('35000');
    await editor.getByLabel('Nhận món', { exact: true }).selectOption('AVAILABLE');
    await editor.getByRole('button', { name: 'Lưu món', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(inspection).toBeVisible();
    await expect(inspection.getByLabel('Đã kiểm tra và xử lý gì?', { exact: true })).toHaveCount(0);

    await inspection
      .getByRole('button', { name: 'Kiểm tra & điều chỉnh kho', exact: true })
      .click();
    await expect(admin.getByRole('heading', { name: 'Tồn kho', exact: true })).toBeVisible();
    await expect(admin.getByLabel('Món ăn', { exact: true })).toHaveValue(product.id);
    const stockRows = admin.locator('.inv-app .inv-table tbody tr');
    await expect(stockRows).toHaveCount(2);
    await expect(stockRows.filter({ hasText: mainIngredient.name })).toHaveCount(1);
    await expect(stockRows.filter({ hasText: otherIngredient.name })).toHaveCount(1);
    await expect(stockRows.filter({ hasText: unrelatedIngredient.name })).toHaveCount(0);
    await admin.getByLabel('Kho', { exact: true }).selectOption(location.id);
    await admin.getByLabel('Tình trạng', { exact: true }).selectOption('ready');
    await expect(stockRows).toHaveCount(2);
    await fits(admin);
    if (info.project.use.isMobile) {
      const metrics = await admin.locator('.inv-stats > article').evaluateAll((cards) =>
        cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          const caption = card.querySelector(':scope > span')!.getBoundingClientRect();
          const value = card.querySelector('strong')!.getBoundingClientRect();
          return {
            width: bounds.width,
            top: bounds.top,
            bottom: bounds.bottom,
            right: bounds.right,
            captionHeight: caption.height,
            valueRight: value.right,
          };
        }),
      );
      expect(metrics).toHaveLength(3);
      for (const [index, metric] of metrics.entries()) {
        expect(metric.width).toBeGreaterThan(300);
        expect(metric.captionHeight).toBeLessThanOrEqual(40);
        expect(metric.valueRight).toBeLessThanOrEqual(metric.right);
        if (index) expect(metric.top).toBeGreaterThan(metrics[index - 1]!.bottom);
      }
    }
    await admin.screenshot({
      path: info.outputPath('inspection-filtered-stock.png'),
      scale: 'css',
    });
    await stockRows
      .filter({ hasText: mainIngredient.name })
      .getByRole('button', { name: 'Kiểm kê / xuất hủy', exact: true })
      .click();
    const adjustment = admin.getByRole('dialog', {
      name: 'Kiểm kê / xuất hủy - ' + mainIngredient.name,
      exact: true,
    });
    await adjustment.getByLabel('Loại ghi nhận', { exact: true }).selectOption('COUNT');
    await adjustment.locator('input[name="quantity"]').fill('18');
    const adjustmentNote = 'Kiểm kê thực tế khi xử lý món dừng ' + code;
    await adjustment
      .getByLabel('Lý do / biên bản kiểm kê hoặc hư hỏng', { exact: true })
      .fill(adjustmentNote);
    await adjustment.getByRole('button', { name: 'Điều chỉnh tồn', exact: true }).click();
    await admin
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Xác nhận điều chỉnh tồn', exact: true })
      .click();
    await expect(adjustment).toHaveCount(0);
    const updatedInventory = await get<Inventory>(admin, '/core/inventory');
    const adjusted = updatedInventory.balances.find(
      (balance) =>
        balance.ingredient_id === mainIngredient.id && balance.location_id === location.id,
    )!;
    expect(Number(adjusted.on_hand_qty)).toBe(18);
    expect(Number(adjusted.reserved_qty)).toBe(0);
    await admin.getByRole('button', { name: 'Quay lại xử lý sự cố', exact: true }).click();
    await expect(inspection).toBeVisible();
    await expect(inspection.getByLabel('Đã kiểm tra và xử lý gì?', { exact: true })).toHaveCount(0);
    await fits(admin);
    await admin.screenshot({
      path: info.outputPath('inspection-return-to-task.png'),
      scale: 'css',
    });

    await inspection.getByRole('button', { name: 'Kiểm tra & hoàn tiền', exact: true }).click();
    const refundDialog = admin.getByRole('dialog', {
      name: 'Hoàn tiền - Bàn ' + code,
      exact: true,
    });
    const refundPanel = refundDialog.getByRole('region', {
      name: 'Hoàn tiền cho khách',
      exact: true,
    });
    await expect(refundPanel).toContainText('Hoàn tiền do món dừng trước chế biến');
    await expect(refundPanel).toContainText('Thiết bị bếp gặp sự cố');
    await expect(refundPanel.getByRole('textbox', { name: 'Lý do hoàn', exact: true })).toHaveCount(
      0,
    );
    const createRefund = refundPanel.locator('form').filter({
      has: admin.getByRole('heading', { name: 'Lập hồ sơ hoàn tiền', exact: true }),
    });
    await expect(createRefund.locator('input[name="amount"]')).toHaveValue('25000');
    await fits(admin);
    await admin.screenshot({ path: info.outputPath('inspection-refund-reason.png'), scale: 'css' });
    await createRefund.getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true }).click();
    await admin
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true })
      .click();
    await expect(createRefund).toHaveCount(0);
    await expect(refundPanel.locator('.admin-approved-refund')).toContainText(
      'Đã chuyển cho nhân viên hoàn tiền',
    );
    await expect(
      refundPanel.getByRole('button', { name: 'Xác nhận đã hoàn', exact: true }),
    ).toHaveCount(0);
    await expect(refundPanel.locator('form')).toHaveCount(0);
    await staff.getByRole('button', { name: 'Làm mới', exact: true }).click();
    const refundJob = staff.locator('.queue-table-card[data-table-id="' + table.id + '"]');
    await expect(refundJob).toContainText('Cần hoàn tiền');
    await refundJob.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    await staffDialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    const completeRefund = staffDialog
      .getByRole('region', { name: 'Hoàn tiền cho khách', exact: true })
      .locator('form')
      .filter({
        has: staff.getByRole('heading', { name: 'Còn phải hoàn 25.000 đ', exact: true }),
      });
    await expect(completeRefund).toContainText('Quản trị đã duyệt:');
    await completeRefund
      .getByRole('button', { name: 'Đã hoàn tiền cho khách', exact: true })
      .click();
    await staff
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(completeRefund).toHaveCount(0);
    await admin.bringToFront();
    await expect(refundPanel.locator('.admin-approved-refund')).toHaveCount(0, { timeout: 15000 });
    await staff.bringToFront();
    await staffDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(refundJob).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await get<Bill>(admin, '/core/sessions/' + session.id + '/bill')).account
            .refund_due_amount,
      )
      .toBe('0');
    await refundDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(inspection).toBeVisible();
    await expect(inspection.getByLabel('Đã kiểm tra và xử lý gì?', { exact: true })).toHaveCount(0);
    await expect(inspection.getByRole('button', { name: 'Kiểm tra & hoàn tiền' })).toHaveCount(0);
    await expect(
      tablePayment
        .locator(':scope > .inbox-facts > div')
        .filter({ hasText: 'Đã tính vào tiền món' })
        .locator('dd'),
    ).toHaveText('0 đ');
    await tablePayment
      .locator('summary')
      .filter({ hasText: /^Chi tiết thu và hoàn tiền$/ })
      .click();
    await expect(
      tablePayment
        .locator('details .payment-flow-facts > div')
        .filter({ hasText: 'Đã hoàn lại khách' })
        .locator('dd'),
    ).toHaveText('25.000 đ');
    await expect(tablePayment.getByText('Cần hoàn lại khách', { exact: true })).toHaveCount(0);
    await expect(inspection).toContainText(
      'Các khoản cần hoàn đã được trả lại cho khách. Hiện cả bàn không còn tiền chờ hoàn.',
    );
    await inspection.getByRole('button', { name: 'Hoàn tất kiểm tra', exact: true }).click();
    await admin
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(inspection).toHaveCount(0);
    await expect(incident).toHaveCount(0);

    await selectAdmin(admin, 'Báo cáo', 'Tra cứu & xử lý món');
    await admin.getByRole('button', { name: 'Dừng trước chế biến', exact: true }).click();
    await admin.getByRole('textbox', { name: /Tìm bàn,.*lý do…/ }).fill(code);
    await admin.getByLabel('Phân loại', { exact: true }).selectOption('RESOLVED');
    const history = admin.locator('.unavailable-history-case');
    await expect(history).toHaveCount(1);
    await expect(history).toContainText(name);
    await expect(
      history.getByRole('heading', {
        name: 'Bàn ' + code + ' · Phiên #' + session.id.slice(0, 8).toUpperCase(),
        exact: true,
      }),
    ).toBeVisible();
    await expect(history.getByText(/^(Đã báo khách|Chờ báo khách)$/)).toHaveCount(0);
    await expect(history.getByText('Đã hoàn: 25.000 đ', { exact: true })).toBeVisible();
    await expect(history.getByText('Đã kiểm tra', { exact: true })).toBeVisible();
    await expect(history.getByText('Thiết bị bếp gặp sự cố', { exact: true })).toHaveCount(1);
    await expect(history).not.toContainText('Dừng trước chế biến - Không tính tiền');
    await expect(history).not.toContainText('Đã kiểm tra nguyên liệu / thiết bị');
    await expect(history).not.toContainText(completionNote);
    const historyData = await get<{ rows: InspectionHistory[] }>(
      admin,
      '/core/history/order-unavailable?period=all&status=RESOLVED&itemId=' + item.id,
    );
    expect(historyData.rows).toHaveLength(1);
    const recorded = historyData.rows[0]!;
    expect(recorded.stock_check_note).toBe(completionNote);
    expect(recorded.guest_notified).toBe(true);
    expect(recorded.refund_history).toMatchObject({
      scope: 'ITEM',
      amount: '25000',
      refunded_amount: '25000',
      remaining_amount: '0',
    });
    expect(recorded.refund_history.cases).toHaveLength(1);
    expect(recorded.refund_history.cases[0]!.related_item_ids).toEqual([item.id]);
    expect(recorded.stock_check_status).toBe('RESOLVED');
    expect(recorded.stock_checked_by_name).toBeTruthy();
    expect(Number.isFinite(Date.parse(recorded.stock_checked_at))).toBe(true);
    expect(recorded.reported_by_name).toBeTruthy();
    expect(Number.isFinite(Date.parse(recorded.reported_at))).toBe(true);
    await expect(history).toContainText(recorded.reported_by_name);
    await expect(history).toContainText(
      new Date(recorded.reported_at).toLocaleDateString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }),
    );
    await expect(history.getByText(/^Xử lý:/)).toContainText(recorded.stock_checked_by_name);
    await expect(history).toContainText(
      new Date(recorded.stock_checked_at).toLocaleDateString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }),
    );
    await fits(admin);
    await admin.screenshot({
      path: info.outputPath('inspection-completed-history.png'),
      scale: 'css',
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});
