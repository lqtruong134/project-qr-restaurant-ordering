'use client';
import { useEffect, useRef, type ReactNode } from 'react';

const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  menu: 'M4 3h16v18H4ZM8 7h8M8 12h8M8 17h5',
  table: 'M3 5h18v10H3ZM6 15v6m12-6v6M8 5v10m8-10v10',
  box: 'm3 7 9-4 9 4v11l-9 4-9-4Zm0 0 9 4 9-4M12 11v11',
  people:
    'M15 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-3-4M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 0a4 4 0 0 1 0 8',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
  chart: 'M3 3v18h18M7 16v-5m5 5V7m5 9V4',
  bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Zm5 3h4',
  chef: 'M7 14a5 5 0 0 1-2-9 5 5 0 0 1 8-2 5 5 0 0 1 6 9v2M7 14v7h10v-7M7 17h10',
  bag: 'M4 7h16l1 14H3ZM8 7V5a4 4 0 0 1 8 0v2',
  check: 'm5 12 4 4L19 6',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
  close: 'm6 6 12 12M18 6 6 18',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 2',
  receipt: 'M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 7h8M8 11h8M8 15h4',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 1 0 1 4m-1-4v-5m0 5h-5',
  leaf: 'M4 20c-4-14 8-9 16-17 2 14-5 20-14 14m-2 3 11-10',
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.menu} />
    </svg>
  );
}
export function Empty({
  title,
  children,
  icon = 'menu',
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Stat({
  title,
  value,
  hint,
  icon = 'chart',
}: {
  title: string;
  value: ReactNode;
  hint?: string;
  icon?: string;
}) {
  return (
    <article className="stat-card">
      <div>
        <span className="stat-label">{title}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <span className="stat-icon">
        <Icon name={icon} />
      </span>
    </article>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={'app-dialog' + (wide ? ' dialog-wide' : '')}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Đóng">
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function Search({
  value,
  onChange,
  placeholder = 'Tìm kiếm…',
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-field">
      <Icon name="search" />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function matches(value: string, search: string) {
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/đ/g, 'd');
  return normalize(value).includes(normalize(search));
}
