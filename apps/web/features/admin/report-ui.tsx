'use client';
import { useState, type ReactNode } from 'react';
import { Icon } from '../shared/primitives';
import { vnd, type Row } from '../shared/components';

export type ReportPeriod = 'today' | 'week' | 'month' | 'custom' | 'all';
export type ReportQuery = {
  period: ReportPeriod;
  start: string;
  end: string;
  search: string;
  filter: string;
  status: string;
  sort: string;
  page: number;
};
export type ReportData = {
  scope: {
    period: ReportPeriod;
    startDay: string;
    endDay: string;
    timezone: string;
    updatedAt: string;
    granularity: string;
  };
  summary: Record<string, string | number | boolean | null>;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  options?: { id: string | null; name: string }[];
  series?: { at: string; label: string; primary: string; secondary: string }[];
  breakdown?: { name: string; value: string }[];
};
export const defaultReportQuery: ReportQuery = {
  period: 'month',
  start: '',
  end: '',
  search: '',
  filter: '',
  status: '',
  sort: 'newest',
  page: 1,
};
type Option = { value: string; label: string };
const periods: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'week', label: 'Tuần này' },
  { value: 'month', label: 'Tháng này' },
  { value: 'custom', label: 'Chọn ngày' },
  { value: 'all', label: 'Toàn bộ' },
];
export function ReportControls({
  query,
  change,
  refresh,
  busy,
  scope,
  placeholder,
  filters = [],
  statuses = [],
  sorts,
}: {
  query: ReportQuery;
  change: (value: Partial<ReportQuery>) => void;
  refresh: () => void;
  busy: boolean;
  scope?: ReportData['scope'];
  placeholder: string;
  filters?: Option[];
  statuses?: Option[];
  sorts: Option[];
}) {
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState(query.start),
    [end, setEnd] = useState(query.end);
  return (
    <section className="report-controls core-card" aria-label="Bộ lọc báo cáo">
      <div className="report-control-top">
        <div className="report-periods" role="group" aria-label="Kỳ báo cáo">
          {periods.map((p) => (
            <button
              key={p.value}
              aria-pressed={
                p.value === 'custom'
                  ? custom || query.period === 'custom'
                  : !custom && query.period === p.value
              }
              onClick={() => {
                if (p.value === 'custom') {
                  setCustom(true);
                  setStart(query.start || scope?.startDay || '');
                  setEnd(query.end || scope?.endDay || '');
                } else {
                  setCustom(false);
                  change({ period: p.value, page: 1 });
                }
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button className="secondary-button" onClick={refresh} disabled={busy}>
          <Icon name="refresh" /> Làm mới
        </button>
      </div>
      {custom && (
        <form
          className="report-custom-dates"
          onSubmit={(e) => {
            e.preventDefault();
            change({ period: 'custom', start, end, page: 1 });
          }}
        >
          <label>
            Từ ngày
            <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Đến ngày
            <input
              type="date"
              required
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button type="submit" className="primary-button">
            Áp dụng khoảng ngày
          </button>
        </form>
      )}
      <div className="report-filter-grid">
        <label className="report-search">
          <span>Tìm kiếm</span>
          <input
            type="search"
            aria-label="Tìm trong báo cáo"
            value={query.search}
            maxLength={100}
            placeholder={placeholder}
            onChange={(e) => change({ search: e.target.value, page: 1 })}
          />
        </label>
        {filters.length > 0 && (
          <label>
            <span>Phân loại</span>
            <select
              aria-label="Phân loại báo cáo"
              value={query.filter}
              onChange={(e) => change({ filter: e.target.value, page: 1 })}
            >
              <option value="">Tất cả</option>
              {filters.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {statuses.length > 0 && (
          <label>
            <span>Trạng thái</span>
            <select
              aria-label="Trạng thái báo cáo"
              value={query.status}
              onChange={(e) => change({ status: e.target.value, page: 1 })}
            >
              <option value="">Tất cả</option>
              {statuses.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>Sắp xếp</span>
          <select
            aria-label="Sắp xếp báo cáo"
            value={query.sort}
            onChange={(e) => change({ sort: e.target.value, page: 1 })}
          >
            {sorts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="report-scope-line">
        <small>
          {scope
            ? `${scope.startDay.split('-').reverse().join('/')} – ${scope.endDay.split('-').reverse().join('/')} - Giờ nhà hàng - Cập nhật ${new Intl.DateTimeFormat('vi-VN', { timeZone: scope.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(scope.updatedAt))}`
            : 'Đang lấy số liệu theo kỳ đã chọn…'}
        </small>
        {(query.search || query.filter || query.status) && (
          <button
            className="secondary-button"
            onClick={() => change({ search: '', filter: '', status: '', page: 1 })}
          >
            Xóa bộ lọc
          </button>
        )}
      </div>
    </section>
  );
}
export function ReportMetrics({
  items,
}: {
  items: { label: string; value: string | number | null; money?: boolean; hint: string }[];
}) {
  return (
    <div className="report-metrics">
      {items.map((i) => (
        <article key={i.label} className="core-card">
          <span>{i.label}</span>
          <strong className={i.value === null ? 'report-value-unavailable' : undefined}>
            {i.value === null ? 'Chưa có dữ liệu tách VAT' : i.money ? vnd(i.value) : i.value}
          </strong>
          <small>{i.hint}</small>
        </article>
      ))}
    </div>
  );
}
export function ReportPagination({
  total,
  page,
  pageSize = 10,
  change,
}: {
  total: number;
  page: number;
  pageSize?: number;
  change: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="report-pagination" aria-label="Phân trang báo cáo">
      <small>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total} kết quả`
          : '0 kết quả'}
      </small>
      <div>
        <button
          className="secondary-button"
          aria-label="Trang trước"
          disabled={page <= 1}
          onClick={() => change(page - 1)}
        >
          Trước
        </button>
        <span>
          Trang {page} / {pages}
        </span>
        <button
          className="secondary-button"
          aria-label="Trang sau"
          disabled={page >= pages}
          onClick={() => change(page + 1)}
        >
          Sau
        </button>
      </div>
    </nav>
  );
}
export function ReportTable({
  title,
  columns,
  children,
}: {
  title: string;
  columns: { label: string; width: number; numeric?: boolean }[];
  children: ReactNode;
}) {
  return (
    <table className="report-table">
      <caption className="sr-only">{title}</caption>
      <colgroup>
        {columns.map((c) => (
          <col key={c.label} style={{ width: `${c.width}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.label} scope="col" className={c.numeric ? 'report-numeric' : ''}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
export function ReportCell({
  label,
  numeric = false,
  children,
}: {
  label: string;
  numeric?: boolean;
  children: ReactNode;
}) {
  return (
    <td data-label={label} className={numeric ? 'report-numeric' : ''}>
      <div className="report-cell-content">{children}</div>
    </td>
  );
}
export function ReportBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return <span className={`report-badge ${tone}`}>{children}</span>;
}
