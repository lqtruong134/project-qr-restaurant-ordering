export type AuthFailure = { errorCode: string; userMessage: string };
let failure: AuthFailure | undefined;
let permissionNotice = '';
let renewing: Promise<Response> | undefined;
let renewalEpoch = 0;
const listeners = new Set<() => void>();
export const getAuthFailure = () => failure;
export const getPermissionNotice = () => permissionNotice;
export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify() {
  for (const listener of listeners) listener();
}
export function clearPermissionNotice() {
  permissionNotice = '';
  notify();
}
const expired = 'Phiên đăng nhập đã hết hạn hoặc tài khoản được đăng nhập trên thiết bị khác.';
const blocked = () =>
  Response.json(failure, { status: failure?.errorCode === 'ACCOUNT_LOCKED' ? 403 : 401 });
async function inspect(response: Response) {
  return response
    .clone()
    .json()
    .catch(() => ({})) as Promise<{ errorCode?: string; userMessage?: string }>;
}
function stop(data: { errorCode?: string; userMessage?: string }) {
  if (failure) return;
  failure = {
    errorCode: data.errorCode ?? 'SESSION_EXPIRED',
    userMessage: data.userMessage ?? expired,
  };
  notify();
}
async function renew(): Promise<Response> {
  if (renewing) return renewing;
  const attempt = async () => {
    if (failure) return blocked();
    // Another tab may already have renewed the shared HttpOnly cookies.
    const current = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (current.ok) return current;
    const data = await inspect(current);
    if (current.status !== 401 || data.errorCode !== 'ACCESS_EXPIRED') return current;
    return fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Protection': '1' },
    });
  };
  // Web Locks serializes renewal across tabs without exposing either cookie to JS.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  renewing = (async () => {
    const response = await (locks ? locks.request('restaurant-auth-renewal', attempt) : attempt());
    if (response.ok) renewalEpoch++;
    return response;
  })().finally(() => {
    renewing = undefined;
  });
  return renewing;
}
export async function requestApi(path: string, init: RequestInit = {}): Promise<Response> {
  if (failure) return blocked();
  const epoch = renewalEpoch;
  const send = () => fetch('/api' + path, { ...init, credentials: 'same-origin' });
  let response = await send();
  const employee =
    !path.startsWith('/guest/') && !['/auth/login', '/auth/logout', '/auth/refresh'].includes(path);
  if (
    employee &&
    response.status === 401 &&
    (await inspect(response)).errorCode === 'ACCESS_EXPIRED'
  ) {
    // ACCESS_EXPIRED is issued by the auth preHandler, before business code runs.
    // Network failures and arbitrary 401 responses never replay a mutation.
    const fresh = epoch === renewalEpoch ? await renew() : Response.json({ status: 'ok' });
    response = fresh.ok && !failure ? await send() : fresh;
    if (response.status === 401 && (await inspect(response)).errorCode === 'ACCESS_EXPIRED')
      return Response.json(
        {
          errorCode: 'AUTH_RETRY_REQUIRED',
          userMessage: 'Chưa gia hạn được kết nối. Vui lòng thử lại thao tác.',
        },
        { status: 503 },
      );
  }
  if (response.status === 401 || response.status === 403) {
    const data = await inspect(response);
    const code =
      data.errorCode ?? (response.status === 401 ? 'SESSION_EXPIRED' : 'PERMISSION_DENIED');
    if (path.startsWith('/guest/') || (path === '/auth/login' && code === 'INVALID_CREDENTIALS'))
      return response;
    if (response.status === 401 || code === 'ACCOUNT_LOCKED') stop({ ...data, errorCode: code });
    else if (code === 'PERMISSION_DENIED') {
      permissionNotice = 'Bạn không có quyền thực hiện nghiệp vụ này.';
      notify();
    }
  }
  return failure && response.ok ? blocked() : response;
}
export function postApi(path: string, body?: unknown) {
  return requestApi(path, {
    method: 'POST',
    headers: {
      'X-CSRF-Protection': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export const getAuthenticated = (path: string) => requestApi(path);
