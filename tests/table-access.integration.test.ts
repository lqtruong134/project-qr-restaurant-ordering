import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { maintainCore } from '../apps/api/src/modules/notifications/maintenance.js';
import { registerModules } from '../apps/api/src/modules/index.js';
let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const name = 'thesis_access_' + randomBytes(8).toString('hex'),
  password = randomBytes(24).toString('hex');
const users: Record<string, string> = {},
  headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const jar = (r: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>) =>
  r.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function req(url: string, user: string, body?: unknown) {
  return app.inject({
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, cookie: users[user] ?? user },
    payload: body as Record<string, unknown>,
  });
}
async function ok(url: string, user: string, body?: unknown) {
  const r = await req(url, user, body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  db = createDatabase(url.toString());
  const migration = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  if (migration.status !== 0) throw new Error(migration.stderr);
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'r'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const user of ['quyettruong05', 'pv001', 'pv002', 'pv003', 'pv004', 'bep001'])
    users[user] = jar(await req('/auth/login', '', { username: user, password }));
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
});
async function fresh() {
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const code = 'ACCESS-' + randomBytes(4).toString('hex');
  const table = await db.prisma.dining_table.create({
    data: { restaurant_id: restaurantId, area_id: area.id, code, name: code, capacity: 4 },
  });
  const qr = await ok('/core/tables/' + table.id + '/qr', 'quyettruong05', {});
  return { table, token: qr.joinPath.split('#')[1] };
}
const joinBody = (token: string, accessCode?: string, name = 'Khách tại bàn') => ({
  token,
  name,
  accessCode,
  acceptedPolicyVersion: restaurantPolicy.version,
});
async function issued() {
  const t = await fresh();
  const code = await ok('/core/tables/' + t.table.id + '/access-code', 'pv001', {});
  return { ...t, ...code };
}
it('provides an existing code for a claimed assistance request without repeating verification', async () => {
  const t = await issued();
  const version = (await db.prisma.table_session.findUniqueOrThrow({ where: { id: t.sessionId } }))
    .version;
  const auditCount = await db.prisma.business_audit_event.count({
    where: { resource_id: t.sessionId, action: 'TABLE_ACCESS_CODE_ISSUED' },
  });
  const request = await ok('/guest/access-request', '', { token: t.token, name: 'Mai' });
  const row = (await ok('/core/support', 'pv001')).find((x: { id: string }) => x.id === request.id);
  expect(row.session_id).toBe(t.sessionId);
  expect(row.table_id).toBe(t.table.id);
  await ok('/core/support/' + request.id + '/claim', 'pv001', {});
  const code = await ok('/core/tables/' + t.table.id + '/access-code', 'pv001');
  expect(code.accessCode).toBe(t.accessCode);
  await ok('/core/support/' + request.id + '/resolve', 'pv001', {});
  expect(
    (await db.prisma.table_session.findUniqueOrThrow({ where: { id: t.sessionId } })).version,
  ).toBe(version);
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: t.sessionId, action: 'TABLE_ACCESS_CODE_ISSUED' },
    }),
  ).toBe(auditCount);
});
it('requires staff-issued four digits before new participation, without opening a table or leaking its code', async () => {
  const t = await fresh();
  const denied = await req('/guest/join', '', joinBody(t.token));
  expect(denied.statusCode).toBe(409);
  expect(await db.prisma.table_session.count({ where: { table_id: t.table.id } })).toBe(0);
  const request = await req('/guest/access-request', '', { token: t.token, name: 'An' });
  expect(request.statusCode, request.body).toBe(200);
  const id = request.json().id,
    cookie = jar(request);
  expect(
    (await db.prisma.dining_table.findUniqueOrThrow({ where: { id: t.table.id } })).table_status,
  ).toBe('AVAILABLE');
  const row = (await ok('/core/support', 'pv001')).find((r: { id: string }) => r.id === id);
  expect(row.request_type).toBe('ACCESS_CODE');
  expect(row.table_id).toBe(t.table.id);
  expect(row.session_id).toBeNull();
  expect(row.visitor_hash).toBeUndefined();
  const snapshot = await ok('/core/admin/overview', 'quyettruong05');
  expect(snapshot.support.new).toBeGreaterThan(0);
  const report = await ok(
    '/core/admin/reports?view=support&period=all&filter=ACCESS_CODE&search=' + t.table.code,
    'quyettruong05',
  );
  expect(report.rows.some((r: { id: string }) => r.id === id)).toBe(true);
  expect((await req('/core/support/' + id + '/access-code', 'pv002', {})).statusCode).toBe(409);
  await ok('/core/support/' + id + '/claim', 'pv001', {});
  expect((await req('/core/support/' + id + '/resolve', 'pv001', {})).statusCode).toBe(409);
  const code = await ok('/core/support/' + id + '/access-code', 'pv001', {});
  expect(code.accessCode).toMatch(/^\d{4}$/);
  expect(code.verification_status).toBe('VERIFIED');
  const repeat = await ok('/core/support/' + id + '/access-code', 'pv001', {});
  expect(repeat.accessCode).toBe(code.accessCode);
  const publicInfo = await ok('/guest/qr-info', cookie, { token: t.token });
  expect(JSON.stringify(publicInfo)).not.toContain(code.accessCode);
  const status = await ok('/guest/access-request/status', cookie, { token: t.token });
  expect(status.accessCode).toBeUndefined();
  await ok('/core/support/' + id + '/resolve', 'pv001', {});
  expect((await ok('/core/support', 'pv001')).some((r: { id: string }) => r.id === id)).toBe(false);
  const joined = await req('/guest/join', cookie, joinBody(t.token, code.accessCode));
  expect(joined.statusCode, joined.body).toBe(200);
  const state = await ok('/guest/state', jar(joined));
  expect(state.session.access_code).toBe(code.accessCode);
  expect(state.session.access_code_ciphertext).toBeUndefined();
});
it('commits failed-code limits and enforces them server-side, including cookie resets via IP limits', async () => {
  const t = await issued();
  let cookie = '';
  const wrong = t.accessCode === '0000' ? '0001' : '0000';
  for (let i = 0; i < 5; i++) {
    const r = await req('/guest/join', cookie, joinBody(t.token, wrong));
    expect(r.statusCode).toBe(403);
    cookie = jar(r);
  }
  expect((await req('/guest/join', cookie, joinBody(t.token, t.accessCode))).statusCode).toBe(429);
  expect(await db.prisma.session_participant.count({ where: { session_id: t.sessionId } })).toBe(0);
  for (let i = 0; i < 15; i++)
    expect((await req('/guest/join', '', joinBody(t.token, wrong))).statusCode).toBe(403);
  expect((await req('/guest/join', '', joinBody(t.token, t.accessCode))).statusCode).toBe(429);
  await db.pool.query('DELETE FROM table_access_limit');
});
it('replaces claimed code assistance after 180s, retaining the old work and rejecting stale staff actions', async () => {
  const t = await fresh();
  const first = await req('/guest/access-request', '', { token: t.token, name: 'Lan' });
  const cookie = jar(first),
    id = first.json().id;
  await ok('/core/support/' + id + '/claim', 'pv001', {});
  const early = await req('/guest/access-request', cookie, {
    token: t.token,
    name: 'Lan',
    retry: true,
  });
  expect(early.statusCode).toBe(429);
  const stranger = await req('/guest/access-request', '', {
    token: t.token,
    name: 'Người khác',
    retry: true,
  });
  expect(stranger.statusCode).toBe(409);
  await db.pool.query(
    "UPDATE support_request SET created_at=now()-interval '190 seconds',acknowledged_at=now()-interval '185 seconds' WHERE id=$1",
    [id],
  );
  const handoff = await ok('/core/support/' + id + '/reassign', 'pv001', {
    userId: (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv003' } })).id,
    reason: 'Cần đồng nghiệp hỗ trợ',
  });
  const replacement = await ok('/guest/access-request', cookie, {
    token: t.token,
    name: 'Lan',
    retry: true,
  });
  expect(replacement.id).not.toBe(id);
  expect(replacement.status).toBe('NEW');
  expect(
    (await db.prisma.support_request_handoff.findUniqueOrThrow({ where: { id: handoff.id } }))
      .status,
  ).toBe('CANCELLED');
  const history = await ok('/core/support/' + id + '/history', 'pv002');
  expect(
    history.audit.some((e: { action: string }) => e.action === 'SUPPORT_REQUEST_REPLACED'),
  ).toBe(true);
  expect((await db.prisma.support_request.findUniqueOrThrow({ where: { id } })).status).toBe(
    'CANCELLED',
  );
  expect((await req('/core/support/' + id + '/access-code', 'pv001', {})).statusCode).toBe(409);
  expect((await req('/core/support/' + id + '/resolve', 'pv001', {})).statusCode).toBe(409);
  const queue = await ok('/core/support', 'pv002');
  expect(queue.find((x: { id: string }) => x.id === replacement.id).acknowledged_by).toBeNull();
  expect(
    await db.prisma.outbox_event.count({
      where: { support_request_id: id, event_type: 'SUPPORT_REQUEST_REPLACED' },
    }),
  ).toBe(1);
  await ok('/core/support/' + replacement.id + '/claim', 'pv002', {});
  await ok('/core/support/' + replacement.id + '/access-code', 'pv002', {});
  await ok('/core/support/' + replacement.id + '/resolve', 'pv002', {});
});
it('serializes simultaneous code issuance, sends ordinary orders directly to kitchen, and records staff calls without guest identities', async () => {
  const t = await fresh();
  const codes = await Promise.all([
    req('/core/tables/' + t.table.id + '/access-code', 'pv001', {}),
    req('/core/tables/' + t.table.id + '/access-code', 'pv002', {}),
  ]);
  for (const r of codes) expect(r.statusCode, r.body).toBe(200);
  expect(codes[0]!.json().accessCode).toBe(codes[1]!.json().accessCode);
  const sid = codes[0]!.json().sessionId,
    code = codes[0]!.json().accessCode;
  expect(await db.prisma.table_session.count({ where: { table_id: t.table.id } })).toBe(1);
  const joined = await req('/guest/join', '', joinBody(t.token, code));
  const cookie = jar(joined);
  expect(joined.statusCode).toBe(200);
  const p = await db.prisma.product.findFirstOrThrow({ where: { code: 'DRINK-07' } });
  let state = await ok('/guest/state', cookie);
  const item = await ok('/guest/cart', cookie, {
    productId: p.id,
    quantity: 1,
    cartVersion: state.cart.cart_version,
  });
  state = await ok('/guest/state', cookie);
  const batch = await ok('/guest/orders', cookie, {
    requestId: crypto.randomUUID(),
    cartVersion: state.cart.cart_version,
    itemIds: [item.id],
  });
  expect(batch.status).toBe('SUBMITTED');
  expect((await ok('/core/kitchen', 'bep001')).some((x: { id: string }) => x.id === batch.id)).toBe(
    true,
  );
  const staffBody = {
    requestId: crypto.randomUUID(),
    lines: [
      { productId: p.id, quantity: 1, note: 'Ít đá' },
      { productId: p.id, quantity: 2, note: 'Không đá' },
    ],
  };
  const staff = await ok('/core/sessions/' + sid + '/orders', 'pv001', staffBody);
  const again = await ok('/core/sessions/' + sid + '/orders', 'pv001', staffBody);
  expect(again.id).toBe(staff.id);
  const stored = await db.prisma.order_batch.findUniqueOrThrow({ where: { id: staff.id } });
  expect(stored.created_by_user_id).not.toBeNull();
  expect(stored.created_by_participant_id).toBeNull();
  expect((await ok('/guest/state', cookie)).participants).toHaveLength(1);
});
it('invalidates old visit codes and credentials while preserving the printed QR for a fresh visit', async () => {
  const t = await issued();
  const joined = await req('/guest/join', '', joinBody(t.token, t.accessCode));
  const cookie = jar(joined);
  await ok('/core/sessions/' + t.sessionId + '/close', 'pv001', {});
  expect((await req('/guest/state', cookie)).statusCode).toBe(401);
  expect((await req('/guest/join', '', joinBody(t.token, t.accessCode))).statusCode).toBe(409);
  await ok('/core/tables/' + t.table.id + '/clean', 'pv001', {});
  const next = await ok('/core/tables/' + t.table.id + '/access-code', 'pv001', {});
  expect(next.accessCode).not.toBe(t.accessCode);
  expect((await req('/guest/join', '', joinBody(t.token, t.accessCode))).statusCode).toBe(403);
  expect((await req('/guest/join', '', joinBody(t.token, next.accessCode))).statusCode).toBe(200);
});
it('retries ordinary support and prevents replacing a bill request with a live collection', async () => {
  const t = await issued();
  const joined = await req('/guest/join', '', joinBody(t.token, t.accessCode));
  const cookie = jar(joined);
  const water = await ok('/guest/support', cookie, { type: 'WATER' });
  await ok('/core/support/' + water.id + '/claim', 'pv001', {});
  await db.pool.query(
    "UPDATE support_request SET created_at=now()-interval '190 seconds',acknowledged_at=now()-interval '185 seconds' WHERE id=$1",
    [water.id],
  );
  const replacement = await ok('/guest/support/' + water.id + '/retry', cookie, {});
  expect(replacement.status).toBe('NEW');
  expect((await req('/core/support/' + water.id + '/resolve', 'pv001', {})).statusCode).toBe(409);
  const product = await db.prisma.product.findFirstOrThrow({ where: { code: 'DRINK-07' } });
  await ok('/core/sessions/' + t.sessionId + '/orders', 'pv001', {
    requestId: crypto.randomUUID(),
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const bill = await ok('/guest/payment-requests', cookie, { method: 'CASH' });
  await ok('/core/support/' + bill.id + '/claim', 'pv001', {});
  await db.pool.query(
    "UPDATE support_request SET created_at=now()-interval '190 seconds',acknowledged_at=now()-interval '185 seconds' WHERE id=$1",
    [bill.id],
  );
  await ok('/core/sessions/' + t.sessionId + '/payments', 'pv001', {
    requestId: crypto.randomUUID(),
    method: 'CASH',
    amount: product.base_price.toString(),
    supportRequestId: bill.id,
  });
  expect((await req('/guest/support/' + bill.id + '/retry', cookie, {})).statusCode).toBe(409);
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: bill.id } })).status,
  ).toBe('ACKNOWLEDGED');
});

it('expires abandoned code assistance together with pending handoffs and keeps a readable history', async () => {
  const t = await fresh(),
    created = await ok('/guest/access-request', '', { token: t.token, name: 'Khách đang chờ' });
  await ok('/core/support/' + created.id + '/claim', 'pv001', {});
  const target = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv002' } });
  const handoff = await ok('/core/support/' + created.id + '/reassign', 'pv001', {
    userId: target.id,
    reason: 'Nhờ đồng nghiệp đến bàn',
  });
  await db.pool.query(
    "UPDATE support_request SET created_at=now()-interval '31 minutes' WHERE id=$1",
    [created.id],
  );
  await maintainCore(db, restaurantId);
  await maintainCore(db, restaurantId);
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: created.id } })).status,
  ).toBe('CANCELLED');
  expect(
    (await db.prisma.support_request_handoff.findUniqueOrThrow({ where: { id: handoff.id } }))
      .status,
  ).toBe('CANCELLED');
  const history = await ok('/core/support/' + created.id + '/history', 'pv003');
  expect(
    history.audit.some((e: { action: string }) => e.action === 'SUPPORT_REQUEST_EXPIRED'),
  ).toBe(true);
  expect(
    await db.prisma.outbox_event.count({
      where: { support_request_id: created.id, event_type: 'SUPPORT_REQUEST_EXPIRED' },
    }),
  ).toBe(1);
  expect(await db.prisma.table_session.count({ where: { table_id: t.table.id } })).toBe(0);
});
it('retains quantity review after staff verification instead of disabling all risk checks', async () => {
  const t = await issued(),
    joined = await req('/guest/join', '', joinBody(t.token, t.accessCode, 'Minh')),
    cookie = jar(joined);
  const product = await db.prisma.product.findFirstOrThrow({ where: { code: 'DRINK-07' } });
  let state = await ok('/guest/state', cookie);
  const item = await ok('/guest/cart', cookie, {
    productId: product.id,
    quantity: 6,
    cartVersion: state.cart.cart_version,
  });
  state = await ok('/guest/state', cookie);
  const batch = await ok('/guest/orders', cookie, {
    requestId: crypto.randomUUID(),
    cartVersion: state.cart.cart_version,
    itemIds: [item.id],
  });
  expect(batch.status).toBe('PENDING_REVIEW');
  expect(
    (await db.prisma.table_session.findUniqueOrThrow({ where: { id: t.sessionId } }))
      .verification_status,
  ).toBe('VERIFIED');
  expect((await ok('/core/kitchen', 'bep001')).some((x: { id: string }) => x.id === batch.id)).toBe(
    false,
  );
});

it('reads an issued PIN without changing verification or history, and uses 60s/180s support retry windows', async () => {
  const t = await issued();
  const before = await db.prisma.table_session.findUniqueOrThrow({ where: { id: t.sessionId } });
  const count = await db.prisma.business_audit_event.count({ where: { resource_id: t.sessionId } });
  const read = await ok('/core/tables/' + t.table.id + '/access-code', 'pv002');
  expect(read.accessCode).toBe(t.accessCode);
  expect(
    (await db.prisma.table_session.findUniqueOrThrow({ where: { id: t.sessionId } })).version,
  ).toBe(before.version);
  expect(await db.prisma.business_audit_event.count({ where: { resource_id: t.sessionId } })).toBe(
    count,
  );
  expect((await req('/core/tables/' + t.table.id + '/access-code', '')).statusCode).toBe(401);
  const joined = await req('/guest/join', '', joinBody(t.token, t.accessCode, 'Hà'));
  const cookie = jar(joined);
  const call = await ok('/guest/support', cookie, { type: 'WATER', content: 'Thêm nước' });
  await db.pool.query(
    "UPDATE support_request SET created_at=now()-interval '61 seconds' WHERE id=$1",
    [call.id],
  );
  await ok('/core/support/' + call.id + '/claim', 'pv001', {});
  await db.pool.query(
    "UPDATE support_request SET acknowledged_at=now()-interval '65 seconds' WHERE id=$1",
    [call.id],
  );
  expect((await req('/guest/support/' + call.id + '/retry', cookie, {})).statusCode).toBe(429);
  await db.pool.query(
    "UPDATE support_request SET created_at=now()-interval '190 seconds',acknowledged_at=now()-interval '181 seconds' WHERE id=$1",
    [call.id],
  );
  const replacement = await ok('/guest/support/' + call.id + '/retry', cookie, {});
  expect(replacement.status).toBe('NEW');
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: call.id } })).status,
  ).toBe('CANCELLED');
});
