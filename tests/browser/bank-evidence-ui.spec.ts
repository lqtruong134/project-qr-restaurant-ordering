import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Page, type Locator } from '@playwright/test';
import type {
  BankEvidenceContext,
  BankEvidencePreview,
  BankEvidenceProof,
} from '../../packages/contracts/src/bank-evidence';
import type { PaymentReconciliationCase } from '../../packages/contracts/src/payments-online';
import { selectAdmin } from './admin-navigation';
const now = '2026-10-23T03:00:00.000Z';
const id = '11111111-1111-4111-8111-111111111111';
const sid = '22222222-2222-4222-8222-222222222222';
const proofId = '33333333-3333-4333-8333-333333333333';
const prefix = '/api/core/admin/payment-reconciliation/' + id + '/bank-evidence';
function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const imageHeader = Buffer.alloc(13);
imageHeader.writeUInt32BE(1, 0);
imageHeader.writeUInt32BE(1, 4);
imageHeader[8] = 8;
imageHeader[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', imageHeader),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 128, 0, 255]))),
  pngChunk('IEND', Buffer.alloc(0)),
]);
async function setup(page: Page, options: { overpay?: boolean; closed?: boolean } = {}) {
  await page.clock.install({ time: new Date(now) });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const row: PaymentReconciliationCase = {
    id,
    session_id: sid,
    table_code: 'A10',
    session_status: options.closed ? 'CLOSED' : 'ACTIVE',
    amount: '10000',
    paid_amount: '0',
    quarantined_amount: '0',
    recorded_amount: '0',
    allocated_amount: '0',
    unapplied_amount: '0',
    refunded_amount: '0',
    refund_due_amount: '0',
    provider_status: 'PENDING',
    status: 'OPEN',
    reason: 'Chưa đối chiếu được với payOS.',
    last_error: null,
    updated_at: now,
    can_resolve: false,
    resolution_blockers: ['Chưa có bằng chứng ngân hàng.'],
    verified_at: null,
    provider_references: ['MB-STATEMENT-001'],
    verification_source: 'UNVERIFIED',
  };
  const context: BankEvidenceContext = {
    facts: {
      intentId: id,
      sessionId: sid,
      sessionCode: '22222222',
      tableCode: 'A10',
      sessionStatus: row.session_status,
      intentStatus: 'REQUIRES_RECONCILIATION',
      providerStatus: 'PENDING',
      orderCode: '202610230001',
      paymentLinkId: 'isolated-bank-evidence-link',
      quoteAmount: '10000',
      bankReportedAmount: '0',
      recordedAmount: '0',
      appliedAmount: '0',
      outstandingAmount: '20000',
      remainingQuoteAmount: '10000',
      receiverBank: 'MB Bank',
      receiverAccountMasked: '•••• 0010',
      providerReferences: ['MB-STATEMENT-001'],
      createdAt: '2026-10-23T02:50:00.125Z',
      expiresAt: '2026-10-23T03:15:00.125Z',
      canVerify: !options.closed,
      blockers: options.closed
        ? ['Phiên đã đóng; cần xử lý ngoại lệ riêng, không thay đổi hóa đơn đã chốt.']
        : [],
    },
    proofs: [],
    history: [],
  };
  let stale = false,
    previewCount = 0,
    holdConfirm = false,
    releaseConfirm: () => void = () => {};
  await page.route('**/api/workspaces/admin', (route) =>
    route.fulfill({
      json: { user: { id: 'admin', displayName: 'Quản trị', role: 'ADMIN', permissions: [] } },
    }),
  );
  await page.route('**/api/core/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path === prefix) return route.fulfill({ json: context });
      if (path === prefix + '/proof/' + proofId)
        return route.fulfill({
          body: png,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'private,no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      if (path === '/api/core/admin/payment-reconciliation') return route.fulfill({ json: [row] });
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
      if (path === '/api/core/risk') return route.fulfill({ json: { defaults: {}, policies: [] } });
      if (path === '/api/core/reports')
        return route.fulfill({ json: { store: {}, sales: [], payments: [], reconciliation: [] } });
      if (path === '/api/core/admin/overview')
        return route.fulfill({
          status: 503,
          json: { userMessage: 'Không dùng tổng quan trong fixture chứng từ.' },
        });
      return route.fulfill({ json: [] });
    }
    const body = request.postDataJSON();
    writes.push({ path, body });
    if (path === prefix + '/proof') {
      expect(body.data).toBe(png.toString('base64'));
      const proof: BankEvidenceProof = {
        id: proofId,
        mime: 'image/png',
        sha256: 'a'.repeat(64),
        byteSize: png.length,
        uploadedAt: now,
        proofUrl: prefix + '/proof/' + proofId,
      };
      context.proofs.unshift(proof);
      return route.fulfill({ json: proof });
    }
    if (path === prefix + '/preview') {
      expect(body.attested).toBe(true);
      expect(body.proofId).toBe(proofId);
      expect(body.reference).toBe('MB-STATEMENT-001');
      expect(body.bankTransactionAt).toBe('2026-10-23T02:59:00.000Z');
      const amount = options.overpay ? '12000' : '10000';
      expect(body.amount).toBe(amount);
      previewCount++;
      const preview: BankEvidencePreview = {
        token: 'isolated-preview-' + previewCount,
        expiresAt: new Date(Date.parse(now) + 120000).toISOString(),
        canConfirm: true,
        blockers: [],
        facts: context.facts,
        impact: {
          recordedDelta: amount,
          allocatedDelta: '10000',
          unallocatedDelta: options.overpay ? '2000' : '0',
          outstandingAfter: '10000',
        },
      };
      return route.fulfill({ json: preview });
    }
    if (path === prefix + '/confirm') {
      expect(body.attested).toBe(true);
      expect(body.token).toBe('isolated-preview-' + previewCount);
      if (holdConfirm)
        await new Promise<void>((resolve) => {
          releaseConfirm = resolve;
        });
      if (stale)
        return route.fulfill({
          status: 409,
          json: { userMessage: 'Số dư hoặc khoản thu đã thay đổi. Hãy tạo bản xem trước mới.' },
        });
      row.status = options.overpay ? 'OPEN' : 'RESOLVED';
      row.recorded_amount = options.overpay ? '12000' : '10000';
      row.allocated_amount = '10000';
      row.quarantined_amount = '0';
      row.verification_source = 'BANK_ADMIN_VERIFIED';
      context.history = [
        {
          receiptId: 'bank-receipt',
          reference: 'MB-STATEMENT-001',
          amount: options.overpay ? '12000' : '10000',
          confirmedAt: now,
          proofId,
        },
      ];
      context.facts.canVerify = false;
      context.facts.blockers = ['Khoản thu đã được ghi nhận; chỉ xem chứng từ.'];
      row.reason = options.overpay
        ? 'Tiền ngân hàng đã xác minh còn phần chưa phân bổ; cần hoàn từ giao dịch gốc.'
        : 'Quản trị đã đối chiếu ngân hàng.';
      row.unapplied_amount = options.overpay ? '2000' : '0';
      row.refund_due_amount = options.overpay ? '2000' : '0';
      return route.fulfill({
        json: {
          receiptId: 'bank-receipt',
          alreadyProcessed: false,
          verificationSource: 'BANK_ADMIN_VERIFIED',
        },
      });
    }
    throw Error('Unexpected bank evidence mutation: ' + path);
  });
  await page.goto('/workspace/admin');
  await selectAdmin(page, 'Việc cần xử lý', 'Ngoại lệ thanh toán');
  await page.getByRole('button', { name: 'Xác minh qua ngân hàng', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Xác minh tiền thực nhận qua ngân hàng',
    exact: true,
  });
  await expect(
    dialog.getByRole('heading', { name: 'Bàn A10 · Phiên #22222222', exact: true }),
  ).toBeVisible();
  return {
    dialog,
    writes,
    errors,
    row,
    context,
    setStale: (v: boolean) => {
      stale = v;
    },
    hold: () => {
      holdConfirm = true;
    },
    release: () => releaseConfirm(),
  };
}
async function fillEvidence(dialog: Locator, amount = '10000') {
  await dialog.getByLabel('Số tiền thực nhận (đ)', { exact: true }).fill(amount);
  await dialog
    .getByLabel('Thời điểm ngân hàng (giờ Việt Nam)', { exact: true })
    .fill('2026-10-23T09:59');
  await dialog
    .getByLabel('Lý do đối chiếu', { exact: true })
    .fill('Đã kiểm tra trực tiếp giao dịch tiền vào trong ứng dụng ngân hàng nhà hàng.');
  await dialog
    .getByLabel('Ảnh chứng từ ngân hàng', { exact: false })
    .setInputFiles({ name: 'bank-statement.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByText('Chứng từ đã lưu · 1 KB', { exact: true })).toBeVisible();
  await dialog
    .getByRole('checkbox', { name: /Tôi đã đối chiếu trực tiếp giao dịch tiền vào/ })
    .check();
}
async function preview(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Xem trước việc ghi nhận', exact: true }).click();
  await expect(
    dialog.getByRole('region', { name: 'Xem trước tác động tiền', exact: true }),
  ).toBeVisible();
}
test('admin verifies independent bank evidence in two steps with protected proof and honest source', async ({
  page,
}, info) => {
  const f = await setup(page);
  await expect(f.dialog.getByLabel('Mã giao dịch ngân hàng', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await expect(f.dialog).toContainText('MB Bank •••• 0010');
  await fillEvidence(f.dialog);
  await f.dialog.getByRole('button', { name: 'Xem chứng từ đã lưu', exact: true }).click();
  await expect(f.dialog.getByAltText('Chứng từ ngân hàng dành riêng cho quản trị')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  await expect(f.dialog.getByAltText('Chứng từ ngân hàng dành riêng cho quản trị')).toBeVisible();
  await expect
    .poll(() =>
      f.dialog
        .getByAltText('Chứng từ ngân hàng dành riêng cho quản trị')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await preview(f.dialog);
  const impact = f.dialog.getByRole('region', { name: 'Xem trước tác động tiền', exact: true });
  await expect(impact).toContainText('Quản trị đối chiếu ngân hàng');
  await expect(
    impact.getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true }),
  ).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => f.dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
      .toBe(true);
  }
  await f.dialog.screenshot({
    path: info.outputPath('bank-evidence-preview.png'),
    animations: 'disabled',
  });
  await impact.getByRole('checkbox', { name: /Tôi xác nhận chứng cứ và tác động/ }).check();
  await impact
    .getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true })
    .click();
  await expect(f.dialog).toHaveCount(0);
  await page.getByLabel('Trạng thái hồ sơ', { exact: true }).selectOption('RESOLVED');
  await expect(page.getByLabel('Nguồn xác minh thanh toán', { exact: true })).toContainText(
    'Quản trị đã đối chiếu ngân hàng',
  );
  expect(f.row.paid_amount).toBe('0');
  expect(f.row.recorded_amount).toBe('10000');
  expect(f.writes.map((w) => w.path)).toEqual([
    prefix + '/proof',
    prefix + '/preview',
    prefix + '/confirm',
  ]);
  await page.getByRole('button', { name: 'Xem chứng từ ngân hàng', exact: true }).click();
  await expect(
    f.dialog.getByRole('button', { name: 'Xem trước việc ghi nhận', exact: true }),
  ).toBeDisabled();
  await f.dialog.getByText('Lịch sử quản trị xác minh ngân hàng', { exact: true }).click();
  await expect(
    f.dialog.getByRole('link', { name: 'Xem chứng từ ngân hàng', exact: true }),
  ).toHaveAttribute('href', prefix + '/proof/' + proofId);
  expect(f.errors).toEqual([]);
});
test('editing evidence invalidates the preview and final attestation without recording money', async ({
  page,
}) => {
  const f = await setup(page);
  await fillEvidence(f.dialog);
  await preview(f.dialog);
  await f.dialog.getByRole('checkbox', { name: /Tôi xác nhận chứng cứ và tác động/ }).check();
  await f.dialog
    .getByLabel('Lý do đối chiếu', { exact: true })
    .fill('Bổ sung đối chiếu nội dung sao kê và mã giao dịch ngân hàng.');
  await expect(
    f.dialog.getByRole('region', { name: 'Xem trước tác động tiền', exact: true }),
  ).toHaveCount(0);
  await expect(
    f.dialog.getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true }),
  ).toHaveCount(0);
  expect(f.row.recorded_amount).toBe('0');
  expect(f.writes.filter((w) => w.path.endsWith('/confirm'))).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
test('expired preview cannot submit bank confirmation', async ({ page }) => {
  const f = await setup(page);
  await fillEvidence(f.dialog);
  await preview(f.dialog);
  await page.clock.fastForward(121000);
  await expect(
    f.dialog.getByText('Bản xem trước đã hết hạn. Vui lòng xem trước lại.', { exact: true }),
  ).toBeVisible();
  await expect(
    f.dialog.getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true }),
  ).toBeDisabled();
  expect(f.writes.filter((w) => w.path.endsWith('/confirm'))).toHaveLength(0);
  expect(f.row.recorded_amount).toBe('0');
  expect(f.errors).toEqual([]);
});
test('stale server state clears confirmation and requires a fresh preview before retry', async ({
  page,
}) => {
  const f = await setup(page);
  await fillEvidence(f.dialog);
  await preview(f.dialog);
  f.setStale(true);
  await f.dialog.getByRole('checkbox', { name: /Tôi xác nhận chứng cứ và tác động/ }).check();
  await f.dialog
    .getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true })
    .click();
  await expect(f.dialog.getByRole('alert')).toContainText('Số dư hoặc khoản thu đã thay đổi');
  await expect(
    f.dialog.getByRole('region', { name: 'Xem trước tác động tiền', exact: true }),
  ).toHaveCount(0);
  expect(f.row.recorded_amount).toBe('0');
  f.setStale(false);
  await preview(f.dialog);
  await f.dialog.getByRole('checkbox', { name: /Tôi xác nhận chứng cứ và tác động/ }).check();
  await f.dialog
    .getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true })
    .click();
  await expect(f.dialog).toHaveCount(0);
  expect(f.writes.filter((w) => w.path.endsWith('/preview'))).toHaveLength(2);
  expect(f.row.recorded_amount).toBe('10000');
  expect(f.errors).toEqual([]);
});
test('confirmed excess money is shown separately from bill allocation and refunds remain pending', async ({
  page,
}) => {
  const f = await setup(page, { overpay: true });
  await fillEvidence(f.dialog, '12000');
  await preview(f.dialog);
  const impact = f.dialog.getByRole('region', { name: 'Xem trước tác động tiền', exact: true });
  await expect(
    impact.locator('dl').filter({ has: page.getByText('Ghi nhận thực thu', { exact: true }) }),
  ).toContainText('12.000 đ');
  await expect(impact.locator('dd')).toHaveText(['12.000 đ', '10.000 đ', '2.000 đ', '10.000 đ']);
  await impact.getByRole('checkbox', { name: /Tôi xác nhận chứng cứ và tác động/ }).check();
  await impact
    .getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true })
    .click();
  await expect(f.dialog).toHaveCount(0);
  expect(f.row.refund_due_amount).toBe('2000');
  expect(f.row.refunded_amount).toBe('0');
  await expect(
    page.getByRole('button', { name: 'Đóng hồ sơ sau đối chiếu', exact: true }),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
test('closed sessions show an explicit blocker and cannot submit evidence mutations', async ({
  page,
}) => {
  const f = await setup(page, { closed: true });
  await expect(f.dialog).toContainText('Phiên đã đóng; cần xử lý ngoại lệ riêng');
  await expect(f.dialog.getByLabel('Số tiền thực nhận (đ)', { exact: true })).toBeDisabled();
  await expect(
    f.dialog.getByRole('button', { name: 'Xem trước việc ghi nhận', exact: true }),
  ).toBeDisabled();
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
test('double click sends one final bank confirmation while the dialog is locked', async ({
  page,
}) => {
  const f = await setup(page);
  await fillEvidence(f.dialog);
  await preview(f.dialog);
  await f.dialog.getByRole('checkbox', { name: /Tôi xác nhận chứng cứ và tác động/ }).check();
  f.hold();
  await f.dialog
    .getByRole('button', { name: 'Xác nhận ghi nhận tiền ngân hàng', exact: true })
    .dblclick();
  await expect(
    f.dialog.getByRole('button', { name: 'Đang ghi nhận…', exact: true }),
  ).toBeDisabled();
  expect(f.writes.filter((w) => w.path.endsWith('/confirm'))).toHaveLength(1);
  await expect(f.dialog.getByRole('button', { name: 'Đóng', exact: true })).toHaveCount(0);
  f.release();
  await expect(f.dialog).toHaveCount(0);
  expect(f.row.recorded_amount).toBe('10000');
  expect(f.errors).toEqual([]);
});
