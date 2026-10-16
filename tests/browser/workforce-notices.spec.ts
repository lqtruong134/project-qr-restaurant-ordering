import { test, expect, type Locator, type Page } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

type Row = { id: string; [key: string]: string | number | boolean | null };
type ScheduleBody = {
  from: string;
  to: string;
  templateIds: string[];
  userIds?: string[];
};
const person: Row = {
  id: 'notice-person',
  display_name: 'Nguyễn Phương Anh',
  username: 'NOTICE-01',
  role: 'STAFF',
  status: 'ACTIVE',
};
const morning: Row = {
  id: 'notice-morning',
  code: 'NOTICE_SANG',
  name: 'Ca sáng kiểm thử',
  start_time: '09:00',
  end_time: '15:00',
  ends_next_day: false,
  break_minutes: 0,
  hourly_rate_override: null,
  is_active: true,
  sort_order: 0,
  version: 1,
  scheduled_count: 0,
};
const afternoon: Row = {
  ...morning,
  id: 'notice-afternoon',
  code: 'NOTICE_CHIEU',
  name: 'Ca chiều kiểm thử',
  start_time: '13:00',
  end_time: '18:00',
};
const localDay = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const shiftFor = (day: string): Row => ({
  id: 'notice-shift',
  template_id: morning.id,
  name: String(morning.name),
  starts_at: `${day}T09:00:00+07:00`,
  ends_at: `${day}T15:00:00+07:00`,
  break_minutes: 0,
});
const assignmentFor = (shift: Row): Row => ({
  ...shift,
  id: 'notice-assignment',
  shift_id: shift.id,
  shift_name: String(shift.name),
  user_id: person.id,
  display_name: String(person.display_name),
  username: String(person.username),
  status: 'ASSIGNED',
  attendance_id: null,
  attendance_status: null,
  checked_in_at: null,
  checked_out_at: null,
  approved_minutes: 0,
  amount: '0',
  area_id: null,
  area_name: null,
});

async function mockWorkforce(page: Page, seeded = false) {
  const data = {
    templates: [{ ...morning }, { ...afternoon }],
    shifts: seeded ? [shiftFor(localDay())] : ([] as Row[]),
    assignments: [] as Row[],
    rates: [] as Row[],
  };
  if (seeded) data.assignments.push(assignmentFor(data.shifts[0]!));
  const writes: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  const unexpectedWrites: string[] = [];
  let scheduleError = '',
    templateError = '';
  // Fail closed for every core mutation, so these UI regressions cannot write live business data.
  await page.route('**/api/core/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === 'GET') {
      if (path === '/api/core/workforce') return route.fulfill({ json: data });
      if (path === '/api/core/users') return route.fulfill({ json: [person] });
      if (path === '/api/core/areas')
        return route.fulfill({
          json: [{ id: 'notice-area', name: 'Sảnh chính', is_active: true }],
        });
      return route.continue();
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    writes.push({ path, method, body });
    if (path === '/api/core/workforce/schedule' && method === 'POST') {
      if (scheduleError)
        return route.fulfill({
          status: 409,
          json: { userMessage: scheduleError },
        });
      const values = body as ScheduleBody;
      const createdShifts = data.shifts.length ? 0 : 1;
      if (createdShifts) data.shifts.push(shiftFor(values.from));
      const createdAssignments = values.userIds?.length && !data.assignments.length ? 1 : 0;
      if (createdAssignments) data.assignments.push(assignmentFor(data.shifts[0]!));
      return route.fulfill({
        json: {
          shifts: data.shifts,
          assignments: values.userIds ? data.assignments : [],
          counts: {
            createdShifts,
            existingShifts: createdShifts ? 0 : 1,
            createdAssignments,
            existingAssignments: values.userIds && !createdAssignments ? 1 : 0,
          },
        },
      });
    }
    if (path.startsWith('/api/core/workforce/templates') && ['POST', 'PATCH'].includes(method)) {
      if (templateError)
        return route.fulfill({
          status: 500,
          json: { userMessage: templateError },
        });
      const template: Row = {
        ...morning,
        id: method === 'POST' ? 'notice-created-template' : path.split('/').at(-1)!,
        code: String(body.code),
        name: String(body.name),
        start_time: String(body.startTime),
        end_time: String(body.endTime),
        is_active: method === 'POST' || Boolean(body.isActive),
        version: method === 'POST' ? 1 : Number(body.version) + 1,
      };
      if (method === 'POST') data.templates.push(template);
      else data.templates = data.templates.map((row) => (row.id === template.id ? template : row));
      return route.fulfill({ json: template });
    }
    if (path === '/api/core/workforce/assignments/notice-assignment/cancel' && method === 'POST') {
      data.assignments[0] = { ...data.assignments[0]!, status: 'CANCELLED' };
      return route.fulfill({ json: data.assignments[0] });
    }
    unexpectedWrites.push(`${method} ${path}`);
    return route.fulfill({
      status: 500,
      json: { userMessage: 'Unexpected mocked core mutation' },
    });
  });
  return {
    data,
    writes,
    unexpectedWrites,
    failSchedule: (message: string) => {
      scheduleError = message;
    },
    failTemplate: (message: string) => {
      templateError = message;
    },
  };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/admin/);
  await selectAdmin(page, 'Ca làm & lương', 'Lịch phân ca');
  await expect(page.locator('.wf-schedule')).toBeVisible();
}

async function schedule(page: Page, assign: boolean, day: string) {
  const submit = assign ? 'Phân công theo mẫu ca' : 'Lập lịch theo mẫu ca';
  await page
    .getByRole('button', {
      name: assign ? 'Phân công nhân viên' : submit,
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: submit, exact: true });
  await dialog.getByLabel('Từ ngày', { exact: true }).fill(day);
  await dialog.getByLabel('Đến ngày (bao gồm)', { exact: true }).fill(day);
  await dialog.locator(`input[name="templateIds"][value="${morning.id}"]`).check();
  if (assign) await dialog.locator(`input[name="userIds"][value="${person.id}"]`).check();
  await dialog.getByRole('button', { name: submit, exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
    .getByRole('button', { name: submit, exact: true })
    .click();
}

const notice = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

async function keyboardDismiss(page: Page, message: Locator) {
  const close = message.getByRole('button', {
    name: 'Đóng thông báo',
    exact: true,
  });
  await close.focus();
  await expect(close).toBeFocused();
  await close.press('Enter');
  await expect(message).toHaveCount(0);
}

async function fitsAt320(page: Page, root: Locator) {
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const geometry = await root.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: node.clientWidth,
      scroll: node.scrollWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(321);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
}

test('schedule notices survive modal close, report real changes and describe duplicates without a success claim', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mock = await mockWorkforce(page);
  await login(page);
  const day = '2026-11-05';
  await schedule(page, false, day);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const created = notice(page, /Đã lập.*1 ca/);
  await expect(created).toBeVisible();
  await page.screenshot({ path: info.outputPath('schedule-created-notice.png'), fullPage: false });
  await page.getByRole('button', { name: 'Ngày theo ca', exact: true }).click();
  await expect(page.getByTestId('day-shift-notice-shift')).toBeVisible();
  await expect(created).toBeVisible();
  await keyboardDismiss(page, created);

  await schedule(page, true, day);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const assigned = notice(page, /Đã phân công.*1/);
  await expect(assigned).toBeVisible();
  await expect(page.getByTestId('day-people')).toHaveText('1 người');
  await fitsAt320(page, assigned);
  await page.screenshot({
    path: info.outputPath('schedule-assigned-notice-320px.png'),
    fullPage: false,
  });
  await keyboardDismiss(page, assigned);

  await schedule(page, true, day);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const duplicate = notice(page, 'Lịch và phân công đã có sẵn. Không tạo thêm bản ghi.');
  await expect(duplicate).toBeVisible();
  await expect(duplicate).not.toContainText(/Đã lập|Đã phân công|thành công/i);
  await expect(page.getByTestId('day-shift-notice-shift').locator('.wf-roster-person')).toHaveCount(
    1,
  );
  await fitsAt320(page, duplicate);
  await keyboardDismiss(page, duplicate);

  await schedule(page, false, day);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const existing = notice(page, 'Các ca trong khoảng ngày này đã có sẵn. Không tạo thêm ca.');
  await expect(existing).toBeVisible();
  await expect(existing).not.toContainText(/Đã lập|thành công/i);
  await keyboardDismiss(page, existing);
  expect(mock.writes.map((write) => write.path)).toEqual(
    Array(4).fill('/api/core/workforce/schedule'),
  );
  expect(mock.data.shifts).toHaveLength(1);
  expect(mock.data.assignments).toHaveLength(1);
  expect(mock.unexpectedWrites).toEqual([]);
});

test('overlap rejection remains readable and preserves dates, templates, employee and area for correction', async ({
  page,
}) => {
  test.setTimeout(90000);
  const mock = await mockWorkforce(page);
  const error =
    'Nguyễn Phương Anh có ca trùng giờ ngày 05/11/2026: Ca sáng kiểm thử 09:00 – 15:00 và Ca chiều kiểm thử 13:00 – 18:00. Chưa lưu lịch và phân công.';
  mock.failSchedule(error);
  await login(page);
  await page.getByRole('button', { name: 'Phân công nhân viên', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Phân công theo mẫu ca',
    exact: true,
  });
  await dialog.getByLabel('Từ ngày', { exact: true }).fill('2026-11-05');
  await dialog.getByLabel('Đến ngày (bao gồm)', { exact: true }).fill('2026-11-06');
  await dialog.locator(`input[name="templateIds"][value="${morning.id}"]`).check();
  await dialog.locator(`input[name="templateIds"][value="${afternoon.id}"]`).check();
  await dialog.locator('input[name="userIds"]').check();
  await dialog
    .getByRole('combobox', { name: 'Khu vực phụ trách', exact: true })
    .selectOption('notice-area');
  await dialog.getByRole('button', { name: 'Phân công theo mẫu ca', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
    .getByRole('button', { name: 'Phân công theo mẫu ca', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', {
      name: 'Kiểm tra trước khi xác nhận',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveText(error);
  await expect(dialog.getByLabel('Từ ngày', { exact: true })).toHaveValue('2026-11-05');
  await expect(dialog.getByLabel('Đến ngày (bao gồm)', { exact: true })).toHaveValue('2026-11-06');
  await expect(dialog.locator('input[name="templateIds"]:checked')).toHaveCount(2);
  await expect(dialog.locator('input[name="userIds"]')).toBeChecked();
  await expect(
    dialog.getByRole('combobox', { name: 'Khu vực phụ trách', exact: true }),
  ).toHaveValue('notice-area');
  await expect(page.getByRole('button', { name: 'Đóng thông báo', exact: true })).toHaveCount(0);
  await expect(notice(page, /Đã lập|Đã phân công|thành công/i)).toHaveCount(0);
  await fitsAt320(page, dialog);
  expect(mock.writes).toHaveLength(1);
  expect(mock.data.shifts).toHaveLength(0);
  expect(mock.data.assignments).toHaveLength(0);
  expect(mock.unexpectedWrites).toEqual([]);
});

test('template create and update and assignment cancellation retain notices; a failed save retains the form without success', async ({
  page,
}) => {
  test.setTimeout(90000);
  const mock = await mockWorkforce(page, true);
  await login(page);
  await selectAdmin(page, 'Ca làm & lương', 'Quản lý ca làm');
  await page.getByRole('button', { name: 'Thêm mẫu ca', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Thêm mẫu ca', exact: true });
  await dialog.getByLabel('Mã mẫu ca', { exact: true }).fill('NOTICE_MOI');
  await dialog.getByLabel('Tên mẫu ca', { exact: true }).fill('Ca mới kiểm thử');
  await dialog.getByRole('button', { name: 'Tạo mẫu ca', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const created = notice(page, /Đã tạo mẫu ca/);
  await expect(created).toBeVisible();
  const card = page.locator('.wf-template-card').filter({
    has: page.getByRole('heading', { name: 'Ca mới kiểm thử', exact: true }),
  });
  await expect(card).toBeVisible();
  await keyboardDismiss(page, created);

  await card.getByRole('button', { name: 'Sửa mẫu ca', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Sửa mẫu ca', exact: true });
  await dialog.getByLabel('Tên mẫu ca', { exact: true }).fill('Ca mới đã cập nhật');
  await dialog.getByLabel('Lý do cập nhật', { exact: true }).fill('Điều chỉnh tên ca để đối chiếu');
  await dialog.getByRole('button', { name: 'Cập nhật mẫu ca', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
    .getByRole('button', { name: 'Cập nhật mẫu ca', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const updated = notice(page, /Đã cập nhật mẫu ca/);
  await expect(updated).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Ca mới đã cập nhật', exact: true }),
  ).toBeVisible();
  await fitsAt320(page, updated);
  await keyboardDismiss(page, updated);

  await selectAdmin(page, 'Ca làm & lương', 'Lịch phân ca');
  await page.getByRole('button', { name: 'Ngày theo ca', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Chi tiết Nguyễn Phương Anh - Ca sáng kiểm thử',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog', { name: 'Chi tiết phân công', exact: true })
    .getByRole('button', { name: 'Hủy phân công', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Hủy phân công', exact: true });
  await dialog.getByLabel('Lý do hủy', { exact: true }).fill('Nhân viên đổi ngày nghỉ');
  await dialog.getByRole('button', { name: 'Xác nhận hủy phân công', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Kiểm tra trước khi xác nhận', exact: true })
    .getByRole('button', { name: 'Xác nhận', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const cancelled = notice(page, /Đã hủy phân công/);
  await expect(cancelled).toBeVisible();
  await expect(page.getByTestId('day-people')).toHaveText('0 người');
  await keyboardDismiss(page, cancelled);

  await selectAdmin(page, 'Ca làm & lương', 'Quản lý ca làm');
  mock.failTemplate('Chưa lưu được mẫu ca. Vui lòng thử lại.');
  await page.getByRole('button', { name: 'Thêm mẫu ca', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Thêm mẫu ca', exact: true });
  await dialog.getByLabel('Mã mẫu ca', { exact: true }).fill('NOTICE_FAIL');
  await dialog.getByLabel('Tên mẫu ca', { exact: true }).fill('Ca chưa được lưu');
  await dialog.getByRole('button', { name: 'Tạo mẫu ca', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Chưa lưu được mẫu ca. Vui lòng thử lại.');
  await expect(dialog.getByLabel('Tên mẫu ca', { exact: true })).toHaveValue('Ca chưa được lưu');
  await expect(page.getByRole('button', { name: 'Đóng thông báo', exact: true })).toHaveCount(0);
  await expect(notice(page, /Đã tạo|Đã cập nhật|thành công/i)).toHaveCount(0);
  expect(mock.writes.map((write) => write.method)).toEqual(['POST', 'PATCH', 'POST', 'POST']);
  expect(mock.unexpectedWrites).toEqual([]);
});

async function freezeNoticeClock(page: Page) {
  // Keep virtual timer assertions independent of native CSS transition timing.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = new Date('2026-11-05T00:00:00.000Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await page.mouse.move(0, 0);
}

async function noticeFraction(message: Locator) {
  return message.locator('.operation-notice-progress-fill').evaluate((node) => {
    const transform = getComputedStyle(node).transform;
    return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
  });
}

test('toast countdown decreases, closes after five seconds and restarts for a replacement notice', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mock = await mockWorkforce(page);
  await login(page);
  await freezeNoticeClock(page);
  await schedule(page, false, '2026-11-05');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const created = page.locator('.operation-notice.success');
  await expect(created).toContainText(/Đã lập.*1 ca/);
  await expect(created.locator('.operation-notice-progress')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  expect(await noticeFraction(created)).toBeGreaterThan(0.95);
  await page.clock.runFor(2000);
  const afterTwoSeconds = await noticeFraction(created);
  expect(afterTwoSeconds).toBeGreaterThan(0.56);
  expect(afterTwoSeconds).toBeLessThan(0.66);
  await fitsAt320(page, created);
  await page.screenshot({ path: info.outputPath('toast-countdown-320px.png'), fullPage: false });
  await page.clock.runFor(2900);
  await expect(created).toBeVisible();
  expect(await noticeFraction(created)).toBeLessThan(0.07);
  await page.clock.runFor(100);
  await expect(page.locator('.operation-notice')).toHaveCount(0);

  await schedule(page, true, '2026-11-05');
  const assigned = page.locator('.operation-notice.success');
  await expect(assigned).toContainText(/Đã phân công.*1/);
  await page.clock.runFor(3500);
  expect(await noticeFraction(assigned)).toBeLessThan(0.36);
  await schedule(page, false, '2026-11-05');
  const replacement = page.locator('.operation-notice.info');
  await expect(replacement).toContainText(
    'Các ca trong khoảng ngày này đã có sẵn. Không tạo thêm ca.',
  );
  expect(await noticeFraction(replacement)).toBeGreaterThan(0.95);
  // The replaced notice would expire after 1.5 seconds; its old timer must not dismiss this one.
  await page.clock.runFor(2000);
  await expect(replacement).toBeVisible();
  expect(await noticeFraction(replacement)).toBeGreaterThan(0.56);
  await page.clock.runFor(3000);
  await expect(page.locator('.operation-notice')).toHaveCount(0);
  expect(mock.writes.map((write) => write.path)).toEqual(
    Array(3).fill('/api/core/workforce/schedule'),
  );
  expect(mock.unexpectedWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('toast reading pauses on hover and keyboard focus and the close button dismisses immediately', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mock = await mockWorkforce(page);
  await login(page);
  await freezeNoticeClock(page);
  await schedule(page, false, '2026-11-05');
  const created = page.locator('.operation-notice.success');
  await expect(created).toBeVisible();
  await page.clock.runFor(1000);
  await created.hover();
  const hoveredFraction = await noticeFraction(created);
  await page.clock.runFor(7000);
  await expect(created).toBeVisible();
  expect(Math.abs((await noticeFraction(created)) - hoveredFraction)).toBeLessThan(0.04);

  const close = created.getByRole('button', { name: 'Đóng thông báo', exact: true });
  await close.focus();
  await page.mouse.move(0, 0);
  await expect(close).toBeFocused();
  const focusedFraction = await noticeFraction(created);
  await page.clock.runFor(7000);
  await expect(created).toBeVisible();
  expect(Math.abs((await noticeFraction(created)) - focusedFraction)).toBeLessThan(0.04);
  await page.getByRole('button', { name: 'Ngày theo ca', exact: true }).focus();
  await page.clock.runFor(1000);
  expect(await noticeFraction(created)).toBeLessThan(focusedFraction - 0.14);
  await fitsAt320(page, created);
  await page.screenshot({
    path: info.outputPath('toast-paused-keyboard-320px.png'),
    fullPage: false,
  });
  await keyboardDismiss(page, created);

  await schedule(page, false, '2026-11-05');
  const duplicate = page.locator('.operation-notice.info');
  await expect(duplicate).toBeVisible();
  await duplicate.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();
  await expect(page.locator('.operation-notice')).toHaveCount(0);
  expect(mock.unexpectedWrites).toEqual([]);
});
