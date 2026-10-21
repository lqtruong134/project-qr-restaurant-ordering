import { expect, test, type Page } from '@playwright/test';
import type { PaymentReconciliationCase } from '../../packages/contracts/src/payments-online';
import { selectAdmin } from './admin-navigation';

const at = '2026-10-19T09:00:00+07:00';
function paymentCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-fixture',
    session_id: 'session-ffc78214',
    table_code: 'A01',
    session_status: 'ACTIVE',
    amount: '5000',
    paid_amount: '5000',
    recorded_amount: '0',
    allocated_amount: '0',
    unapplied_amount: '0',
    refund_due_amount: '0',
    refunded_amount: '0',
    quarantined_amount: '5000',
    provider_status: 'PAID',
    updated_at: at,
    last_error: null,
    reason: 'Tài khoản nhận tiền không khớp bằng chứng của khoản thu.',
    status: 'OPEN',
    provider_references: ['PAYOS-TRUSTED-REFERENCE-FIXTURE'],
    acknowledged_at: null,
    acknowledged_by_name: null,
    verified_at: null,
    resolved_at: null,
    resolution_note: null,
    can_resolve: false,
    resolution_blockers: ['Chưa xác minh được đúng tài khoản nhận. Chưa ghi tiền vào sổ.'],
    ...overrides,
  } as PaymentReconciliationCase;
}
async function fixture(page: Page, initial: PaymentReconciliationCase[]) {
  const rows = initial;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  let stale = false,
    unavailable = false;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/workspaces/admin', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'admin-fixture',
          displayName: 'Quản trị thử nghiệm',
          role: 'ADMIN',
          permissions: [],
        },
      },
    }),
  );
  await page.route('**/api/core/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path === '/api/core/admin/payment-reconciliation')
        return route.fulfill({
          status: unavailable ? 503 : 200,
          json: unavailable ? { userMessage: 'Fixture tạm thời mất kết nối.' } : rows,
        });
      if (path === '/api/core/catalog')
        return route.fulfill({ json: { products: [], categories: [] } });
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
      if (path === '/api/core/admin/overview')
        return route.fulfill({
          status: 503,
          json: { userMessage: 'Không dùng số liệu tổng quan trong fixture này.' },
        });
      return route.fulfill({ json: [] });
    }
    const body = request.postDataJSON();
    writes.push({ path, body });
    if (path.endsWith('/acknowledge')) {
      Object.assign(rows[0]!, { acknowledged_at: at, acknowledged_by_name: 'Quản trị thử nghiệm' });
      return route.fulfill({ json: { status: 'ok' } });
    }
    if (path.endsWith('/resolve')) {
      if (stale)
        return route.fulfill({
          status: 409,
          json: {
            userMessage: 'Khoản hoàn chưa hoàn tất. Dữ liệu đã thay đổi; hãy đối chiếu lại.',
          },
        });
      if (!rows[0]!.can_resolve)
        return route.fulfill({
          status: 409,
          json: { userMessage: 'Chưa đủ bằng chứng để đóng hồ sơ.' },
        });
      Object.assign(rows[0]!, {
        status: 'RESOLVED',
        resolved_at: at,
        resolution_note: 'Đã đối chiếu đủ giao dịch và tiền hoàn.',
      });
      return route.fulfill({ json: { status: 'ok' } });
    }
    if (path.endsWith('/refresh'))
      return route.fulfill({ json: { status: 'REQUIRES_RECONCILIATION' } });
    throw new Error('Unexpected admin fixture mutation: ' + path);
  });
  await page.goto('/workspace/admin');
  await expect(page.getByRole('navigation', { name: 'Quản trị', exact: true })).toBeVisible();
  return {
    rows,
    writes,
    errors,
    rejectResolution: (value: boolean) => {
      stale = value;
    },
    unavailable: (value: boolean) => {
      unavailable = value;
    },
  };
}
async function openCentre(page: Page) {
  await selectAdmin(page, 'Việc cần xử lý', 'Ngoại lệ thanh toán');
  return page.getByRole('region', { name: 'Đối soát thanh toán online', exact: true });
}
async function fact(page: Page, title: string) {
  return page
    .locator('.online-reconciliation-facts > div')
    .filter({ has: page.locator('span').filter({ hasText: new RegExp('^' + title + '$') }) })
    .locator('strong');
}

test('normal automatically handled payments create no admin exception work or forms', async ({
  page,
}) => {
  const f = await fixture(page, []);
  const panel = await openCentre(page);
  await expect(panel).toContainText('0 hồ sơ ngoại lệ đang chờ');
  await expect(panel).toContainText('Không có khoản online cần đối soát');
  await expect(panel.getByRole('button', { name: 'Tiếp nhận kiểm tra', exact: true })).toHaveCount(
    0,
  );
  await expect(panel.getByRole('textbox')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /Đóng hồ sơ sau đối chiếu/ })).toHaveCount(0);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('known provider reference is read only and acknowledgement never verifies or records bank money', async ({
  page,
}, info) => {
  const f = await fixture(page, [paymentCase()]);
  await expect(page.getByRole('button', { name: /1 ngoại lệ thanh toán/ })).toBeVisible();
  const panel = await openCentre(page);
  await expect(await fact(page, 'Số tiền yêu cầu')).toHaveText('5.000 đ');
  await expect(await fact(page, 'payOS báo đã nhận')).toHaveText('5.000 đ');
  await expect(await fact(page, 'Đã ghi sổ giao dịch')).toHaveText('0 đ');
  await expect(await fact(page, 'Đã tính vào tiền món')).toHaveText('0 đ');
  await panel.getByText('Xem đối chiếu và bằng chứng', { exact: true }).click();
  await expect(panel.locator('code')).toHaveText('PAYOS-TRUSTED-REFERENCE-FIXTURE');
  await expect(panel.getByLabel(/Mã giao dịch|tham chiếu sao kê/i)).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /Đóng hồ sơ sau đối chiếu/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Tiếp nhận kiểm tra', exact: true }).click();
  await expect(panel).toContainText('Đã tiếp nhận · còn cần xử lý');
  await expect(panel).toContainText('Chưa đủ bằng chứng xác minh');
  await expect(panel).toContainText('1 hồ sơ ngoại lệ đang chờ');
  expect(f.rows[0]!.recorded_amount).toBe('0');
  expect(f.rows[0]!.allocated_amount).toBe('0');
  expect(f.rows[0]!.verified_at).toBeNull();
  expect(f.writes).toEqual([
    { path: '/api/core/admin/payment-reconciliation/intent-fixture/acknowledge', body: {} },
  ]);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const card = panel.locator('.online-reconciliation-card').first();
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
  }
  await panel.screenshot({
    path: info.outputPath('payment-admin-320.png'),
    animations: 'disabled',
  });
  expect(f.errors).toEqual([]);
});

test('overpayment keeps requested received recorded allocated unapplied and refunds separate', async ({
  page,
}) => {
  const f = await fixture(page, [
    paymentCase({
      amount: '10000',
      paid_amount: '12000',
      recorded_amount: '12000',
      allocated_amount: '10000',
      unapplied_amount: '2000',
      refund_due_amount: '2000',
      quarantined_amount: '0',
      verified_at: at,
      reason: 'Khách chuyển dư 2.000đ so với số tiền yêu cầu.',
      resolution_blockers: ['Còn 2.000đ cần hoàn từ đúng giao dịch gốc.'],
    }),
  ]);
  const panel = await openCentre(page);
  await expect(await fact(page, 'Số tiền yêu cầu')).toHaveText('10.000 đ');
  await expect(await fact(page, 'payOS báo đã nhận')).toHaveText('12.000 đ');
  await expect(await fact(page, 'Đã ghi sổ giao dịch')).toHaveText('12.000 đ');
  await expect(await fact(page, 'Đã tính vào tiền món')).toHaveText('10.000 đ');
  await expect(await fact(page, 'Chưa phân bổ vào tiền món')).toHaveText('2.000 đ');
  await expect(await fact(page, 'Còn cần hoàn của cả phiên')).toHaveText('2.000 đ');
  await expect(await fact(page, 'Đã hoàn thực tế')).toHaveText('0 đ');
  await expect(panel).toContainText('Chưa thể đóng hồ sơ');
  await expect(
    panel.getByRole('button', { name: 'Mở xử lý hoàn tiền tại bàn', exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: /Đóng hồ sơ sau đối chiếu|Đã trả|Đã nhận tiền/ }),
  ).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test('closing a verified case rechecks server conditions and preserves read only history', async ({
  page,
}) => {
  const f = await fixture(page, [
    paymentCase({
      recorded_amount: '5000',
      allocated_amount: '5000',
      quarantined_amount: '0',
      verified_at: at,
      can_resolve: true,
      resolution_blockers: [],
      acknowledged_at: at,
      reason: 'Bằng chứng đã khớp; chờ kết thúc hồ sơ kiểm tra.',
    }),
  ]);
  const panel = await openCentre(page);
  f.rejectResolution(true);
  await panel.getByRole('button', { name: 'Đóng hồ sơ sau đối chiếu', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng hồ sơ', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Khoản hoàn chưa hoàn tất');
  expect(f.rows[0]!.status).toBe('OPEN');
  expect(f.rows[0]!.allocated_amount).toBe('5000');
  f.rejectResolution(false);
  await panel.getByRole('button', { name: 'Đóng hồ sơ sau đối chiếu', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng hồ sơ', exact: true }).click();
  await expect(panel).toContainText('0 hồ sơ ngoại lệ đang chờ');
  await panel.getByLabel('Trạng thái hồ sơ', { exact: true }).selectOption('RESOLVED');
  await expect(panel).toContainText('Đã đóng và lưu lịch sử');
  await panel.getByText('Xem đối chiếu và bằng chứng', { exact: true }).click();
  await expect(panel).toContainText('PAYOS-TRUSTED-REFERENCE-FIXTURE');
  await expect(panel).toContainText('Đã đối chiếu đủ giao dịch và tiền hoàn.');
  await expect(
    panel.getByRole('button', {
      name: /Tiếp nhận kiểm tra|Đóng hồ sơ sau đối chiếu|Đối chiếu lại với payOS/,
    }),
  ).toHaveCount(0);
  expect(
    f.writes.every(
      (write) => JSON.stringify(write.body) === JSON.stringify({ resolution: 'RECONCILED' }),
    ),
  ).toBe(true);
  expect(f.rows[0]!.allocated_amount).toBe('5000');
  expect(f.rows[0]!.refunded_amount).toBe('0');
  expect(f.errors).toEqual([]);
});

test('background updates remove resolved cases from pending and retain last data on connection failure', async ({
  page,
}) => {
  await page.clock.install();
  const f = await fixture(page, [paymentCase()]);
  const panel = await openCentre(page);
  await expect(panel).toContainText('1 hồ sơ ngoại lệ đang chờ');
  f.unavailable(true);
  await page.clock.fastForward(6000);
  await expect(panel.getByRole('alert')).toContainText('Dữ liệu gần nhất được giữ lại');
  await expect(panel).toContainText('1 hồ sơ ngoại lệ đang chờ');
  await expect(panel).not.toContainText('Không có khoản online cần đối soát');
  f.unavailable(false);
  Object.assign(f.rows[0]!, { status: 'RESOLVED', resolved_at: at });
  await page.clock.fastForward(6000);
  await expect(panel).toContainText('0 hồ sơ ngoại lệ đang chờ');
  await expect(panel).toContainText('Không có khoản online cần đối soát');
  expect(f.writes).toEqual([]);
});

test('admin provider refresh uses the admin route and never converts a provider-only result into verified money', async ({
  page,
}) => {
  const f = await fixture(page, [paymentCase()]);
  const panel = await openCentre(page);
  await panel.getByRole('button', { name: 'Đối chiếu lại với payOS', exact: true }).click();
  await expect(panel).toContainText('Chưa đủ bằng chứng xác minh');
  await expect(await fact(page, 'Đã ghi sổ giao dịch')).toHaveText('0 đ');
  await expect(await fact(page, 'Đã tính vào tiền món')).toHaveText('0 đ');
  await expect(
    panel.getByRole('button', { name: 'Đóng hồ sơ sau đối chiếu', exact: true }),
  ).toHaveCount(0);
  expect(f.writes).toEqual([
    { path: '/api/core/admin/payment-reconciliation/intent-fixture/refresh', body: {} },
  ]);
  expect(f.rows[0]!.status).toBe('OPEN');
  expect(f.rows[0]!.verified_at).toBeNull();
});

test('unmatched signed notifications remain separate and cannot be assigned or marked paid by admin', async ({
  page,
}) => {
  const f = await fixture(page, []);
  await page.route('**/api/core/admin/payment-webhooks/unmatched', (route) =>
    route.fulfill({
      json: [
        {
          id: 'webhook-fixture',
          orderCode: '991122',
          amount: '9000',
          currency: 'VND',
          reference: 'UNMATCHED-REFERENCE-FIXTURE',
          receivedAt: at,
        },
      ],
    }),
  );
  const panel = await openCentre(page);
  const inbox = panel.getByRole('region', {
    name: 'Thông báo payOS chưa khớp khoản thu',
    exact: true,
  });
  await expect(panel).toContainText('0 hồ sơ ngoại lệ đang chờ');
  await expect(inbox).toContainText('9.000 đ');
  await expect(inbox).toContainText('UNMATCHED-REFERENCE-FIXTURE');
  await expect(inbox).toContainText('Chưa xác nhận đã nhận tiền cho bàn.');
  await expect(inbox.getByRole('button')).toHaveCount(0);
  await expect(inbox.getByRole('textbox')).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test('one payOS overpayment creates one admin work link when it already covers the whole refund alert', async ({
  page,
}) => {
  const f = await fixture(page, [
    paymentCase({
      recorded_amount: '12000',
      allocated_amount: '10000',
      unapplied_amount: '2000',
      refund_due_amount: '2000',
      quarantined_amount: '0',
    }),
  ]);
  const summary = page.getByRole('region', { name: 'Tóm tắt việc cần xử lý', exact: true });
  await expect(summary).toContainText('Việc cần xử lý - 1');
  await page.route('**/api/core/alerts', (route) =>
    route.fulfill({
      json: [
        {
          id: 'refund-alert',
          alert_type: 'REFUND_REQUIRED',
          session_id: 'session-ffc78214',
          table_code: 'A01',
          refund_due_amount: '2000',
          status: 'OPEN',
        },
      ],
    }),
  );
  await page
    .getByRole('navigation', { name: 'Quản trị', exact: true })
    .getByRole('button', { name: 'Tải lại dữ liệu', exact: true })
    .click();
  await expect(summary).toContainText('Việc cần xử lý - 1');
  await expect(
    summary.getByRole('button', { name: '1 ngoại lệ thanh toán', exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByRole('button', { name: /bàn cần hoàn tiền|1 cần hoàn tiền/ }),
  ).toHaveCount(0);
  expect(f.rows[0]!.unapplied_amount).toBe('2000');
  expect(f.rows[0]!.refund_due_amount).toBe('2000');
  expect(f.writes).toEqual([]);
});
