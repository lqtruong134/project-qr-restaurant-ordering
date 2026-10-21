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

it('keeps invalid login editable and guest expiry outside the employee auth boundary', async () => {
  const c = await import('./api-client');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ errorCode: 'INVALID_CREDENTIALS' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ errorCode: 'SESSION_EXPIRED' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true })),
  );
  await c.postApi('/auth/login', {});
  expect(c.getAuthFailure()).toBeUndefined();
  await c.getAuthenticated('/guest/state');
  expect(c.getAuthFailure()).toBeUndefined();
  expect((await c.getAuthenticated('/core/tables')).ok).toBe(true);
});

it.each(['GET', 'HEAD'])(
  'cancels in-flight %s reads when their document leaves',
  async (method) => {
    const browserWindow = new EventTarget();
    vi.stubGlobal('window', browserWindow);
    const c = await import('./api-client');
    const caller = new AbortController();
    let readSignal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          readSignal = init!.signal!;
          readSignal.addEventListener('abort', () => reject(readSignal!.reason), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const request = c.requestApi('/core/orders', { method, signal: caller.signal });
    const cancelled = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    browserWindow.dispatchEvent(new Event('pagehide'));
    await cancelled;
    expect(readSignal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(c.getAuthFailure()).toBeUndefined();
  },
);

it.each(['POST', 'PATCH', 'DELETE'])(
  'pagehide cancels reads without cancelling or replaying an in-flight %s mutation',
  async (method) => {
    const browserWindow = new EventTarget();
    vi.stubGlobal('window', browserWindow);
    const c = await import('./api-client');
    const caller = new AbortController();
    let finish!: (response: Response) => void;
    let mutationSignal: AbortSignal | null | undefined;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init!.signal!;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      )
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            mutationSignal = init?.signal;
            finish = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetch);
    const read = c.getAuthenticated('/core/catalog');
    const cancelled = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    const mutation = c.requestApi('/core/orders', {
      method,
      body: '{}',
      signal: caller.signal,
    });
    browserWindow.dispatchEvent(new Event('pagehide'));
    await cancelled;
    expect(mutationSignal).toBe(caller.signal);
    expect(mutationSignal?.aborted).toBe(false);
    finish(Response.json({ status: 'saved' }));
    expect(await (await mutation).json()).toEqual({ status: 'saved' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method,
      body: '{}',
      credentials: 'same-origin',
    });
  },
);

it('blocks new reads after pagehide and restores BFCache reads without hiding real network errors', async () => {
  const browserWindow = new EventTarget();
  const listeners = vi.spyOn(browserWindow, 'addEventListener');
  vi.stubGlobal('window', browserWindow);
  const c = await import('./api-client');
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  expect((await c.getAuthenticated('/core/catalog')).ok).toBe(true);
  browserWindow.dispatchEvent(new Event('pagehide'));
  await expect(c.getAuthenticated('/core/orders')).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).toHaveBeenCalledTimes(1);
  browserWindow.dispatchEvent(new Event('pageshow'));
  fetch.mockRejectedValueOnce(new TypeError('network after restore'));
  await expect(c.getAuthenticated('/core/orders')).rejects.toThrow('network after restore');
  expect((await c.requestApi('/core/tables', { method: 'get' })).ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(listeners.mock.calls.map(([event]) => event)).toEqual(['pagehide', 'pageshow']);
  expect(c.getAuthFailure()).toBeUndefined();
});

it('preserves a caller deadline abort reason and removes its listener', async () => {
  vi.stubGlobal('window', new EventTarget());
  const c = await import('./api-client');
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const request = c.getAuthenticated('/core/catalog');
  // The first read has no caller deadline; cancel it independently on document teardown.
  const cancelled = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  window.dispatchEvent(new Event('pagehide'));
  await cancelled;
  window.dispatchEvent(new Event('pageshow'));
  const timed = c.requestApi('/core/orders', { signal: caller.signal });
  const deadline = new DOMException('Read deadline exceeded.', 'TimeoutError');
  const timedOut = expect(timed).rejects.toBe(deadline);
  caller.abort(deadline);
  await timedOut;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(c.getAuthFailure()).toBeUndefined();
});

it('does not send a read whose caller has already aborted', async () => {
  vi.stubGlobal('window', new EventTarget());
  const c = await import('./api-client');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const caller = new AbortController();
  const reason = new DOMException('Caller left the view.', 'AbortError');
  caller.abort(reason);
  await expect(c.requestApi('/core/orders', { signal: caller.signal })).rejects.toBe(reason);
  expect(fetch).not.toHaveBeenCalled();
});

it('releases completed and failed read controllers and caller listeners', async () => {
  const browserWindow = new EventTarget();
  vi.stubGlobal('window', browserWindow);
  const c = await import('./api-client');
  const first = new AbortController();
  const second = new AbortController();
  const removeFirst = vi.spyOn(first.signal, 'removeEventListener');
  const removeSecond = vi.spyOn(second.signal, 'removeEventListener');
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init!.signal!);
    return signals.length === 1
      ? Promise.resolve(Response.json({ ok: true }))
      : Promise.reject(new TypeError('active network failure'));
  });
  vi.stubGlobal('fetch', fetch);
  const completed = await c.requestApi('/core/catalog', { signal: first.signal });
  expect(completed.ok).toBe(true);
  await completed.json();
  await vi.waitFor(() => expect(removeFirst).toHaveBeenCalledWith('abort', expect.any(Function)));
  await expect(c.requestApi('/core/orders', { signal: second.signal })).rejects.toThrow(
    'active network failure',
  );
  expect(removeFirst).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(removeSecond).toHaveBeenCalledWith('abort', expect.any(Function));
  browserWindow.dispatchEvent(new Event('pagehide'));
  first.abort();
  second.abort();
  expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
  expect(c.getAuthFailure()).toBeUndefined();
});

it('preserves Response identity and cancels an unfinished body after response headers arrive', async () => {
  const browserWindow = new EventTarget();
  vi.stubGlobal('window', browserWindow);
  const c = await import('./api-client');
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
        body.enqueue(new TextEncoder().encode('{"items":'));
      },
    }),
    { headers: { 'content-type': 'application/json', 'x-read-version': '7' } },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init!.signal!;
      signal.addEventListener('abort', () => body.error(signal.reason), { once: true });
      return Promise.resolve(response);
    }),
  );
  const result = await c.requestApi('/core/orders', { signal: caller.signal });
  expect(result).toBe(response);
  expect(result.headers.get('x-read-version')).toBe('7');
  expect(result.bodyUsed).toBe(false);
  const cancelled = expect(result.json()).rejects.toMatchObject({ name: 'AbortError' });
  browserWindow.dispatchEvent(new Event('pagehide'));
  await cancelled;
  await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)));
  expect(caller.signal.aborted).toBe(false);
  expect(c.getAuthFailure()).toBeUndefined();
});

it('keeps real body failures observable and releases their lifecycle resources', async () => {
  const browserWindow = new EventTarget();
  vi.stubGlobal('window', browserWindow);
  const c = await import('./api-client');
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let readSignal: AbortSignal | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      readSignal = init!.signal!;
      return Promise.resolve(response);
    }),
  );
  const result = await c.requestApi('/core/orders', { signal: caller.signal });
  const failure = new TypeError('body connection was interrupted');
  const failed = expect(result.json()).rejects.toBe(failure);
  body.error(failure);
  await failed;
  await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)));
  browserWindow.dispatchEvent(new Event('pagehide'));
  caller.abort();
  expect(readSignal?.aborted).toBe(false);
  expect(c.getAuthFailure()).toBeUndefined();
});

it('cancels the auth/me read on pagehide without refreshing or replaying a request', async () => {
  const browserWindow = new EventTarget();
  vi.stubGlobal('window', browserWindow);
  const c = await import('./api-client');
  let renewalSignal: AbortSignal | undefined;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ errorCode: 'ACCESS_EXPIRED' }, { status: 401 }))
    .mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          renewalSignal = init!.signal!;
          renewalSignal.addEventListener('abort', () => reject(renewalSignal!.reason), {
            once: true,
          });
        }),
    );
  vi.stubGlobal('fetch', fetch);
  const request = c.getAuthenticated('/core/orders');
  const cancelled = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1]![0]).toBe('/api/auth/me');
  browserWindow.dispatchEvent(new Event('pagehide'));
  await cancelled;
  expect(renewalSignal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(c.getAuthFailure()).toBeUndefined();
});
