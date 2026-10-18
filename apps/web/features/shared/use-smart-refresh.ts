'use client';
import { useEffect, useMemo, useRef } from 'react';
import { createSmartRefresh } from './smart-refresh';

export function useSmartRefresh(
  load: (signal: AbortSignal) => Promise<void>,
  {
    enabled = true,
    intervalMs,
    initial = true,
  }: {
    enabled?: boolean;
    intervalMs: number | false;
    initial?: boolean;
  },
) {
  const options = useRef({ enabled, intervalMs });
  options.current = { enabled, intervalMs };
  const scheduler = useMemo(
    () =>
      createSmartRefresh(load, {
        enabled: () => options.current.enabled,
        intervalMs: () => options.current.intervalMs,
        canRefresh: () => !document.hidden && navigator.onLine !== false,
      }),
    [load],
  );
  useEffect(() => {
    scheduler.start(initial);
    const resume = () => scheduler.wake();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    window.addEventListener('focus', resume);
    return () => {
      scheduler.stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      window.removeEventListener('focus', resume);
    };
  }, [scheduler, initial]);
  useEffect(() => scheduler.synchronize(), [scheduler, enabled, intervalMs]);
  return scheduler.refresh;
}
