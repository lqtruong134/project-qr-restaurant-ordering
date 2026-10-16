'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../shared/primitives';
import { dishProgressSummary, type DishNoticeFeed } from './dish-notices';
import type { Row } from '../shared/components';

export function GuestLiveNotice({
  feed,
  orders,
  openOrders,
}: {
  feed: DishNoticeFeed | undefined;
  orders: Row[];
  openOrders: () => void;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [distance, setDistance] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const notices = feed?.notices ?? [];
  const current = notices[active % Math.max(notices.length, 1)];
  const message = current?.text ?? dishProgressSummary(orders);
  const stopped = paused || hovered || focused || reducedMotion;
  const rotationMs = Math.max(8000, Math.min(30_000, distance * 28 + 5000));
  const newestId = notices[0]?.id;
  useEffect(() => setActive(0), [newestId]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (stopped || notices.length < 2) return;
    const timer = setInterval(() => setActive((index) => index + 1), rotationMs);
    return () => clearInterval(timer);
  }, [stopped, notices.length, rotationMs]);
  useEffect(() => {
    const measure = () =>
      setDistance(
        Math.max(0, (text.current?.scrollWidth ?? 0) - (viewport.current?.clientWidth ?? 0)),
      );
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (text.current) observer.observe(text.current);
    return () => observer.disconnect();
  }, [message]);
  return (
    <section
      className="guest-live-notice"
      aria-label="Cập nhật món tại bàn"
      data-tone={current?.tone ?? 'normal'}
      data-paused={stopped}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span className="guest-live-notice-label">
        <Icon name={current?.tone === 'attention' ? 'info' : 'chef'} size={18} />
        <strong>Từ bếp</strong>
      </span>
      <div
        className="guest-live-notice-message"
        ref={viewport}
        data-scroll={distance > 2}
        aria-live="off"
        title={message}
      >
        <span
          className="guest-live-notice-text"
          key={current?.id ?? message}
          ref={text}
          style={
            {
              '--notice-distance': '-' + distance + 'px',
              '--notice-duration': rotationMs - 1500 + 'ms',
            } as CSSProperties
          }
        >
          {message}
        </span>
      </div>
      <div className="guest-live-notice-actions">
        {notices.length > 1 && (
          <>
            <button
              type="button"
              className="guest-live-notice-next"
              aria-label="Thông báo tiếp theo"
              onClick={() => {
                setPaused(true);
                setActive((index) => index + 1);
              }}
            >
              <span aria-hidden="true">
                {(active % notices.length) + 1}/{notices.length}
              </span>
              <Icon name="arrow" size={16} />
            </button>
          </>
        )}
        {!reducedMotion && (distance > 2 || notices.length > 1) && (
          <button
            type="button"
            className="guest-live-notice-pause"
            aria-label={paused ? 'Tiếp tục chạy thông báo' : 'Tạm dừng thông báo'}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? 'Chạy' : 'Dừng'}
          </button>
        )}
        <button type="button" className="guest-live-notice-open" onClick={openOrders}>
          Món đã gọi <Icon name="arrow" size={16} />
        </button>
      </div>
      <span
        className="guest-live-notice-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feed?.announcement ?? ''}
      </span>
    </section>
  );
}
