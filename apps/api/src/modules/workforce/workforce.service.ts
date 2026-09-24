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
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input) ||
    !Number.isFinite(Date.parse(input))
  )
    reject('Thời gian cần có ngày, giờ và múi giờ hợp lệ.', 400);
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
export const assignmentQuery = `SELECT a.*,s.name AS shift_name,s.break_minutes,u.username,u.display_name,d.name AS area_name,
 t.id AS attendance_id,t.checked_in_at,t.checked_out_at,t.status AS attendance_status,t.approved_minutes,t.hourly_rate_snapshot,t.amount,t.review_note
 FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id JOIN app_user u ON u.id=a.user_id
 LEFT JOIN dining_area d ON d.id=a.area_id LEFT JOIN attendance_record t ON t.assignment_id=a.id`;
