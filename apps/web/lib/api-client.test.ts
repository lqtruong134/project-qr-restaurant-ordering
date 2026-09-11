import { it, expect, vi, afterEach } from 'vitest';
import { getAuthenticated } from './api-client';
afterEach(() => vi.unstubAllGlobals());
it('shares one refresh when simultaneous GET requests receive 401', async () => {
  let refreshCount = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const counts = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCount++;
        await barrier;
        return new Response('{}', { status: 200 });
      }
      const count = (counts.get(url) ?? 0) + 1;
      counts.set(url, count);
      return new Response('{}', { status: count === 1 ? 401 : 200 });
    }),
  );
  const first = getAuthenticated('/one'),
    second = getAuthenticated('/two');
  await vi.waitFor(() => expect(refreshCount).toBe(1));
  release();
  expect((await Promise.all([first, second])).map((r) => r.status)).toEqual([200, 200]);
  expect(refreshCount).toBe(1);
});
it('does not refresh on 403 or repeat a rejected refresh', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  expect((await getAuthenticated('/forbidden')).status).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response('{}', { status: 401 }));
  expect((await getAuthenticated('/expired')).status).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(3);
});
