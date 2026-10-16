import { browserTableCode } from './table-code-fixture';
import { selectAdmin } from './admin-navigation';
import { test, expect, type Page } from '@playwright/test';
async function login(p: Page, user: string, area: string) {
  await p.goto('/login');
  await p.locator('#username').fill(user);
  await p.locator('#password').fill(process.env.SEED_PASSWORD!);
  await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(p).toHaveURL(new RegExp('workspace/' + area));
}
async function post(p: Page, path: string, data: unknown) {
  const r = await p.request.post('/api' + path, {
    headers: { origin: new URL(p.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test('kitchen quick issue, global admin entry, durable staff conversation and aligned zero-price receipt', async ({
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
  const [admin, staff, kitchen, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const p of [admin!, staff!, kitchen!, guest!]) {
    p.setDefaultTimeout(15000);
    p.on('pageerror', (e) => errors.push(e.message));
  }
  try {
    await login(admin!, 'quyettruong05', 'admin');
    await login(staff!, 'pv008', 'staff');
    await login(kitchen!, 'bep002', 'kitchen');
    const tables = await (await admin!.request.get('/api/core/admin/tables')).json();
    const code = 'SC-' + info.project.name[0] + '-' + String(Date.now()).slice(-6);
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
    await guest!.getByLabel('Tên của bạn').fill('Khách trải nghiệm món');
    await guest!
      .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
      .check();
    await guest!.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
    await expect(
      guest!.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
    const state = await (await guest!.request.get('/api/guest/state')).json(),
      sid = state.session.id;
    const catalog = await (await admin!.request.get('/api/core/catalog')).json();
    const faulty = catalog.products.find((p: { name: string }) => p.name === 'Bò nướng sốt tiêu'),
      normal = catalog.products.find((p: { name: string }) => p.name === 'Nước suối 500 ml');
    expect(faulty).toBeTruthy();
    expect(normal).toBeTruthy();
    const batch = await post(staff!, '/core/sessions/' + sid + '/orders', {
      requestId: crypto.randomUUID(),
      lines: [
        { productId: faulty.id, quantity: 1 },
        { productId: normal.id, quantity: 1 },
      ],
    });
    const orders = await (await staff!.request.get('/api/core/orders')).json(),
      items = orders.find((o: { id: string }) => o.id === batch.id).items;
    const good = items.find((i: { product_id: string }) => i.product_id === normal.id);
    for (const item of items) {
      await post(kitchen!, '/core/items/' + item.id + '/accept', {});
      await post(kitchen!, '/core/items/' + item.id + '/prepare', {});
    }
    await post(kitchen!, '/core/items/' + good.id + '/ready', {});
    await staff!.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await staff!.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    const servingTable = staff!
      .locator('.table-tile')
      .filter({ has: staff!.getByRole('heading', { name: code, exact: true }) });
    await servingTable.getByRole('button', { name: 'Mở chi tiết bàn', exact: true }).click();
    const servingDialog = staff!.getByRole('dialog');
    await servingDialog.getByRole('button', { name: 'Món đã gọi', exact: true }).click();
    const servingSelection = servingDialog.locator('.serve-selection');
    const dishCheck = servingSelection.getByRole('checkbox', { name: /Nước suối/ });
    const dimensions = await dishCheck.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }));
    expect(dimensions.width).toBe(18);
    expect(dimensions.height).toBe(18);
    await expect(
      servingDialog.getByRole('button', { name: 'Đã mang ra bàn', exact: true }),
    ).toHaveCount(0);
    await staff!.screenshot({ path: info.outputPath('staff-serving-selection.png'), scale: 'css' });
    await dishCheck.check();
    await servingSelection.getByRole('button', { name: 'Đã phục vụ 1 món', exact: true }).click();
    await expect(servingSelection).toHaveCount(0);
    await servingDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    const total = (BigInt(faulty.base_price) + BigInt(normal.base_price)).toString();
    const payment = await post(staff!, '/core/sessions/' + sid + '/payments', {
      requestId: crypto.randomUUID(),
      method: 'CASH',
      amount: total,
    });
    await post(staff!, '/core/payments/' + payment.id + '/confirm', { amount: total });
    const adminNav = admin!.getByRole('navigation', { name: 'Quản trị', exact: true }),
      expand = adminNav.getByRole('button', { name: 'Mở thanh điều hướng', exact: true });
    if (await expand.count()) await expand.click();
    await selectAdmin(admin!, 'Thực đơn');
    const ticket = kitchen!
      .locator('.order-card')
      .filter({ has: kitchen!.getByRole('heading', { name: 'Bàn ' + code, exact: true }) });
    const item = ticket.locator('.core-order-item').filter({ hasText: faulty.name });
    await item.getByText('Báo sự cố và dừng món', { exact: false }).click();
    await item.getByRole('button', { name: 'Lỗi chế biến của nhà hàng', exact: true }).click();
    await expect(item.getByRole('textbox')).toHaveCount(0);
    await item.getByRole('button', { name: 'Lý do khác', exact: true }).click();
    await expect(item.getByRole('textbox')).toHaveAttribute('required', '');
    await item.getByRole('button', { name: 'Lỗi chế biến của nhà hàng', exact: true }).click();
    await kitchen!.screenshot({
      path: info.outputPath('kitchen-quick-issue.png'),
      scale: 'css',
      fullPage: true,
    });
    await item.getByRole('button', { name: 'Dừng món và báo sự cố', exact: true }).click();
    await expect(admin!.locator('.urgent-bar')).toContainText(/\d+ món \/ kho cần xử lý/);
    await admin!.locator('.urgent-entry').click();
    const group = admin!
      .locator('.inbox-case')
      .filter({ has: admin!.getByRole('heading', { name: 'Bàn ' + code, exact: true }) });
    await expect(group).toContainText(faulty.name);
    await admin!
      .getByRole('textbox', { name: 'Tìm bàn, món hoặc mã phiên…', exact: true })
      .fill(code);
    await admin!.screenshot({
      path: info.outputPath('admin-issue-queue.png'),
      scale: 'css',
      fullPage: true,
    });
    await group.getByRole('button', { name: 'Kiểm tra & quyết định', exact: true }).click();
    await admin!
      .getByRole('dialog')
      .getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true })
      .click();
    await expect(admin!.getByRole('dialog', { name: 'Xác nhận lỗi nhà hàng?' })).toContainText(
      '159.000',
    );
    await admin!
      .getByRole('dialog', { name: 'Xác nhận lỗi nhà hàng?' })
      .getByRole('button', { name: 'Xác nhận lỗi nhà hàng', exact: true })
      .click();
    await expect(admin!.locator('.inbox-summary')).toContainText(/\d+ cần hoàn tiền/);
    await expect(staff!.locator('.dish-issue-banner')).toContainText(code);
    await staff!
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await staff!
      .getByRole('navigation', { name: 'Người phụ trách công việc' })
      .getByRole('button', { name: /Tôi phụ trách/ })
      .click();
    await staff!.getByLabel('Loại công việc').selectOption('payment');
    await staff!.getByRole('button', { name: 'Xem việc trao đổi tại bàn', exact: true }).click();
    await expect(
      staff!
        .getByRole('navigation', { name: 'Người phụ trách công việc' })
        .getByRole('button', { name: /Việc chung/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(staff!.getByLabel('Loại công việc')).toHaveValue('issue');
    const tableCard = staff!
      .locator('.queue-table-card')
      .filter({ has: staff!.getByRole('heading', { name: code, exact: true }) });
    await expect(tableCard.getByRole('button')).toHaveCount(1);
    await tableCard.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    const communication = staff!
      .locator('.alert-card')
      .filter({ has: staff!.locator('.dish-guest-task') })
      .filter({ hasText: code });
    await expect(communication).toContainText(faulty.name);
    await staff!.screenshot({
      path: info.outputPath('staff-guest-conversation.png'),
      scale: 'css',
    });
    await communication
      .getByRole('button', { name: 'Đã trao đổi với khách tại bàn', exact: true })
      .click();
    await expect(staff!.locator('.dish-issue-banner').filter({ hasText: code })).toHaveCount(0);
    await expect(communication).toHaveCount(0);
    await staff!
      .getByRole('dialog', { name: 'Chi tiết - ' + code, exact: true })
      .getByRole('button', { name: 'Đóng', exact: true })
      .click();
    await staff!.getByLabel('Loại công việc').selectOption('refund');
    await expect(tableCard).toHaveCount(0);
    await guest!
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thanh toán', exact: true })
      .click();
    const guestBill = guest!.locator('.guest-bill-lines');
    await expect(guestBill).toContainText('Nhà hàng hủy - Không tính tiền');
    await expect(
      guestBill
        .locator('.guest-bill-item')
        .filter({ hasText: faulty.name })
        .locator('.compact-bill-row>strong'),
    ).toHaveText('0 đ');
    await expect(guestBill).not.toContainText('−159.000');
    await admin!
      .locator('.inbox-case')
      .filter({ hasText: code })
      .getByRole('button', { name: 'Xử lý hoàn tiền', exact: true })
      .click();
    const refundDialog = admin!.getByRole('dialog', { name: 'Hoàn tiền - Bàn ' + code });
    await refundDialog.getByRole('button', { name: 'Phiếu thường', exact: true }).click();
    const receipt = refundDialog.getByRole('region', { name: 'Phiếu thanh toán' });
    await expect(receipt).toContainText('Nhà hàng hủy - Không tính tiền');
    const badRow = receipt.locator('.receipt-row').filter({ hasText: faulty.name });
    await expect(badRow.locator('strong')).toHaveText('0 đ');
    const aligned = await receipt
      .locator('.receipt-row')
      .evaluateAll((rows) =>
        rows.map((row) =>
          Array.from(row.children).map((cell) => Math.round(cell.getBoundingClientRect().right)),
        ),
      );
    expect(
      aligned.every(
        (row) =>
          row[1] === aligned[0]![1] && row[2] === aligned[0]![2] && row[3] === aligned[0]![3],
      ),
    ).toBe(true);
    for (const p of [admin!, staff!, kitchen!, guest!])
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await admin!.screenshot({ path: info.outputPath('receipt-zero-item.png'), scale: 'css' });
    await guest!.screenshot({
      path: info.outputPath('guest-simple-bill.png'),
      scale: 'css',
      fullPage: true,
    });
    await admin!.emulateMedia({ media: 'print' });
    await expect(badRow).toBeVisible();
    await admin!.screenshot({ path: info.outputPath('receipt-print.png'), scale: 'css' });
    await admin!.emulateMedia({ media: 'screen' });
    const bill = await (await staff!.request.get('/api/core/sessions/' + sid + '/bill')).json();
    expect(bill.account).toMatchObject({
      charge_total: normal.base_price,
      paid_total: total,
      refunded_total: '0',
      refund_due_amount: faulty.base_price,
    });
    const createRefund = refundDialog
      .locator('form')
      .filter({ has: admin!.getByRole('heading', { name: 'Lập hồ sơ hoàn tiền', exact: true }) });
    await createRefund.getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true }).click();
    await admin!
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Lập hồ sơ hoàn tiền', exact: true })
      .click();
    await expect(createRefund).toHaveCount(0);
    await expect(refundDialog.locator('.admin-approved-refund')).toContainText(
      'Đã chuyển cho nhân viên hoàn tiền',
    );
    await expect(
      refundDialog.getByRole('button', { name: 'Xác nhận đã hoàn', exact: true }),
    ).toHaveCount(0);
    await expect(refundDialog.locator('form')).toHaveCount(0);
    await staff!.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await expect(tableCard).toContainText('Cần hoàn tiền');
    await tableCard.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    const staffRefundDialog = staff!.getByRole('dialog', {
      name: 'Chi tiết - ' + code,
      exact: true,
    });
    await staffRefundDialog.getByRole('button', { name: 'Thu tiền & phiếu', exact: true }).click();
    const completeRefund = staffRefundDialog
      .getByRole('region', { name: 'Hoàn tiền cho khách', exact: true })
      .locator('form')
      .filter({
        has: staff!.getByRole('heading', { name: 'Còn phải hoàn 159.000 đ', exact: true }),
      });
    await expect(completeRefund).toContainText('Quản trị đã duyệt:');
    await completeRefund
      .getByRole('button', { name: 'Đã hoàn tiền cho khách', exact: true })
      .click();
    await staff!
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(completeRefund).toHaveCount(0);
    await expect(refundDialog.locator('.admin-approved-refund')).toHaveCount(0);
    await staffRefundDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(tableCard).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await admin!.request.get('/api/core/sessions/' + sid + '/bill')).json()).account
            .refund_due_amount,
      )
      .toBe('0');
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
  }
});

test('stopping an accepted dish needs no note for a preset reason and creates separate stock and guest tasks', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, kitchen] = (await Promise.all(contexts.map((c) => c.newPage()))) as [
    Page,
    Page,
    Page,
  ];
  try {
    await admin.clock.install();
    await login(admin, 'quyettruong05', 'admin');
    const summary = admin.getByRole('region', { name: 'Tóm tắt việc cần xử lý', exact: true });
    await expect(summary).not.toContainText('Đang kiểm tra việc cần xử lý');
    const issueCountButton = summary.getByRole('button', { name: /món & kho cần xử lý/ });
    const initialIssues = (await issueCountButton.count())
      ? parseInt(await issueCountButton.innerText(), 10)
      : 0;
    // Pause background polling so the sidebar refresh must update the operational inbox itself.
    await admin.clock.pauseAt(new Date(Date.now() + 1000));
    await login(staff, 'pv008', 'staff');
    await login(kitchen, 'bep002', 'kitchen');
    const catalog = await (await admin.request.get('/api/core/catalog')).json();
    const code = 'PREP-' + crypto.randomUUID().slice(0, 8);
    const product = await post(admin, '/core/products', {
      code,
      name: 'Món kiểm tra ' + code,
      categoryId: catalog.categories[0].id,
      price: '25000',
      stockManaged: false,
      complimentary: false,
    });
    const areas = await (await admin.request.get('/api/core/areas')).json();
    const table = await post(admin, '/core/tables', {
      areaId: areas[0].id,
      code,
      name: code,
      capacity: 4,
    });
    const opened = await post(staff, '/core/tables/' + table.id + '/open', {});
    const batch = await post(staff, '/core/sessions/' + opened.id + '/orders', {
      requestId: crypto.randomUUID(),
      lines: [{ productId: product.id, quantity: 1 }],
    });
    const orders = await (await staff.request.get('/api/core/orders')).json();
    const item = orders.find((o: { id: string }) => o.id === batch.id).items[0];
    await post(kitchen, '/core/items/' + item.id + '/accept', {});
    const ticket = kitchen
      .locator('.order-card')
      .filter({ has: kitchen.getByRole('heading', { name: 'Bàn ' + code, exact: true }) });
    await ticket.locator('.rare-action summary').click();
    const form = ticket.locator('form').filter({
      has: kitchen.getByRole('heading', { name: 'Không thể phục vụ món này', exact: true }),
    });
    await form.getByLabel('Lý do xử lý', { exact: true }).selectOption('OTHER');
    await expect(form.getByRole('textbox')).toHaveAttribute('required', '');
    await form.getByLabel('Lý do xử lý', { exact: true }).selectOption('EQUIPMENT_FAILURE');
    await expect(form.getByRole('textbox')).toHaveCount(0);
    await kitchen.screenshot({
      path: info.outputPath('kitchen-before-preparation.png'),
      scale: 'css',
    });
    await form.getByRole('button', { name: 'Xác nhận không thể phục vụ', exact: true }).click();
    await kitchen
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(ticket).toHaveCount(0);
    let bill = await (await staff.request.get('/api/core/sessions/' + opened.id + '/bill')).json();
    expect(bill.account.charge_total).toBe('0');
    expect(bill.closure.canClose).toBe(false);
    await staff.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(code);
    await staff
      .locator('.table-tile')
      .filter({ has: staff.getByRole('heading', { name: code, exact: true }) })
      .getByRole('button', { name: 'Mở chi tiết bàn', exact: true })
      .click();
    const staffDialog = staff.getByRole('dialog');
    await expect(staffDialog.locator('.table-code-card .dish-guest-task')).toHaveCount(0);
    await expect(staffDialog.locator('.table-detail-alerts .dish-guest-task')).toContainText(
      'Thiết bị bếp gặp sự cố',
    );
    await staff.screenshot({ path: info.outputPath('staff-separated-tasks.png'), scale: 'css' });
    await staffDialog
      .getByRole('button', { name: 'Đã trao đổi với khách tại bàn', exact: true })
      .click();
    bill = await (await staff.request.get('/api/core/sessions/' + opened.id + '/bill')).json();
    expect(bill.closure.canClose).toBe(true);
    await expect(staffDialog.locator('.dish-guest-task')).toHaveCount(0);
    await expect(staffDialog.locator('.latest-table-job')).toHaveCount(0);
    await expect(staffDialog.locator('.table-all-clear')).toContainText(
      'Không còn công việc cần nhân viên xử lý',
    );
    await expect(
      staffDialog.getByRole('region', { name: 'Việc của quản trị', exact: true }),
    ).toHaveCount(0);
    await expect(staffDialog.locator('.alert-card')).toHaveCount(0);
    await staff.screenshot({ path: info.outputPath('staff-notice-completed.png'), scale: 'css' });
    await staffDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await expect(staff.locator('.queue-table-card').filter({ hasText: code })).toHaveCount(0);
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: 'Sơ đồ bàn', exact: true })
      .click();
    const calmTable = staff.locator('.table-tile').filter({
      has: staff.getByRole('heading', { name: code, exact: true }),
    });
    await expect(calmTable).not.toHaveClass(/has-attention/);
    await calmTable.getByRole('button', { name: 'Mở chi tiết bàn', exact: true }).click();
    await staffDialog.getByRole('button', { name: 'Việc tại bàn', exact: true }).click();
    await expect(staffDialog.locator('.alert-card')).toHaveCount(0);
    await admin
      .getByRole('navigation', { name: 'Quản trị', exact: true })
      .getByRole('button', { name: 'Tải lại dữ liệu', exact: true })
      .click();
    await expect(issueCountButton).toContainText(
      String(initialIssues + 1) + ' món & kho cần xử lý',
    );
    await selectAdmin(admin, 'Việc cần xử lý');
    await admin
      .getByRole('textbox', { name: 'Tìm bàn, món hoặc mã phiên…', exact: true })
      .fill(code);
    const stockCase = admin.locator('.inbox-case').filter({ hasText: code });
    await expect(stockCase).toHaveCount(1);
    await expect(stockCase).toContainText('Kiểm tra nguyên liệu / thiết bị');
    await stockCase
      .getByRole('button', { name: 'Kiểm tra kho & khả năng phục vụ', exact: true })
      .click();
    const stockDialog = admin.getByRole('dialog', { name: 'Kiểm tra nguyên liệu - Bàn ' + code });
    await expect(stockDialog).toContainText('số lượng tồn thực tế chưa được điều chỉnh');
    await expect(stockDialog.getByText('Không tính tiền - 0 đ', { exact: true })).toBeVisible();
    const tablePayment = stockDialog.getByRole('region', {
      name: 'Thanh toán cả bàn',
      exact: true,
    });
    await expect(tablePayment).toContainText(
      'Món đang kiểm tra không tính tiền. Số tiền bên dưới là của cả bàn, không phải riêng món này.',
    );
    await expect(
      tablePayment.getByRole('heading', { name: 'Thanh toán cả bàn', exact: true }),
    ).toBeVisible();
    for (const label of ['Đã thanh toán (sau hoàn)', 'Còn phải thanh toán']) {
      await expect(
        tablePayment
          .locator(':scope > .inbox-facts > div')
          .filter({ hasText: label })
          .locator('dd'),
      ).toHaveText('0 đ');
    }
    await expect(tablePayment.locator(':scope > .inbox-facts > div')).toHaveCount(3);
    await expect(tablePayment.getByText('Đã hoàn cho khách', { exact: true })).toHaveCount(0);
    await expect(tablePayment.getByText('Còn chờ hoàn tiền món', { exact: true })).toHaveCount(0);
    await expect(stockDialog).toContainText(
      'Khách chưa thanh toán. Món bị dừng không tính tiền, nên không cần hoàn tiền.',
    );
    await expect(stockDialog.getByRole('button', { name: 'Kiểm tra & hoàn tiền' })).toHaveCount(0);
    await admin.screenshot({ path: info.outputPath('admin-stock-follow-up.png'), scale: 'css' });
    await expect(stockDialog.getByLabel('Đã kiểm tra và xử lý gì?', { exact: true })).toHaveCount(
      0,
    );
    await expect(stockDialog.locator('textarea')).toHaveCount(0);
    await expect(
      stockDialog.getByRole('heading', { name: 'Kết quả kiểm tra', exact: true }),
    ).toHaveCount(0);
    await stockDialog.getByRole('button', { name: 'Hoàn tất kiểm tra', exact: true }).click();
    await admin
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(stockDialog).toHaveCount(0);
    await expect(staffDialog.locator('.alert-card')).toHaveCount(0);
    await expect(staffDialog.locator('.latest-table-job')).toHaveCount(0);
    const updatedCatalog = await (await admin.request.get('/api/core/catalog')).json();
    expect(
      updatedCatalog.products.find((p: { id: string }) => p.id === product.id).availability_status,
    ).toBe('UNAVAILABLE');
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
