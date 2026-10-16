import { it, expect, vi, beforeEach, afterEach } from 'vitest';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
const expired = () => Response.json({ errorCode: 'ACCESS_EXPIRED' }, { status: 401 });
it.each(['GET', 'POST', 'PATCH', 'DELETE'])(
  'renews short-lived access before retrying %s rejected before business execution',
  async (method) => {
    const client = await import('./api-client');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(Response.json({ status: 'ok' }))
      .mockResolvedValueOnce(Response.json({ saved: true }));
    vi.stubGlobal('fetch', fetch);
    const init = {
      method,
      body: method === 'GET' ? undefined : '{"amount":"55000"}',
      headers: { 'X-CSRF-Protection': '1' },
    };
    const response = await client.requestApi('/core/payments', init);
    expect(response.ok).toBe(true);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/core/payments',
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/core/payments',
    ]);
    expect(fetch.mock.calls[3]![1]).toEqual(fetch.mock.calls[0]![1]);
    expect(client.getAuthFailure()).toBeUndefined();
  },
);
it('coalesces concurrent polling and mutation renewal into one refresh', async () => {
  const client = await import('./api-client');
  let renewed = false,
    refreshCount = 0,
    executions = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        refreshCount++;
        await new Promise((r) => setTimeout(r, 15));
        renewed = true;
        return Response.json({ status: 'ok' });
      }
      if (url === '/api/auth/me') return renewed ? Response.json({ user: {} }) : expired();
      if (!renewed) return expired();
      executions++;
      return Response.json({ ok: true });
    }),
  );
  const responses = await Promise.all([
    client.getAuthenticated('/core/tables'),
    client.getAuthenticated('/core/orders'),
    client.postApi('/core/payment/confirm', {}),
  ]);
  expect(responses.every((r) => r.ok)).toBe(true);
  expect(refreshCount).toBe(1);
  expect(executions).toBe(3);
});
it('uses cross-tab lock and rechecks current cookies before rotating', async () => {
  const client = await import('./api-client');
  const lock = vi.fn(async (_name: string, fn: () => Promise<Response>) => fn());
  vi.stubGlobal('navigator', { locks: { request: lock } });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(Response.json({ user: { id: 'current' } }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  expect((await client.getAuthenticated('/core/tables')).ok).toBe(true);
  expect(lock).toHaveBeenCalledWith('restaurant-auth-renewal', expect.any(Function));
  expect(fetch.mock.calls.some((c) => c[0] === '/api/auth/refresh')).toBe(false);
});
it('refresh revocation is terminal, while temporary server failure preserves the login and never replays', async () => {
  const client = await import('./api-client');
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(Response.json({ userMessage: 'temporary' }, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  expect((await client.postApi('/core/payments', {})).status).toBe(503);
  expect(client.getAuthFailure()).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(Response.json({ errorCode: 'SESSION_EXPIRED' }, { status: 401 }));
  expect((await client.postApi('/core/payments', {})).status).toBe(401);
  expect(client.getAuthFailure()?.errorCode).toBe('SESSION_EXPIRED');
});
it('does not renew guest credentials or replay a mutation after a network failure', async () => {
  const client = await import('./api-client');
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(expired())
    .mockRejectedValueOnce(new TypeError('network'));
  vi.stubGlobal('fetch', fetch);
  expect((await client.postApi('/guest/cart', {})).status).toBe(401);
  await expect(client.postApi('/core/payments', {})).rejects.toThrow('network');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(client.getAuthFailure()).toBeUndefined();
});
