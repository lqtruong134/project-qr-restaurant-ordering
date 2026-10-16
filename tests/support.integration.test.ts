import { completePaymentHandover } from './dining-completion-fixture.js';
import { withTableCode } from './table-code-fixture.js';
import { maintainCore } from '../apps/api/src/modules/notifications/maintenance.js';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
let db: Database, host: Database, app: ReturnType<typeof buildApp>;
const name = 'thesis_support_' + randomBytes(8).toString('hex'),
  password = randomBytes(24).toString('hex');
const users: Record<string, string> = {},
  headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const jar = (r: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>) =>
  r.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function req(url: string, user: string, body?: unknown) {
  if (url === '/guest/join')
    body = await withTableCode(app, db, users.pv001 ?? users.quyettruong05!, headers, body);
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
async function table() {
  const code = 'R' + randomBytes(3).toString('hex');
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const t = await db.prisma.dining_table.create({
    data: { restaurant_id: restaurantId, area_id: area.id, code, name: code, capacity: 4 },
  });
  const s = await ok('/core/tables/' + t.id + '/open', 'pv001', {});
  return { table: t, sid: s.id };
}
async function supportTable(type = 'WATER', content = 'Cho thêm 2 ly nước') {
  const t = await table();
  const qr = await ok('/core/tables/' + t.table.id + '/qr', 'quyettruong05', {});
  const join = await req('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'An',
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  expect(join.statusCode, join.body).toBe(200);
  const cookie = jar(join);
  const request = await ok('/guest/support', cookie, { type, content });
  return { ...t, cookie, request };
}
async function owner() {
  const t = await supportTable();
  await ok('/core/support/' + t.request.id + '/claim', 'pv001', {});
  return t;
}
const path = (id: string) => '/core/support/' + id;
const person = async (name: string) =>
  (
    await db.prisma.app_user.findFirstOrThrow({
      where: { restaurant_id: restaurantId, username: name },
    })
  ).id;
async function handoff(id: string, target = 'pv002', actor = 'pv001') {
  return ok(path(id) + '/reassign', actor, {
    userId: await person(target),
    reason: 'Sắp hết ca, nhờ hỗ trợ tiếp',
  });
}
const respond = (id: string, h: string, a: string) => path(id) + '/handoffs/' + h + '/' + a;

it('creates NEW and exposes only safe guest fields', async () => {
  const t = await supportTable();
  expect(t.request.status).toBe('NEW');
  expect(t.request.reused).toBe(false);
  expect(Object.keys(t.request).sort()).toEqual([
    'content',
    'created_at',
    'id',
    'request_type',
    'resolved_at',
    'reused',
    'status',
  ]);
  const row = await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } });
  expect(row.session_id).toBe(t.sid);
  expect(row.participant_id).toBeTruthy();
  expect(row.acknowledged_by).toBeNull();
});
it('reuses NEW including two simultaneous submissions and creates one event', async () => {
  const t = await supportTable();
  const results = await Promise.all([
    ok('/guest/support', t.cookie, { type: 'WATER' }),
    ok('/guest/support', t.cookie, { type: 'WATER' }),
  ]);
  expect(results.every((r) => r.id === t.request.id && r.reused)).toBe(true);
  expect(
    await db.prisma.outbox_event.count({
      where: { support_request_id: t.request.id, event_type: 'SUPPORT_REQUEST_CREATED' },
    }),
  ).toBe(1);
});
it('reuses ACKNOWLEDGED and PENDING without altering owner', async () => {
  const t = await owner();
  await handoff(t.request.id);
  const r = await ok('/guest/support', t.cookie, { type: 'WATER' });
  expect(r.id).toBe(t.request.id);
  expect(r.reused).toBe(true);
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: r.id } })).acknowledged_by,
  ).toBe(await person('pv001'));
});
it('allows a new same-type request after RESOLVED', async () => {
  const t = await owner();
  await ok(path(t.request.id) + '/resolve', 'pv001', {});
  const r = await ok('/guest/support', t.cookie, { type: 'WATER' });
  expect(r.id).not.toBe(t.request.id);
  expect(r.status).toBe('NEW');
  expect(r.reused).toBe(false);
});
it('requires OTHER content, rejects unknown types and caps notes', async () => {
  const t = await supportTable();
  for (const b of [
    { type: 'OTHER' },
    { type: 'OTHER', content: '  ' },
    { type: 'BOGUS' },
    { type: 'WATER', content: 'a'.repeat(301) },
  ])
    expect((await req('/guest/support', t.cookie, b)).statusCode).toBe(400);
  expect(
    (await ok('/guest/support', t.cookie, { type: 'OTHER', content: 'Cần ghế trẻ em' })).status,
  ).toBe('NEW');
});
it('claims once with assigned identity and first claim time', async () => {
  const t = await owner();
  const row = await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } });
  expect(row.status).toBe('ACKNOWLEDGED');
  expect(row.acknowledged_by).toBe(await person('pv001'));
  expect(row.acknowledged_at).toBeTruthy();
});
it('two different staff claim concurrently: one winner and clear loser', async () => {
  const t = await supportTable();
  const rs = await Promise.all(
    ['pv001', 'pv002'].map((u) => req(path(t.request.id) + '/claim', u, {})),
  );
  expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(rs.find((r) => r.statusCode === 409)!.json().userMessage).toBe(
    'Yêu cầu đã được nhân viên khác tiếp nhận.',
  );
  const row = await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } });
  expect(row.acknowledged_by).toBe(await person(rs[0]!.statusCode === 200 ? 'pv001' : 'pv002'));
  expect(
    await db.prisma.business_audit_event.count({
      where: { resource_id: row.id, action: 'SUPPORT_REQUEST_CLAIMED' },
    }),
  ).toBe(1);
});
it('non-owner cannot resolve or propose handoff', async () => {
  const t = await owner();
  expect((await req(path(t.request.id) + '/resolve', 'pv002', {})).statusCode).toBe(403);
  expect(
    (
      await req(path(t.request.id) + '/reassign', 'pv002', {
        userId: await person('pv003'),
        reason: 'Đổi ca',
      })
    ).statusCode,
  ).toBe(403);
});
it('owner resolves with timestamp and resolved identity', async () => {
  const t = await owner();
  const row = await ok(path(t.request.id) + '/resolve', 'pv001', {});
  expect(row.status).toBe('RESOLVED');
  expect(row.resolved_by).toBe(await person('pv001'));
  expect(row.resolved_at).toBeTruthy();
});
it('proposes PENDING with required reason, preserving owner and first claim timestamp', async () => {
  const t = await owner();
  const before = await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } });
  expect(
    (await req(path(t.request.id) + '/reassign', 'pv001', { userId: await person('pv002') }))
      .statusCode,
  ).toBe(400);
  const h = await handoff(t.request.id);
  expect(h.status).toBe('PENDING');
  expect(h.from_staff_id).toBe(before.acknowledged_by);
  expect(h.responded_at).toBeNull();
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } }))
      .acknowledged_at,
  ).toEqual(before.acknowledged_at);
});
it('accept changes ownership only to recipient and former owner loses resolve', async () => {
  const t = await owner(),
    h = await handoff(t.request.id);
  expect((await req(path(t.request.id) + '/resolve', 'pv002', {})).statusCode).toBe(403);
  const accepted = await ok(respond(t.request.id, h.id, 'accept'), 'pv002', {});
  expect(accepted.status).toBe('ACCEPTED');
  expect(accepted.responded_by).toBe(await person('pv002'));
  expect((await req(path(t.request.id) + '/resolve', 'pv001', {})).statusCode).toBe(403);
  expect((await ok(path(t.request.id) + '/resolve', 'pv002', {})).status).toBe('RESOLVED');
});
it('decline keeps old owner with reason and permits another handoff', async () => {
  const t = await owner(),
    h = await handoff(t.request.id);
  expect((await req(respond(t.request.id, h.id, 'decline'), 'pv002', {})).statusCode).toBe(400);
  const r = await ok(respond(t.request.id, h.id, 'decline'), 'pv002', {
    reason: 'Đang thu tiền bàn khác',
  });
  expect(r.status).toBe('DECLINED');
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } }))
      .acknowledged_by,
  ).toBe(await person('pv001'));
  const another = await handoff(t.request.id, 'pv003');
  expect(another.id).not.toBe(h.id);
});
it('third party and sender cannot accept or decline recipient handoff', async () => {
  const t = await owner(),
    h = await handoff(t.request.id);
  for (const u of ['pv001', 'pv003'])
    for (const a of ['accept', 'decline'])
      expect(
        (await req(respond(t.request.id, h.id, a), u, { reason: 'Không đúng người' })).statusCode,
      ).toBe(403);
});
it('resolve closes pending atomically and rejects stale accept', async () => {
  const t = await owner(),
    h = await handoff(t.request.id);
  await ok(path(t.request.id) + '/resolve', 'pv001', {});
  const row = await db.prisma.support_request_handoff.findUniqueOrThrow({ where: { id: h.id } });
  expect(row.status).toBe('CANCELLED');
  expect(row.responded_by).toBe(await person('pv001'));
  expect((await req(respond(t.request.id, h.id, 'accept'), 'pv002', {})).statusCode).toBe(409);
});
it('two concurrent proposals produce only one PENDING', async () => {
  const t = await owner();
  const rs = await Promise.all(
    ['pv002', 'pv003'].map(async (u) =>
      req(path(t.request.id) + '/reassign', 'pv001', {
        userId: await person(u),
        reason: 'Cuối ca',
      }),
    ),
  );
  expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(
    await db.prisma.support_request_handoff.count({
      where: { support_request_id: t.request.id, status: 'PENDING' },
    }),
  ).toBe(1);
});
it('resolve vs accept race ends in a coherent owner and handoff state', async () => {
  const t = await owner(),
    h = await handoff(t.request.id);
  const rs = await Promise.all([
    req(path(t.request.id) + '/resolve', 'pv001', {}),
    req(respond(t.request.id, h.id, 'accept'), 'pv002', {}),
  ]);
  expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
  const row = await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } }),
    hist = await db.prisma.support_request_handoff.findUniqueOrThrow({ where: { id: h.id } });
  if (row.status === 'RESOLVED') {
    expect(hist.status).toBe('CANCELLED');
    expect(row.acknowledged_by).toBe(await person('pv001'));
  } else {
    expect(hist.status).toBe('ACCEPTED');
    expect(row.acknowledged_by).toBe(await person('pv002'));
    expect(rs[0].statusCode).toBe(403);
  }
});
it('sender can cancel; recipient cannot; cancelled cannot be accepted', async () => {
  const t = await owner(),
    h = await handoff(t.request.id);
  expect(
    (await req(respond(t.request.id, h.id, 'cancel'), 'pv002', { reason: 'Rút' })).statusCode,
  ).toBe(403);
  expect(
    (
      await ok(respond(t.request.id, h.id, 'cancel'), 'pv001', {
        reason: 'Tôi tự xử lý xong việc khác',
      })
    ).status,
  ).toBe('CANCELLED');
  expect((await req(respond(t.request.id, h.id, 'accept'), 'pv002', {})).statusCode).toBe(409);
});
it('rejects self, inactive, kitchen and admin handoff recipients', async () => {
  const t = await owner();
  expect(
    (
      await req(path(t.request.id) + '/reassign', 'pv001', {
        userId: await person('pv001'),
        reason: 'Tự chuyển',
      })
    ).statusCode,
  ).toBe(400);
  for (const u of ['bep001', 'quyettruong05'])
    expect(
      (
        await req(path(t.request.id) + '/reassign', 'pv001', {
          userId: await person(u),
          reason: 'Nhờ hỗ trợ',
        })
      ).statusCode,
    ).toBe(403);
  const id = await person('pv004');
  await db.pool.query("UPDATE app_user SET status='INACTIVE' WHERE id=$1", [id]);
  try {
    expect(
      (await req(path(t.request.id) + '/reassign', 'pv001', { userId: id, reason: 'Nhờ hỗ trợ' }))
        .statusCode,
    ).toBe(403);
  } finally {
    await db.pool.query("UPDATE app_user SET status='ACTIVE' WHERE id=$1", [id]);
  }
});
it('inactive recipient cannot accept; old owner still resolves', async () => {
  const t = await owner(),
    h = await handoff(t.request.id),
    id = await person('pv002');
  await db.pool.query("UPDATE app_user SET status='INACTIVE' WHERE id=$1", [id]);
  try {
    expect((await req(respond(t.request.id, h.id, 'accept'), 'pv002', {})).statusCode).toBe(403);
    await ok(path(t.request.id) + '/resolve', 'pv001', {});
  } finally {
    await db.pool.query("UPDATE app_user SET status='ACTIVE' WHERE id=$1", [id]);
    users.pv002 = jar(await req('/auth/login', '', { username: 'pv002', password }));
  }
});
it('rejects resolved claim and handoff', async () => {
  const t = await owner();
  await ok(path(t.request.id) + '/resolve', 'pv001', {});
  expect((await req(path(t.request.id) + '/claim', 'pv002', {})).statusCode).toBe(409);
  expect(
    (
      await req(path(t.request.id) + '/reassign', 'pv001', {
        userId: await person('pv002'),
        reason: 'Đã xong',
      })
    ).statusCode,
  ).toBe(409);
});
it('guest state follows NEW/ACK/RESOLVED and excludes other participants and handoff internals', async () => {
  const t = await supportTable();
  const qr = await ok('/core/tables/' + t.table.id + '/qr', 'quyettruong05');
  const join = await req('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'Bình',
    acceptedPolicyVersion: restaurantPolicy.version,
  });
  const other = jar(join);
  expect((await ok('/guest/state', other)).support).toHaveLength(0);
  for (const action of [null, 'claim', 'resolve']) {
    if (action) await ok(path(t.request.id) + '/' + action, 'pv001', {});
    const r = (await ok('/guest/state', t.cookie)).support[0];
    expect(r.status).toBe(
      action === 'claim' ? 'ACKNOWLEDGED' : action === 'resolve' ? 'RESOLVED' : 'NEW',
    );
    expect(Object.keys(r).sort()).toEqual([
      'acknowledged_at',
      'can_retry',
      'content',
      'created_at',
      'id',
      'payment_method',
      'replaces_request_id',
      'request_type',
      'resolved_at',
      'retry_at',
      'status',
    ]);
  }
});
it('records actor/timestamps/reasons and all support outbox events including decline', async () => {
  const t = await owner(),
    h = await handoff(t.request.id);
  await ok(respond(t.request.id, h.id, 'decline'), 'pv002', { reason: 'Đang phục vụ bàn 08' });
  const next = await handoff(t.request.id);
  await ok(respond(t.request.id, next.id, 'accept'), 'pv002', {});
  await ok(path(t.request.id) + '/resolve', 'pv002', {});
  const history = await ok(path(t.request.id) + '/history', 'pv003');
  expect(history.handoffs).toHaveLength(2);
  expect(history.handoffs[0].response_reason).toBe('Đang phục vụ bàn 08');
  expect(history.audit).toHaveLength(7);
  const events = await db.prisma.outbox_event.findMany({
    where: { support_request_id: t.request.id },
    orderBy: { created_at: 'asc' },
  });
  expect(events.map((e) => e.event_type)).toEqual([
    'SUPPORT_REQUEST_CREATED',
    'SUPPORT_REQUEST_CLAIMED',
    'SUPPORT_HANDOFF_REQUESTED',
    'SUPPORT_HANDOFF_DECLINED',
    'SUPPORT_HANDOFF_REQUESTED',
    'SUPPORT_HANDOFF_ACCEPTED',
    'SUPPORT_REQUEST_RESOLVED',
  ]);
  expect(
    (await db.pool.query("SELECT core_tenant('outbox_event',$1) AS tenant", [events[0]!.id]))
      .rows[0].tenant,
  ).toBe(restaurantId);
});
it('active staff fallback sees requests without shift; kitchen/admin cannot claim; admin can view history', async () => {
  const t = await supportTable();
  expect(
    (await ok('/core/support', 'pv003')).some((x: { id: string }) => x.id === t.request.id),
  ).toBe(true);
  const people = await ok('/core/support-assignees', 'pv001');
  expect(people.some((x: { username: string }) => x.username === 'pv003')).toBe(true);
  expect(people.some((x: { username: string }) => x.username === 'bep001')).toBe(false);
  for (const u of ['bep001', 'quyettruong05'])
    expect((await req(path(t.request.id) + '/claim', u, {})).statusCode).toBe(403);
  expect(
    (await ok('/core/admin/support/' + t.request.id + '/history', 'quyettruong05')).request.id,
  ).toBe(t.request.id);
  expect((await req('/core/admin/support', 'pv001')).statusCode).toBe(403);
});
it('blocks account lock or role removal while owner has unresolved tasks', async () => {
  const t = await owner(),
    id = await person('pv001');
  const response = await app.inject({
    method: 'PATCH',
    url: '/core/users/' + id,
    headers: { ...headers, cookie: users.quyettruong05 },
    payload: { role: 'KITCHEN', status: 'ACTIVE', name: 'Nhân viên', reason: 'Đổi vai trò' },
  });
  expect(response.statusCode, response.body).toBe(409);
  expect(response.json().userMessage).toContain('hỗ trợ');
  expect(
    (await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } }))
      .acknowledged_by,
  ).toBe(id);
});
it('SQL unique guard blocks duplicate active requests and second pending; history is immutable', async () => {
  const t = await owner(),
    row = await db.prisma.support_request.findUniqueOrThrow({ where: { id: t.request.id } }),
    h = await handoff(t.request.id);
  await expect(
    db.pool.query(
      "INSERT INTO support_request(session_id,participant_id,request_type) VALUES($1,$2,'WATER')",
      [t.sid, row.participant_id],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    db.pool.query(
      'INSERT INTO support_request_handoff(support_request_id,from_staff_id,to_staff_id,reason) VALUES($1,$2,$3,$4)',
      [row.id, await person('pv001'), await person('pv003'), 'Cùng lúc'],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await ok(respond(row.id, h.id, 'accept'), 'pv002', {});
  await expect(
    db.pool.query("UPDATE support_request_handoff SET reason='Sửa lịch sử' WHERE id=$1", [h.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('SQL pending owner guard rejects ownership gaps and session cannot close with active support', async () => {
  const t = await owner();
  await handoff(t.request.id);
  await expect(
    db.pool.query('UPDATE support_request SET acknowledged_by=$2 WHERE id=$1', [
      t.request.id,
      await person('pv003'),
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await req('/core/sessions/' + t.sid + '/close', 'pv001', {})).statusCode).toBe(409);
  await ok(path(t.request.id) + '/resolve', 'pv001', {});
  await completePaymentHandover(app, users.pv001!, headers, t.sid);
  await ok('/core/sessions/' + t.sid + '/close', 'pv001', {});
  expect(
    (await db.prisma.table_session.findUniqueOrThrow({ where: { id: t.sid } })).session_status,
  ).toBe('CLOSED');
});

it('prioritizes checked-in staff in table area, while every valid colleague remains visible', async () => {
  const t = await supportTable(),
    admin = await person('quyettruong05');
  // A dedicated employee avoids overlap with the realistic, date-relative seed.
  const base = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv003' } });
  const username = 'priority_' + randomBytes(4).toString('hex');
  const employee = await db.prisma.app_user.create({
    data: {
      restaurant_id: restaurantId,
      username,
      staff_code: username,
      display_name: 'Nhân viên kiểm thử ưu tiên',
      password_hash: base.password_hash,
    },
  });
  const role = await db.prisma.role.findUniqueOrThrow({ where: { code: 'STAFF' } });
  await db.prisma.user_role.create({ data: { user_id: employee.id, role_id: role.id } });
  users[username] = jar(await req('/auth/login', '', { username, password }));
  const uid = employee.id;
  const shift = await db.prisma.work_shift.create({
    data: {
      restaurant_id: restaurantId,
      code: 'SUPPORT-' + randomBytes(4).toString('hex'),
      name: 'Ca kiểm thử hỗ trợ',
      starts_at: new Date(Date.now() - 60000),
      ends_at: new Date(Date.now() + 3600000),
      created_by: admin,
    },
  });
  const sa = await db.prisma.shift_assignment.create({
    data: {
      restaurant_id: restaurantId,
      shift_id: shift.id,
      user_id: uid,
      area_id: t.table.area_id,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      assigned_by: admin,
    },
  });
  await db.prisma.attendance_record.create({
    data: { restaurant_id: restaurantId, assignment_id: sa.id, checked_in_at: new Date() },
  });
  const rows = await ok('/core/support', username);
  expect(rows.find((r: { id: string }) => r.id === t.request.id).area_priority).toBe(true);
  const people = await ok('/core/support-assignees?requestId=' + t.request.id, 'pv001');
  expect(people[0].id).toBe(uid);
  expect(people[0].on_duty).toBe(true);
  expect(people[0].same_area).toBe(true);
  expect(people.some((r: { username: string }) => r.username === 'pv002')).toBe(true);
});
it('rejects cross-restaurant handoff at API and SQL boundaries', async () => {
  const t = await owner(),
    base = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv002' } });
  const restaurant = await db.prisma.restaurant.create({ data: { name: 'Nhà hàng khác' } });
  const target = await db.prisma.app_user.create({
    data: {
      restaurant_id: restaurant.id,
      username: 'other',
      staff_code: 'other',
      display_name: 'Nhân viên khác',
      password_hash: base.password_hash,
    },
  });
  const role = await db.prisma.role.findUniqueOrThrow({ where: { code: 'STAFF' } });
  await db.prisma.user_role.create({ data: { user_id: target.id, role_id: role.id } });
  expect(
    (
      await req(path(t.request.id) + '/reassign', 'pv001', {
        userId: target.id,
        reason: 'Khác quán',
      })
    ).statusCode,
  ).toBe(403);
  await expect(
    db.pool.query(
      'INSERT INTO support_request_handoff(support_request_id,from_staff_id,to_staff_id,reason) VALUES($1,$2,$3,$4)',
      [t.request.id, await person('pv001'), target.id, 'Khác nhà hàng'],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('publishes support events through existing outbox maintenance with resolvable tenant', async () => {
  const t = await supportTable();
  for (let n = 0; n < 3; n++) await maintainCore(db, restaurantId);
  const row = await db.prisma.outbox_event.findFirstOrThrow({
    where: { support_request_id: t.request.id, event_type: 'SUPPORT_REQUEST_CREATED' },
  });
  expect(row.status).toBe('PUBLISHED');
  expect(row.published_at).toBeTruthy();
  expect(row.attempts).toBe(1);
});
