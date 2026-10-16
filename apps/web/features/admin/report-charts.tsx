'use client';
import { useId, useState } from 'react';
import { vnd } from '../shared/components';
import { Empty } from '../shared/primitives';
import type { ReportData } from './report-ui';

export function ReportTrend({
  title,
  series,
  primary,
  secondary,
}: {
  title: string;
  series: NonNullable<ReportData['series']>;
  primary: string;
  secondary: string;
}) {
  const [selected, setSelected] = useState(0),
    id = useId();
  const max = Math.max(1000, ...series.flatMap((p) => [Number(p.primary), Number(p.secondary)]));
  const x = (i: number) => (series.length === 1 ? 314 : 56 + (i * 516) / (series.length - 1)),
    y = (v: string) => 178 - (Number(v) * 142) / max;
  const path = (key: 'primary' | 'secondary') =>
    series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`).join(' ');
  const point = series[Math.min(selected, series.length - 1)];
  return (
    <section className="core-card report-chart">
      <h3>{title}</h3>
      <div className="report-legend">
        <span className="primary">{primary}</span>
        <span className="secondary">{secondary}</span>
      </div>
      {series.some((p) => Number(p.primary) || Number(p.secondary)) ? (
        <>
          <svg viewBox="0 0 610 218" role="img" aria-labelledby={id}>
            <title id={id}>{title}. Chọn mốc thời gian bên dưới để xem số tiền chính xác.</title>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1="56"
                  x2="572"
                  y1={178 - 142 * f}
                  y2={178 - 142 * f}
                  className="report-chart-grid"
                />
                <text x="48" y={182 - 142 * f} textAnchor="end">
                  {new Intl.NumberFormat('vi-VN', {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  }).format(max * f)}
                </text>
              </g>
            ))}
            {series.length > 1 && (
              <path
                d={`${path('primary')} L${x(series.length - 1)},178 L56,178 Z`}
                className="report-chart-area"
              />
            )}
            <path d={path('primary')} className="report-chart-primary" />
            <path d={path('secondary')} className="report-chart-secondary" />
            {series.length === 1 && (
              <g className="report-chart-points">
                <circle
                  cx={x(0)}
                  cy={y(series[0]!.primary)}
                  r="4"
                  className="report-point-primary"
                />
                <circle
                  cx={x(0)}
                  cy={y(series[0]!.secondary)}
                  r="4"
                  className="report-point-secondary"
                />
              </g>
            )}
            {series.map(
              (p, i) =>
                (i % Math.max(1, Math.ceil((series.length - 1) / 4)) === 0 ||
                  i === series.length - 1) && (
                  <text key={p.at} x={x(i)} y="202" textAnchor="middle">
                    {p.label}
                  </text>
                ),
            )}
          </svg>
          <label className="report-chart-readout">
            Mốc thời gian
            <select
              aria-label={`Mốc thời gian: ${title}`}
              value={Math.min(selected, series.length - 1)}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {series.map((p, i) => (
                <option key={p.at} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {point && (
            <p className="report-chart-values">
              {primary}: <strong>{vnd(point.primary)}</strong> - {secondary}:{' '}
              <strong>{vnd(point.secondary)}</strong>
            </p>
          )}
        </>
      ) : (
        <Empty title="Chưa có số liệu trong kỳ này">Chọn kỳ khác để xem biến động.</Empty>
      )}
    </section>
  );
}
export function ReportBars({
  title,
  items,
  label = (name) => name,
}: {
  title: string;
  items: NonNullable<ReportData['breakdown']>;
  label?: (name: string) => string;
}) {
  const max = Math.max(1, ...items.map((i) => Number(i.value)));
  return (
    <section className="core-card report-chart">
      <h3>{title}</h3>
      {items.some((i) => Number(i.value)) ? (
        <ol className="report-ranking">
          {items.map((i, index) => (
            <li key={index}>
              <div>
                <span>{label(i.name)}</span>
                <strong>{vnd(i.value)}</strong>
              </div>
              <div className="report-bar-track" aria-hidden="true">
                <span style={{ width: `${(Number(i.value) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="Chưa có số liệu để so sánh">Chọn khoảng thời gian khác để xem số liệu.</Empty>
      )}
    </section>
  );
}
