'use client';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

const paths: Record<string, string> = {
  'panel-close': 'M4 3h16v18H4ZM9 3v18m7-12-3 3 3 3',
  'panel-open': 'M4 3h16v18H4ZM9 3v18m4-12 3 3-3 3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 7v7m0-10v.1',
  warning: 'M12 3 2 21h20ZM12 9v5m0 3v.1',
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
      className="ui-icon"
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
let requestDiscard: (() => Promise<boolean>) | undefined;
export async function confirmDiscard(
  root: ParentNode | null = Array.from(document.querySelectorAll('dialog[open]')).at(-1) ?? null,
) {
  if (!root?.querySelector('form[data-dirty="true"]')) return true;
  return (await requestDiscard?.()) ?? false;
}
const openDialogs = new Set<HTMLDialogElement>();
let previousBodyOverflow = '';
export function Modal({
  title,
  children,
  close,
  wide = false,
  blocking = false,
  headingContent,
  className = '',
  descriptionId,
  initialFocus,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  blocking?: boolean;
  headingContent?: ReactNode;
  className?: string;
  descriptionId?: string;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialogElement = ref.current;
    if (!dialogElement) return;
    dialogElement.showModal();
    (initialFocus?.current ?? dialogElement.querySelector<HTMLHeadingElement>('h2'))?.focus({
      preventScroll: true,
    });
    if (openDialogs.size === 0) previousBodyOverflow = document.body.style.overflow;
    openDialogs.add(dialogElement);
    document.body.style.overflow = 'hidden';
    return () => {
      dialogElement.close();
      openDialogs.delete(dialogElement);
      if (openDialogs.size === 0) document.body.style.overflow = previousBodyOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  async function requestClose() {
    if (blocking || closing.current) return;
    closing.current = true;
    try {
      if (await confirmDiscard(ref.current)) close();
    } finally {
      closing.current = false;
    }
  }
  return (
    <dialog
      ref={ref}
      className={'app-dialog' + (wide ? ' dialog-wide' : '') + (className ? ' ' + className : '')}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void requestClose();
      }}
      aria-label={title}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="dialog-heading">
        <h2 id={titleId} tabIndex={-1}>
          {title}
        </h2>
        {headingContent}
        {!blocking && (
          <button className="icon-button" onClick={requestClose} aria-label="Đóng">
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function DiscardDialogHost() {
  const [pending, setPending] = useState(false);
  const resolvePending = useRef<((discard: boolean) => void) | undefined>(undefined);
  const continueButton = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  useEffect(() => {
    const request = () => {
      // Only the first pending action may proceed; repeated requests keep their form open.
      if (resolvePending.current) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        resolvePending.current = resolve;
        setPending(true);
      });
    };
    requestDiscard = request;
    return () => {
      if (requestDiscard === request) requestDiscard = undefined;
      resolvePending.current?.(false);
      resolvePending.current = undefined;
    };
  }, []);
  function finish(discard: boolean) {
    const resolve = resolvePending.current;
    resolvePending.current = undefined;
    setPending(false);
    resolve?.(discard);
  }
  if (!pending) return null;
  return (
    <Modal
      title="Bỏ thay đổi chưa lưu?"
      className="discard-dialog"
      descriptionId={descriptionId}
      initialFocus={continueButton}
      close={() => finish(false)}
    >
      <div className="confirm-dialog">
        <span className="confirm-dialog-icon">
          <Icon name="warning" size={24} />
        </span>
        <p id={descriptionId}>
          Những thay đổi bạn vừa nhập chưa được lưu. Chọn “Bỏ thay đổi” sẽ bỏ phần chỉnh sửa này.
        </p>
        <div className="confirm-dialog-actions">
          <button ref={continueButton} className="primary-button" onClick={() => finish(false)}>
            Tiếp tục chỉnh sửa
          </button>
          <button className="secondary-button discard-button" onClick={() => finish(true)}>
            Bỏ thay đổi
          </button>
        </div>
      </div>
    </Modal>
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
        autoComplete="off"
        enterKeyHint="search"
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
