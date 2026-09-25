import { it, expect, vi, afterEach, beforeEach } from 'vitest';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it.each(['GET', 'POST', 'PATCH', 'DELETE'])(
  'blocks %s without refreshing or replaying mutations',
  async (method) => {
    const client = await import('./api-client');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ errorCode: 'SESSION_EXPIRED', userMessage: 'expired' }, { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    const listener = vi.fn();
    client.subscribeAuth(listener);
    await client.requestApi('/core/orders', { method });
    await client.requestApi('/core/payments', { method: 'POST' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.getAuthFailure()?.errorCode).toBe('SESSION_EXPIRED');
    expect(listener).toHaveBeenCalledTimes(1);
  },
);
it('permission denial preserves session and subsequent requests', async () => {
  const c = await import('./api-client');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ errorCode: 'PERMISSION_DENIED' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ ok: true })),
  );
  await c.getAuthenticated('/core/reports');
  expect(c.getAuthFailure()).toBeUndefined();
  expect(c.getPermissionNotice()).toContain('không có quyền');
  expect((await c.getAuthenticated('/core/tables')).ok).toBe(true);
});
it('locked account is terminal; CSRF and network failures are not logout', async () => {
  const c = await import('./api-client');
  const f = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ errorCode: 'CSRF_REJECTED' }, { status: 403 }))
    .mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce(
      Response.json({ errorCode: 'ACCOUNT_LOCKED', userMessage: 'locked' }, { status: 403 }),
    );
  vi.stubGlobal('fetch', f);
  await c.postApi('/core/orders', {});
  expect(c.getAuthFailure()).toBeUndefined();
  await expect(c.getAuthenticated('/core/tables')).rejects.toThrow('network');
  expect(c.getAuthFailure()).toBeUndefined();
  await c.getAuthenticated('/core/tables');
  expect(c.getAuthFailure()?.errorCode).toBe('ACCOUNT_LOCKED');
});
it('late success cannot revive the screen after another request blocks it', async () => {
  const c = await import('./api-client');
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      )
      .mockResolvedValueOnce(Response.json({ errorCode: 'SESSION_EXPIRED' }, { status: 401 })),
  );
  const late = c.getAuthenticated('/core/catalog');
  await c.getAuthenticated('/core/tables');
  finish(Response.json({ secret: 'old data' }));
  expect((await late).status).toBe(401);
});
