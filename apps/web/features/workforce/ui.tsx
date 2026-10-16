import type { ReactNode } from 'react';
import type { Row } from '../shared/components';
import { Icon } from '../shared/primitives';

const zone = 'Asia/Ho_Chi_Minh';
export const localDay = (v: unknown = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(String(v)));
export const clock = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleTimeString('vi-VN', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
export const dateLabel = (v: string, weekday = false) => {
  const label = `${v.slice(8, 10)}/${v.slice(5, 7)}`;
  return weekday
    ? `${new Date(v + 'T12:00:00+07:00').toLocaleDateString('vi-VN', { timeZone: zone, weekday: 'short' })}, ${label}`
    : label;
};
export const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const monday = (day: string) =>
  addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
export const duration = (n: unknown) => {
  const m = Number(n ?? 0);
  return `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
};
export const shiftTime = (a: Row) =>
  `${clock(a.starts_at)} – ${clock(a.ends_at)}${localDay(a.starts_at) !== localDay(a.ends_at) ? ' (+1 ngày)' : ''}`;
export function attendanceState(a: Row, now = Date.now()) {
  if (a.status === 'CANCELLED') return { label: 'Đã hủy', tone: 'muted' };
  if (a.attendance_status === 'APPROVED') return { label: 'Đã duyệt', tone: 'green' };
  if (a.checked_out_at) return { label: 'Đã ra ca - chờ duyệt', tone: 'blue' };
  if (a.classification === 'MISSING_OUT')
    return { label: 'Thiếu giờ ra - cần bổ sung công', tone: 'amber' };
  if (a.checked_in_at && !a.checked_out_at) return { label: 'Đang trong ca', tone: 'blue' };
  if (new Date(String(a.ends_at)).getTime() <= now)
    return { label: 'Chờ duyệt công', tone: 'amber' };
  return { label: 'Đã phân công', tone: 'muted' };
}
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`wf-badge wf-${tone}`}>{children}</span>;
}
export function Person({ name, sub }: { name: unknown; sub?: unknown }) {
  return (
    <div className="wf-person">
      <span className="wf-avatar" aria-hidden="true">
        {String(name).slice(0, 1)}
      </span>
      <div>
        <strong>{String(name)}</strong>
        {sub != null && <small>{String(sub)}</small>}
      </div>
    </div>
  );
}
export function PanelHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="wf-heading">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children && <div className="wf-actions">{children}</div>}
    </div>
  );
}
export function WeekNav({ week, onChange }: { week: string; onChange: (s: string) => void }) {
  return (
    <div className="wf-week-nav">
      <button
        className="icon-button"
        aria-label="Tuần trước"
        onClick={() => onChange(addDays(week, -7))}
      >
        ‹
      </button>
      <strong>
        {dateLabel(week)}/{week.slice(0, 4)} – {dateLabel(addDays(week, 6))}/
        {addDays(week, 6).slice(0, 4)}
      </strong>
      <button
        className="icon-button"
        aria-label="Tuần sau"
        onClick={() => onChange(addDays(week, 7))}
      >
        ›
      </button>
      <button className="secondary-button" onClick={() => onChange(monday(localDay()))}>
        Tuần này
      </button>
    </div>
  );
}
export function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="wf-hint">
      <Icon name="clock" size={18} />
      <p>{children}</p>
    </div>
  );
}
