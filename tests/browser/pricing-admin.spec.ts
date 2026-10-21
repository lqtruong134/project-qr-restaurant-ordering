import { test, expect, type Page, type Locator } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
import type { DiscountProgram, TaxSettings } from '../../packages/contracts/src/billing';

const catalog = {
  categories: [{ id: 'rice', code: 'COM', name: 'Cơm', is_active: true }],
  products: [
    {
      id: 'dish',
      code: 'COM-01',
      name: 'Cơm tấm sườn nướng dùng cùng đồ chua và nước mắm riêng',
      base_price: '79000',
      version: 3,
      is_active: true,
      category_id: 'rice',
      product_kind: 'DISH',
      availability_status: 'AVAILABLE',
    },
    {
      id: 'combo',
      code: 'COMBO-01',
      name: 'Combo cơm trưa',
      base_price: '99000',
      version: 1,
      is_active: true,
      category_id: 'combo-category',
      product_kind: 'COMBO',
      availability_status: 'AVAILABLE',
    },
  ],
};
async function fixture(page: Page) {
  const programs: DiscountProgram[] = [];
  const tax: TaxSettings = {
    priceIncludesVat: true,
    current: {
      id: 'policy1',
      effectiveAt: '2026-01-01T00:00:00+07:00',
      defaultRatePercent: 8,
      version: 1,
      reason: 'Chính sách áp dụng cho nhóm hàng đủ điều kiện',
      createdAt: '2026-01-01T00:00:00+07:00',
    },
    policies: [],
    products: [
      {
        id: 'dish',
        code: 'COM-01',
        name: catalog.products[0]!.name,
        treatment: 'DEFAULT',
        ratePercent: null,
        version: 3,
      },
    ],
  };
  tax.policies = [
    tax.current!,
    {
      id: 'policy2',
      effectiveAt: '2027-01-01T00:00:00+07:00',
      defaultRatePercent: 10,
      version: 2,
      reason: 'Kết thúc kỳ giảm VAT',
      createdAt: '2026-10-13T00:00:00+07:00',
    },
  ];
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  let conflict = false;
  await page.route('**/api/workspaces/admin', (route) =>
    route.fulfill({
      json: {
        user: { id: 'admin', displayName: 'Quản trị nhà hàng', role: 'ADMIN', permissions: [] },
      },
    }),
  );
  await page.route('**/api/core/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method();
    if (method === 'GET') {
      if (path === '/api/core/catalog') return route.fulfill({ json: catalog });
      if (path === '/api/core/admin/discount-programs') return route.fulfill({ json: programs });
      if (path.endsWith('/history'))
        return route.fulfill({
          json: {
            versions: [
              {
                version: 1,
                changedAt: '2026-10-13T00:00:00+07:00',
                changedBy: 'Quản trị nhà hàng',
                action: 'CREATE',
                snapshot: programs[0],
              },
            ],
            redemptions: [],
          },
        });
      if (path === '/api/core/admin/tax-policies') return route.fulfill({ json: tax });
      if (path.startsWith('/api/core/admin/overview'))
        return route.fulfill({
          status: 503,
          json: { userMessage: 'Không dùng tổng quan trong kiểm thử giao diện này.' },
        });
      if (path === '/api/core/inventory')
        return route.fulfill({
          json: {
            units: [],
            ingredients: [],
            locations: [],
            balances: [],
            movements: [],
            receipts: [],
            recipes: [],
            recipeItems: [],
          },
        });
      if (path === '/api/core/reports')
        return route.fulfill({ json: { store: {}, sales: [], payments: [], reconciliation: [] } });
      if (path === '/api/core/risk') return route.fulfill({ json: { defaults: {}, policies: [] } });
      return route.fulfill({ json: [] });
    }
    const body = req.postDataJSON();
    writes.push({ path, method, body });
    if (path.startsWith('/api/core/admin/discount-programs')) {
      if (conflict)
        return route.fulfill({
          status: 409,
          json: { userMessage: 'Chương trình đã được cập nhật. Tải lại trước khi sửa.' },
        });
      if (method === 'POST')
        programs.push({
          ...body,
          id: 'program1',
          version: 1,
          usedCount: 0,
          reservedCount: 0,
          createdAt: new Date().toISOString(),
        } as DiscountProgram);
      if (method === 'PATCH')
        programs[0] = { ...programs[0], ...body, version: programs[0]!.version + 1 };
      if (method === 'DELETE')
        programs[0] = { ...programs[0]!, status: 'ARCHIVED', version: programs[0]!.version + 1 };
      return route.fulfill({ json: programs[0] });
    }
    if (path === '/api/core/admin/tax-policies' && method === 'POST') {
      tax.policies.push({
        ...body,
        id: 'policy' + (tax.policies.length + 1),
        version: tax.policies.length + 1,
        createdAt: new Date().toISOString(),
      } as TaxSettings['policies'][number]);
      return route.fulfill({ json: tax.policies.at(-1) });
    }
    if (path === '/api/core/products/dish/tax' && method === 'PATCH') {
      tax.products[0] = { ...tax.products[0]!, ...body, version: 4 };
      return route.fulfill({ json: tax.products[0] });
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({
      status: 500,
      json: { userMessage: 'Blocked unexpected fixture mutation' },
    });
  });
  await page.goto('/workspace/admin');
  await expect(page.getByRole('navigation', { name: 'Quản trị', exact: true })).toBeVisible();
  return {
    programs,
    tax,
    writes,
    unexpected,
    conflict: () => {
      conflict = true;
    },
    clearConflict: () => {
      conflict = false;
    },
  };
}

async function fits(dialog: Locator) {
  const geometry = await dialog.evaluate((node) => ({
    overflow: Array.from(node.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        text: el.textContent?.slice(0, 50),
        width: el.clientWidth,
        scroll: el.scrollWidth,
      })),
    width: node.clientWidth,
    scroll: node.scrollWidth,
    fields: Array.from(node.querySelectorAll('input:not([type=checkbox]),select,textarea')).map(
      (el) => {
        const bounds = el.getBoundingClientRect(),
          body = node.querySelector('.dialog-body')!.getBoundingClientRect();
        return {
          width: bounds.width,
          left: bounds.left - body.left,
          right: body.right - bounds.right,
        };
      },
    ),
  }));
  expect(geometry.scroll, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width + 1);
  for (const field of geometry.fields) {
    expect(field.width).toBeGreaterThan(100);
    expect(field.left).toBeGreaterThanOrEqual(-1);
    expect(field.right).toBeGreaterThanOrEqual(-1);
  }
}

test('promotion CRUD validates money, keeps combo excluded, handles conflicts and preserves archived history', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const state = await fixture(page);
  await selectAdmin(page, 'Khuyến mãi & VAT', 'Chương trình khuyến mãi');
  await expect(page.getByText('Chưa có chương trình khuyến mãi', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Thêm chương trình', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm chương trình khuyến mãi', exact: true });
  await dialog.getByLabel('Tên chương trình', { exact: true }).fill('Ưu đãi bữa trưa');
  await dialog.getByLabel('Cách áp dụng', { exact: true }).selectOption('CODE');
  await dialog.getByLabel('Mã giảm giá', { exact: true }).fill('BUATRUA');
  await dialog.getByLabel('Tỷ lệ giảm (%)', { exact: true }).fill('101');
  await dialog.getByRole('button', { name: 'Lưu chương trình', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Tỷ lệ giảm');
  expect(state.writes).toHaveLength(0);
  await dialog.getByLabel('Tỷ lệ giảm (%)', { exact: true }).fill('10');
  await dialog.getByLabel('Giảm tối đa (đồng)', { exact: true }).fill('50000');
  await dialog.getByLabel('Tiền món tối thiểu (đồng)', { exact: true }).fill('300000');
  await dialog.getByLabel('Phạm vi áp dụng', { exact: true }).selectOption('PRODUCTS');
  await expect(dialog.getByRole('checkbox', { name: /Combo cơm trưa/ })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: /Cơm tấm sườn nướng/ }).check();
  const checkboxes = await dialog.locator('label.policy-consent').evaluateAll((labels) =>
    labels.map((label) => {
      const input = label.querySelector('input')!.getBoundingClientRect(),
        span = label.querySelector('span')!,
        text = span.getBoundingClientRect();
      return {
        width: input.width,
        height: input.height,
        gap: text.left - input.right,
        offset: Math.abs(
          input.top +
            input.height / 2 -
            text.top -
            parseFloat(getComputedStyle(span).lineHeight) / 2,
        ),
      };
    }),
  );
  for (const checkbox of checkboxes) {
    expect(checkbox.width).toBe(18);
    expect(checkbox.height).toBe(18);
    expect(checkbox.gap).toBe(10);
    expect(checkbox.offset).toBeLessThanOrEqual(2);
  }

  for (const width of info.project.use.isMobile ? [390, 320] : [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(dialog);
  }
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 1440 : 390, height: 1000 });
  await dialog.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('discount-editor.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Lưu chương trình', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Đã thêm chương trình khuyến mãi.' }),
  ).toBeVisible();
  expect(state.writes[0]!.body).toMatchObject({
    excludeCombos: true,
    code: 'BUATRUA',
    percent: 10,
    maxDiscountAmount: '50000',
    minEligibleAmount: '300000',
    productIds: ['dish'],
    status: 'PAUSED',
  });
  const card = page.getByRole('article', { name: 'Khuyến mãi Ưu đãi bữa trưa', exact: true });
  await card.getByRole('button', { name: 'Bật chương trình', exact: true }).click();
  await expect(card.getByText('Đang bật', { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath('discount-list.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await card.getByRole('button', { name: 'Sửa điều kiện', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Sửa chương trình khuyến mãi', exact: true });
  await edit.getByLabel('Tên chương trình', { exact: true }).fill('Nội dung chưa lưu');
  await edit.getByRole('button', { name: 'Đóng', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Bỏ thay đổi chưa lưu?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Tiếp tục chỉnh sửa', exact: true }).click();
  await expect(edit.getByLabel('Tên chương trình', { exact: true })).toHaveValue(
    'Nội dung chưa lưu',
  );
  state.conflict();
  await edit.getByRole('button', { name: 'Lưu chương trình', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('Tải lại trước khi sửa');
  await edit.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Bỏ thay đổi chưa lưu?', exact: true })
    .getByRole('button', { name: 'Bỏ thay đổi', exact: true })
    .click();
  await card.getByRole('button', { name: 'Lịch sử & lượt dùng', exact: true }).click();
  const history = page.getByRole('dialog', {
    name: 'Lịch sử khuyến mãi — Ưu đãi bữa trưa',
    exact: true,
  });
  await expect(history.getByText('Phiên bản 1', { exact: true })).toBeVisible();
  await expect(
    history.getByText('Chưa có phiên bàn sử dụng chương trình.', { exact: true }),
  ).toBeVisible();
  await history.getByRole('button', { name: 'Đóng', exact: true }).click();
  state.clearConflict();
  await card.getByRole('button', { name: 'Lưu trữ', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Lưu trữ khuyến mãi?', exact: true })
    .getByRole('button', { name: 'Lưu trữ', exact: true })
    .click();
  await expect(card.getByText('Đã lưu trữ', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Sửa điều kiện', exact: true })).toHaveCount(0);
  await expect(
    card.getByRole('button', { name: 'Lịch sử & lượt dùng', exact: true }),
  ).toBeVisible();
  expect(state.programs).toHaveLength(1);
  expect(state.unexpected).toEqual([]);
});

test('VAT uses standard rates, distinguishes exempt from zero, and appends scheduled policy without rewriting history', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const state = await fixture(page);
  await selectAdmin(page, 'Khuyến mãi & VAT', 'Giá & VAT');
  await expect(page.getByText('Giá thực đơn đã bao gồm VAT', { exact: true })).toBeVisible();
  await expect(page.getByText('VAT mặc định 10%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Phân loại VAT', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Phân loại VAT —/ });
  await dialog.getByLabel('Phân loại VAT', { exact: true }).selectOption('TAXABLE');
  const rates = dialog.getByLabel('Thuế suất riêng', { exact: true });
  expect(
    await rates
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value)),
  ).toEqual(['8', '10', '5', '0']);
  await rates.selectOption('0');
  await expect(
    dialog.getByText('Không chịu VAT khác với chịu VAT ở thuế suất 0%.', { exact: false }),
  ).toBeVisible();
  await dialog.getByLabel('Phân loại VAT', { exact: true }).selectOption('EXEMPT');
  await expect(rates).toHaveCount(0);
  await dialog
    .getByLabel('Lý do phân loại', { exact: true })
    .fill('Đối chiếu nhóm hàng của món theo hồ sơ kế toán');
  for (const width of info.project.use.isMobile ? [390, 320] : [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(dialog);
  }
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 1440 : 390, height: 1000 });
  await dialog.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({
    path: info.outputPath('vat-product-editor.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Lưu phân loại VAT', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.writes[0]!.body).toMatchObject({
    treatment: 'EXEMPT',
    ratePercent: null,
    version: 3,
  });
  await page.getByRole('button', { name: 'Lập phiên bản thay thế', exact: true }).click();
  const replacement = page.getByRole('dialog', { name: 'Lập chính sách VAT mới', exact: true });
  await expect(
    replacement.getByLabel('Thời điểm hiệu lực · giờ Việt Nam', { exact: true }),
  ).toHaveValue('2027-01-01T00:00');
  await expect(
    replacement.getByLabel('Thời điểm hiệu lực · giờ Việt Nam', { exact: true }),
  ).toHaveAttribute('readonly', '');
  await replacement.getByLabel('Mức VAT mặc định', { exact: true }).selectOption('5');
  await replacement
    .getByLabel('Căn cứ / lý do thay đổi', { exact: true })
    .fill('Thay phiên bản kế hoạch theo căn cứ phân loại hàng');
  await replacement.getByRole('button', { name: 'Lưu chính sách VAT', exact: true }).click();
  await expect(replacement).toBeHidden();
  await expect(page.getByText('Đã thay thế', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lập chính sách mới', exact: true }).click();
  const policy = page.getByRole('dialog', { name: 'Lập chính sách VAT mới', exact: true });
  await policy.getByLabel('Mức VAT mặc định', { exact: true }).selectOption('10');
  await policy
    .getByLabel('Thời điểm hiệu lực · giờ Việt Nam', { exact: true })
    .fill('2027-02-01T00:00');
  await policy
    .getByLabel('Căn cứ / lý do thay đổi', { exact: true })
    .fill('Chính sách mới theo thời điểm hiệu lực');
  await policy.getByRole('button', { name: 'Lưu chính sách VAT', exact: true }).click();
  await expect(policy).toBeHidden();
  expect(state.tax.policies).toHaveLength(4);
  expect(state.tax.policies[0]!.defaultRatePercent).toBe(8);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: info.outputPath('vat-policies.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(state.writes.at(-1)!.body).toMatchObject({
    effectiveAt: '2027-01-31T17:00:00.000Z',
    defaultRatePercent: 10,
  });
  expect(state.unexpected).toEqual([]);
});

test('admin incident preview uses the saved discounted item amount without estimating refunds from the table balance', async ({
  page,
}) => {
  const state = await fixture(page);
  const issue = {
    id: 'discounted-item',
    session_id: 'discount-session',
    table_code: 'A11',
    product_name_snapshot: 'Khoai tây chiên',
    quantity: 1,
    status: 'ISSUE_REPORTED',
    version: 1,
    reported_reason_code: 'QUALITY_ISSUE',
    reported_at: new Date().toISOString(),
    reported_by_name: 'Nhân viên bếp',
    line_total: '49000',
    has_charge: true,
  };
  await page.route('**/api/core/order-exceptions*', (route) => route.fulfill({ json: [issue] }));
  await page.route('**/api/core/reports/sessions/discount-session', (route) =>
    route.fulfill({
      json: {
        exceptions: [],
        bill: {
          session: { id: 'discount-session', table_code: 'A11' },
          participants: [],
          charges: [],
          intents: [],
          payments: [],
          refunds: [],
          generatedAt: new Date().toISOString(),
          account: {
            id: 'account',
            charge_total: '44100',
            paid_total: '44100',
            refunded_total: '0',
            outstanding_amount: '0',
            refund_due_amount: '0',
          },
          billing: {
            version: 1,
            priceIncludesVat: true,
            subtotalAmount: '49000',
            discountAmount: '4900',
            payableAmount: '44100',
            beforeVatAmount: '40833',
            vatAmount: '3267',
            legacyTaxUnavailable: false,
            promotion: {
              id: 'program1',
              name: 'Ưu đãi bữa trưa',
              code: null,
              status: 'USED',
              locked: true,
              eligibleAmount: '49000',
              discountAmount: '4900',
              reason: null,
            },
            vatGroups: [
              {
                treatment: 'TAXABLE',
                ratePercent: 8,
                beforeVatAmount: '40833',
                vatAmount: '3267',
                totalAmount: '44100',
              },
            ],
            lines: [
              {
                chargeId: 'charge1',
                orderItemId: 'discounted-item',
                grossAmount: '49000',
                discountAmount: '4900',
                payableAmount: '44100',
                beforeVatAmount: '40833',
                vatAmount: '3267',
                taxTreatment: 'TAXABLE',
                vatRatePercent: 8,
                promotionId: 'program1',
              },
            ],
          },
        },
      },
    }),
  );
  await selectAdmin(page, 'Việc cần xử lý', 'Món & nguyên liệu');
  await page.getByRole('button', { name: 'Kiểm tra & quyết định', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Món & kho cần xử lý - Bàn A11', exact: true });
  const preview = dialog.getByText('Nếu xác nhận lỗi nhà hàng:', { exact: false });
  await expect(preview).toContainText('bỏ tính tiền 44.100 đ');
  await expect(preview).toContainText('đối chiếu tiền đã phân bổ theo từng giao dịch');
  await expect(preview).toContainText('Khoản cần hoàn và tiền món còn thiếu được xử lý riêng');
  await expect(preview).toContainText('khách chỉ nhận lại tiền khi có xác nhận hoàn thực tế');
  await expect(preview).not.toContainText('49.000 đ');
  await expect(dialog.locator('.billing-payable dd')).toHaveText('44.100 đ');
  await expect(dialog.locator('.billing-discount dd')).toHaveText('−4.900 đ');
  expect(state.writes).toHaveLength(0);
  expect(state.unexpected).toEqual([]);
});

test('sales reports distinguish discounts, included VAT and gross margin, while legacy VAT stays unavailable', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const state = await fixture(page);
  let legacy = false,
    empty = false;
  await page.route('**/api/core/admin/reports?*', (route) => {
    const view = new URL(route.request().url()).searchParams.get('view');
    return route.fulfill({
      json: {
        scope: {
          period: 'month',
          startDay: '2026-10-01',
          endDay: '2026-10-13',
          timezone: 'Asia/Ho_Chi_Minh',
          updatedAt: '2026-10-13T11:00:00Z',
          granularity: 'day',
        },
        summary:
          view === 'reconciliation'
            ? { sessions: 1, balanced: 1, outstanding: '0', refundDue: '0' }
            : {
                subtotal: empty ? '0' : '100000',
                discountAmount: empty ? '0' : '10000',
                sales: empty ? '0' : '90000',
                vat: empty ? '0' : '6667',
                beforeVatSales: empty ? '0' : legacy ? null : '83333',
                cost: empty ? '0' : '40000',
                margin: empty ? '0' : legacy ? null : '43333',
                quantity: empty ? '0' : '1',
                legacyTaxUnavailable: empty ? false : legacy,
              },
        rows: empty
          ? []
          : view === 'reconciliation'
            ? [
                {
                  id: 'report-session',
                  table_code: 'A11',
                  at: '2026-10-13T11:00:00Z',
                  payable: '90000',
                  collected: '90000',
                  refunded: '0',
                  balance: '0',
                  subtotal: '100000',
                  discountAmount: '10000',
                  vat: '6667',
                  legacyTaxUnavailable: false,
                },
              ]
            : [
                {
                  id: 'report-dish',
                  name: 'Cơm tấm sườn nướng dùng cùng đồ chua và nước mắm riêng',
                  category: 'Cơm',
                  subtotal: '100000',
                  discountAmount: '10000',
                  sales: '90000',
                  vat: '6667',
                  beforeVatSales: legacy ? null : '83333',
                  cost: '40000',
                  margin: legacy ? null : '43333',
                  quantity: '1',
                  legacyTaxUnavailable: legacy,
                },
              ],
        total: empty ? 0 : 1,
        page: 1,
        pageSize: 10,
        options: [],
        series: [],
        breakdown: [],
      },
    });
  });
  await selectAdmin(page, 'Báo cáo', 'Doanh số món');
  const report = page.getByRole('region', { name: 'Báo cáo quản trị', exact: true });
  await expect(report.locator('.report-metrics article')).toHaveCount(8);
  await expect(
    report.locator('.report-metrics article').filter({ hasText: 'Khuyến mãi đã giảm' }),
  ).toContainText('10.000 đ');
  await expect(
    report.locator('.report-metrics article').filter({ hasText: 'Doanh số sau giảm, gồm VAT' }),
  ).toContainText('90.000 đ');
  await expect(
    report.locator('.report-metrics article').filter({ hasText: 'VAT trong doanh số' }),
  ).toContainText('6.667 đ');
  await expect(
    report.locator('.report-metrics article').filter({ hasText: 'Lãi gộp trước chi phí vận hành' }),
  ).toContainText('43.333 đ');
  for (const width of info.project.use.isMobile ? [390, 320] : [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(
      await report.locator('table').evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 1440 : 390, height: 1000 });
  await page.screenshot({
    path: info.outputPath('sales-vat-known.png'),
    fullPage: true,
    animations: 'disabled',
  });
  legacy = true;
  await report.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect(
    report.locator('.report-metrics article').filter({ hasText: 'VAT trong doanh số' }),
  ).toContainText('Chưa có dữ liệu tách VAT');
  await expect(report.locator('td[data-label="Lãi gộp"]')).toContainText(
    'Chưa có dữ liệu tách VAT',
  );
  await expect(report.locator('td[data-label="Lãi gộp"]')).not.toContainText('0 đ');
  await page.screenshot({
    path: info.outputPath('sales-vat-legacy.png'),
    fullPage: true,
    animations: 'disabled',
  });
  empty = true;
  await report.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect(report.getByText('Không có kết quả phù hợp', { exact: true })).toBeVisible();
  empty = false;
  await selectAdmin(page, 'Báo cáo', 'Đối soát phiên');
  await expect(report.locator('td[data-label="Tổng thanh toán"]')).toContainText('90.000 đ');
  await expect(report.locator('td[data-label="Tổng thanh toán"]')).toContainText(
    'Khuyến mãi −10.000 đ',
  );
  await expect(report.locator('td[data-label="Tổng thanh toán"]')).toContainText(
    'Đã gồm VAT 6.667 đ',
  );
  expect(state.unexpected).toEqual([]);
  expect(state.writes).toHaveLength(0);
});
