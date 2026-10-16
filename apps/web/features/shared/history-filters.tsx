'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Row } from './components';
import { Empty, Icon, Search } from './primitives';
import {
  historyBounds,
  historyDay,
  historyMatches,
  type HistoryQuery,
  type HistoryPeriod,
} from './history-range';
type Option = { value: string; label: string };
const initialQuery = (): HistoryQuery => ({
  period: 'all',
  from: historyDay(),
  to: historyDay(),
  q: '',
  status: 'all',
});
function Controls({
  query,
  change,
  placeholder,
  statuses = [],
  children,
  onReset,
  showTimeFilter = true,
}: {
  query: HistoryQuery;
  change: (query: HistoryQuery) => void;
  onReset?: () => void;
  showTimeFilter?: boolean;
  placeholder: string;
  statuses?: Option[];
  children?: ReactNode;
}) {
  return (
    <div className="history-controls" aria-label="Bộ lọc lịch sử">
      <Search value={query.q} onChange={(q) => change({ ...query, q })} placeholder={placeholder} />
      {showTimeFilter && (
        <label>
          Thời gian
          <select
            aria-label="Thời gian"
            value={query.period}
            onChange={(e) => change({ ...query, period: e.target.value as HistoryPeriod })}
          >
            <option value="all">Tất cả thời gian</option>
            <option value="today">Hôm nay</option>
            <option value="week">Tuần này</option>
            <option value="month">Tháng này</option>
            <option value="custom">Khoảng ngày</option>
          </select>
        </label>
      )}
      {showTimeFilter && query.period === 'custom' && (
        <>
          <label>
            Từ ngày
            <input
              aria-label="Từ ngày"
              type="date"
              value={query.from}
              onChange={(e) => change({ ...query, from: e.target.value })}
            />
          </label>
          <label>
            Đến ngày
            <input
              aria-label="Đến ngày"
              type="date"
              value={query.to}
              min={query.from}
              onChange={(e) => change({ ...query, to: e.target.value })}
            />
          </label>
        </>
      )}
      {!!statuses.length && (
        <label>
          Phân loại
          <select
            aria-label="Phân loại"
            value={query.status}
            onChange={(e) => change({ ...query, status: e.target.value })}
          >
            <option value="all">Tất cả</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {children}
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          change(initialQuery());
          onReset?.();
        }}
      >
        Xóa bộ lọc
      </button>
    </div>
  );
}
function Pagination({
  total,
  page,
  size,
  change,
}: {
  total: number;
  page: number;
  size: number;
  change: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="history-pagination" aria-label="Phân trang lịch sử">
      <span role="status">
        {total
          ? `${page * size + 1}–${Math.min(total, (page + 1) * size)} / ${total} kết quả`
          : '0 kết quả'}
      </span>
      <div>
        <button
          type="button"
          className="secondary-button"
          aria-label="Trang trước"
          disabled={!page}
          onClick={() => change(page - 1)}
        >
          ‹
        </button>
        <span>
          Trang {page + 1} / {pages}
        </span>
        <button
          type="button"
          className="secondary-button"
          aria-label="Trang sau"
          disabled={page >= pages - 1}
          onClick={() => change(page + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}
export function HistoryList<T>({
  items,
  date,
  end,
  search,
  state,
  statuses,
  placeholder = 'Tìm nội dung, người hoặc lý do…',
  children,
  dateOnly = false,
  empty = 'Không có lịch sử phù hợp',
  showTimeFilter = true,
}: {
  items: T[];
  date: (item: T) => unknown;
  end?: (item: T) => unknown;
  search: (item: T) => string;
  state?: (item: T) => string;
  statuses?: Option[];
  placeholder?: string;
  children: (items: T[]) => ReactNode;
  dateOnly?: boolean;
  empty?: string;
  showTimeFilter?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery),
    [page, setPage] = useState(0);
  let error = '',
    filtered: T[] = [];
  try {
    historyBounds(query);
    filtered = items.filter(
      (item) =>
        search(item)
          .toLocaleLowerCase('vi-VN')
          .includes(query.q.trim().toLocaleLowerCase('vi-VN')) &&
        (query.status === 'all' || state?.(item) === query.status) &&
        historyMatches(date(item), query, undefined, end?.(item), dateOnly),
    );
  } catch (e) {
    error = (e as Error).message;
  }
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 12) - 1));
  return (
    <div className="history-view">
      <Controls
        query={query}
        change={(q) => {
          setQuery(q);
          setPage(0);
        }}
        placeholder={placeholder}
        statuses={statuses}
        showTimeFilter={showTimeFilter}
      />
      {query.period !== 'all' && (
        <small className="history-scope">
          {dateOnly
            ? 'Lọc theo kỳ có giao với khoảng ngày đã chọn.'
            : 'Theo ngày tại nhà hàng - Tuần và tháng tính đến hôm nay.'}
        </small>
      )}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : filtered.length ? (
        children(filtered.slice(current * 12, current * 12 + 12))
      ) : (
        <Empty title={empty} icon="clock">
          {showTimeFilter
            ? 'Đổi thời gian, từ khóa hoặc phân loại để xem các mục khác.'
            : 'Đổi từ khóa hoặc phân loại để xem các mục khác.'}
        </Empty>
      )}
      <Pagination total={filtered.length} page={current} size={12} change={setPage} />
    </div>
  );
}
type HistoryPage = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  timezone: string;
  range: { startDay: string; endDay: string } | null;
};
export function ServerHistory({
  kind,
  children,
  placeholder,
  statuses,
  controls,
  filters = {},
  initialSearch = '',
  onReset,
  refreshKey,
  empty = 'Không có lịch sử phù hợp',
  showTimeFilter = true,
}: {
  kind: string;
  children: (rows: Row[]) => ReactNode;
  placeholder: string;
  statuses?: Option[];
  controls?: ReactNode;
  filters?: Record<string, string>;
  initialSearch?: string;
  onReset?: () => void;
  showTimeFilter?: boolean;
  refreshKey?: unknown;
  empty?: string;
}) {
  const [query, setQuery] = useState(() => ({ ...initialQuery(), q: initialSearch })),
    [page, setPage] = useState(0),
    [version, setVersion] = useState(0),
    [data, setData] = useState<HistoryPage>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const extra = JSON.stringify(filters),
    refresh = JSON.stringify(refreshKey);
  const key = JSON.stringify({ kind, query, extra });
  const [previous, setPrevious] = useState(key);
  if (previous !== key) {
    setPrevious(key);
    setPage(0);
  }
  let invalid = '';
  try {
    historyBounds(query);
  } catch (e) {
    invalid = (e as Error).message;
  }
  useEffect(() => {
    if (invalid) {
      setBusy(false);
      setData(undefined);
      return;
    }
    let active = true;
    setBusy(true);
    setError('');
    const params = new URLSearchParams({ ...query, ...JSON.parse(extra), page: String(page) });
    const timer = setTimeout(
      () =>
        void api<HistoryPage>('/core/history/' + kind + '?' + params)
          .then((d) => {
            if (active) setData(d);
          })
          .catch((e) => {
            if (active) {
              setError(e.message);
              setData(undefined);
            }
          })
          .finally(() => {
            if (active) setBusy(false);
          }),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [kind, query, extra, refresh, page, version, invalid]);
  return (
    <div className="history-view">
      <Controls
        query={query}
        change={(q) => {
          setQuery(q);
          setPage(0);
        }}
        placeholder={placeholder}
        statuses={statuses}
        onReset={onReset}
      >
        {controls}
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => setVersion((v) => v + 1)}
        >
          <Icon name="refresh" size={16} />
          Làm mới
        </button>
      </Controls>
      <small className="history-scope">
        {data?.range
          ? `${data.range.startDay} → ${data.range.endDay} - Theo ngày tại nhà hàng`
          : 'Tra cứu lịch sử trong phạm vi bạn được xem.'}
      </small>
      {invalid || error ? (
        <p role="alert" className="form-error">
          {invalid || error}
        </p>
      ) : busy ? (
        <p role="status">Đang tải lịch sử…</p>
      ) : data?.rows.length ? (
        children(data.rows)
      ) : (
        <Empty title={empty} icon="clock">
          {showTimeFilter
            ? 'Đổi thời gian, từ khóa hoặc phân loại để xem các mục khác.'
            : 'Đổi từ khóa hoặc phân loại để xem các mục khác.'}
        </Empty>
      )}
      {!busy && !invalid && !error && data && (
        <Pagination total={data.total} page={data.page} size={data.pageSize} change={setPage} />
      )}
    </div>
  );
}
