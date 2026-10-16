import { test, expect, type Page, type Locator } from '@playwright/test';
import { selectAdmin } from './admin-navigation';
type Row = { id: string; [key: string]: unknown };
const person: Row = {
  id: 'pay-person',
  username: 'pv-pay',
  display_name: 'Nguyễn Phương Anh',
  role: 'STAFF',
  status: 'ACTIVE',
};
const chef: Row = {
  id: 'pay-chef',
  username: 'bep-pay',
  display_name: 'Trần Minh Đức',
  role: 'KITCHEN',
  status: 'ACTIVE',
};
const night: Row = {
  id: 'pay-assignment',
  shift_id: 'pay-night',
  user_id: person.id,
  display_name: person.display_name,
  username: person.username,
  role: 'STAFF',
  shift_name: 'Ca đóng cửa',
  status: 'ASSIGNED',
  starts_at: '2025-02-03T22:00:00+07:00',
  ends_at: '2025-02-04T02:00:00+07:00',
  checked_in_at: '2025-02-03T22:00:00+07:00',
  checked_out_at: '2025-02-04T02:00:00+07:00',
  attendance_id: 'pay-attendance',
  attendance_status: 'RECORDED',
  classification: 'NORMAL',
  requires_exception: false,
  scheduled_minutes: 240,
  actual_minutes: 240,
  suggested_minutes: 240,
  late_minutes: 0,
  early_leave_minutes: 0,
  outside_minutes: 0,
  break_minutes: 0,
  hourly_rate_override: '50000',
  effective_hourly_rate: '40000',
  pay_policy_active: true,
  approved_minutes: null,
  amount: '0',
};
type Period = { startsAt: string; endsAt: string; kind: string };
async function mockPay(page: Page, assignment?: Row) {
  const policies: Row[] = [];
  const calendar: Row[] = [];
  const assignments: Row[] = assignment ? [{ ...assignment }] : [];
  const writes: { path: string; body: Record<string, unknown>; method: string }[] = [];
  const unexpected: string[] = [];
  let previewError = '';
  await page.route('**/api/core/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    if (method === 'GET') {
      if (path === '/api/core/users') return route.fulfill({ json: [person, chef] });
      if (path === '/api/core/workforce')
        return route.fulfill({
          json: {
            templates: [],
            shifts: [],
            assignments,
            rates: [
              {
                id: 'person-rate',
                user_id: person.id,
                hourly_rate: '40000',
                effective_from: '2025-01-01T00:00:00+07:00',
              },
              {
                id: 'chef-rate',
                user_id: chef.id,
                hourly_rate: '80000',
                effective_from: '2025-01-01T00:00:00+07:00',
              },
            ],
          },
        });
      if (path === '/api/core/workforce/pay-settings')
        return route.fulfill({
          json: { policies, calendar, timezone: 'Asia/Ho_Chi_Minh', today: '2026-10-10' },
        });
      return route.continue();
    }
    const body = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {};
    writes.push({ path, body, method });
    if (path === '/api/core/workforce/pay-policies') {
      const saved: Row = {
        id: 'pay-policy',
        effective_from: body.effectiveFrom,
        night_premium_percent: body.nightPremiumPercent,
        overtime_weekday_percent: body.overtimeWeekdayPercent,
        rest_day_percent: body.restDayPercent,
        holiday_percent: body.holidayPercent,
      };
      policies.unshift(saved);
      return route.fulfill({ json: saved });
    }
    if (path === '/api/core/workforce/calendar' && method === 'POST') {
      const saved: Row = {
        id: 'pay-calendar-' + calendar.length,
        date: body.date,
        kind: body.kind,
        user_id: body.userId ?? null,
        name: body.name,
      };
      calendar.push(saved);
      return route.fulfill({ json: saved });
    }
    if (path.startsWith('/api/core/workforce/calendar/') && method === 'DELETE') {
      const index = calendar.findIndex((row) => row.id === path.split('/').at(-1));
      if (index >= 0) calendar.splice(index, 1);
      return route.fulfill({ json: { removed: true } });
    }
    if (path === '/api/core/workforce/assignments/pay-assignment/pay-preview') {
      if (previewError) return route.fulfill({ status: 409, json: { userMessage: previewError } });
      const periods = body.paidPeriods as Period[];
      let nightMinutes = 0;
      for (const period of periods)
        for (
          let time = Date.parse(period.startsAt);
          time < Date.parse(period.endsAt);
          time += 60000
        ) {
          const hour = new Date(time + 7 * 3600000).getUTCHours();
          if (hour >= 22 || hour < 6) nightMinutes++;
        }
      const minutes = Number(body.minutes),
        base = Math.round((minutes * 40000) / 60),
        premium = Math.round(((nightMinutes * 40000) / 60) * 0.3),
        amount = String(base + premium);
      return route.fulfill({
        json: {
          approvedMinutes: minutes,
          hourlyRate: '40000',
          amount,
          paidPeriods: periods,
          paySnapshot: { source: 'policy' },
          payComponents: {
            regularMinutes: minutes,
            nightMinutes,
            overtimeMinutes: 0,
            holidayMinutes: 0,
            restDayMinutes: 0,
            paidHolidayMinutes: 0,
            baseAmount: String(base),
            nightAmount: String(premium),
            overtimeAmount: '0',
            restDayAmount: '0',
            holidayAmount: '0',
            paidHolidayAmount: '0',
            totalAmount: amount,
          },
        },
      });
    }
    if (path === '/api/core/workforce/assignments/pay-assignment/approve') {
      assignments[0] = {
        ...assignments[0],
        attendance_status: 'APPROVED',
        classification: 'APPROVED',
        approved_minutes: body.minutes,
        amount: '208000',
      } as Row;
      return route.fulfill({ json: { id: 'pay-attendance', amount: '208000' } });
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({
      status: 500,
      json: { userMessage: 'Unexpected mocked workforce mutation' },
    });
  });
  return {
    writes,
    unexpected,
    calendar,
    policies,
    failPreview: (message: string) => {
      previewError = message;
    },
  };
}
async function login(page: Page, section = 'Đơn giá & chính sách') {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  await selectAdmin(page, 'Ca làm & lương', section);
}
async function confirm(page: Page, label: string) {
  await page
    .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
    .getByRole('button', { name: label, exact: true })
    .click();
}
async function fits320(page: Page, root?: Locator) {
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  if (root)
    expect(await root.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
}
async function review(page: Page) {
  await page.getByLabel('Tháng chấm công', { exact: true }).fill('2025-02');
  await page.getByRole('button', { name: /^Cần duyệt/ }).click();
  await page.getByRole('button', { name: /^Kiểm tra (ca này|& duyệt)$/ }).click();
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('combobox', { name: 'Cách tính công', exact: true }) });
}
test('employee rates, policy and per-person rest calendar have clear feedback and fit a small screen', async ({
  page,
}, info) => {
  const mock = await mockPay(page);
  await login(page);
  await expect(
    page.getByRole('heading', { name: 'Đơn giá cơ bản của từng nhân viên', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.wf-table tbody tr').filter({ hasText: String(person.display_name) }),
  ).toContainText('40.000 đ / giờ');
  await expect(
    page.locator('.wf-table tbody tr').filter({ hasText: String(chef.display_name) }),
  ).toContainText('80.000 đ / giờ');
  await page.getByRole('button', { name: 'Thêm chính sách', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Thêm chính sách tính lương', exact: true });
  await expect(dialog.getByLabel('Trả thêm cho giờ đêm (%)', { exact: true })).toHaveAttribute(
    'min',
    '30',
  );
  await expect(dialog.getByLabel('Lương làm ngày lễ (%)', { exact: true })).toHaveValue('300');
  await fits320(page, dialog);
  await dialog.getByRole('button', { name: 'Lưu chính sách', exact: true }).click();
  await confirm(page, 'Lưu chính sách');
  await expect(
    page.getByRole('status').filter({ hasText: 'Đã lưu chính sách tính lương mới.' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.wf-pay-policy-grid')).toContainText('Cộng 30%');
  await page.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();
  for (const kind of ['HOLIDAY', 'WEEKLY_REST']) {
    await page.getByRole('button', { name: 'Thêm ngày nghỉ', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Thêm ngày lễ hoặc ngày nghỉ', exact: true });
    await dialog
      .getByLabel('Ngày nghỉ', { exact: true })
      .fill(kind === 'HOLIDAY' ? '2026-11-20' : '2026-11-23');
    await dialog.getByRole('combobox', { name: 'Loại ngày', exact: true }).selectOption(kind);
    if (kind === 'WEEKLY_REST')
      await dialog
        .getByRole('combobox', { name: 'Nhân viên', exact: true })
        .selectOption(person.id);
    await dialog
      .getByLabel('Tên ngày nghỉ', { exact: true })
      .fill(kind === 'HOLIDAY' ? 'Ngày lễ của nhà hàng' : 'Ngày nghỉ theo lịch Phương Anh');
    await dialog.getByRole('button', { name: 'Lưu ngày nghỉ', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã thêm ngày nghỉ vào lịch.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();
  }
  const calendar = page.getByRole('region', { name: 'Lịch ngày lễ và ngày nghỉ', exact: true });
  await expect(calendar).toContainText('Nghỉ hằng tuần · Nguyễn Phương Anh');
  await expect(calendar).toContainText('Ngày lễ · Toàn nhà hàng');
  await fits320(page);
  await page.screenshot({ path: info.outputPath('pay-settings-320.png'), fullPage: true });
  await calendar
    .getByRole('combobox', { name: 'Loại ngày', exact: true })
    .selectOption('WEEKLY_REST');
  await expect(calendar.locator('article')).toHaveCount(1);
  await calendar.getByRole('button', { name: 'Gỡ ngày nghỉ', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gỡ ngày nghỉ', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Đã gỡ ngày nghỉ khỏi lịch.' }),
  ).toBeVisible();
  expect(mock.calendar).toHaveLength(1);
  expect(mock.writes[0]!.body).toMatchObject({
    nightPremiumPercent: 30,
    overtimeWeekdayPercent: 150,
    restDayPercent: 200,
    holidayPercent: 300,
  });
  expect(mock.writes.find((write) => write.body.kind === 'WEEKLY_REST')?.body.userId).toBe(
    person.id,
  );
  expect(mock.unexpected).toEqual([]);
});

test('night review previews personal base and night premium before approval and keeps the success notice', async ({
  page,
}, info) => {
  const mock = await mockPay(page, night);
  await login(page, 'Chấm công & duyệt');
  const dialog = await review(page);
  const calculated = dialog.getByRole('region', { name: 'Tiền công dự kiến', exact: true });
  await expect(calculated).toContainText('208.000 đ');
  await expect(calculated).toContainText('160.000 đ');
  await expect(calculated).toContainText('48.000 đ');
  await expect(calculated).not.toContainText('200.000 đ');
  await fits320(page, dialog);
  await page.screenshot({ path: info.outputPath('night-pay-review-320.png'), fullPage: false });
  await dialog.getByRole('button', { name: 'Duyệt công', exact: true }).click();
  await confirm(page, 'Duyệt công');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Đã duyệt giờ công cho Nguyễn Phương Anh.' }),
  ).toBeVisible();
  const approved = mock.writes.find((write) => write.path.endsWith('/approve'))!;
  expect(approved.body).toMatchObject({
    minutes: 240,
    approvalMode: 'FULL',
    outcome: 'WORKED',
    approveExtra: false,
    expectedAmount: '208000',
  });
  expect(approved.body.paidPeriods).toHaveLength(1);
  expect(mock.writes.findIndex((write) => write.path.endsWith('/pay-preview'))).toBeLessThan(
    mock.writes.findIndex((write) => write.path.endsWith('/approve')),
  );
  expect(mock.unexpected).toEqual([]);
});

test('unpaid break requires its real interval and a failed preview preserves inputs without approving old money', async ({
  page,
}, info) => {
  const row = {
    ...night,
    starts_at: '2025-02-03T20:00:00+07:00',
    ends_at: '2025-02-04T00:00:00+07:00',
    checked_in_at: '2025-02-03T20:00:00+07:00',
    checked_out_at: '2025-02-04T00:00:00+07:00',
    break_minutes: 30,
    scheduled_minutes: 210,
    actual_minutes: 210,
    suggested_minutes: 210,
  };
  const mock = await mockPay(page, row);
  await login(page, 'Chấm công & duyệt');
  const dialog = await review(page);
  const calculated = dialog.getByRole('region', { name: 'Tiền công dự kiến', exact: true });
  await expect(calculated).toContainText('Chọn giờ bắt đầu và kết thúc nghỉ');
  expect(mock.writes.filter((write) => write.path.endsWith('/pay-preview'))).toHaveLength(0);
  await dialog.getByLabel('Bắt đầu nghỉ', { exact: true }).fill('2025-02-03T21:00');
  await dialog.getByLabel('Kết thúc nghỉ', { exact: true }).fill('2025-02-03T21:30');
  await expect(calculated).toContainText('164.000 đ');
  await fits320(page, dialog);
  await page.screenshot({ path: info.outputPath('unpaid-break-preview-320.png'), fullPage: false });
  mock.failPreview('Lịch ngày nghỉ vừa thay đổi. Kiểm tra lại trước khi duyệt công.');
  await dialog
    .getByLabel('Lý do duyệt hoặc điều chỉnh giờ công', { exact: true })
    .fill('Đối chiếu ca sau khi lịch nghỉ thay đổi.');
  await expect(calculated.getByRole('alert')).toHaveText(
    'Lịch ngày nghỉ vừa thay đổi. Kiểm tra lại trước khi duyệt công.',
  );
  await expect(calculated).not.toContainText('164.000 đ');
  await expect(dialog.getByLabel('Bắt đầu nghỉ', { exact: true })).toHaveValue('2025-02-03T21:00');
  await dialog.getByRole('button', { name: 'Duyệt công', exact: true }).click();
  await confirm(page, 'Duyệt công');
  await expect(dialog.locator('form > .form-error[role="alert"]')).toHaveText(
    'Lịch ngày nghỉ vừa thay đổi. Kiểm tra lại trước khi duyệt công.',
  );
  expect(mock.writes.filter((write) => write.path.endsWith('/approve'))).toHaveLength(0);
  expect(mock.unexpected).toEqual([]);
});

test('finalized classified payslips show frozen components and expandable evidence for admin, staff and kitchen', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mock = await mockPay(page);
  const run = {
    id: 'pay-frozen-run',
    period_start: '2025-02-01',
    period_end: '2025-03-01',
    status: 'FINALIZED',
    total_amount: '208000',
    employee_count: 1,
  };
  const components = {
    regularMinutes: 240,
    nightMinutes: 240,
    overtimeMinutes: 0,
    restDayMinutes: 0,
    holidayMinutes: 0,
    paidHolidayMinutes: 0,
    baseAmount: '160000',
    nightAmount: '48000',
    overtimeAmount: '0',
    restDayAmount: '0',
    holidayAmount: '0',
    paidHolidayAmount: '0',
    totalAmount: '208000',
  };
  const snapshot = {
    version: 1,
    components,
    segments: [
      {
        startsAt: '2025-02-03T22:00:00+07:00',
        endsAt: '2025-02-04T02:00:00+07:00',
        kind: 'REGULAR',
        dayKind: 'WEEKDAY',
        isNight: true,
        minutes: 240,
        hourlyRate: '40000',
        totalPercent: 130,
        amount: '208000',
      },
    ],
  };
  let currentUser = 'pv001';
  const slip = () => ({
    id: 'pay-frozen-slip',
    payroll_run_id: run.id,
    user_id: currentUser === 'bep001' ? chef.id : person.id,
    username_snapshot: currentUser,
    employee_name_snapshot: currentUser === 'bep001' ? chef.display_name : person.display_name,
    total_amount: '208000',
    work_amount: '208000',
    bonus_amount: '0',
    deduction_amount: '0',
    payment_status: 'UNPAID',
  });
  const lines = [
    {
      id: 'pay-frozen-line',
      payroll_slip_id: 'pay-frozen-slip',
      line_type: 'WORK',
      description: 'Ca đóng cửa · 03/02/2025',
      minutes: 240,
      hourly_rate_snapshot: '40000',
      amount: '208000',
      pay_components: components,
      pay_snapshot: snapshot,
    },
  ];
  // Preserve the existing fail-closed core write route and mock only the saved reads.
  await page.route('**/api/core/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fallback();
    if (path === '/api/core/payroll') return route.fulfill({ json: [run] });
    if (path === '/api/core/history/payroll')
      return route.fulfill({ json: { rows: [run], total: 1, page: 0, pageSize: 20 } });
    if (path === '/api/core/payroll/pay-frozen-run')
      return route.fulfill({ json: { run, slips: [slip()], lines, payments: [] } });
    if (path === '/api/core/payroll/me')
      return route.fulfill({ json: { runs: [run], slips: [slip()], lines } });
    if (path === '/api/core/workforce/me')
      return route.fulfill({ json: { assignments: [], currentAssignments: [] } });
    return route.fallback();
  });
  async function verifySlip(dialog: Locator, role: string) {
    const saved = dialog.locator('.wf-payslip');
    await expect(saved).toContainText('4 giờ');
    await expect(saved).toContainText('208.000 đ');
    await expect(saved).not.toContainText('50.000 đ / giờ');
    const details = saved.locator('details.wf-pay-details');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(details).toContainText('Tiền công cơ bản');
    await expect(details).toContainText('160.000 đ');
    await expect(details).toContainText('Cộng làm đêm');
    await expect(details).toContainText('48.000 đ');
    await expect(details.locator('.wf-pay-breakdown-total')).toHaveText('Tổng tiền công208.000 đ');
    await expect(details.locator('.wf-pay-segments tbody')).toContainText('130%');
    await expect(details.locator('.wf-pay-segments tbody')).toContainText('40.000 đ');
    await expect(details.locator('.wf-pay-segments tbody')).toContainText('4 giờ');
    await fits320(page, dialog);
    await details.scrollIntoViewIfNeeded();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    for (const amount of await details.locator('.wf-pay-breakdown dd').all()) {
      const box = await amount.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    }
    expect(
      await saved
        .locator('.wf-table-scroll')
        .first()
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`frozen-payslip-${role}-320.png`),
      fullPage: false,
    });
    await details.locator('summary').click();
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('.wf-pay-breakdown')).not.toBeVisible();
    await details.locator('summary').click();
    await expect(details.locator('.wf-pay-breakdown-total')).toContainText('208.000 đ');
  }
  await login(page, 'Bảng lương');
  await page.getByRole('button', { name: 'Xem bảng lương', exact: true }).click();
  await page.getByRole('button', { name: 'Xem phiếu pv001', exact: true }).click();
  await verifySlip(
    page.getByRole('dialog', { name: 'Phiếu lương - Nguyễn Phương Anh', exact: true }),
    'admin',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  for (const [username, role] of [
    ['pv001', 'staff'],
    ['bep001', 'kitchen'],
  ]) {
    currentUser = username!;
    await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username!);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('workspace/' + role));
    await page.getByRole('button', { name: 'Lịch làm & lương của tôi', exact: true }).click();
    await page.getByRole('button', { name: 'Phiếu lương', exact: true }).click();
    await page.getByRole('button', { name: 'Xem phiếu lương', exact: true }).click();
    await verifySlip(page.getByRole('dialog', { name: 'Phiếu lương của bạn', exact: true }), role!);
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  expect(mock.writes).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});
