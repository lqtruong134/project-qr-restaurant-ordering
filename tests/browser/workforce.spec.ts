import { randomUUID } from 'node:crypto';
import { selectAdmin } from './admin-navigation';
import {
  test as base,
  expect,
  type Page,
  type APIRequestContext,
  type Route,
  type Request,
} from '@playwright/test';
type PayrollEmployee = { id: string; username: string; display_name: string };
const test = base.extend<{
  payrollEmployees: { create: (page: Page, suffix: string) => Promise<PayrollEmployee> };
}>({
  payrollEmployees: [
    async ({ playwright, baseURL }, use, info) => {
      const database = new URL(process.env.DATABASE_URL!);
      if (!/^\/thesis_browser_[a-f0-9]+$/.test(database.pathname))
        throw Error('Payroll fixtures require the isolated browser database.');
      const headers = { origin: new URL(baseURL!).origin, 'x-csrf-protection': '1' };
      const created: PayrollEmployee[] = [];
      let client: APIRequestContext | undefined;
      try {
        await use({
          create: async (page, suffix) => {
            // Capture the ADMIN session after its UI login. A second login would
            // increment auth_version and revoke the browser's existing session.
            client ??= await playwright.request.newContext({
              baseURL,
              storageState: await page.context().storageState(),
            });
            const response = await client.post('/api/core/users', {
              headers,
              data: {
                username: 'wf-' + info.project.name + '-' + suffix + '-' + randomUUID().slice(0, 8),
                name: 'Nhân viên bảng lương ' + suffix + ' ' + info.project.name,
                role: 'STAFF',
                password: process.env.SEED_PASSWORD!,
              },
            });
            expect(response.ok(), await response.text()).toBe(true);
            const employee = (await response.json()) as PayrollEmployee;
            created.push(employee);
            return employee;
          },
        });
      } finally {
        // This copied session uses an independent HTTP context, so teardown needs
        // neither a live browser nor another login. Preserve all payroll history.
        const cleanup = client;
        if (cleanup) {
          try {
            const retired = await Promise.allSettled(
              created.map(async (employee) => {
                const response = await cleanup.patch('/api/core/users/' + employee.id, {
                  headers,
                  timeout: 5000,
                  data: {
                    name: employee.display_name,
                    role: 'STAFF',
                    status: 'INACTIVE',
                    reason: 'Kết thúc tài khoản nhân viên của browser test riêng.',
                  },
                });
                expect(response.ok(), await response.text()).toBe(true);
              }),
            );
            expect(retired.filter((result) => result.status === 'rejected')).toEqual([]);
          } finally {
            await cleanup.dispose();
          }
        }
      }
    },
    { timeout: 30000 },
  ],
});

test.use({ actionTimeout: 15000 });

async function login(page: Page, user: string, role: string) {
  await page.bringToFront();
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(user);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth) + 1,
    ),
  ).toBe(true);
}
test('manager schedules, reviews attendance and closes a readable payroll; employees see only their own finalized slip', async ({
  browser,
  baseURL,
  payrollEmployees,
}, info) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ baseURL, ...info.project.use });
  const staffContext = await browser.newContext({ baseURL, ...info.project.use });
  const page = await context.newPage(),
    staff = await staffContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  staff.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(page, 'quyettruong05', 'admin');
    await selectAdmin(page, 'Ca làm & lương');
    await expect(page.locator('.admin-content > .section-heading h2')).toHaveText('Lịch phân ca');
    await expect(
      page.getByRole('button', { name: 'Tuần theo nhân viên', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Ngày theo ca', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ngày theo ca', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const initialWork = (await (await page.request.get('/api/core/workforce')).json()) as {
      shifts: { id: string; starts_at: string; ends_at: string }[];
      assignments: {
        id: string;
        user_id: string;
        shift_id: string;
        status: string;
        starts_at: string;
        ends_at: string;
      }[];
    };
    const selectedDate = await page.getByLabel('Ngày xem lịch', { exact: true }).inputValue();
    await expect(page.locator('.wf-date-picker > strong')).toHaveText(
      `${selectedDate.slice(8, 10)}/${selectedDate.slice(5, 7)}/${selectedDate.slice(0, 4)}`,
    );
    const dayStart = new Date(selectedDate + 'T00:00:00+07:00').getTime();
    const dayAssignments = initialWork.assignments.filter(
      (a) =>
        a.status === 'ASSIGNED' &&
        new Date(a.starts_at).getTime() < dayStart + 86400000 &&
        new Date(a.ends_at).getTime() > dayStart,
    );
    await expect(page.getByTestId('day-people')).toHaveText(
      `${new Set(dayAssignments.map((a) => a.user_id)).size} người`,
    );
    for (const shift of initialWork.shifts.filter(
      (s) =>
        new Date(s.starts_at).getTime() < dayStart + 86400000 &&
        new Date(s.ends_at).getTime() > dayStart,
    )) {
      await expect(
        page.getByTestId('day-shift-' + shift.id).locator('.wf-roster-person'),
      ).toHaveCount(dayAssignments.filter((a) => a.shift_id === shift.id).length);
    }
    await page.screenshot({
      path: info.outputPath('workforce-day.png'),
      fullPage: !info.project.use.isMobile,
    });
    await page.getByRole('button', { name: 'Tuần theo ca', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Lịch tuần theo ca' })).toBeVisible();
    await noPageOverflow(page);
    await page.screenshot({
      path: info.outputPath('workforce-week.png'),
      fullPage: !info.project.use.isMobile,
    });
    await page.getByRole('button', { name: 'Tuần theo nhân viên', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Lịch tuần theo nhân viên' })).toBeVisible();
    await noPageOverflow(page);
    await page.getByRole('button', { name: 'Ngày theo ca', exact: true }).click();
    await page.getByLabel('Lọc lịch theo bộ phận').selectOption('KITCHEN');
    const team = (await (await page.request.get('/api/core/users')).json()) as {
      id: string;
      role: string;
    }[];
    await expect(page.getByTestId('day-people')).toHaveText(
      `${new Set(dayAssignments.filter((a) => team.some((u) => u.id === a.user_id && u.role === 'KITCHEN')).map((a) => a.user_id)).size} người`,
    );
    await noPageOverflow(page);
    await page.getByLabel('Lọc lịch theo bộ phận').selectOption('all');
    await page.getByLabel('Ngày xem lịch', { exact: true }).fill('2026-12-31');
    await expect(
      page.getByRole('heading', { name: 'Ngày này chưa có ca làm', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('day-people')).toHaveText('0 người');
    await page.getByLabel('Ngày xem lịch', { exact: true }).fill(selectedDate);
    await noPageOverflow(page);
    const headers = { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' };
    const post = async (path: string, data: unknown) => {
      const result = await page.request.post('/api/core/' + path, { headers, data });
      expect(result.ok(), await result.text()).toBe(true);
      return result.json();
    };
    // Other browser scenarios import approved historical work for seeded employees.
    // New employees keep this payroll's rates and attendance independent of that history.
    const employee = await payrollEmployees.create(page, 'first');
    const secondEmployee = await payrollEmployees.create(page, 'second');
    // A background admin GET must be cancelled before the existing full reload tears it down.
    const abortMarker = '__playwright_urgent_read_cleanup__';
    await page.evaluate((marker) => {
      sessionStorage.setItem(marker, '{}');
      sessionStorage.removeItem(marker + '_pagehide');
      window.addEventListener('pagehide', () =>
        sessionStorage.setItem(marker + '_pagehide', 'left'),
      );
      let readSequence = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          location.href,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (
          url.pathname === '/api/core/admin/payment-reconciliation' &&
          method.toUpperCase() === 'GET' &&
          signal
        ) {
          const id = String(++readSequence);
          const record = (state: 'started' | 'aborted' | 'fulfilled' | `rejected:${string}`) => {
            const reads = JSON.parse(sessionStorage.getItem(marker) ?? '{}') as Record<
              string,
              string
            >;
            reads[id] = state;
            sessionStorage.setItem(marker, JSON.stringify(reads));
          };
          record(signal.aborted ? 'aborted' : 'started');
          signal.addEventListener('abort', () => record('aborted'), { once: true });
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          );
          // Correlate the held network request with its own real application signal.
          headers.set('x-playwright-read-id', id);
          return originalFetch(input, { ...init, headers }).then(
            (response) => {
              record('fulfilled');
              return response;
            },
            (error: Error) => {
              // Native navigation can reject before pagehide; the transport then retires this signal.
              record(`rejected:${error.name}`);
              throw error;
            },
          );
        }
        return originalFetch(input, init);
      };
    }, abortMarker);
    let heldRead: Request | undefined;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const holdRead = async (route: Route) => {
      if (
        route.request().method() !== 'GET' ||
        !route.request().headers()['x-playwright-read-id'] ||
        heldRead
      )
        return route.continue();
      heldRead = route.request();
      await readGate;
      // Once its document has navigated, a cancelled request may no longer be continued.
      await route.continue().catch(() => undefined);
    };
    await page.route('**/api/core/admin/payment-reconciliation', holdRead);
    try {
      await expect.poll(() => Boolean(heldRead), { timeout: 10000 }).toBe(true);
      const heldId = heldRead!.headers()['x-playwright-read-id']!;
      expect(heldId).toBeTruthy();
      const heldState = () =>
        page.evaluate(
          ({ marker, id }) =>
            (JSON.parse(sessionStorage.getItem(marker) ?? '{}') as Record<string, string>)[id],
          { marker: abortMarker, id: heldId },
        );
      await expect.poll(heldState).toBe('started');
      await page.reload();
      releaseRead();
      // The held read must terminate without a response. Chromium can retire its signal
      // after native cancellation but before pagehide; WebKit may abort the signal first.
      await expect.poll(heldState).toMatch(/^(?:aborted|rejected:(?:AbortError|TypeError))$/);
      await expect
        .poll(() =>
          page.evaluate((marker) => sessionStorage.getItem(marker + '_pagehide'), abortMarker),
        )
        .toBe('left');
    } finally {
      releaseRead();
      await page.unroute('**/api/core/admin/payment-reconciliation', holdRead);
      await page.evaluate((marker) => {
        sessionStorage.removeItem(marker);
        sessionStorage.removeItem(marker + '_pagehide');
      }, abortMarker);
    }
    const month =
      info.project.name === 'desktop' ? '01' : info.project.name === 'mobile' ? '02' : '03';
    const nextMonth = String(Number(month) + 1).padStart(2, '0');
    await selectAdmin(page, 'Ca làm & lương', 'Đơn giá & chính sách');
    await page.getByRole('button', { name: 'Thêm đơn giá', exact: true }).click();
    const rateDialog = page.getByRole('dialog', { name: 'Thêm đơn giá cơ bản', exact: true });
    await rateDialog.locator('select[name="userId"]').selectOption(employee.id);
    await rateDialog.getByLabel('Đơn giá một giờ (đồng)').fill('35000');
    await rateDialog.getByLabel('Có hiệu lực từ').fill(`2026-${month}-01T00:00`);
    await rateDialog.getByLabel('Lý do / thỏa thuận').fill('Đơn giá của dữ liệu kiểm thử riêng');
    await rateDialog.getByRole('button', { name: 'Lưu đơn giá', exact: true }).click();
    const savedRate = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/core/workforce/pay-rates' &&
        response.request().method() === 'POST',
    );
    await page
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    const rateResponse = await savedRate;
    expect(rateResponse.ok(), await rateResponse.text()).toBe(true);
    expect(await rateResponse.json()).toMatchObject({
      user_id: employee.id,
      hourly_rate: '35000',
    });
    await expect(rateDialog).toHaveCount(0);
    await selectAdmin(page, 'Ca làm & lương', 'Lịch phân ca');
    await selectAdmin(page, 'Ca làm & lương', 'Quản lý ca làm');
    await page.getByRole('button', { name: 'Thêm mẫu ca', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mã mẫu ca', { exact: true }).fill('WF-' + info.project.name);
    await dialog
      .getByLabel('Tên mẫu ca', { exact: true })
      .fill('Ca thử giao diện ' + info.project.name);
    await dialog.getByLabel('Có thời gian nghỉ không tính công', { exact: true }).check();
    await dialog.getByLabel('Thời gian nghỉ không tính công (phút)').fill('30');
    await expect(dialog.locator('.wf-calculation')).toContainText('5 giờ 30 phút');
    await dialog.getByRole('button', { name: 'Tạo mẫu ca', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await noPageOverflow(page);
    await page.screenshot({
      path: info.outputPath('shift-templates.png'),
      fullPage: !info.project.use.isMobile,
    });
    await selectAdmin(page, 'Ca làm & lương', 'Lịch phân ca');
    await page.getByRole('button', { name: 'Phân công nhân viên', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Từ ngày', { exact: true }).fill(`2026-${month}-05`);
    await dialog.getByLabel('Đến ngày (bao gồm)').fill(`2026-${month}-05`);
    await dialog
      .getByRole('checkbox', {
        name: 'Ca thử giao diện ' + info.project.name + ' 09:00 – 15:00',
        exact: true,
      })
      .check();
    await dialog.locator('input[name="userIds"][value="' + employee.id + '"]').check();
    await dialog.getByRole('button', { name: 'Phân công theo mẫu ca', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Phân công theo mẫu ca', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Ngày theo ca', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Ca thử giao diện ' + info.project.name, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('day-people')).toHaveText('1 người');
    await selectAdmin(page, 'Ca làm & lương', 'Chấm công & duyệt');
    await page.bringToFront();
    // Show this employee's review queue before changing the period, rather than
    // editing a native month control while the complete historical grid is loading.
    await page.getByRole('button', { name: /^Cần duyệt/ }).click();
    await page.getByRole('textbox', { name: 'Tìm tên hoặc mã nhân viên…' }).fill(employee.username);
    const timesheet = page.locator('.wf-timesheets');
    await expect(timesheet).toHaveAttribute('aria-busy', 'false');
    const monthPicker = page.getByLabel('Tháng chấm công', { exact: true });
    const targetMonth = '2026-' + month;
    if ((await monthPicker.inputValue()) !== targetMonth) {
      const loaded = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === '/api/core/workforce' &&
          url.searchParams.get('from') === targetMonth + '-01' &&
          response.ok()
        );
      });
      await monthPicker.fill(targetMonth);
      await loaded;
    }
    await expect(monthPicker).toHaveValue(targetMonth);
    await expect(timesheet).toHaveAttribute('aria-busy', 'false');
    await noPageOverflow(page);
    const reviewButton = page.getByRole('button', { name: 'Kiểm tra ca này', exact: true });
    if (info.project.use.isMobile) {
      const box = await reviewButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(info.project.use.viewport!.width + 1);
    }
    await reviewButton.click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Cách tính công').selectOption('EXCEPTION');
    await dialog.getByLabel('Giờ công được duyệt').fill('5');
    await dialog.getByLabel('Phút công được duyệt').fill('30');
    await dialog
      .getByLabel('Lý do duyệt hoặc điều chỉnh giờ công')
      .fill('Dữ liệu kiểm thử riêng: đối chiếu đủ ca, trừ 30 phút nghỉ.');
    await dialog.getByRole('button', { name: 'Duyệt công', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Duyệt công', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Không có ca nào đang chờ trong nhóm này' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Bảng công tháng', exact: true }).click();
    await expect(page.locator('.wf-metrics')).toContainText('192.500 đ');
    await page.screenshot({
      path: info.outputPath('attendance-approved.png'),
      fullPage: !info.project.use.isMobile,
    });
    // A second employee is needed to verify that paying one slip does not mark the whole run paid.
    await post('workforce/pay-rates', {
      userId: secondEmployee.id,
      effectiveFrom: `2026-${month}-01T00:00:00+07:00`,
      hourlyRate: '35000',
      reason: 'Đơn giá nhân viên thứ hai trong test',
    });
    const scheduled = (await (await page.request.get('/api/core/workforce')).json()).shifts.find(
      (s: { name: string }) => s.name === 'Ca thử giao diện ' + info.project.name,
    );
    const secondAssignment = await post('workforce/assignments', {
      userId: secondEmployee.id,
      shiftId: scheduled.id,
    });
    await post('workforce/assignments/' + secondAssignment.id + '/approve', {
      minutes: 330,
      approvalMode: 'FULL',
      outcome: 'MISSED_CLOCK',
      note: 'Đối chiếu đủ ca cho nhân viên thứ hai',
    });
    await selectAdmin(page, 'Ca làm & lương', 'Bảng lương');
    await page.getByRole('button', { name: 'Lập bảng lương nháp', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Từ ngày (bao gồm)').fill(`2026-${month}-01`);
    await dialog.getByLabel('Đến trước ngày (không bao gồm)').fill(`2026-${nextMonth}-01`);
    await dialog.getByRole('button', { name: 'Tạo bản nháp' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .locator('.wf-payroll-detail > .wf-panel > .wf-heading')
        .getByText('Bản nháp', { exact: true }),
    ).toBeVisible();
    const lastDay = new Date(Date.UTC(2026, Number(month), 0)).getUTCDate();
    await expect(
      page.getByRole('heading', {
        name: `Kỳ lương 01/${month}/2026 – ${lastDay}/${month}/2026`,
        exact: true,
      }),
    ).toBeVisible();
    await login(staff, employee.username, 'staff');
    await staff.getByRole('button', { name: 'Lịch làm & lương của tôi', exact: true }).click();
    await staff.getByRole('button', { name: 'Phiếu lương', exact: true }).click();
    const personalPay = await staff.request.get('/api/core/payroll/me');
    const before = (await personalPay.json()) as { runs: { id: string; status: string }[] };
    expect(before.runs.every((r) => r.status !== 'DRAFT')).toBe(true);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Thưởng / khấu trừ', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('select[name="slipId"]').selectOption({
      label: employee.display_name + ' - ' + employee.username,
    });
    await dialog.getByLabel('Số tiền (đồng, nhập lớn hơn 0)').fill('7500');
    await dialog.getByLabel('Nội dung và lý do').fill('Thưởng kiểm thử giao diện');
    await dialog.getByRole('button', { name: 'Thêm khoản', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator('.wf-salary-table tbody tr').filter({ hasText: employee.username }),
    ).toContainText('200.000 đ');
    await page.getByRole('button', { name: 'Chốt bảng lương', exact: true }).click();
    const finalizeDialog = page.getByRole('dialog', { name: 'Chốt bảng lương chính thức?' });
    await expect(finalizeDialog).toContainText('Số liệu sẽ được khóa');
    await finalizeDialog.getByRole('button', { name: 'Chốt bảng lương', exact: true }).click();
    await expect(page.getByText('Đã chốt', { exact: true })).toBeVisible();
    await noPageOverflow(page);
    await page.screenshot({
      path: info.outputPath('payroll-finalized.png'),
      fullPage: !info.project.use.isMobile,
    });
    await page.getByRole('button', { name: 'Xem phiếu ' + employee.username, exact: true }).click();
    await page
      .getByRole('button', { name: 'Ghi nhận đã chi cho nhân viên này', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Chứng từ / nội dung chi tiền thực tế')
      .fill('Chứng từ giả trong database kiểm thử riêng');
    await dialog.getByRole('button', { name: 'Xác nhận đã chi cho nhân viên' }).click();
    await page
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('1 / 2 phiếu đã chi', { exact: true })).toBeVisible();
    await expect(page.getByText('Đã ghi nhận chi đủ', { exact: true })).toHaveCount(0);
    await expect(
      page.locator('.wf-salary-table tbody tr').filter({ hasText: employee.username }),
    ).toContainText('Đã chi');
    await page.screenshot({
      path: info.outputPath('payroll-partially-paid.png'),
      fullPage: !info.project.use.isMobile,
    });
    await page
      .getByRole('button', { name: 'Xem phiếu ' + secondEmployee.username, exact: true })
      .click();
    await expect(page.locator('.wf-slip-payment')).toContainText('Đã chốt - Chưa chi');
    await page
      .getByRole('button', { name: 'Ghi nhận đã chi cho nhân viên này', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Chứng từ / nội dung chi tiền thực tế')
      .fill('Chi nhân viên thứ hai trong test');
    await dialog
      .getByRole('button', { name: 'Xác nhận đã chi cho nhân viên', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận' })
      .getByRole('button', { name: 'Xác nhận', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Đã ghi nhận chi đủ', { exact: true })).toBeVisible();
    await staff.bringToFront();
    await staff.getByRole('button', { name: 'Làm mới', exact: true }).click();
    await expect(staff.getByRole('button', { name: 'Xem phiếu lương' }).last()).toBeVisible();
    await staff.getByRole('button', { name: 'Xem phiếu lương' }).last().click();
    await expect(staff.getByRole('dialog').locator('.wf-slip-total')).toContainText('200.000 đ');
    await noPageOverflow(staff);
    await staff.screenshot({
      path: info.outputPath('personal-payslip.png'),
      fullPage: !info.project.use.isMobile,
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([context.close(), staffContext.close()]);
  }
});

for (const [user, role] of [
  ['pv008', 'staff'],
  ['bep006', 'kitchen'],
]) {
  test(`${role} has a clear personal shift, weekly schedule, history and empty payslip view`, async ({
    page,
  }, info) => {
    const employeeCode =
      (role === 'staff' ? 'pv00' : 'bep00') +
      (info.project.name === 'desktop' ? '4' : info.project.name === 'mobile' ? '5' : '6');
    void user;
    await login(page, 'quyettruong05', 'admin');
    const users = (await (await page.request.get('/api/core/users')).json()) as {
      id: string;
      username: string;
    }[];
    const employee = users.find((u) => u.username === employeeCode)!;
    const starts = new Date(Date.now() - 5 * 60000).toISOString(),
      ends = new Date(Date.now() + 65 * 60000).toISOString();
    const bodyHeaders = { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' };
    const workforce = (await (await page.request.get('/api/core/workforce')).json()) as {
      assignments: {
        id: string;
        user_id: string;
        status: string;
        starts_at: string;
        ends_at: string;
      }[];
    };
    for (const a of workforce.assignments.filter(
      (a) =>
        a.user_id === employee.id &&
        a.status === 'ASSIGNED' &&
        a.starts_at < ends &&
        a.ends_at > starts,
    )) {
      const cancelled = await page.request.post(
        '/api/core/workforce/assignments/' + a.id + '/cancel',
        { headers: bodyHeaders, data: { reason: 'Tách ca kiểm thử nút chấm công' } },
      );
      expect(cancelled.ok()).toBe(true);
    }
    const shiftResponse = await page.request.post('/api/core/workforce/shifts', {
      headers: bodyHeaders,
      data: {
        code: 'CLOCK-' + role + '-' + info.project.name,
        name: 'Ca thử chấm công',
        startsAt: starts,
        endsAt: ends,
        breakMinutes: 30,
      },
    });
    expect(shiftResponse.ok()).toBe(true);
    const shift = (await shiftResponse.json()) as { id: string };
    const assigned = await page.request.post('/api/core/workforce/assignments', {
      headers: bodyHeaders,
      data: { shiftId: shift.id, userId: employee.id },
    });
    expect(assigned.ok()).toBe(true);
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page).toHaveURL(/login/);
    await login(page, employeeCode, role!);
    await page.getByRole('button', { name: 'Lịch làm & lương của tôi', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Lịch của bạn theo ngày và tuần' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Theo ngày', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.locator('.wf-agenda-shift').filter({ hasText: 'Ca thử chấm công' }),
    ).toBeVisible();
    await expect(page.locator('.wf-clock-card')).toBeVisible();
    await page.getByRole('button', { name: 'Vào ca', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ra ca', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ra ca', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ra ca', exact: true })).toHaveCount(0);
    await noPageOverflow(page);
    await page.screenshot({
      path: info.outputPath(role + '-personal-day.png'),
      fullPage: !info.project.use.isMobile,
    });
    await page.getByRole('button', { name: 'Cả tuần', exact: true }).click();
    await page.screenshot({
      path: info.outputPath(role + '-personal-week.png'),
      fullPage: !info.project.use.isMobile,
    });
    await noPageOverflow(page);
    await page.getByRole('button', { name: 'Tuần sau', exact: true }).click();
    const shifts = page.locator('.wf-personal-week .wf-shift');
    await expect(shifts.first()).toBeVisible();
    await shifts.first().click();
    await expect(page.getByRole('dialog')).toContainText('Ca làm của bạn');
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByRole('button', { name: 'Lịch sử chấm công', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Giờ công của bạn' })).toBeVisible();
    await page.getByLabel('Phân loại', { exact: true }).selectOption('pending');
    const clockedHistory = page
      .locator('.wf-personal-history tbody tr')
      .filter({ hasText: 'Ca thử chấm công' });
    await expect(clockedHistory).toHaveCount(1);
    await expect(clockedHistory.getByText('Đã ra ca - chờ duyệt', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Phiếu lương', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Phiếu lương đã chốt', exact: true }),
    ).toBeVisible();
    // Historical-data scenarios can legitimately provide this employee with finalized slips.
    // Exercise an empty search result instead of assuming their payroll history is absent.
    await page
      .getByRole('textbox', { name: 'Tìm kỳ lương…', exact: true })
      .fill('KHONG-CO-KY-LUONG-UI');
    await expect(page.getByRole('heading', { name: 'Chưa có phiếu lương phù hợp' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xem phiếu lương', exact: true })).toHaveCount(0);
    await noPageOverflow(page);
  });
}
