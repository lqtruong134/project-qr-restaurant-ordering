'use client';
import { useEffect, useId, useState } from 'react';
import { api, vnd } from '../shared/components';
import { Icon } from '../shared/primitives';
import type { AdminOpen, OverviewSnapshot } from './admin-overview';

type Period = 'today' | 'week' | 'month';
type Totals = {
  collected: string;
  refunded: string;
  net: string;
  orders: number;
  sessions: number;
};
type Point = {
  label: string;
  collected: string;
  refunded: string;
  orders: number;
  sessions: number;
};
export type OverviewStatistics = {
  period: Period;
  updatedAt: string;
  timezone: string;
  startDay: string;
  endDay: string;
  previousStartDay: string;
  previousEndDay: string;
  granularity: 'hour' | 'day';
  current: Totals;
  previous: Totals;
  series: Point[];
  topSales: OverviewSnapshot['topSales'];
};
const periods: Record<Period, string> = {
  today: 'Hôm nay',
  week: '7 ngày qua',
  month: 'Tháng này',
};
const shortDay = (day: string) => day.split('-').slice(1).reverse().join('/');
const range = (start: string, end: string) =>
  start === end ? shortDay(start) : `${shortDay(start)} – ${shortDay(end)}`;
function Comparison({
  current,
  previous,
  money = false,
}: {
  current: string | number;
  previous: string | number;
  money?: boolean;
}) {
  const diff = BigInt(current) - BigInt(previous);
  if (diff === 0n) return <small className="period-comparison">Bằng khoảng trước</small>;
  const magnitude = diff < 0n ? -diff : diff;
  return (
    <small className={'period-comparison ' + (diff > 0n ? 'increase' : 'decrease')}>
      {diff > 0n ? '↑ Tăng' : '↓ Giảm'} {money ? vnd(magnitude.toString()) : magnitude.toString()}{' '}
      so với khoảng trước
    </small>
  );
}
function PeriodMetric({
  title,
  current,
  previous,
  money,
  icon,
  onClick,
}: {
  title: string;
  current: string | number;
  previous: string | number;
  money?: boolean;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      className="period-metric"
      onClick={onClick}
      aria-label={`${title}: ${money ? vnd(current) : current}. Xem chi tiết`}
    >
      <span className="period-metric-top">
        <span>{title}</span>
        <Icon name={icon} size={18} />
      </span>
      <strong>{money ? vnd(current) : current}</strong>
      <Comparison current={current} previous={previous} money={money} />
    </button>
  );
}
const compact = (value: number) =>
  new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
function TrendChart({ points, money, title }: { points: Point[]; money: boolean; title: string }) {
  const id = useId();
  const [chosen, setChosen] = useState<number>();
  const index = Math.min(chosen ?? points.length - 1, points.length - 1);
  const keys = money ? (['collected', 'refunded'] as const) : (['orders', 'sessions'] as const);
  const names = money ? ['Đã thu', 'Đã hoàn'] : ['Lượt gọi món', 'Phiên bàn mở'];
  const max = Math.max(money ? 1000 : 3, ...points.flatMap((p) => keys.map((k) => Number(p[k]))));
  const plot = { left: 48, right: 584, top: 20, bottom: 176 };
  const x = (i: number) =>
    points.length === 1
      ? (plot.left + plot.right) / 2
      : plot.left + (i * (plot.right - plot.left)) / (points.length - 1);
  const y = (n: number) => plot.bottom - (n / max) * (plot.bottom - plot.top);
  const lines = keys.map((k) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(p[k]))}`).join(' '),
  );
  const shown = points[index];
  return (
    <figure className="overview-trend">
      <div className="chart-legend">
        {names.map((name, i) => (
          <span key={name}>
            <i className={'series-dot series-' + i} />
            {name}
          </span>
        ))}
      </div>
      <svg
        viewBox="0 0 600 212"
        role="img"
        aria-labelledby={id}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const local = ((event.clientX - box.left) / box.width) * 600;
          setChosen(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(((local - plot.left) / (plot.right - plot.left)) * (points.length - 1)),
              ),
            ),
          );
        }}
      >
        <title id={id}>{title}. Có thể chọn mốc thời gian bên dưới để đọc số chính xác.</title>
        {[0, 1, 2, 3].map((n) => {
          const value = (max * n) / 3;
          return (
            <g key={n}>
              <line
                x1={plot.left}
                x2={plot.right}
                y1={y(value)}
                y2={y(value)}
                className="chart-gridline"
              />
              <text x={plot.left - 7} y={y(value) + 4} textAnchor="end" className="chart-label">
                {money ? compact(value) : Math.round(value)}
              </text>
            </g>
          );
        })}
        {points.length > 1 && (
          <path
            d={`${lines[0]} L${x(points.length - 1)},${plot.bottom} L${x(0)},${plot.bottom} Z`}
            className="chart-area"
          />
        )}
        {lines.map((line, i) => (
          <path key={i} d={line} className={'chart-line series-' + i} />
        ))}
        {points.map((p, i) => (
          <g key={p.label}>
            {keys.map((k, n) => (
              <circle
                key={k}
                cx={x(i)}
                cy={y(Number(p[k]))}
                r={i === index ? 4 : 2.2}
                className={'chart-point series-' + n}
              />
            ))}
          </g>
        ))}
        {points.map((p, i) =>
          i === 0 ||
          i === points.length - 1 ||
          i % Math.max(1, Math.ceil(points.length / 6)) === 0 ? (
            <text key={p.label} x={x(i)} y={202} textAnchor="middle" className="chart-label">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="chart-readout">
        <label>
          Mốc thời gian{' '}
          <select
            aria-label={'Mốc thời gian: ' + title}
            value={index}
            onChange={(e) => setChosen(Number(e.target.value))}
          >
            {points.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {shown && (
          <div>
            {keys.map((k, i) => (
              <span key={k}>
                {names[i]} <strong>{money ? vnd(shown[k]) : shown[k]}</strong>
              </span>
            ))}
          </div>
        )}
      </figcaption>
      {!points.some((p) => keys.some((k) => Number(p[k]) > 0)) && (
        <p className="chart-zero">
          Chưa có {money ? 'giao dịch thành công' : 'lượt gọi món hoặc phiên bàn mới'} trong khoảng
          này.
        </p>
      )}
    </figure>
  );
}
function TrendTable({ data, money }: { data: OverviewStatistics; money: boolean }) {
  const a = money ? 'Đã thu' : 'Lượt gọi món',
    b = money ? 'Đã hoàn' : 'Phiên bàn mở';
  return (
    <table className="overview-data-table">
      <caption>
        {money ? 'Tiền thu và hoàn' : 'Lượt gọi món và phiên bàn'} theo{' '}
        {data.granularity === 'hour' ? 'giờ' : 'ngày'}
      </caption>
      <thead>
        <tr>
          <th scope="col">Mốc thời gian</th>
          <th scope="col">{a}</th>
          <th scope="col">{b}</th>
        </tr>
      </thead>
      <tbody>
        {data.series.map((p) => (
          <tr key={p.label}>
            <th scope="row">{p.label}</th>
            <td data-label={a}>{money ? vnd(p.collected) : p.orders}</td>
            <td data-label={b}>{money ? vnd(p.refunded) : p.sessions}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Tổng</th>
          <td data-label={a}>{money ? vnd(data.current.collected) : data.current.orders}</td>
          <td data-label={b}>{money ? vnd(data.current.refunded) : data.current.sessions}</td>
        </tr>
      </tfoot>
    </table>
  );
}
function SummaryStrip({ items }: { items: { title: string; value: string; previous?: string }[] }) {
  return (
    <dl className="chart-summary-strip">
      {items.map((item) => (
        <div key={item.title}>
          <dt>{item.title}</dt>
          <dd>{item.value}</dd>
          {item.previous && <small>Khoảng trước: {item.previous}</small>}
        </div>
      ))}
    </dl>
  );
}
function TableStatus({ tables, open }: { tables: OverviewSnapshot['tables']; open: AdminOpen }) {
  const parts = [
    { label: 'Đang phục vụ', value: tables.occupied, color: 'var(--brand)' },
    { label: 'Chờ dọn', value: tables.cleaning, color: 'var(--orange)' },
    { label: 'Sẵn sàng', value: tables.available, color: '#8da899' },
  ];
  const total = parts.reduce((n, p) => n + p.value, 0);
  let offset = 0;
  return (
    <section className="core-card overview-chart-card table-status-card">
      <header>
        <div>
          <span className="chart-eyebrow">Đang diễn ra</span>
          <h3>Tình trạng bàn</h3>
        </div>
        <span className="live-pill">
          <i /> Hiện tại
        </span>
      </header>
      <div className="table-status-content">
        <div className="table-ring">
          <svg
            viewBox="0 0 160 160"
            role="img"
            aria-label={parts.map((p) => `${p.value} bàn ${p.label.toLowerCase()}`).join(', ')}
          >
            <circle cx="80" cy="80" r="61" fill="none" stroke="var(--line)" strokeWidth="17" />
            {parts.map((p) => {
              const length = total ? (p.value / total) * 100 : 0;
              const start = offset;
              offset += length;
              return (
                <circle
                  key={p.label}
                  cx="80"
                  cy="80"
                  r="61"
                  fill="none"
                  stroke={p.color}
                  strokeWidth="17"
                  pathLength="100"
                  strokeDasharray={`${length} ${100 - length}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 80 80)"
                />
              );
            })}
          </svg>
          <div>
            <strong>{tables.total}</strong>
            <span>bàn đang dùng</span>
          </div>
        </div>
        <ul>
          {parts.map((p) => (
            <li key={p.label}>
              <span>
                <i style={{ background: p.color }} />
                {p.label}
              </span>
              <strong>{p.value}</strong>
            </li>
          ))}
        </ul>
      </div>
      <p className="chart-note">
        Chỉ tính bàn và khu vực đang sử dụng. Số này luôn là hiện tại, không đổi theo kỳ thống kê.
      </p>
      <footer>
        <button className="secondary-button" onClick={() => open('tables')}>
          Xem bàn & QR <Icon name="arrow" size={16} />
        </button>
      </footer>
    </section>
  );
}
export default function OverviewCharts({
  snapshot,
  open,
  refreshVersion,
}: {
  snapshot: OverviewSnapshot;
  open: AdminOpen;
  refreshVersion: number;
}) {
  const [period, setPeriod] = useState<Period>('week');
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  const [data, setData] = useState<OverviewStatistics>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true,
      inFlight = false;
    async function load() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const fresh = await api<OverviewStatistics>(
          '/core/admin/overview/statistics?period=' + period,
        );
        if (active) {
          setData(fresh);
          setError('');
        }
      } catch {
        if (active) setError('Chưa tải được thống kê. Bấm Làm mới để thử lại.');
      } finally {
        inFlight = false;
        if (active) setBusy(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30000);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [period, refreshVersion]);
  const current = data?.period === period ? data : undefined;
  return (
    <section className="overview-statistics" aria-label="Thống kê theo thời gian" aria-busy={busy}>
      <div className="statistics-toolbar">
        <div>
          <span className="chart-eyebrow">Theo kỳ thống kê</span>
          <h3>Thống kê tổng quan</h3>
          <p>
            {current
              ? `${range(current.startDay, current.endDay)} - đến ${new Intl.DateTimeFormat('vi-VN', { timeZone: current.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(current.updatedAt))} - ${current.timezone}`
              : 'Đang tải khoảng thống kê…'}
          </p>
        </div>
        <div className="statistics-controls">
          <div className="period-tabs" role="group" aria-label="Khoảng thống kê">
            {(Object.keys(periods) as Period[]).map((p) => (
              <button
                key={p}
                aria-pressed={p === period}
                className={p === period ? 'selected' : ''}
                onClick={() => {
                  if (p !== period) {
                    setBusy(true);
                    setError('');
                    setPeriod(p);
                  }
                }}
              >
                {periods[p]}
              </button>
            ))}
          </div>
          <div className="chart-view-toggle" role="group" aria-label="Cách xem thống kê">
            <button
              aria-pressed={mode === 'chart'}
              onClick={() => setMode('chart')}
              title="Xem biểu đồ"
            >
              <Icon name="chart" size={17} />
              Biểu đồ
            </button>
            <button
              aria-pressed={mode === 'table'}
              onClick={() => setMode('table')}
              title="Xem bảng số liệu"
            >
              <Icon name="menu" size={17} />
              Bảng số liệu
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
          {current && ' Đang giữ số liệu lần cập nhật gần nhất.'}
        </p>
      )}
      {!current ? (
        <div className="statistics-loading" role="status">
          {error ? 'Thống kê chưa có dữ liệu để hiển thị.' : 'Đang tải thống kê nhà hàng…'}
        </div>
      ) : (
        <>
          <div className="period-metrics">
            <PeriodMetric
              title="Tiền đã thu"
              current={current.current.collected}
              previous={current.previous.collected}
              money
              icon="receipt"
              onClick={() => open('reports', 'payments')}
            />
            <PeriodMetric
              title="Tiền đã hoàn"
              current={current.current.refunded}
              previous={current.previous.refunded}
              money
              icon="receipt"
              onClick={() => open('reports', 'reconciliation')}
            />
            <PeriodMetric
              title="Thu sau hoàn"
              current={current.current.net}
              previous={current.previous.net}
              money
              icon="chart"
              onClick={() => open('reports', 'reconciliation')}
            />
            <PeriodMetric
              title="Phiên bàn mở"
              current={current.current.sessions}
              previous={current.previous.sessions}
              icon="table"
              onClick={() => open('reports', 'reconciliation')}
            />
          </div>
          <p className="comparison-scope">
            So với {range(current.previousStartDay, current.previousEndDay)}, cùng số ngày và đến
            cùng giờ. Thu sau hoàn = tiền đã thu − tiền đã hoàn, chưa trừ chi phí.
          </p>
          <div className="overview-chart-grid">
            <section className="core-card overview-chart-card">
              <header>
                <div>
                  <span className="chart-eyebrow">
                    {periods[period]} - {range(current.startDay, current.endDay)}
                  </span>
                  <h3>Tiền thu & hoàn</h3>
                </div>
                <Icon name="chart" size={20} />
              </header>
              <SummaryStrip
                items={[
                  {
                    title: 'Đã thu',
                    value: vnd(current.current.collected),
                    previous: vnd(current.previous.collected),
                  },
                  {
                    title: 'Đã hoàn',
                    value: vnd(current.current.refunded),
                    previous: vnd(current.previous.refunded),
                  },
                ]}
              />
              {mode === 'chart' ? (
                <TrendChart
                  key={period + '-money'}
                  points={current.series}
                  money
                  title="Tiền thu & hoàn"
                />
              ) : (
                <TrendTable data={current} money />
              )}
              <p className="chart-note">
                Tiền thu là thanh toán tiền món, không gồm tiền thối và chưa trừ tiền hoàn. Tiền
                hoàn tính theo ngày nhân viên xác nhận đã trả cho khách.
              </p>
              <footer>
                <button className="secondary-button" onClick={() => open('reports', 'payments')}>
                  Xem giao dịch thanh toán <Icon name="arrow" size={16} />
                </button>
              </footer>
            </section>
            <section className="core-card overview-chart-card">
              <header>
                <div>
                  <span className="chart-eyebrow">
                    {periods[period]} - {range(current.startDay, current.endDay)}
                  </span>
                  <h3>Lượt gọi món & phiên bàn</h3>
                </div>
                <Icon name="people" size={20} />
              </header>
              <SummaryStrip
                items={[
                  {
                    title: 'Lượt gọi món đã gửi',
                    value: String(current.current.orders),
                    previous: String(current.previous.orders),
                  },
                  {
                    title: 'Phiên bàn mở',
                    value: String(current.current.sessions),
                    previous: String(current.previous.sessions),
                  },
                ]}
              />
              {mode === 'chart' ? (
                <TrendChart
                  key={period + '-activity'}
                  points={current.series}
                  money={false}
                  title="Lượt gọi món & phiên bàn"
                />
              ) : (
                <TrendTable data={current} money={false} />
              )}
              <p className="chart-note">
                Một phiên có thể gửi nhiều lượt gọi món. Lượt đã gửi vẫn được đếm nếu sau đó bị hủy.
              </p>
              <footer>
                <button
                  className="secondary-button"
                  onClick={() => open('reports', 'reconciliation')}
                >
                  Xem các phiên thanh toán <Icon name="arrow" size={16} />
                </button>
              </footer>
            </section>
            <section className="core-card overview-chart-card">
              <header>
                <div>
                  <span className="chart-eyebrow">{periods[period]} - 5 món đứng đầu</span>
                  <h3>Món nổi bật</h3>
                </div>
                <Icon name="menu" size={20} />
              </header>
              <p className="chart-note">
                Món đã phục vụ trong kỳ, xếp theo tiền đang tính sau miễn tiền.
              </p>
              {current.topSales.length ? (
                <ol className={'top-product-bars ' + (mode === 'table' ? 'numbers-only' : '')}>
                  {current.topSales.map((item, i) => (
                    <li key={item.product_id + '-' + item.name}>
                      <div>
                        <span className="product-rank">{i + 1}</span>
                        <span>
                          {item.name}
                          <small>{item.quantity} phần đã phục vụ</small>
                        </span>
                        <strong>{vnd(item.amount)}</strong>
                      </div>
                      {mode === 'chart' && (
                        <span className="product-bar-track">
                          <span
                            style={{
                              width: `${(Math.max(0, Number(item.amount)) / Math.max(1, ...current.topSales.map((p) => Number(p.amount)))) * 100}%`,
                            }}
                          />
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="chart-zero">Chưa có món đã phục vụ trong khoảng này.</p>
              )}
              <footer>
                <button className="secondary-button" onClick={() => open('reports', 'sales')}>
                  Xem báo cáo bán hàng <Icon name="arrow" size={16} />
                </button>
              </footer>
            </section>
            <TableStatus tables={snapshot.tables} open={open} />
          </div>
        </>
      )}
    </section>
  );
}
