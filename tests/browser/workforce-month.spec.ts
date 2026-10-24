import { test, expect, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
import { createDatabase } from '../../packages/database/src/index.js';
import { restaurantId } from '../../packages/database/src/seed.js';
import { generateWorkforceHistory } from '../../scripts/restaurant-workforce-history.js';

async function selectTimesheetMonth(page: Page, month: string) {
  const picker = page.getByLabel('Tháng chấm công', { exact: true });
  const timesheet = page.locator('.wf-timesheets');
  await expect(timesheet).toHaveAttribute('aria-busy', 'false');
  if ((await picker.inputValue()) !== month) {
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/core/workforce' &&
        url.searchParams.get('from') === month + '-01' &&
        response.ok()
      );
    });
    await picker.fill(month);
    await loaded;
  }
  await expect(picker).toHaveValue(month);
  await expect(timesheet).toHaveAttribute('aria-busy', 'false');
}

let reviewDay: string;
let reviewShiftName: string;
let reviewAssignmentId: string;
test.beforeAll(async ({ browserName }, info) => {
  void browserName;
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/thesis_browser_[a-f0-9]+$/.test(url.pathname))
    throw Error('Workforce verification requires the isolated browser database.');
  const db = createDatabase(url.toString());
  try {
    await generateWorkforceHistory(db, {
      restaurantId,
      from: '2026-09-01',
      through: '2026-10-03',
      now: new Date('2026-10-04T08:00:00+07:00'),
      datasetKey: 'browser-workforce-v3',
      apply: true,
    });
    reviewDay = (
      { desktop: '2026-10-04', mobile: '2026-10-05', 'webkit-mobile': '2026-10-06' } as Record<
        string,
        string
      >
    )[info.project.name]!;
    reviewShiftName = 'Ca đối chiếu giờ nghỉ - ' + info.project.name;
    const admin = await db.prisma.app_user.findFirstOrThrow({
      where: { username: 'quyettruong05' },
    });
    const person = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'bep001' } });
    const start = new Date(reviewDay + 'T07:00:00+07:00'),
      end = new Date(reviewDay + 'T16:00:00+07:00');
    const shiftFacts = {
      restaurant_id: restaurantId,
      code: 'CA-KIEM-TRA-' + info.project.name,
      name: reviewShiftName,
      starts_at: start,
      ends_at: end,
      break_minutes: 60,
      hourly_rate_override: null,
      created_by: admin.id,
    };
    // A failed test restarts its worker and reruns beforeAll against the same database.
    // Recorded shifts are immutable, so reuse matching facts without issuing an UPDATE.
    const shift =
      (await db.prisma.work_shift.findUnique({
        where: {
          restaurant_id_code: {
            restaurant_id: restaurantId,
            code: shiftFacts.code,
          },
        },
      })) ?? (await db.prisma.work_shift.create({ data: shiftFacts }));
    expect(shift, 'A reused review shift must retain all expected immutable facts').toMatchObject({
      ...shiftFacts,
      template_id: null,
      scheduled_date: null,
      template_version: null,
      attendance_grace_minutes: 15,
      clock_in_early_minutes: 15,
      clock_out_late_minutes: 120,
    });
    const assignment = await db.prisma.shift_assignment.upsert({
      where: { shift_id_user_id: { shift_id: shift.id, user_id: person.id } },
      update: {},
      create: {
        restaurant_id: restaurantId,
        shift_id: shift.id,
        user_id: person.id,
        starts_at: start,
        ends_at: end,
        assigned_by: admin.id,
      },
    });
    reviewAssignmentId = assignment.id;
    await db.prisma.attendance_record.upsert({
      where: { assignment_id: assignment.id },
      update: {},
      create: {
        restaurant_id: restaurantId,
        assignment_id: assignment.id,
        checked_in_at: start,
        checked_out_at: end,
      },
    });
  } finally {
    await db.close();
  }
});

test('a ca with a scheduled break requires explicit break times and is approved with classified personal pay', async ({
  page,
}) => {
  // Include month-table rendering, approval and persisted payroll checks in the scenario budget.
  test.setTimeout(60000);
  await page.bringToFront();
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  await selectAdmin(page, 'Ca làm & lương', 'Chấm công & duyệt');
  await selectTimesheetMonth(page, '2026-10');
  await page.getByRole('button', { name: /^Cần duyệt/ }).click();
  const row = page.locator('.wf-review-queue .wf-queue-row').filter({ hasText: reviewShiftName });
  await expect(row).toBeVisible();
  await expect(row.getByRole('checkbox')).toHaveCount(0);
  await row.getByRole('button', { name: 'Kiểm tra ca này', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Duyệt công của ca', exact: true });
  await expect(dialog).toContainText('Chọn giờ bắt đầu và kết thúc nghỉ');
  await dialog.getByLabel('Bắt đầu nghỉ', { exact: true }).fill(reviewDay + 'T09:00');
  await dialog.getByLabel('Kết thúc nghỉ', { exact: true }).fill(reviewDay + 'T10:00');
  await dialog
    .getByLabel('Lý do duyệt hoặc điều chỉnh giờ công', { exact: true })
    .fill('Đã đối chiếu chấm công và xác nhận nghỉ từ 09:00 đến 10:00.');
  await expect(dialog.locator('.wf-pay-breakdown-total')).toContainText('520.000');
  await dialog.getByRole('button', { name: 'Duyệt công', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true });
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith('/core/workforce/assignments/' + reviewAssignmentId + '/approve') &&
      r.request().method() === 'POST',
  );
  await confirm.getByRole('button', { name: 'Duyệt công', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(row).toHaveCount(0);
  const db = createDatabase(process.env.DATABASE_URL!);
  try {
    const saved = await db.prisma.attendance_record.findUniqueOrThrow({
      where: { assignment_id: reviewAssignmentId },
    });
    expect(saved.approved_minutes).toBe(480);
    expect(saved.hourly_rate_snapshot).toBe(65000n);
    expect(saved.amount).toBe(520000n);
    expect(saved.rate_source).toBe('EMPLOYEE');
    expect(saved.paid_periods).toEqual([
      {
        startsAt: new Date(reviewDay + 'T07:00:00+07:00').toISOString(),
        endsAt: new Date(reviewDay + 'T09:00:00+07:00').toISOString(),
        kind: 'REGULAR',
      },
      {
        startsAt: new Date(reviewDay + 'T10:00:00+07:00').toISOString(),
        endsAt: new Date(reviewDay + 'T16:00:00+07:00').toISOString(),
        kind: 'REGULAR',
      },
    ]);
  } finally {
    await db.close();
  }
});

test('monthly attendance and paid salaries remain searchable and exportable with night and holiday evidence', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.bringToFront();
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  await selectAdmin(page, 'Ca làm & lương', 'Chấm công & duyệt');
  await selectTimesheetMonth(page, '2026-09');
  await expect(page.locator('.wf-metrics')).toContainText('14 người');
  await expect(page.locator('.wf-metrics')).toContainText('Không còn ca đã kết thúc chờ duyệt');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1,
    ),
  ).toBe(true);
  if (!info.project.use.isMobile) {
    await expect(page.locator('.wf-month-table tbody tr')).toHaveCount(14);
    await expect(page.locator('.wf-month-table thead th')).toHaveCount(32);
  } else await expect(page.locator('.wf-month-mobile > button')).toHaveCount(14);
  await page.screenshot({
    path: info.outputPath('september-attendance.png'),
    fullPage: !info.project.use.isMobile,
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất bảng công', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('bang-cong-2026-09.csv');
  await page.getByRole('textbox', { name: 'Tìm tên hoặc mã nhân viên…' }).fill('pv008');
  const detailButton = info.project.use.isMobile
    ? page.locator('.wf-month-mobile > button').first()
    : page.locator('.wf-sticky-person button').first();
  await detailButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('giữ nguyên dấu chấm ra bị thiếu');
  const holiday = dialog.locator('.wf-person-days > article').filter({ hasText: '02/09' });
  await holiday.locator('summary').click();
  await expect(holiday.locator('dt').filter({ hasText: 'Cộng làm đêm' })).toBeVisible();
  await expect(holiday.locator('dt').filter({ hasText: 'Cộng làm ngày lễ' })).toBeVisible();
  await expect(holiday).toContainText('Đơn giá cơ bản / giờ');
  await page.screenshot({
    path: info.outputPath('september-person-detail.png'),
    fullPage: !info.project.use.isMobile,
  });
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();

  await selectAdmin(page, 'Ca làm & lương', 'Bảng lương');
  await page
    .locator('.wf-run-table tbody tr')
    .filter({ hasText: '01/09/2026' })
    .getByRole('button', { name: 'Xem bảng lương', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Kỳ lương 01/09/2026 – 30/09/2026', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Đã ghi nhận chi đủ', { exact: true })).toBeVisible();
  await expect(page.locator('.wf-salary-table tbody tr')).toHaveCount(14);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1,
    ),
  ).toBe(true);
  await page.getByLabel('Lọc phiếu theo thanh toán').selectOption('UNPAID');
  await expect(
    page.locator('.wf-salary-table tbody').getByRole('button', { name: /^Xem phiếu / }),
  ).toHaveCount(0);
  await expect(page.locator('.wf-salary-table tbody')).toContainText('Không có phiếu');
  await page.getByLabel('Lọc phiếu theo thanh toán').selectOption('PAID');
  await expect(page.locator('.wf-salary-table tbody tr')).toHaveCount(14);
  await page.screenshot({
    path: info.outputPath('september-payroll.png'),
    fullPage: !info.project.use.isMobile,
  });
  const payrollDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất bảng lương', exact: true }).click();
  expect((await payrollDownload).suggestedFilename()).toMatch(/^bang-luong-/);
  await page.getByRole('button', { name: 'Xem phiếu pv008', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.wf-slip-payment')).toContainText('Đã chi');
  await page.getByRole('dialog').locator('.wf-pay-details summary').first().click();
  await expect(
    page.getByRole('dialog').locator('dt').filter({ hasText: 'Cộng làm đêm' }).first(),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.getByRole('button', { name: '← Danh sách kỳ lương', exact: true }).click();
  await page
    .locator('.wf-run-table tbody tr')
    .filter({ hasText: '01/10/2026' })
    .getByRole('button', { name: 'Xem bảng lương', exact: true })
    .click();
  await expect(page.locator('.wf-progress [aria-current="step"]')).toContainText('Lập nháp');
  await page.getByRole('button', { name: 'Xem phiếu pv008', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.wf-slip-payment')).toContainText(
    'Bản nháp - Chưa phải lương chính thức',
  );
});
