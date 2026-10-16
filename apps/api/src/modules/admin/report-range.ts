export type ReportPeriod = 'today' | 'week' | 'month' | 'custom' | 'all';
const dayMs = 86400000;
function date(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('Chọn ngày hợp lệ.');
  const parsed = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day)
    throw new RangeError('Chọn ngày hợp lệ.');
  return parsed;
}
export function reportRange(
  period: string,
  today: string,
  start?: string,
  end?: string,
  earliest = today,
) {
  if (!['today', 'week', 'month', 'custom', 'all'].includes(period))
    throw new RangeError('Chọn kỳ báo cáo hợp lệ.');
  const current = date(today);
  let startDay = today,
    endDay = today;
  if (period === 'week') {
    current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
    startDay = current.toISOString().slice(0, 10);
  } else if (period === 'month') startDay = today.slice(0, 8) + '01';
  else if (period === 'all') startDay = earliest;
  else if (period === 'custom') {
    startDay = start ?? '';
    endDay = end ?? '';
  }
  const days = (date(endDay).getTime() - date(startDay).getTime()) / dayMs + 1;
  if (days < 1) throw new RangeError('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.');
  if (period === 'custom' && days > 366)
    throw new RangeError('Chọn tối đa 366 ngày cho một lần xem báo cáo.');
  return {
    period: period as ReportPeriod,
    startDay,
    endDay,
    granularity: days === 1 ? 'hour' : days <= 90 ? 'day' : 'month',
  };
}
