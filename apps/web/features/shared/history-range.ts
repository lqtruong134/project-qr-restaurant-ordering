export type HistoryPeriod = 'all' | 'today' | 'week' | 'month' | 'custom';
export type HistoryQuery = {
  period: HistoryPeriod;
  from: string;
  to: string;
  q: string;
  status: string;
};
export function historyDay(value: unknown = new Date(), timezone = 'Asia/Ho_Chi_Minh') {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map((k) => parts.find((p) => p.type === k)?.value).join('-');
}
export function historyBounds(query: HistoryQuery, today = historyDay()) {
  let from = today,
    to = today;
  if (query.period === 'all') return { from: '', to: '' };
  if (query.period === 'week') {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    from = d.toISOString().slice(0, 10);
  }
  if (query.period === 'month') from = today.slice(0, 8) + '01';
  if (query.period === 'custom') {
    from = query.from;
    to = query.to;
  }
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(from) || !valid(to) || from > to)
    throw Error('Chọn khoảng ngày hợp lệ; ngày kết thúc không trước ngày bắt đầu.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365)
    throw Error('Chọn tối đa 366 ngày cho một lần tra cứu.');
  return { from, to };
}
export function historyMatches(
  value: unknown,
  query: HistoryQuery,
  today = historyDay(),
  end?: unknown,
  dateOnly = false,
) {
  const { from, to } = historyBounds(query, today);
  if (!from) return true;
  const day = (v: unknown) => (dateOnly ? String(v).slice(0, 10) : historyDay(v));
  return day(end ?? value) >= from && day(value) <= to;
}
