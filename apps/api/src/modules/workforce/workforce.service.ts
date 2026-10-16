import type { Database } from '@thesis/database';
import { one, reject, transaction, type Connection } from '../shared/core-persistence.js';

// Serialize attendance approval, rate changes and payroll closure per restaurant.
export function workforceTransaction<T>(
  db: Database,
  restaurant: string,
  fn: (c: Connection) => Promise<T>,
) {
  return transaction(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,530053))', [restaurant]);
    return fn(c);
  });
}
export function timestamp(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      input,
    ) ||
    !Number.isFinite(Date.parse(input))
  )
    reject('Thời gian cần có ngày, giờ và múi giờ hợp lệ.', 400);
  date(input.slice(0, 10));
  return new Date(input).toISOString();
}
export function date(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
    !Number.isFinite(Date.parse(input)) ||
    new Date(input).toISOString().slice(0, 10) !== input
  )
    reject('Ngày không hợp lệ.', 400);
  return input;
}
export async function assertOpenPeriod(c: Connection, restaurant: string, startsAt: unknown) {
  const existing = await c.query(
    `SELECT p.id FROM payroll_run p JOIN restaurant r ON r.id=p.restaurant_id
    WHERE p.restaurant_id=$1 AND ($2::timestamptz AT TIME ZONE r.timezone)::date>=p.period_start
    AND ($2::timestamptz AT TIME ZONE r.timezone)::date<p.period_end AND p.status<>'DRAFT'`,
    [restaurant, startsAt],
  );
  if (existing.rowCount) reject('Ngày công nằm trong kỳ lương đã chốt.');
}
export async function employee(c: Connection, id: string, restaurant: string) {
  return one(
    c,
    `SELECT u.id,u.username,u.display_name
     FROM app_user u
     JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
     JOIN role r ON r.id=ur.role_id
     WHERE u.id=$1 AND u.restaurant_id=$2 AND u.status='ACTIVE' AND r.code<>'ADMIN'
     FOR UPDATE OF u`,
    [id, restaurant],
  );
}
export async function assertAssignmentAvailable(
  c: Connection,
  restaurant: string,
  user: { id: string; display_name: string; username: string },
  shift: { id: string; starts_at: unknown; ends_at: unknown },
  explainRollback = false,
) {
  const conflict = (
    await c.query(
      `SELECT a.shift_id,a.status,s.name AS shift_name,
       to_char(a.starts_at AT TIME ZONE r.timezone,'DD/MM/YYYY HH24:MI') AS starts_label,
       to_char(a.ends_at AT TIME ZONE r.timezone,'DD/MM/YYYY HH24:MI') AS ends_label
       FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id
       JOIN restaurant r ON r.id=a.restaurant_id
       WHERE a.restaurant_id=$1 AND a.user_id=$2
       AND ((a.status='ASSIGNED' AND a.starts_at<$4 AND a.ends_at>$3) OR a.shift_id=$5)
       ORDER BY CASE WHEN a.shift_id=$5 THEN 0 ELSE 1 END,a.starts_at LIMIT 1`,
      [restaurant, user.id, shift.starts_at, shift.ends_at, shift.id],
    )
  ).rows[0];
  if (!conflict) return;
  const person = user.display_name || user.username;
  const period = `${conflict.starts_label} → ${conflict.ends_label}`;
  const ca = `“${conflict.shift_name}” (${period})`;
  const message =
    conflict.status === 'CANCELLED'
      ? `Nhân viên ${person} đã có phân công bị hủy trong ca ${ca}. Chọn người thay thế hoặc lập lịch khác.`
      : conflict.shift_id === shift.id
        ? `Nhân viên ${person} đã được phân công vào ca ${ca}.`
        : `Nhân viên ${person} có ca ${ca} trùng giờ.`;
  reject(
    message +
      (explainRollback
        ? ' Không có lịch hoặc phân công mới nào được lưu; hãy điều chỉnh lựa chọn.'
        : ''),
  );
}
export { attendanceSummary } from './attendance.js';

export const assignmentQuery = `SELECT a.*,s.name AS shift_name,s.break_minutes,s.hourly_rate_override,s.attendance_grace_minutes,s.clock_in_early_minutes,s.clock_out_late_minutes,s.template_id,u.username,u.display_name,d.name AS area_name,
 t.id AS attendance_id,t.checked_in_at,t.checked_out_at,t.status AS attendance_status,t.approved_minutes,t.hourly_rate_snapshot,t.amount,t.review_note,t.outcome,t.approval_mode,t.rate_source,t.pay_components,t.pay_snapshot,t.paid_periods,
 (t.pay_snapshot IS NOT NULL OR COALESCE(t.status,'RECORDED')<>'APPROVED' AND EXISTS(SELECT 1 FROM workforce_pay_policy p JOIN restaurant r ON r.id=p.restaurant_id WHERE p.restaurant_id=a.restaurant_id AND p.effective_from<=(a.starts_at AT TIME ZONE r.timezone)::date)) AS pay_policy_active,
 COALESCE(t.hourly_rate_snapshot,CASE WHEN EXISTS(SELECT 1 FROM workforce_pay_policy p JOIN restaurant r ON r.id=p.restaurant_id WHERE p.restaurant_id=a.restaurant_id AND p.effective_from<=(a.starts_at AT TIME ZONE r.timezone)::date) THEN NULL ELSE s.hourly_rate_override END,(SELECT p.hourly_rate FROM employee_pay_rate p WHERE p.user_id=a.user_id AND p.restaurant_id=a.restaurant_id AND p.effective_from<=a.starts_at ORDER BY p.effective_from DESC LIMIT 1)) AS effective_hourly_rate
 FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id JOIN app_user u ON u.id=a.user_id
 LEFT JOIN dining_area d ON d.id=a.area_id LEFT JOIN attendance_record t ON t.assignment_id=a.id`;
