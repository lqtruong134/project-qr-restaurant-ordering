let refreshInFlight: Promise<Response> | undefined;
export function postApi(path: string, body?: unknown) {
  return fetch('/api' + path, {
    method: 'POST',
    headers: {
      'X-CSRF-Protection': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export async function getAuthenticated(path: string) {
  const response = await fetch('/api' + path);
  if (response.status !== 401) return response;
  // Share the same refresh request when multiple components receive 401 together.
  if (!refreshInFlight)
    refreshInFlight = postApi('/auth/refresh').finally(() => {
      refreshInFlight = undefined;
    });
  const renewed = await refreshInFlight;
  if (!renewed.ok) return response;
  return fetch('/api' + path);
}
