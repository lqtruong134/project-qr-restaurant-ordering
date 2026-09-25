export type AuthFailure = { errorCode: string; userMessage: string };
let failure: AuthFailure | undefined;
let permissionNotice = '';
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
export async function requestApi(path: string, init: RequestInit = {}): Promise<Response> {
  // Once blocked, polling, mutations and late responses cannot restore the old screen.
  if (failure)
    return Response.json(failure, { status: failure.errorCode === 'ACCOUNT_LOCKED' ? 403 : 401 });
  const response = await fetch('/api' + path, { ...init, credentials: 'same-origin' });
  if (response.status === 401 || response.status === 403) {
    const data = await response
      .clone()
      .json()
      .catch(() => ({}));
    const code =
      data.errorCode ?? (response.status === 401 ? 'SESSION_EXPIRED' : 'PERMISSION_DENIED');
    if (response.status === 401 || code === 'ACCOUNT_LOCKED') {
      failure ??= { errorCode: code, userMessage: data.userMessage ?? expired };
      notify();
    } else if (code === 'PERMISSION_DENIED') {
      permissionNotice = 'Bạn không có quyền thực hiện nghiệp vụ này.';
      notify();
    }
  }
  if (failure && response.ok)
    return Response.json(failure, { status: failure.errorCode === 'ACCOUNT_LOCKED' ? 403 : 401 });
  return response;
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
