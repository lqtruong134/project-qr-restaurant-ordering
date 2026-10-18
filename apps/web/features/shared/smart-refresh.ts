export type SmartRefreshOptions = {
  enabled: () => boolean;
  intervalMs: () => number | false;
  canRefresh: () => boolean;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
  minimumWakeGapMs?: number;
};

/** One read-model request at a time. Provider reconciliation remains server-side. */
export function createSmartRefresh(
  load: (signal: AbortSignal) => Promise<void>,
  options: SmartRefreshOptions,
) {
  let active = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let queued: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let failures = 0;
  let lastStarted = -Infinity;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const allowed = () => active && options.enabled() && options.canRefresh();
  const schedule = () => {
    clear();
    const interval = options.intervalMs();
    if (!allowed() || interval === false || running) return;
    const delay = Math.min(interval * 2 ** Math.min(failures, 5), options.maxBackoffMs ?? 30000);
    timer = setTimeout(() => {
      timer = undefined;
      if (allowed()) void execute().catch(() => undefined);
    }, delay);
  };
  const execute = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    clear();
    controller = new AbortController();
    const signal = controller.signal;
    lastStarted = Date.now();
    let timedOut = false;
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException('Read-model refresh was interrupted.', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    });
    const deadline = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, options.requestTimeoutMs ?? 10000);
    running = Promise.race([
      Promise.resolve().then(() => {
        if (!signal.aborted) return load(signal);
      }),
      cancelled,
    ])
      .then(() => {
        if (!signal.aborted) failures = 0;
      })
      .catch((error: unknown) => {
        if (!signal.aborted || timedOut) failures++;
        throw error;
      })
      .finally(() => {
        clearTimeout(deadline);
        signal.removeEventListener('abort', abort);
        running = undefined;
        controller = undefined;
        schedule();
      });
    return running;
  };
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (!running) return execute();
    // A mutation/manual recovery may finish while an older poll is in flight.
    // Coalesce callers into one fresh read AFTER that poll, never return stale data as recovery.
    queued ??= running
      .catch(() => undefined)
      .then(() => {
        queued = undefined;
        return execute();
      });
    return queued;
  };
  const wake = () => {
    clear();
    if (!allowed()) return;
    if (running) {
      // React Strict Mode replays effect cleanup/setup; replace the aborted read immediately.
      if (controller?.signal.aborted) void refresh().catch(() => undefined);
      return;
    }
    // focus + visibilitychange + online commonly arrive as one burst.
    const wait = Math.max(0, (options.minimumWakeGapMs ?? 750) - (Date.now() - lastStarted));
    if (wait) {
      timer = setTimeout(() => {
        timer = undefined;
        if (allowed()) void execute().catch(() => undefined);
      }, wait);
    } else void execute().catch(() => undefined);
  };
  return {
    refresh,
    wake,
    synchronize: schedule,
    start(initial = true) {
      active = true;
      stopped = false;
      if (initial) wake();
      else schedule();
    },
    stop() {
      active = false;
      stopped = true;
      clear();
      controller?.abort();
    },
  };
}
