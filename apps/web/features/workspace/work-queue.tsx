'use client';
import { SessionReference } from '../shared/session-reference';
import { type Order, type Row } from '../shared/components';
import { Empty, Icon, Search, matches } from '../shared/primitives';
import { tableWork, requestOwner, type TableJob } from './table-work';
import { restaurantTime } from '../shared/restaurant-time';

export function workState(job: TableJob, userId: string) {
  const request = job.request;
  if (!request || request.status === 'NEW') return 'common';
  if (request.pending_to_staff_id === userId) return 'incoming';
  return request.acknowledged_by === userId ? 'mine' : 'other';
}

const views = [
  ['common', 'Việc chung'],
  ['mine', 'Tôi phụ trách'],
  ['incoming', 'Bàn giao đến tôi'],
  ['other', 'Đồng nghiệp phụ trách'],
] as const;
const kinds = [
  ['all', 'Tất cả loại'],
  ['payment', 'Thu tiền'],
  ['serve', 'Mang món'],
  ['support', 'Hỗ trợ khách'],
  ['verification', 'Xác minh bàn'],
  ['issue', 'Sự cố'],
  ['refund', 'Hoàn tiền'],
  ['review', 'Duyệt món'],
  ['clean', 'Dọn bàn'],
] as const;
const rank: Record<string, number> = { incoming: 0, mine: 1, common: 2, other: 3 };

export function WorkQueue({
  tables,
  orders,
  support,
  alerts,
  userId,
  search,
  setSearch,
  kind,
  setKind,
  view,
  setView,
  open,
}: {
  tables: Row[];
  orders: Order[];
  support: Row[];
  alerts: Row[];
  userId: string;
  search: string;
  setSearch: (s: string) => void;
  kind: string;
  setKind: (s: string) => void;
  view: string;
  setView: (s: string) => void;
  open: (table: Row, tab: string, requestId?: string) => void;
}) {
  const allJobs = tables.flatMap((table) =>
    tableWork(table, orders, support, alerts).map((job) => ({ table, job })),
  );
  const all = allJobs.filter(
    ({ table, job }) =>
      matches(
        String(table.name) +
          ' ' +
          table.code +
          ' ' +
          job.title +
          ' ' +
          job.detail +
          ' ' +
          String(job.request?.acknowledged_by_name ?? ''),
        search,
      ) &&
      (kind === 'all' || job.kind === kind),
  );
  const count = (state: string) => all.filter(({ job }) => workState(job, userId) === state).length;
  const jobs = all.filter(({ job }) => workState(job, userId) === view);
  const grouped = new Map<string, { table: Row; jobs: TableJob[] }>();
  for (const item of jobs) {
    const existing = grouped.get(item.table.id);
    if (existing) existing.jobs.push(item.job);
    else grouped.set(item.table.id, { table: item.table, jobs: [item.job] });
  }
  const cards = [...grouped.values()].sort((a, b) => {
    const oldest = (items: TableJob[]) =>
      Math.min(...items.map((job) => Date.parse(job.time) || Date.now()));
    return (
      oldest(a.jobs) - oldest(b.jobs) || String(a.table.code).localeCompare(String(b.table.code))
    );
  });
  return (
    <section className="work-queue queue-board" aria-label="Hàng đợi công việc">
      <div className="queue-board-heading">
        <div>
          <h2>Việc tại bàn</h2>
          <p>Mỗi bàn một thẻ. Mở chi tiết để nhận yêu cầu hoặc xử lý công việc.</p>
        </div>
      </div>
      <div className="queue-filter-toolbar">
        <Search value={search} onChange={setSearch} placeholder="Tìm tên hoặc mã bàn…" />
        <label className="queue-kind-select">
          Loại công việc
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map(([value, title]) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav className="queue-views" aria-label="Người phụ trách công việc">
        {views.map(([value, title]) => (
          <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
            <span>{title}</span>
            <b>{count(value)} việc</b>
          </button>
        ))}
      </nav>
      <div className="queue-board-summary" role="status">
        <strong>
          {cards.length} bàn - {jobs.length} việc
        </strong>
        <span>
          {view === 'common'
            ? 'Yêu cầu chưa có người nhận và công việc chung. Mở xem chưa phải nhận việc.'
            : view === 'mine'
              ? 'Các yêu cầu bạn đã nhận. Tiếp tục xử lý hoặc bàn giao trong chi tiết bàn.'
              : view === 'incoming'
                ? 'Người gửi vẫn phụ trách cho đến khi bạn đồng ý nhận bàn giao.'
                : 'Xem người đang phụ trách. Muốn tiếp tục xử lý cần đồng nghiệp bàn giao.'}
        </span>
      </div>
      {!cards.length && (
        <Empty
          title={allJobs.length ? 'Không có bàn trong nhóm đang xem' : 'Chưa có công việc tại bàn'}
        >
          {allJobs.length
            ? 'Chọn nhóm khác hoặc thay bộ lọc để xem công việc.'
            : 'Yêu cầu của khách và việc tại bàn sẽ hiện ở đây khi phát sinh.'}
        </Empty>
      )}
      <div className="queue-table-grid">
        {cards.map(({ table, jobs }) => {
          const preview = [...jobs].sort(
            (a, b) =>
              (rank[workState(a, userId)] ?? 4) - (rank[workState(b, userId)] ?? 4) ||
              (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0),
          );
          const first = preview[0]!;
          const newest = Math.max(...jobs.map((job) => Date.parse(job.time) || 0));
          return (
            <article className="queue-table-card" key={table.id} data-table-id={table.id}>
              <header>
                <div>
                  <h3>
                    {String(table.name)}
                    <SessionReference id={table.session_id} />
                  </h3>
                  <small>{String(table.area_name)}</small>
                </div>
                <span className="queue-job-count">{jobs.length} việc</span>
              </header>
              <ul className="queue-job-preview">
                {preview.slice(0, 3).map((job) => (
                  <li key={job.kind + ':' + job.id} data-queue-request-id={job.request?.id}>
                    <span className={'work-badge kind-' + job.kind}>
                      <Icon name={job.icon} size={15} />
                      {job.title}
                    </span>
                    <small>
                      {job.request
                        ? (workState(job, userId) === 'incoming' ? 'Bàn giao đến bạn - ' : '') +
                          requestOwner(job.request, userId)
                        : 'Việc chung'}
                    </small>
                  </li>
                ))}
              </ul>
              {jobs.length > 3 && (
                <small className="queue-more">Còn {jobs.length - 3} việc trong chi tiết bàn</small>
              )}
              <footer>
                <small>
                  {newest
                    ? 'Cập nhật ' +
                      restaurantTime(new Date(newest).toISOString(), {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''}
                </small>
                <button
                  className="primary-button"
                  onClick={() =>
                    open(table, jobs.length > 1 ? 'tasks' : first.tab, first.request?.id)
                  }
                >
                  Chi tiết bàn <Icon name="arrow" size={16} />
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
