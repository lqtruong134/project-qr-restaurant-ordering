import type { Row } from '../shared/components';
import { addDays, localDay } from './ui';

export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Tháng không hợp lệ');
  const from = month + '-01';
  const next = new Date(from + 'T12:00:00Z');
  next.setUTCMonth(next.getUTCMonth() + 1);
  const to = addDays(next.toISOString().slice(0, 10), -1);
  return {
    from,
    to,
    days: Array.from({ length: Number(to.slice(8)) }, (_, i) => addDays(from, i)),
  };
}
export const previousMonth = (today = localDay()) =>
  addDays(today.slice(0, 7) + '-01', -1).slice(0, 7);
export const shortHours = (minutes: unknown) => {
  const n = Number(minutes ?? 0);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
export const canReview = (a: Row, now = Date.now()) =>
  a.status === 'ASSIGNED' &&
  a.attendance_status !== 'APPROVED' &&
  a.classification !== 'ACTIVE' &&
  new Date(String(a.ends_at)).getTime() <= now;
export const canApproveStandard = (a: Row, now = Date.now()) =>
  canReview(a, now) &&
  a.classification === 'NORMAL' &&
  !a.requires_exception &&
  (!a.pay_policy_active || Number(a.break_minutes) === 0) &&
  Number(a.actual_minutes) > 0 &&
  Number(a.effective_hourly_rate) >= 1000;
export function monthRows(rows: Row[], month: string) {
  return rows.filter(
    (a) => a.status !== 'CANCELLED' && localDay(a.starts_at).startsWith(month + '-'),
  );
}
export function totals(rows: Row[]) {
  const approved = rows.filter((a) => a.attendance_status === 'APPROVED');
  return {
    assigned: rows.length,
    approved: approved.length,
    minutes: approved.reduce((n, a) => n + Number(a.approved_minutes ?? 0), 0),
    amount: approved.reduce((n, a) => n + BigInt(String(a.amount ?? 0)), 0n),
    leave: approved.filter((a) => a.outcome === 'LEAVE').length,
    absent: approved.filter((a) => a.outcome === 'ABSENT').length,
    pending: rows.filter((a) => canReview(a)).length,
    exceptions: rows.filter((a) => canReview(a) && !canApproveStandard(a)).length,
  };
}
export function cellLabel(rows: Row[]) {
  if (!rows.length) return '—';
  const t = totals(rows);
  return (
    [
      t.minutes ? shortHours(t.minutes) : '',
      t.leave ? 'N' : '',
      t.absent ? 'V' : '',
      t.pending ? '!' : '',
      !t.approved && !t.pending ? 'L' : '',
    ]
      .filter(Boolean)
      .join(' - ') || '0:00'
  );
}
export function csv(rows: unknown[][]) {
  return (
    '\ufeff' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? '');
            if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
export function downloadCsv(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
