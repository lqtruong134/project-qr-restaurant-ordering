import type { Database } from '../packages/database/src/index.js';
import {
  restaurantHourlyRate,
  workforceTemplates,
} from '../packages/database/src/workforce-seed.js';
import { previewPay } from '../apps/api/src/modules/workforce/pay.service.js';
import type { PaidPeriod } from '../apps/api/src/modules/workforce/pay-calculation.js';
import type { Connection } from '../apps/api/src/modules/shared/core-persistence.js';
import {
  deterministicUuid,
  historyDutyRoster,
  historyTimestamp,
  insertHistoryRows,
  type HistoryRow,
} from './restaurant-history-support.js';

export type WorkforceHistoryOptions = {
  restaurantId: string;
  from: string;
  through: string;
  now: Date;
  datasetKey: string;
  apply?: boolean;
  progress?: (message: string) => void;
};
export type WorkforceHistoryResult = {
  applied: boolean;
  alreadyApplied: boolean;
  cutoff: string;
  counts: Record<string, number>;
  invariants: Record<string, number>;
};
type Person = { id: string; username: string; display_name: string; role: string };
type Approved = {
  id: string;
  userId: string;
  day: string;
  name: string;
  approvalAt: string;
  pay: Awaited<ReturnType<typeof previewPay>>;
};
const addDay = (day: string, n: number) =>
  new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const addMinutes = (at: string, n: number) => new Date(Date.parse(at) + n * 60000).toISOString();
const monthEnd = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1))
    .toISOString()
    .slice(0, 10);
const localDay = (at: number) => new Date(at + 7 * 3600000).toISOString().slice(0, 10);
const dayValid = (day: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day + 'T12:00:00Z')) &&
  new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day;

/** The same staff actions checked by the operational history generator. */
const actionSql = `SELECT x.actor,x.at FROM (
 SELECT h.actor_user_id AS actor,h.changed_at AS at FROM order_status_history h JOIN order_batch b ON b.id=h.order_batch_id JOIN table_session s ON s.id=b.session_id JOIN dining_table dt ON dt.id=s.table_id WHERE dt.restaurant_id=$1
 UNION ALL SELECT p.confirmed_by,p.confirmed_at FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table dt ON dt.id=s.table_id WHERE dt.restaurant_id=$1
 UNION ALL SELECT t.processed_by,t.processed_at FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id JOIN table_session s ON s.id=f.session_id JOIN dining_table dt ON dt.id=s.table_id WHERE dt.restaurant_id=$1
 UNION ALL SELECT s.closed_by,s.closed_at FROM table_session s JOIN dining_table dt ON dt.id=s.table_id WHERE dt.restaurant_id=$1
 UNION ALL SELECT r.resolved_by,r.resolved_at FROM support_request r JOIN table_session s ON s.id=r.session_id JOIN dining_table dt ON dt.id=s.table_id WHERE dt.restaurant_id=$1
 ) x JOIN app_user u ON u.id=x.actor JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL JOIN role ro ON ro.id=ur.role_id
 WHERE ro.code IN ('STAFF','KITCHEN') AND x.at >= $2 AND x.at <= $3`;

export async function validateWorkforceHistory(
  c: Connection,
  restaurantId: string,
  from: string,
  cutoff: string,
) {
  const checks: Record<string, number> = {};
  const start = historyTimestamp(from, 0),
    params = [restaurantId, start, cutoff];
  const count = async (name: string, sql: string) => {
    checks[name] = Number(
      (await c.query(Object.assign({ text: sql, values: params }, { query_timeout: 180000 })))
        .rows[0]!.n,
    );
  };
  const attendanceScope = `a.restaurant_id=$1 AND a.starts_at >= $2 AND a.starts_at <= $3`;
  await count(
    'futurePunchesOrApprovals',
    `SELECT count(*)::int AS n FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id WHERE ${attendanceScope} AND (t.checked_in_at>$3 OR t.checked_out_at>$3 OR t.approved_at>$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(t.paid_periods,'[]'::jsonb)) p WHERE (p->>'endsAt')::timestamptz>$3))`,
  );
  await count(
    'unclassifiedApprovals',
    `SELECT count(*)::int AS n FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id WHERE ${attendanceScope} AND (t.status<>'APPROVED' OR t.rate_source IS DISTINCT FROM 'EMPLOYEE' OR t.pay_snapshot IS NULL OR t.pay_components IS NULL OR t.paid_periods IS NULL OR t.amount IS DISTINCT FROM (t.pay_components->>'totalAmount')::bigint OR t.pay_components IS DISTINCT FROM t.pay_snapshot->'components' OR t.paid_periods IS DISTINCT FROM t.pay_snapshot->'periods')`,
  );
  await count(
    'payrollSnapshotMismatch',
    `SELECT count(*)::int AS n FROM payroll_line l JOIN attendance_record t ON t.id=l.attendance_id JOIN shift_assignment a ON a.id=t.assignment_id WHERE ${attendanceScope} AND (l.amount<>t.amount OR l.minutes<>t.approved_minutes OR l.hourly_rate_snapshot<>t.hourly_rate_snapshot OR l.pay_components IS DISTINCT FROM t.pay_components OR l.pay_snapshot IS DISTINCT FROM t.pay_snapshot OR l.paid_periods IS DISTINCT FROM t.paid_periods)`,
  );
  await count(
    'approvalBeforeWorkEnded',
    `SELECT count(*)::int AS n FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id WHERE ${attendanceScope} AND (t.approved_at<a.ends_at OR t.approved_at<t.checked_out_at)`,
  );
  await count(
    'overlappingAssignments',
    `SELECT count(*)::int AS n FROM shift_assignment a JOIN shift_assignment b ON a.user_id=b.user_id AND a.id<b.id AND a.starts_at<b.ends_at AND a.ends_at>b.starts_at AND b.status='ASSIGNED' WHERE ${attendanceScope} AND a.status='ASSIGNED'`,
  );
  await count(
    'adminAssignments',
    `SELECT count(*)::int AS n FROM shift_assignment a JOIN user_role ur ON ur.user_id=a.user_id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id WHERE ${attendanceScope} AND r.code='ADMIN'`,
  );
  await count(
    'futureSalaryEvents',
    `SELECT count(*)::int AS n FROM payroll_run p WHERE p.restaurant_id=$1 AND p.period_end>($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND (p.finalized_at>$3 OR p.paid_at>$3 OR EXISTS(SELECT 1 FROM payroll_payment x JOIN payroll_slip s ON s.id=x.payroll_slip_id WHERE s.payroll_run_id=p.id AND x.paid_at>$3) OR (p.status<>'DRAFT' AND p.period_end>($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))`,
  );
  await count(
    'salaryPaymentMismatch',
    `SELECT count(*)::int AS n FROM payroll_payment p JOIN payroll_slip s ON s.id=p.payroll_slip_id JOIN payroll_run r ON r.id=s.payroll_run_id WHERE r.restaurant_id=$1 AND r.period_end>($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND r.created_at<=$3 AND (p.amount IS DISTINCT FROM (SELECT sum(amount) FROM payroll_line WHERE payroll_slip_id=s.id) OR p.paid_at<r.finalized_at)`,
  );
  await count(
    'deductions',
    `SELECT count(*)::int AS n FROM payroll_line l JOIN payroll_slip s ON s.id=l.payroll_slip_id JOIN payroll_run r ON r.id=s.payroll_run_id WHERE r.restaurant_id=$1 AND r.period_end>($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND r.created_at<=$3 AND l.line_type='DEDUCTION'`,
  );
  await count(
    'workOnWeeklyRest',
    `SELECT count(*)::int AS n FROM shift_assignment a JOIN workforce_calendar_day d ON d.restaurant_id=a.restaurant_id AND d.user_id=a.user_id AND d.kind='WEEKLY_REST' AND d.date=(a.starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date WHERE ${attendanceScope} AND a.status='ASSIGNED'`,
  );
  await count(
    'customerActionsOutsideApprovedWork',
    `SELECT count(*)::int AS n FROM (${actionSql}) x WHERE NOT EXISTS(SELECT 1 FROM shift_assignment a JOIN attendance_record t ON t.assignment_id=a.id WHERE a.user_id=x.actor AND a.restaurant_id=$1 AND a.status='ASSIGNED' AND t.status='APPROVED' AND t.outcome IN ('WORKED','MISSED_CLOCK') AND t.checked_in_at<=x.at AND (t.checked_out_at IS NULL OR t.checked_out_at>=x.at) AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.paid_periods) p WHERE p->>'kind'<>'PAID_HOLIDAY' AND (p->>'startsAt')::timestamptz<=x.at AND (p->>'endsAt')::timestamptz>=x.at))`,
  );
  return checks;
}

/**
 * Build candidate history atomically. Preview mode exercises real pay calculation and database
 * guards, then rolls back. Existing approved history is never replaced or recomputed.
 */
export async function generateWorkforceHistory(
  db: Database,
  options: WorkforceHistoryOptions,
): Promise<WorkforceHistoryResult> {
  const { restaurantId, from, through, datasetKey } = options;
  if (
    !dayValid(from) ||
    !dayValid(through) ||
    from < '2026-08-01' ||
    through < from ||
    Date.parse(through) - Date.parse(from) > 366 * 86400000 ||
    !datasetKey.trim()
  )
    throw new Error(
      'Workforce history needs valid dates from 2026-08-01, at most one year, and a dataset key.',
    );
  if (!Number.isFinite(options.now.getTime())) throw new Error('Invalid workforce history clock.');
  const cutoffMs = Math.min(
      options.now.getTime(),
      Date.now(),
      Date.parse(historyTimestamp(addDay(through, 1), 0)) - 1,
    ),
    cutoff = new Date(cutoffMs).toISOString();
  if (localDay(cutoffMs) < from)
    throw new Error('Workforce history range is entirely in the future.');
  const markerId = deterministicUuid(datasetKey + ':workforce:import');
  const c = await db.pool.connect(),
    counts: Record<string, number> = {};
  const identity = (key: string) => deterministicUuid(datasetKey + ':workforce:' + key);
  const baseAt = historyTimestamp('2026-08-01', 0);
  const add = async (table: string, rows: HistoryRow[]) => {
    if (!rows.length) return;
    await insertHistoryRows(c, table, rows);
    counts[table] = (counts[table] ?? 0) + rows.length;
  };
  let adminId: string;
  const audit = async (
    action: string,
    type: string,
    id: string,
    reason: string,
    details: unknown,
    at: string,
  ) =>
    add('business_audit_event', [
      {
        id: identity('audit:' + action + ':' + id),
        restaurant_id: restaurantId,
        actor_id: adminId,
        action,
        resource_type: type,
        resource_id: id,
        reason,
        details,
        created_at: at,
      },
    ]);
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout='170s'");
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,530053))', [restaurantId]);
    const context = (await c.query('SELECT timezone FROM restaurant WHERE id=$1', [restaurantId]))
      .rows[0];
    if (!context || context.timezone !== 'Asia/Ho_Chi_Minh')
      throw new Error('Workforce history requires the restaurant Vietnam timezone.');
    const marker = (
      await c.query(
        "SELECT details FROM business_audit_event WHERE id=$1 AND restaurant_id=$2 AND action='IMPORT_WORKFORCE_HISTORY'",
        [markerId, restaurantId],
      )
    ).rows[0];
    if (marker) {
      if (
        marker.details.from !== from ||
        marker.details.through !== through ||
        marker.details.cutoff !== cutoff
      )
        throw new Error('Dataset key already belongs to a different workforce range or cutoff.');
      const invariants = await validateWorkforceHistory(c, restaurantId, from, cutoff);
      if (Object.values(invariants).some((n) => n !== 0))
        throw new Error('Stored workforce history is inconsistent: ' + JSON.stringify(invariants));
      await c.query('ROLLBACK');
      return {
        applied: false,
        alreadyApplied: true,
        cutoff,
        counts: marker.details.counts,
        invariants,
      };
    }
    const preexisting = await c.query(
      'SELECT id FROM shift_assignment WHERE restaurant_id=$1 AND starts_at>=$2 AND starts_at<=$3 LIMIT 1',
      [restaurantId, historyTimestamp(from, 0), cutoff],
    );
    if (preexisting.rowCount)
      throw new Error(
        'Workforce history requires an empty candidate assignment range; existing approved history is protected.',
      );
    const people = (
      await c.query<Person>(
        `SELECT DISTINCT u.id,u.username,u.display_name,r.code AS role FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1 AND u.status='ACTIVE' AND r.code IN ('STAFF','KITCHEN') ORDER BY u.username`,
        [restaurantId],
      )
    ).rows;
    const administrator = (
      await c.query(
        `SELECT u.id FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1 AND u.status='ACTIVE' AND r.code='ADMIN' ORDER BY u.username LIMIT 1`,
        [restaurantId],
      )
    ).rows[0];
    if (
      !administrator ||
      ['STAFF', 'KITCHEN'].some((role) => people.filter((p) => p.role === role).length < 3)
    )
      throw new Error(
        'History requires an administrator and at least three people per operating role.',
      );
    if (new Set(people.map((p) => p.id)).size !== people.length)
      throw new Error('History employees must have one operating role.');
    adminId = administrator.id;
    const areaId =
      (
        await c.query(
          "SELECT id FROM dining_area WHERE restaurant_id=$1 AND code='TRONG-NHA' AND is_active",
          [restaurantId],
        )
      ).rows[0]?.id ?? null;
    const policy = (
      await c.query(
        'SELECT * FROM workforce_pay_policy WHERE restaurant_id=$1 AND effective_from=$2',
        [restaurantId, '2026-08-01'],
      )
    ).rows[0];
    if (
      policy &&
      [
        policy.night_premium_percent,
        policy.overtime_weekday_percent,
        policy.rest_day_percent,
        policy.holiday_percent,
      ].join(',') !== '30,150,200,300'
    )
      throw new Error(
        'Existing baseline policy differs; review it rather than rewriting pay rules.',
      );
    if (!policy) {
      const id = identity('policy:2026-08-01');
      await add('workforce_pay_policy', [
        {
          id,
          restaurant_id: restaurantId,
          effective_from: '2026-08-01',
          night_premium_percent: 30,
          overtime_weekday_percent: 150,
          rest_day_percent: 200,
          holiday_percent: 300,
          created_by: adminId,
          created_at: baseAt,
        },
      ]);
      await audit(
        'SET_WORKFORCE_PAY_POLICY',
        'WORKFORCE_PAY_POLICY',
        id,
        'Thiết lập hệ số giờ đêm, làm thêm và ngày lễ.',
        {
          effectiveFrom: '2026-08-01',
          nightPremiumPercent: 30,
          overtimeWeekdayPercent: 150,
          restDayPercent: 200,
          holidayPercent: 300,
        },
        baseAt,
      );
    }
    for (const person of people) {
      const hourlyRate = restaurantHourlyRate(person.username).toString();
      const rate = (
        await c.query(
          'SELECT id,hourly_rate::text FROM employee_pay_rate WHERE user_id=$1 AND effective_from=$2',
          [person.id, baseAt],
        )
      ).rows[0];
      if (rate && rate.hourly_rate !== hourlyRate)
        throw new Error('Existing personal pay rate differs for ' + person.username);
      if (!rate) {
        const id = identity('rate:' + person.id);
        const reason =
          person.username === 'bep001'
            ? 'Đơn giá giờ bếp trưởng.'
            : person.username === 'pv001'
              ? 'Đơn giá giờ trưởng nhóm phục vụ.'
              : 'Đơn giá giờ nhân viên.';
        await add('employee_pay_rate', [
          {
            id,
            restaurant_id: restaurantId,
            user_id: person.id,
            effective_from: baseAt,
            hourly_rate: hourlyRate,
            reason,
            created_by: adminId,
            created_at: baseAt,
          },
        ]);
        await audit(
          'SET_PAY_RATE',
          'EMPLOYEE_PAY_RATE',
          id,
          reason,
          { userId: person.id, hourlyRate, effectiveFrom: baseAt },
          baseAt,
        );
      }
    }
    const templates = new Map<string, { id: string; version: number }>();
    for (const [index, definition] of workforceTemplates.entries()) {
      let template = (
        await c.query(
          'SELECT *,start_time::text AS start,end_time::text AS finish FROM shift_template WHERE restaurant_id=$1 AND code=$2',
          [restaurantId, definition.code],
        )
      ).rows[0];
      if (
        template &&
        (template.start.slice(0, 5) !== definition.start ||
          template.finish.slice(0, 5) !== definition.end ||
          template.break_minutes !== definition.break ||
          template.ends_next_day !== definition.next ||
          template.hourly_rate_override !== null)
      )
        throw new Error('Existing shift template differs: ' + definition.code);
      if (!template) {
        const id = identity('template:' + definition.code);
        await add('shift_template', [
          {
            id,
            restaurant_id: restaurantId,
            code: definition.code,
            name: definition.name,
            start_time: definition.start,
            end_time: definition.end,
            ends_next_day: definition.next,
            break_minutes: definition.break,
            hourly_rate_override: null,
            is_active: true,
            sort_order: index,
            version: 1,
            created_by: adminId,
            created_at: baseAt,
            updated_at: baseAt,
          },
        ]);
        await audit(
          'CREATE_SHIFT_TEMPLATE',
          'SHIFT_TEMPLATE',
          id,
          'Tạo mẫu ca dùng chung; lương theo đơn giá nhân viên.',
          {
            code: definition.code,
            startTime: definition.start,
            endTime: definition.end,
            breakMinutes: definition.break,
            useShiftRate: false,
          },
          baseAt,
        );
        template = { id, version: 1 };
      }
      templates.set(definition.code, template);
    }
    const lastDay = [through, localDay(cutoffMs)].sort()[0]!;
    const days: string[] = [];
    for (let day = from; day <= lastDay; day = addDay(day, 1)) days.push(day);
    const rest: HistoryRow[] = [];
    const calendar = (
      await c.query(
        'SELECT date::text,kind,user_id FROM workforce_calendar_day WHERE restaurant_id=$1 AND date>=$2 AND date<=$3',
        [restaurantId, from, lastDay],
      )
    ).rows;
    const calendarKeys = new Set(
      calendar.map((r) => r.date + ':' + r.kind + ':' + (r.user_id ?? '')),
    );
    for (const day of days) {
      for (const role of ['STAFF', 'KITCHEN']) {
        const roster = historyDutyRoster(
          people.filter((p) => p.role === role).map((p) => p.id),
          day,
        );
        for (const id of roster.off)
          if (!calendarKeys.has(day + ':WEEKLY_REST:' + id))
            rest.push({
              id: identity('rest:' + day + ':' + id),
              restaurant_id: restaurantId,
              date: day,
              kind: 'WEEKLY_REST',
              user_id: id,
              name: 'Ngày nghỉ hằng tuần theo lịch phân ca',
              created_by: adminId,
              created_at: historyTimestamp(day, 0),
            });
      }
      if (day === '2026-09-02' && !calendarKeys.has(day + ':HOLIDAY:'))
        rest.push({
          id: identity('holiday:' + day),
          restaurant_id: restaurantId,
          date: day,
          kind: 'HOLIDAY',
          user_id: null,
          name: 'Quốc khánh 2/9',
          created_by: adminId,
          created_at: historyTimestamp(day, 0),
        });
    }
    await add('workforce_calendar_day', rest);
    for (const row of rest)
      await audit(
        'ADD_PAY_CALENDAR',
        'WORKFORCE_CALENDAR_DAY',
        String(row.id),
        String(row.name),
        { date: row.date, kind: row.kind, userId: row.user_id },
        String(row.created_at),
      );
    const firstActions = new Map<string, number>();
    for (const row of (
      await c.query(
        Object.assign(
          {
            text: `SELECT actor,min(at) AS at FROM (${actionSql}) actions GROUP BY actor,(at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
            values: [restaurantId, historyTimestamp(from, 0), cutoff],
          },
          { query_timeout: 180000 },
        ),
      )
    ).rows) {
      const at = new Date(row.at).getTime(),
        key = row.actor + ':' + localDay(at);
      firstActions.set(key, Math.min(firstActions.get(key) ?? Infinity, at));
    }
    const assignments: {
        person: Person;
        day: string;
        morning: boolean;
        a: HistoryRow;
        start: string;
        end: string;
      }[] = [],
      shifts: HistoryRow[] = [],
      assignmentRows: HistoryRow[] = [];
    for (const day of days)
      for (const morning of [true, false]) {
        const start = historyTimestamp(day, morning ? 420 : 900),
          end = historyTimestamp(day, morning ? 960 : 1380);
        // Every actual clock and approval must fit in the selected operating cutoff.
        if (Date.parse(end) > cutoffMs) continue;
        const code = morning ? 'CA-SANG' : 'CA-TOI',
          template = templates.get(code)!,
          id = identity('shift:' + day + ':' + code),
          plannedAt = historyTimestamp(day, 0);
        shifts.push({
          id,
          restaurant_id: restaurantId,
          code: day + '-' + code,
          name: morning ? 'Ca sáng' : 'Ca tối',
          starts_at: start,
          ends_at: end,
          break_minutes: 60,
          created_by: adminId,
          created_at: plannedAt,
          updated_at: plannedAt,
          template_id: template.id,
          scheduled_date: day,
          template_version: template.version,
          hourly_rate_override: null,
          attendance_grace_minutes: 15,
          clock_in_early_minutes: 15,
          clock_out_late_minutes: 120,
        });
        for (const role of ['STAFF', 'KITCHEN']) {
          const roster = historyDutyRoster(
            people.filter((p) => p.role === role).map((p) => p.id),
            day,
          );
          for (const userId of morning ? roster.morning : roster.evening) {
            const person = people.find((p) => p.id === userId)!;
            const a = {
              id: identity('assignment:' + day + ':' + userId),
              restaurant_id: restaurantId,
              shift_id: id,
              user_id: userId,
              area_id: role === 'STAFF' ? areaId : null,
              starts_at: start,
              ends_at: end,
              status: 'ASSIGNED',
              assigned_by: adminId,
              created_at: plannedAt,
              updated_at: plannedAt,
            };
            assignmentRows.push(a);
            assignments.push({
              person,
              day,
              morning,
              a: {
                ...a,
                break_minutes: 60,
                attendance_grace_minutes: 15,
                clock_out_late_minutes: 120,
              },
              start,
              end,
            });
          }
        }
      }
    await add('work_shift', shifts);
    await add('shift_assignment', assignmentRows);
    for (const s of shifts)
      await audit(
        'SCHEDULE_SHIFT',
        'WORK_SHIFT',
        String(s.id),
        'Lập lịch từ mẫu ca',
        { templateId: s.template_id, templateVersion: s.template_version, date: s.scheduled_date },
        String(s.created_at),
      );
    for (const a of assignmentRows)
      await audit(
        'ASSIGN_SHIFT',
        'SHIFT_ASSIGNMENT',
        String(a.id),
        'Phân ca theo mẫu',
        { shiftId: a.shift_id, userId: a.user_id },
        String(a.created_at),
      );
    const approved: Approved[] = [];
    for (const [index, assignment] of assignments.entries()) {
      const { person, day, morning, a, start, end } = assignment;
      const variant = (Number(day.slice(8)) + people.indexOf(person) * 7) % 23;
      const late =
        variant === 3 &&
        (firstActions.get(person.id + ':' + day) ?? Infinity) >= Date.parse(start) + 20 * 60000;
      const missed = variant === 7;
      const extra =
        variant === 11 &&
        Date.parse(end) + 35 * 60000 <= cutoffMs &&
        !(
          await c.query(
            "SELECT id FROM shift_assignment WHERE restaurant_id=$1 AND user_id=$2 AND id<>$3 AND status='ASSIGNED' AND starts_at<$5 AND ends_at>$4 LIMIT 1",
            [restaurantId, person.id, a.id, end, addMinutes(end, 30)],
          )
        ).rowCount;
      const checkedIn = late ? addMinutes(start, 20) : start,
        checkedOut = missed ? null : extra ? addMinutes(end, 30) : end;
      const periods: PaidPeriod[] = [
        {
          startsAt: checkedIn,
          endsAt: historyTimestamp(day, morning ? 540 : 960),
          kind: 'REGULAR',
        },
        { startsAt: historyTimestamp(day, morning ? 600 : 1020), endsAt: end, kind: 'REGULAR' },
      ];
      if (extra) periods.push({ startsAt: end, endsAt: addMinutes(end, 30), kind: 'OVERTIME' });
      const note = missed
        ? 'Bổ sung công sau khi đối chiếu lịch trực và bàn giao; giữ nguyên dấu chấm ra bị thiếu.'
        : extra
          ? 'Duyệt 30 phút làm thêm để bàn giao và hoàn tất công việc cuối ca.'
          : late
            ? 'Duyệt thời gian làm việc thực tế; vào ca muộn 20 phút.'
            : 'Đã đối chiếu giờ vào, giờ ra và thời gian nghỉ theo lịch ca.';
      const pay = await previewPay(
        c,
        restaurantId,
        a,
        { checked_in_at: checkedIn, checked_out_at: checkedOut },
        {
          minutes: periods.reduce(
            (n, p) => n + (Date.parse(p.endsAt) - Date.parse(p.startsAt)) / 60000,
            0,
          ),
          note,
          outcome: missed ? 'MISSED_CLOCK' : 'WORKED',
          approvalMode: missed || extra ? 'EXCEPTION' : late ? 'ACTUAL' : 'FULL',
          approveExtra: extra,
          paidPeriods: periods,
        },
      );
      const id = identity('attendance:' + day + ':' + person.id),
        approvalAt = new Date(
          Math.min(cutoffMs, Date.parse(addMinutes(extra ? addMinutes(end, 30) : end, 5))),
        ).toISOString();
      await add('attendance_record', [
        {
          id,
          restaurant_id: restaurantId,
          assignment_id: a.id,
          checked_in_at: checkedIn,
          checked_out_at: checkedOut,
          status: 'APPROVED',
          approved_minutes: pay.approvedMinutes,
          hourly_rate_snapshot: pay.hourlyRate,
          amount: pay.amount,
          approved_by: adminId,
          approved_at: approvalAt,
          review_note: note,
          outcome: pay.outcome,
          approval_mode: pay.approvalMode,
          rate_source: 'EMPLOYEE',
          pay_components: pay.payComponents,
          pay_snapshot: pay.paySnapshot,
          paid_periods: pay.paidPeriods,
          created_at: checkedIn,
          updated_at: approvalAt,
        },
      ]);
      await audit(
        'APPROVE_ATTENDANCE',
        'SHIFT_ASSIGNMENT',
        String(a.id),
        note,
        { ...pay, originalPunches: { in: checkedIn, out: checkedOut } },
        approvalAt,
      );
      approved.push({
        id,
        userId: person.id,
        day,
        name: morning ? 'Ca sáng' : 'Ca tối',
        approvalAt,
        pay,
      });
      if ((index + 1) % 100 === 0)
        options.progress?.(
          'Calculated ' + (index + 1) + '/' + assignments.length + ' attendance approvals',
        );
    }
    for (const month of [...new Set(approved.map((a) => a.day.slice(0, 7)))]) {
      const start = month + '-01',
        end = monthEnd(month),
        rows = approved.filter((a) => a.day.startsWith(month));
      const fullMonth = from <= start && lastDay >= addDay(end, -1),
        finalizeAt = historyTimestamp(end, 600),
        paidAt = historyTimestamp(addDay(end, 2), 960);
      const willFinalize = fullMonth && Date.parse(finalizeAt) <= cutoffMs,
        willPay = willFinalize && Date.parse(paidAt) <= cutoffMs;
      const createdAt = willFinalize
        ? addMinutes(finalizeAt, -30)
        : rows
            .map((a) => a.approvalAt)
            .sort()
            .at(-1)!;
      const runId = identity('payroll:' + month);
      await add('payroll_run', [
        {
          id: runId,
          restaurant_id: restaurantId,
          period_start: start,
          period_end: end,
          status: 'DRAFT',
          created_by: adminId,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ]);
      const slips = new Map<string, string>();
      for (const person of people.filter((p) => rows.some((r) => r.userId === p.id))) {
        const id = identity('slip:' + month + ':' + person.id);
        slips.set(person.id, id);
        await add('payroll_slip', [
          {
            id,
            restaurant_id: restaurantId,
            payroll_run_id: runId,
            user_id: person.id,
            employee_name_snapshot: person.display_name,
            username_snapshot: person.username,
            created_at: createdAt,
          },
        ]);
      }
      await add(
        'payroll_line',
        rows.map((a) => ({
          id: identity('line:' + a.id),
          restaurant_id: restaurantId,
          payroll_slip_id: slips.get(a.userId),
          attendance_id: a.id,
          line_type: 'WORK',
          description: 'Công ' + a.name.toLowerCase() + ' ngày ' + a.day,
          minutes: a.pay.approvedMinutes,
          hourly_rate_snapshot: a.pay.hourlyRate,
          amount: a.pay.amount,
          created_by: adminId,
          created_at: createdAt,
          pay_components: a.pay.payComponents,
          pay_snapshot: a.pay.paySnapshot,
          paid_periods: a.pay.paidPeriods,
        })),
      );
      if (fullMonth)
        for (const person of people.filter(
          (p) => ['bep001', 'pv001'].includes(p.username) && slips.has(p.id),
        ))
          await add('payroll_line', [
            {
              id: identity('bonus:' + month + ':' + person.id),
              restaurant_id: restaurantId,
              payroll_slip_id: slips.get(person.id),
              attendance_id: null,
              line_type: 'BONUS',
              description: 'Thưởng trách nhiệm điều phối và bàn giao ca tháng ' + month.slice(5),
              minutes: null,
              hourly_rate_snapshot: null,
              amount: '200000',
              created_by: adminId,
              created_at: createdAt,
              pay_components: null,
              pay_snapshot: null,
              paid_periods: null,
            },
          ]);
      const totals = (
        await c.query(
          'SELECT s.id,COALESCE(sum(l.amount),0)::text AS amount FROM payroll_slip s JOIN payroll_line l ON l.payroll_slip_id=s.id WHERE s.payroll_run_id=$1 GROUP BY s.id',
          [runId],
        )
      ).rows;
      if (willFinalize) {
        // Runtime touch_updated_at records ingestion time. Operational finalized_at/paid_at retain historical evidence.
        await c.query(
          "UPDATE payroll_run SET status='FINALIZED',finalized_by=$2,finalized_at=$3 WHERE id=$1",
          [runId, adminId, finalizeAt],
        );
        await audit(
          'FINALIZE_PAYROLL',
          'PAYROLL_RUN',
          runId,
          'Chốt bảng lương chính thức',
          { totalAmount: totals.reduce((n, row) => n + BigInt(row.amount), 0n).toString() },
          finalizeAt,
        );
      }
      if (willPay) {
        for (const slip of totals)
          if (BigInt(slip.amount) > 0n) {
            const payment = {
              id: identity('salary:' + slip.id),
              restaurant_id: restaurantId,
              payroll_slip_id: slip.id,
              amount: slip.amount,
              reference: 'Chi lương tháng ' + month + ' theo phiếu nhân viên',
              paid_by: adminId,
              paid_at: paidAt,
            };
            await add('payroll_payment', [payment]);
            await audit('PAY_SALARY', 'PAYROLL_SLIP', slip.id, payment.reference, payment, paidAt);
          }
        await c.query(
          "UPDATE payroll_run SET status='PAID',paid_by=$2,paid_at=$3,payment_reference=$4 WHERE id=$1",
          [runId, adminId, paidAt, 'Đã ghi nhận chi từng phiếu nhân viên tháng ' + month],
        );
      }
    }
    await c.query(
      'ANALYZE shift_assignment, attendance_record, payroll_run, payroll_slip, payroll_line, payroll_payment',
    );
    const invariants = await validateWorkforceHistory(c, restaurantId, from, cutoff);
    if (Object.values(invariants).some((n) => n !== 0))
      throw new Error('Workforce history invariants failed: ' + JSON.stringify(invariants));
    await add('business_audit_event', [
      {
        id: markerId,
        restaurant_id: restaurantId,
        actor_id: adminId,
        action: 'IMPORT_WORKFORCE_HISTORY',
        resource_type: 'RESTAURANT',
        resource_id: restaurantId,
        reason:
          'Ghi nhận lịch sử phân ca, công đã duyệt và chi lương theo chính sách của nhà hàng.',
        details: {
          datasetKey,
          from,
          through,
          cutoff,
          counts: { ...counts, business_audit_event: (counts.business_audit_event ?? 0) + 1 },
        },
        created_at: cutoff,
      },
    ]);
    await c.query(options.apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: options.apply === true, alreadyApplied: false, cutoff, counts, invariants };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
