'use client';
import { vnd } from '../shared/components';
import { duration } from './ui';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const positive = (value: unknown) => Number(value ?? 0) > 0;
const parts = [
  ['baseAmount', 'Tiền công cơ bản', '100% đơn giá cá nhân cho các giờ đã làm'],
  ['nightAmount', 'Cộng làm đêm', 'Phần cộng thêm cho giờ làm từ 22:00 đến 06:00'],
  ['overtimeAmount', 'Cộng làm thêm ngày thường', 'Phần cộng thêm ngoài tiền công cơ bản'],
  ['restDayAmount', 'Cộng làm ngày nghỉ tuần', 'Theo ngày nghỉ đã đăng ký của nhân viên'],
  ['holidayAmount', 'Cộng làm ngày lễ', 'Phần cộng thêm cho giờ làm trong ngày lễ'],
  ['paidHolidayAmount', 'Lương nghỉ lễ', 'Giờ nghỉ lễ được hưởng lương; tách riêng giờ đã làm'],
] as const;

export function PayBreakdown({
  components,
  heading = 'Các khoản tiền công',
}: {
  components: unknown;
  heading?: string;
}) {
  const values = object(components);
  if (!values) return null;
  return (
    <section className="wf-pay-breakdown" aria-label={heading || 'Các khoản tiền công'}>
      {heading && <h4>{heading}</h4>}
      <dl>
        {parts
          .filter(([key]) => positive(values[key]))
          .map(([key, label, note]) => (
            <div key={key}>
              <dt>
                {label}
                <small>{note}</small>
              </dt>
              <dd>{vnd(values[key])}</dd>
            </div>
          ))}
        <div className="wf-pay-breakdown-total">
          <dt>Tổng tiền công</dt>
          <dd>{vnd(values.totalAmount)}</dd>
        </div>
      </dl>
    </section>
  );
}

const stamp = (value: unknown) => {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};
const segmentLabel = (segment: Record<string, unknown>) => {
  if (segment.kind === 'PAID_HOLIDAY') return 'Nghỉ lễ hưởng lương';
  const day =
    segment.dayKind === 'HOLIDAY'
      ? 'Ngày lễ'
      : segment.dayKind === 'WEEKLY_REST'
        ? 'Ngày nghỉ tuần'
        : 'Ngày thường';
  return [
    day,
    segment.kind === 'OVERTIME' ? 'Làm thêm' : 'Trong ca',
    segment.isNight ? 'Ban đêm' : 'Ban ngày',
  ].join(' · ');
};

export function PayDetails({ components, snapshot }: { components: unknown; snapshot?: unknown }) {
  const saved = object(snapshot);
  const values = object(components) ?? object(saved?.components);
  if (!values) return null;
  const segments = Array.isArray(saved?.segments)
    ? saved.segments.map(object).filter((value): value is Record<string, unknown> => !!value)
    : [];
  return (
    <details className="wf-pay-details">
      <summary>Chi tiết tiền công</summary>
      <PayBreakdown components={values} heading="" />
      {!!segments.length && (
        <div className="wf-table-scroll">
          <table className="wf-table wf-pay-segments">
            <caption>Các khoảng được duyệt · giờ Việt Nam</caption>
            <thead>
              <tr>
                <th>Khoảng thời gian</th>
                <th>Loại công</th>
                <th>Giờ công</th>
                <th>Đơn giá cơ bản / giờ</th>
                <th>Mức hưởng</th>
                <th>Tiền công</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment, index) => (
                <tr key={`${segment.startsAt}-${index}`}>
                  <td data-label="Khoảng thời gian">
                    {stamp(segment.startsAt)}
                    <br />→ {stamp(segment.endsAt)}
                  </td>
                  <td data-label="Loại công">{segmentLabel(segment)}</td>
                  <td data-label="Giờ công">{duration(segment.minutes)}</td>
                  <td data-label="Đơn giá cơ bản / giờ">{vnd(segment.hourlyRate)}</td>
                  <td data-label="Mức hưởng">{String(segment.totalPercent ?? 100)}%</td>
                  <td data-label="Tiền công">{vnd(segment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="wf-pay-snapshot-note">
        Đơn giá và chính sách được lưu tại lúc duyệt công. Giờ làm đêm có thể đồng thời là giờ làm
        thêm hoặc ngày lễ.
      </p>
    </details>
  );
}
export default PayBreakdown;
