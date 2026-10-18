import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmartRefresh } from './smart-refresh';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());
const settle = () => vi.advanceTimersByTimeAsync(0);

function setup(load = vi.fn<(_: AbortSignal) => Promise<void>>().mockResolvedValue(undefined)) {
  const state = { visible: true, online: true, enabled: true, interval: 3000 as number | false };
  const scheduler = createSmartRefresh(load, {
    enabled: () => state.enabled,
    intervalMs: () => state.interval,
    canRefresh: () => state.visible && state.online,
  });
  return { load, state, scheduler };
}

describe('smart read-model refresh', () => {
  it('polls while pending, stops the payment timer at terminal, and still permits explicit recovery', async () => {
    const { load, state, scheduler } = setup();
    scheduler.start();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(load).toHaveBeenCalledTimes(2);
    state.interval = false;
    scheduler.synchronize();
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(2);
    await scheduler.refresh();
    expect(load).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('pauses hidden/offline, refreshes on foreground, and coalesces focus/visibility/online bursts', async () => {
    const { load, state, scheduler } = setup();
    scheduler.start();
    await settle();
    state.visible = false;
    scheduler.wake();
    await vi.advanceTimersByTimeAsync(15000);
    expect(load).toHaveBeenCalledTimes(1);
    state.visible = true;
    scheduler.wake();
    scheduler.wake();
    scheduler.wake();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    state.online = false;
    scheduler.wake();
    await vi.advanceTimersByTimeAsync(15000);
    expect(load).toHaveBeenCalledTimes(2);
    state.online = true;
    scheduler.wake();
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('never overlaps a slow network request even across polling and focus events', async () => {
    let finish!: () => void;
    const load = vi.fn<(_: AbortSignal) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { scheduler } = setup(load);
    scheduler.start();
    await settle();
    scheduler.wake();
    scheduler.wake();
    await vi.advanceTimersByTimeAsync(9000);
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await settle();
    await vi.advanceTimersByTimeAsync(2999);
    expect(load).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('manual recovery after a mutation waits for the old poll then coalesces exactly one new read', async () => {
    let finish!: () => void;
    const load = vi
      .fn<(_: AbortSignal) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { scheduler } = setup(load);
    scheduler.start();
    await settle();
    const first = scheduler.refresh(),
      second = scheduler.refresh();
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(load).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('backs off errors and resets cadence after a successful read', async () => {
    const load = vi
      .fn<(_: AbortSignal) => Promise<void>>()
      .mockRejectedValueOnce(Error('network'))
      .mockRejectedValueOnce(Error('network'))
      .mockResolvedValue(undefined);
    const { scheduler } = setup(load);
    scheduler.start();
    await settle();
    await vi.advanceTimersByTimeAsync(5999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(11999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3000);
    expect(load).toHaveBeenCalledTimes(4);
    scheduler.stop();
  });

  it('caps backoff at thirty seconds without losing manual recovery', async () => {
    const load = vi.fn<(_: AbortSignal) => Promise<void>>().mockRejectedValue(Error('offline'));
    const { scheduler } = setup(load);
    scheduler.start();
    await settle();
    await vi.advanceTimersByTimeAsync(6000 + 12000 + 24000);
    expect(load).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(29999);
    expect(load).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(5);
    await expect(scheduler.refresh()).rejects.toThrow('offline');
    expect(load).toHaveBeenCalledTimes(6);
    scheduler.stop();
  });

  it('aborts an in-flight read and discards queued/manual work after unmount', async () => {
    let signal!: AbortSignal;
    const load = vi.fn<(_: AbortSignal) => Promise<void>>((input) => {
      signal = input;
      return new Promise<void>((_, reject) =>
        input.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
      );
    });
    const { scheduler } = setup(load);
    scheduler.start();
    await settle();
    const recovery = scheduler.refresh();
    scheduler.stop();
    expect(signal.aborted).toBe(true);
    await recovery;
    await vi.advanceTimersByTimeAsync(60000);
    await scheduler.refresh();
    scheduler.wake();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('bounds a hung read, releases singleflight and backs off even when the transport ignores abort', async () => {
    let initialSignal!: AbortSignal;
    const load = vi
      .fn<(_: AbortSignal) => Promise<void>>()
      .mockImplementationOnce((signal) => {
        initialSignal = signal;
        return new Promise<void>(() => undefined);
      })
      .mockResolvedValue(undefined);
    const { scheduler } = setup(load);
    scheduler.start();
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(initialSignal.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('restarts immediately after effect cleanup/setup without reviving the aborted read', async () => {
    let firstSignal!: AbortSignal;
    const load = vi
      .fn<(_: AbortSignal) => Promise<void>>()
      .mockImplementationOnce((signal) => {
        firstSignal = signal;
        return new Promise<void>(() => undefined);
      })
      .mockResolvedValue(undefined);
    const { scheduler } = setup(load);
    scheduler.start();
    await settle();
    scheduler.stop();
    scheduler.start();
    await settle();
    expect(firstSignal.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('supports an initial guest read before polling is enabled', async () => {
    const { load, state, scheduler } = setup();
    state.enabled = false;
    scheduler.start(false);
    scheduler.wake();
    await settle();
    expect(load).not.toHaveBeenCalled();
    await scheduler.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    state.enabled = true;
    scheduler.synchronize();
    await vi.advanceTimersByTimeAsync(3000);
    expect(load).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
