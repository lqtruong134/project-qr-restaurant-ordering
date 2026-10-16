import { request, expect, type Page } from '@playwright/test';
// Provision through staff permissions. These fixtures exercise the existing feature under test;
// table-access.spec tests the actual guest request and staff claiming UI instead.
export async function browserTableCode(
  admin: Page,
  joinPath: string,
  staff?: Page,
): Promise<string> {
  const origin = new URL(admin.url()).origin,
    headers = { origin, 'x-csrf-protection': '1' };
  const info = await admin.request.post('/api/guest/qr-info', {
    headers,
    data: { token: joinPath.split('#')[1] },
  });
  const tableInfo = await info.json();
  const tables = await (await admin.request.get('/api/core/admin/tables')).json();
  const table = tables.find((t: { code: string }) => t.code === tableInfo.table_code);
  expect(table).toBeTruthy();
  const auxiliary = staff?.url().includes('/workspace/staff')
    ? null
    : await request.newContext({ baseURL: origin });
  const client = auxiliary ?? staff!.request;
  try {
    if (auxiliary) {
      const login = await client.post('/api/auth/login', {
        headers,
        data: { username: 'pv008', password: process.env.SEED_PASSWORD! },
      });
      expect(login.ok(), await login.text()).toBe(true);
    }
    const result = await client.post('/api/core/tables/' + table.id + '/access-code', {
      headers,
      data: {},
    });
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()).accessCode;
  } finally {
    if (auxiliary) await auxiliary.dispose();
  }
}
