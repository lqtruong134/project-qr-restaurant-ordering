import type { Connection } from '../shared/core-persistence.js';
import { integer, object, one, reject, text } from '../shared/core-persistence.js';
import { attendanceSummary, assertOpenPeriod, timestamp } from './workforce.service.js';
import {
  calculatePay,
  localClock,
  isNightMinute,
  type PaidPeriod,
  type PayPolicy,
  type PayRate,
  type CalendarDay,
} from './pay-calculation.js';

export const policyColumns =
  'id,effective_from::text AS effective_from,night_premium_percent,overtime_weekday_percent,rest_day_percent,holiday_percent,created_at';
export const calendarColumns =
  'd.id,d.date::text AS date,d.kind,d.user_id,d.name,d.created_at,u.display_name';
export async function paySettings(c: Connection, restaurant: string) {
  const [policies, calendar, current] = await Promise.all([
    c.query(
      `SELECT ${policyColumns} FROM workforce_pay_policy WHERE restaurant_id=$1 ORDER BY effective_from DESC`,
      [restaurant],
    ),
    c.query(
      `SELECT ${calendarColumns} FROM workforce_calendar_day d LEFT JOIN app_user u ON u.id=d.user_id WHERE d.restaurant_id=$1 ORDER BY d.date DESC,d.kind,u.display_name LIMIT 5000`,
      [restaurant],
    ),
    one(
      c,
      'SELECT timezone,(now() AT TIME ZONE timezone)::date::text AS today FROM restaurant WHERE id=$1',
      [restaurant],
    ),
  ]);
  return { policies: policies.rows, calendar: calendar.rows, ...current };
}
export async function assertCalendarEditable(
  c: Connection,
  restaurant: string,
  day: string,
  userId: string | null,
) {
  const affected = await c.query(
    `SELECT t.id FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id JOIN restaurant r ON r.id=a.restaurant_id WHERE a.restaurant_id=$1 AND t.status='APPROVED' AND ($3::uuid IS NULL OR a.user_id=$3) AND (a.starts_at < (($2::date+1)::timestamp AT TIME ZONE r.timezone) AND a.ends_at > ($2::date::timestamp AT TIME ZONE r.timezone) OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.paid_periods,'[]'::jsonb)) p WHERE (p->>'startsAt')::timestamptz AT TIME ZONE r.timezone < ($2::date+1)::timestamp AND (p->>'endsAt')::timestamptz AT TIME ZONE r.timezone > $2::date::timestamp)) LIMIT 1`,
    [restaurant, day, userId],
  );
  if (affected.rowCount)
    reject(
      'Ngày này đã có công được duyệt. Không thay đổi lịch ngày lễ hoặc ngày nghỉ đã dùng để tính lương.',
    );
  const closed = await c.query(
    "SELECT id FROM payroll_run WHERE restaurant_id=$1 AND status<>'DRAFT' AND period_start<=$2::date AND period_end>$2::date",
    [restaurant, day],
  );
  if (closed.rowCount) reject('Ngày này thuộc kỳ lương đã chốt.');
}
export async function policyActive(c: Connection, restaurant: string, startsAt: unknown) {
  return Boolean(
    (
      await c.query(
        'SELECT p.id FROM workforce_pay_policy p JOIN restaurant r ON r.id=p.restaurant_id WHERE p.restaurant_id=$1 AND p.effective_from<=($2::timestamptz AT TIME ZONE r.timezone)::date LIMIT 1',
        [restaurant, startsAt],
      )
    ).rowCount,
  );
}
function parsePeriods(input: unknown): PaidPeriod[] {
  if (!Array.isArray(input) || input.length > 32)
    reject('Chọn tối đa 32 khoảng công có thời gian rõ ràng.', 400);
  return input
    .map((p) => {
      const row = object(p),
        startsAt = timestamp(row.startsAt),
        endsAt = timestamp(row.endsAt),
        kind = text(row.kind);
      if (
        !['REGULAR', 'OVERTIME', 'PAID_HOLIDAY'].includes(kind) ||
        Date.parse(endsAt) <= Date.parse(startsAt) ||
        Date.parse(startsAt) % 60000 ||
        Date.parse(endsAt) % 60000
      )
        reject('Khoảng công cần giờ:phút, giờ kết thúc sau giờ bắt đầu và loại công hợp lệ.', 400);
      return { startsAt, endsAt, kind: kind as PaidPeriod['kind'] };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.kind.localeCompare(b.kind));
}
export async function previewPay(
  c: Connection,
  restaurant: string,
  a: Record<string, unknown>,
  prior: Record<string, unknown> | undefined,
  b: Record<string, unknown>,
) {
  const summary = attendanceSummary({ ...a, ...prior }),
    minutes = integer(b.minutes, 0, 960),
    note = text(b.note, 500);
  const outcome =
    b.outcome === undefined ? (minutes === 0 ? 'ABSENT' : 'MISSED_CLOCK') : text(b.outcome);
  if (!['WORKED', 'ABSENT', 'LEAVE', 'MISSED_CLOCK', 'PAID_HOLIDAY'].includes(outcome))
    reject('Chọn loại giờ công hợp lệ.', 400);
  const mode =
    b.approvalMode === undefined ? (minutes === 0 ? 'ZERO' : 'EXCEPTION') : text(b.approvalMode);
  if (!['FULL', 'ACTUAL', 'ZERO', 'EXCEPTION'].includes(mode))
    reject('Chọn cách tính công hợp lệ.', 400);
  if (
    (['ABSENT', 'LEAVE'].includes(outcome) && minutes !== 0) ||
    (!['ABSENT', 'LEAVE'].includes(outcome) && minutes === 0)
  )
    reject(
      'Vắng hoặc nghỉ không lương cần 0 phút; các loại công hưởng lương cần số phút lớn hơn 0.',
      400,
    );
  if (outcome === 'WORKED' && (!prior?.checked_in_at || !prior?.checked_out_at))
    reject('Thiếu giờ vào/ra. Chọn bổ sung chấm công và ghi rõ lý do.', 400);
  const start = new Date(String(a.starts_at)).getTime(),
    end = new Date(String(a.ends_at)).getTime();
  let periods: PaidPeriod[];
  if (b.paidPeriods !== undefined) periods = parsePeriods(b.paidPeriods);
  else if (minutes === 0) periods = [];
  else if (Number(a.break_minutes) > 0 || !['FULL', 'ACTUAL'].includes(mode))
    reject(
      'Cần ghi rõ các khoảng công và thời gian nghỉ để tính đúng giờ đêm, làm thêm và ngày lễ.',
      400,
    );
  else {
    const s =
      mode === 'ACTUAL' ? Math.max(start, new Date(String(prior?.checked_in_at)).getTime()) : start;
    const e =
      mode === 'ACTUAL' ? Math.min(end, new Date(String(prior?.checked_out_at)).getTime()) : end;
    if (!Number.isFinite(s) || !Number.isFinite(e))
      reject('Thiếu dấu chấm công để tính thời gian thực tế.', 400);
    // Original punches keep their seconds; approve only complete minute intervals inside the evidence.
    periods = [
      {
        startsAt: new Date(Math.ceil(s / 60000) * 60000).toISOString(),
        endsAt: new Date(Math.floor(e / 60000) * 60000).toISOString(),
        kind: 'REGULAR',
      },
    ];
  }
  const work = periods.filter((p) => p.kind !== 'PAID_HOLIDAY'),
    entitlements = periods.filter((p) => p.kind === 'PAID_HOLIDAY');
  const duration = (p: PaidPeriod) => (Date.parse(p.endsAt) - Date.parse(p.startsAt)) / 60000;
  if (periods.reduce((n, p) => n + duration(p), 0) !== minutes)
    reject('Tổng số phút phải bằng các khoảng công đã chọn.', 400);
  if (mode === 'ZERO' && minutes !== 0) reject('Không tính công cần 0 phút.', 400);
  for (const group of [work, entitlements])
    for (let i = 1; i < group.length; i++)
      if (Date.parse(group[i]!.startsAt) < Date.parse(group[i - 1]!.endsAt))
        reject('Các khoảng công cùng nhóm bị trùng giờ.', 400);
  for (const p of periods) {
    const s = Date.parse(p.startsAt),
      e = Date.parse(p.endsAt);
    if (s < start - 480 * 60000 || e > end + 480 * 60000 || e > Date.now())
      reject('Khoảng công nằm ngoài giới hạn ca hoặc chưa kết thúc.', 400);
    if (p.kind !== 'OVERTIME' && (s < start || e > end))
      reject('Công trong ca và nghỉ lễ hưởng lương phải nằm trong lịch đã phân công.', 400);
    if (p.kind === 'OVERTIME' && b.approveExtra !== true)
      reject('Cần xác nhận duyệt làm thêm và ghi rõ lý do.', 400);
    await assertOpenPeriod(c, restaurant, p.startsAt);
    await assertOpenPeriod(c, restaurant, new Date(e - 1).toISOString());
  }
  const regular = work.filter((p) => p.kind === 'REGULAR').reduce((n, p) => n + duration(p), 0);
  if (regular > summary.scheduled_minutes)
    reject('Giờ trong ca vượt công chuẩn sau khi trừ nghỉ. Hãy tách giờ làm thêm.', 400);
  if (mode === 'FULL' && regular !== summary.scheduled_minutes && outcome !== 'PAID_HOLIDAY')
    reject('Tính đủ ca phải có đủ công chuẩn sau khi trừ thời gian nghỉ.', 400);
  if (mode === 'ACTUAL') {
    if (!prior?.checked_in_at || !prior?.checked_out_at)
      reject('Tính thực tế cần đủ giờ vào và ra.', 400);
    const inside = work.filter((p) => p.kind === 'REGULAR');
    if (
      regular > summary.actual_minutes ||
      inside.some(
        (p) =>
          Date.parse(p.startsAt) < new Date(String(prior.checked_in_at)).getTime() ||
          Date.parse(p.endsAt) > new Date(String(prior.checked_out_at)).getTime(),
      )
    )
      reject('Công thực tế phải nằm trong dấu chấm công gốc và đã trừ nghỉ.', 400);
  }
  if (
    (outcome === 'PAID_HOLIDAY' && work.length) ||
    (outcome !== 'PAID_HOLIDAY' && minutes > 0 && !work.length)
  )
    reject('Chọn nghỉ lễ hưởng lương cho công chỉ gồm quyền hưởng ngày lễ.', 400);
  if (entitlements.reduce((n, p) => n + duration(p), 0) > summary.scheduled_minutes)
    reject('Công nghỉ lễ hưởng lương vượt công chuẩn của ca.', 400);
  const context = await one(c, 'SELECT timezone FROM restaurant WHERE id=$1', [restaurant]);
  const min = periods.length ? periods[0]!.startsAt : new Date(start).toISOString(),
    max = periods.length
      ? periods.reduce((m, p) => (p.endsAt > m ? p.endsAt : m), periods[0]!.endsAt)
      : new Date(end).toISOString();
  const [ps, rs, cs, other] = await Promise.all([
    c.query(
      `SELECT ${policyColumns} FROM workforce_pay_policy WHERE restaurant_id=$1 ORDER BY effective_from`,
      [restaurant],
    ),
    c.query(
      'SELECT id,effective_from,hourly_rate::text FROM employee_pay_rate WHERE restaurant_id=$1 AND user_id=$2 AND effective_from<=$3 ORDER BY effective_from',
      [restaurant, a.user_id, max],
    ),
    c.query(
      'SELECT id,date::text AS date,kind,user_id,name FROM workforce_calendar_day WHERE restaurant_id=$1 AND date>=($2::timestamptz AT TIME ZONE $4)::date AND date<=($3::timestamptz AT TIME ZONE $4)::date AND (user_id IS NULL OR user_id=$5)',
      [restaurant, min, max, context.timezone, a.user_id],
    ),
    c.query(
      "SELECT t.id,t.paid_periods FROM attendance_record t JOIN shift_assignment x ON x.id=t.assignment_id JOIN restaurant r ON r.id=x.restaurant_id WHERE x.restaurant_id=$1 AND x.user_id=$2 AND x.id<>$3 AND t.status='APPROVED' AND (((x.starts_at AT TIME ZONE r.timezone)::date<=$5::date AND (x.ends_at AT TIME ZONE r.timezone)::date>=$4::date) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(t.paid_periods,'[]'::jsonb)) p WHERE ((p->>'startsAt')::timestamptz AT TIME ZONE r.timezone)::date<=$5::date AND ((p->>'endsAt')::timestamptz AT TIME ZONE r.timezone)::date>=$4::date))",
      [
        restaurant,
        a.user_id,
        a.id,
        localClock(min, context.timezone).date,
        localClock(Date.parse(max) - 1, context.timezone).date,
      ],
    ),
  ]);
  const previouslyPaid: PaidPeriod[] = other.rows.flatMap((r) => r.paid_periods ?? []);
  for (const p of periods)
    if (
      previouslyPaid.some(
        (q) =>
          (q.kind === 'PAID_HOLIDAY') === (p.kind === 'PAID_HOLIDAY') &&
          Date.parse(q.startsAt) < Date.parse(p.endsAt) &&
          Date.parse(q.endsAt) > Date.parse(p.startsAt),
      )
    )
      reject('Khoảng công này đã được duyệt ở ca khác; không tính tiền hai lần.');
  if (work.length) {
    const overlaps = await c.query(
      "SELECT id FROM shift_assignment WHERE restaurant_id=$1 AND user_id=$2 AND id<>$3 AND status='ASSIGNED' AND starts_at<$5 AND ends_at>$4",
      [restaurant, a.user_id, a.id, min, max],
    );
    for (const row of overlaps.rows) {
      const otherShift = await one(
        c,
        'SELECT starts_at,ends_at FROM shift_assignment WHERE id=$1',
        [row.id],
      );
      if (
        work.some(
          (p) =>
            Date.parse(p.startsAt) < new Date(otherShift.ends_at).getTime() &&
            Date.parse(p.endsAt) > new Date(otherShift.starts_at).getTime(),
        )
      )
        reject('Khoảng công trùng lịch của ca khác. Duyệt công ở đúng ca để tránh trả trùng.');
    }
  }
  const policies: PayPolicy[] = ps.rows.map((p) => ({
    id: p.id,
    effectiveFrom: p.effective_from,
    nightPremiumPercent: p.night_premium_percent,
    overtimeWeekdayPercent: p.overtime_weekday_percent,
    restDayPercent: p.rest_day_percent,
    holidayPercent: p.holiday_percent,
  }));
  const rates: PayRate[] = rs.rows.map((p) => ({
    id: p.id,
    effectiveFrom: new Date(p.effective_from).toISOString(),
    hourlyRate: p.hourly_rate,
  }));
  const calendar: CalendarDay[] = cs.rows.map((d) => ({
    id: d.id,
    date: d.date,
    kind: d.kind,
    userId: d.user_id,
    name: d.name,
  }));
  const previouslyEntitled: Record<string, number> = {};
  for (const p of previouslyPaid.filter((p) => p.kind === 'PAID_HOLIDAY'))
    for (let ms = Date.parse(p.startsAt); ms < Date.parse(p.endsAt); ms += 60000) {
      const d = localClock(ms, context.timezone).date;
      previouslyEntitled[d] = (previouslyEntitled[d] ?? 0) + 1;
    }
  const entitled: Record<string, number> = {};
  for (const p of entitlements)
    for (let ms = Date.parse(p.startsAt); ms < Date.parse(p.endsAt); ms += 60000) {
      const d = localClock(ms, context.timezone).date;
      entitled[d] = (entitled[d] ?? 0) + 1;
    }
  for (const [day, count] of Object.entries(entitled))
    if (count + (previouslyEntitled[day] ?? 0) > 480)
      reject('Nghỉ lễ hưởng lương không vượt 8 giờ mỗi nhân viên trong một ngày.', 400);
  const priorDayOT = new Map<string, number>();
  for (const p of previouslyPaid.filter((p) => p.kind === 'OVERTIME'))
    for (let ms = Date.parse(p.startsAt); ms < Date.parse(p.endsAt); ms += 60000) {
      const clock = localClock(ms, context.timezone);
      if (!isNightMinute(clock.minute))
        priorDayOT.set(clock.date, Math.min(priorDayOT.get(clock.date) ?? Infinity, ms));
    }
  const priorNightOT: { date: string; time: number }[] = [];
  for (const p of previouslyPaid.filter((p) => p.kind === 'OVERTIME'))
    for (let ms = Date.parse(p.startsAt); ms < Date.parse(p.endsAt); ms += 60000) {
      const clock = localClock(ms, context.timezone);
      if (isNightMinute(clock.minute) && !calendar.some((d) => d.date === clock.date))
        priorNightOT.push({ date: clock.date, time: ms });
    }
  for (const p of work.filter((p) => p.kind === 'OVERTIME'))
    for (let ms = Date.parse(p.startsAt); ms < Date.parse(p.endsAt); ms += 60000) {
      const clock = localClock(ms, context.timezone);
      if (
        !isNightMinute(clock.minute) &&
        priorNightOT.some(
          (night) =>
            night.date === clock.date &&
            ms < night.time &&
            (priorDayOT.get(clock.date) ?? Infinity) >= night.time,
        )
      )
        reject(
          'Ngày này đã duyệt làm thêm ban đêm. Cần duyệt làm thêm ban ngày trước ban đêm để xác định đúng hệ số; không thay đổi công đã duyệt.',
        );
    }
  let result: ReturnType<typeof calculatePay>;
  try {
    result = calculatePay({
      timezone: context.timezone,
      userId: String(a.user_id),
      periods,
      policies,
      rates,
      calendar,
      daytimeOvertimeStarts: [...priorDayOT.values()].map((ms) => new Date(ms).toISOString()),
    });
  } catch (error) {
    reject((error as Error).message, 400);
  }
  const initialRate = rates.filter((p) => Date.parse(p.effectiveFrom) <= start).at(-1);
  if (!initialRate) reject('Nhân viên chưa có đơn giá cơ bản tại ngày bắt đầu ca.', 400);
  return {
    approvedMinutes: minutes,
    hourlyRate: initialRate.hourlyRate,
    amount: result.amount,
    payComponents: result.components,
    paySnapshot: result.snapshot,
    paidPeriods: periods,
    outcome,
    approvalMode: mode,
    note,
  };
}
