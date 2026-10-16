import type { Row } from '../shared/components';
import { calendarDate } from './format';

export function overlapsDate(shift: Row, date: string) {
  const start = new Date(date + 'T00:00:00+07:00').getTime();
  const end = start + 86400000;
  return (
    new Date(String(shift.starts_at)).getTime() < end &&
    new Date(String(shift.ends_at)).getTime() > start
  );
}
export function assignedOnDate(assignments: Row[], date: string) {
  return assignments.filter((a) => a.status === 'ASSIGNED' && overlapsDate(a, date));
}
export function staffingCount(assignments: Row[], users: Row[]) {
  const live = assignments.filter((a) => a.status === 'ASSIGNED');
  const people = new Set(live.map((a) => a.user_id));
  const roleCount = (role: string) =>
    new Set(
      live
        .filter((a) => users.some((u) => u.id === a.user_id && u.role === role))
        .map((a) => a.user_id),
    ).size;
  return {
    people: people.size,
    assignments: live.length,
    staff: roleCount('STAFF'),
    kitchen: roleCount('KITCHEN'),
  };
}
export function shiftGroupKey(shift: Row) {
  const local = (v: unknown) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(String(v)));
  const offset = Math.round(
    (new Date(calendarDate(shift.ends_at)).getTime() -
      new Date(calendarDate(shift.starts_at)).getTime()) /
      86400000,
  );
  return JSON.stringify([
    shift.name ?? shift.shift_name,
    local(shift.starts_at),
    local(shift.ends_at),
    offset,
    Number(shift.break_minutes),
  ]);
}
