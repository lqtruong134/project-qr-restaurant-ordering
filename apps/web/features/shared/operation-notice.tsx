'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './primitives';

const NOTICE_DURATION_MS = 5000;
type Notice = { id: number; message: string; tone: 'success' | 'info' };
let current: Notice | undefined;
let nextId = 0;
const listeners = new Set<() => void>();
function emit(message: string, tone: Notice['tone']) {
  current = { id: ++nextId, message, tone };
  listeners.forEach((listener) => listener());
}
export function notifySuccess(message: string) {
  emit(message, 'success');
}
export function notifyInfo(message: string) {
  emit(message, 'info');
}
function dismiss(id: number) {
  if (current?.id !== id) return;
  current = undefined;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function OperationNoticeHost() {
  const notice = useSyncExternalStore(
    subscribe,
    () => current,
    () => undefined,
  );
  const [target, setTarget] = useState<HTMLElement>();
  const [hoveredId, setHoveredId] = useState<number>();
  const [focusedId, setFocusedId] = useState<number>();
  const [hidden, setHidden] = useState(false);
  const clock = useRef({ id: 0, remaining: NOTICE_DURATION_MS });
  const [progress, setProgress] = useState({ id: 0, remaining: NOTICE_DURATION_MS });
  const paused = hidden || hoveredId === notice?.id || focusedId === notice?.id;
  useEffect(() => {
    const update = () => {
      const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(
        -1,
      );
      setTarget(dialog ?? document.body);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    if (clock.current.id !== notice.id)
      clock.current = { id: notice.id, remaining: NOTICE_DURATION_MS };
    setProgress({ ...clock.current });
    if (paused) return;
    const remaining = clock.current.remaining;
    const startedAt = Date.now();
    const update = () =>
      setProgress({ id: notice.id, remaining: Math.max(0, remaining - (Date.now() - startedAt)) });
    const interval = setInterval(update, 100);
    const timer = setTimeout(() => dismiss(notice.id), remaining);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
      clock.current.remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
  }, [notice, paused]);
  if (!target) return null;
  const fraction =
    notice && progress.id === notice.id ? progress.remaining / NOTICE_DURATION_MS : 1;
  return createPortal(
    <div className="operation-notice-region">
      {notice && (
        <div
          className={'operation-notice ' + notice.tone}
          role="status"
          aria-atomic="true"
          key={notice.id}
          onMouseEnter={() => setHoveredId(notice.id)}
          onMouseLeave={() => setHoveredId(undefined)}
          onFocusCapture={() => setFocusedId(notice.id)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(undefined);
          }}
        >
          <span className="operation-notice-icon" aria-hidden="true">
            <Icon name={notice.tone === 'success' ? 'check' : 'info'} size={20} />
          </span>
          <div className="operation-notice-message">
            <strong>{notice.tone === 'success' ? 'Thành công' : 'Thông tin'}</strong>
            <p>{notice.message}</p>
          </div>
          <button
            type="button"
            className="icon-button operation-notice-close"
            aria-label="Đóng thông báo"
            onClick={() => dismiss(notice.id)}
          >
            <Icon name="close" size={18} />
          </button>
          <span className="operation-notice-progress" aria-hidden="true">
            <span
              className="operation-notice-progress-fill"
              style={{ transform: 'scaleX(' + fraction + ')' }}
            />
          </span>
        </div>
      )}
    </div>,
    target,
  );
}
