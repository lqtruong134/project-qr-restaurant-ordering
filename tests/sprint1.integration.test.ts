import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
let db: Database;
let admin: Database;
let app: ReturnType<typeof buildApp>;
const dbName = 'thesis_test_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
let clock = Date.now();
const headers = { origin: 'http://localhost:3000', 'x-csrf-protection': '1' };
type Response = Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>;
const cookies = (response: Response) =>
  response.cookies.map((c) => c.name + '=' + c.value).join('; ');
async function login(username = 'staff', ip = '127.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    headers,
    payload: { username, password },
    remoteAddress: ip,
  });
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  admin = createDatabase(url.toString());
  await admin.pool.query('CREATE DATABASE ' + dbName);
  url.pathname = '/' + dbName;
  const result = spawnSync(
    'pnpm',
    ['--filter', '@thesis/database', 'exec', 'prisma', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('Isolated migration failed');
  db = createDatabase(url.toString());
  await seed(db, password);
}, 60000);
afterAll(async () => {
  if (db) await db.close();
  if (admin) {
    await admin.pool.query('DROP DATABASE ' + dbName + ' WITH (FORCE)');
    await admin.close();
  }
});
beforeEach(async () => {
  clock = Date.now();
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'a'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    now: () => clock,
  });
});
afterEach(async () => {
  await app.close();
});
it('migrates exactly 14 business tables and seed twice preserves counts and passwords', async () => {
  const rows = await db.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
  );
  expect(rows.rowCount).toBe(14);
  const before = await db.prisma.app_user.findMany({ orderBy: { username: 'asc' } });
  await seed(db, password);
  const after = await db.prisma.app_user.findMany({ orderBy: { username: 'asc' } });
  expect(after.length).toBe(3);
  expect(after.map((u) => u.id)).toEqual(before.map((u) => u.id));
  expect(
    after.every(
      (u, i) =>
        u.password_hash === before[i]?.password_hash && u.password_hash.startsWith('$argon2id$'),
    ),
  ).toBe(true);
  expect(await db.prisma.product.count()).toBe(3);
});
it('three roles allow their own workspace and deny the other two at backend', async () => {
  for (const [i, role] of ['staff', 'kitchen', 'admin'].entries()) {
    const response = await login(role, '127.0.0.' + (i + 1));
    expect(response.statusCode).toBe(200);
    for (const target of ['staff', 'kitchen', 'admin'])
      expect(
        (await app.inject({ url: '/workspaces/' + target, headers: { cookie: cookies(response) } }))
          .statusCode,
      ).toBe(target === role ? 200 : 403);
    expect(response.cookies.every((c) => c.httpOnly && c.sameSite === 'Strict')).toBe(true);
  }
});
it('unauthenticated is 401 and a newly added undeclared business route is deny by default', async () => {
  app.get('/test-unclassified', async () => ({ secret: true }));
  expect((await app.inject('/workspaces/admin')).statusCode).toBe(401);
  const response = await login();
  expect(
    (await app.inject({ url: '/test-unclassified', headers: { cookie: cookies(response) } }))
      .statusCode,
  ).toBe(403);
});
it('rejects CSRF, malformed input, unknown and wrong credentials without account disclosure', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'staff', password },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { ...headers, origin: 'https://attacker.example' },
        payload: { username: 'staff', password },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers,
        payload: { username: 'staff', password, unexpected: true },
      })
    ).statusCode,
  ).toBe(400);
  const a = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers,
    payload: { username: 'staff', password: 'wrong' },
  });
  const b = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers,
    payload: { username: 'unknown', password: 'wrong' },
  });
  expect(a.statusCode).toBe(401);
  expect(b.statusCode).toBe(401);
  expect(a.json().userMessage).toBe(b.json().userMessage);
  expect(a.body.includes(password)).toBe(false);
});
it('enforces five login attempts per account across IPs and per IP across accounts', async () => {
  for (let i = 0; i < 5; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          headers,
          payload: { username: 'unknown', password: 'wrong' },
          remoteAddress: '10.0.0.' + i,
        })
      ).statusCode,
    ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers,
        payload: { username: 'unknown', password: 'wrong' },
        remoteAddress: '10.0.0.99',
      })
    ).statusCode,
  ).toBe(429);
  for (let i = 0; i < 5; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          headers,
          payload: { username: 'unknown' + i, password: 'wrong' },
          remoteAddress: '10.1.1.1',
        })
      ).statusCode,
    ).toBe(401);
  expect((await login('admin', '10.1.1.1')).statusCode).toBe(429);
  clock += 61000;
  expect((await login('admin', '10.1.1.1')).statusCode).toBe(200);
});
it('rotates refresh atomically; old token cannot be reused; logout revokes both credentials', async () => {
  const first = await login();
  const old = cookies(first);
  const results = await Promise.all(
    [1, 2].map(() =>
      app.inject({ method: 'POST', url: '/auth/refresh', headers: { ...headers, cookie: old } }),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  const current = cookies(results.find((r) => r.statusCode === 200)!);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { ...headers, cookie: old },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { ...headers, cookie: current },
      })
    ).statusCode,
  ).toBe(204);
  expect((await app.inject({ url: '/auth/me', headers: { cookie: current } })).statusCode).toBe(
    401,
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { ...headers, cookie: current },
      })
    ).statusCode,
  ).toBe(401);
});
it('access expires at 15 minutes, refresh at absolute seven days; login invalidates prior access', async () => {
  const first = await login();
  const second = await login();
  expect(
    (await app.inject({ url: '/auth/me', headers: { cookie: cookies(first) } })).statusCode,
  ).toBe(401);
  clock += 901000;
  expect(
    (await app.inject({ url: '/auth/me', headers: { cookie: cookies(second) } })).statusCode,
  ).toBe(401);
  const fresh = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { ...headers, cookie: cookies(second) },
  });
  expect(fresh.statusCode).toBe(200);
  clock += 7 * 86400000;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { ...headers, cookie: cookies(fresh) },
      })
    ).statusCode,
  ).toBe(401);
});
it('disable and password change revoke refresh and access even after re-enabling', async () => {
  const first = await login();
  const u = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'staff' } });
  await db.prisma.app_user.update({ where: { id: u.id }, data: { status: 'INACTIVE' } });
  expect(
    (await app.inject({ url: '/auth/me', headers: { cookie: cookies(first) } })).statusCode,
  ).toBe(401);
  await db.prisma.app_user.update({ where: { id: u.id }, data: { status: 'ACTIVE' } });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { ...headers, cookie: cookies(first) },
      })
    ).statusCode,
  ).toBe(401);
  const second = await login();
  await db.prisma.app_user.update({
    where: { id: u.id },
    data: { password_hash: u.password_hash + 'changed' },
  });
  expect(
    (await app.inject({ url: '/auth/me', headers: { cookie: cookies(second) } })).statusCode,
  ).toBe(401);
  await db.prisma.app_user.update({
    where: { id: u.id },
    data: { password_hash: u.password_hash },
  });
});
it('revoked role is effective immediately while role assignment history remains readable', async () => {
  const first = await login();
  const u = await db.prisma.app_user.findFirstOrThrow({ where: { username: 'staff' } });
  const grant = await db.prisma.user_role.findFirstOrThrow({
    where: { user_id: u.id, revoked_at: null },
  });
  await db.prisma.user_role.update({ where: { id: grant.id }, data: { revoked_at: new Date() } });
  expect(
    (await app.inject({ url: '/workspaces/staff', headers: { cookie: cookies(first) } }))
      .statusCode,
  ).toBe(403);
  await db.prisma.user_role.create({ data: { user_id: u.id, role_id: grant.role_id } });
  const user = await db.prisma.app_user.findUniqueOrThrow({
    where: { id: u.id },
    include: { user_role: true },
  });
  expect(user.user_role.length).toBe(2);
});
it('database enforces unique, FK, tenant isolation, nonnegative VND and active QR/session/cart rules', async () => {
  const table = await db.prisma.dining_table.findFirstOrThrow({ where: { code: 'B01' } });
  const session = await db.prisma.table_session.findFirstOrThrow({ where: { table_id: table.id } });
  const product = await db.prisma.product.findFirstOrThrow();
  const reject = async (sql: string, params: unknown[], code: string) => {
    await expect(db.pool.query(sql, params)).rejects.toMatchObject({ code });
  };
  await reject('INSERT INTO table_session(table_id) VALUES($1)', [table.id], '23505');
  await reject('INSERT INTO session_cart(session_id) VALUES($1)', [session.id], '23505');
  await reject(
    'INSERT INTO table_qr_token(table_id,token_hash,version_no) VALUES($1,$2,2)',
    [table.id, randomUUID()],
    '23505',
  );
  await reject('INSERT INTO session_cart(session_id) VALUES($1)', [randomUUID()], '23503');
  await reject('UPDATE product SET base_price=-1 WHERE id=$1', [product.id], '23514');
  await reject(
    'INSERT INTO product(restaurant_id,category_id,code,name,base_price) VALUES($1,$2,$3,$4,0)',
    [restaurantId, product.category_id, product.code, 'duplicate'],
    '23505',
  );
  const other = await db.prisma.restaurant.create({ data: { name: 'Other tenant' } });
  await reject(
    'INSERT INTO product(restaurant_id,category_id,code,name,base_price) VALUES($1,$2,$3,$4,0)',
    [other.id, product.category_id, 'cross', 'cross'],
    '23503',
  );
  await reject('DELETE FROM restaurant WHERE id=$1', [restaurantId], '23001');
  const user = await db.prisma.app_user.findFirstOrThrow();
  const grant = await db.prisma.user_role.findFirstOrThrow({
    where: { user_id: user.id, revoked_at: null },
  });
  await reject(
    'INSERT INTO user_role(user_id,role_id) VALUES($1,$2)',
    [user.id, grant.role_id],
    '23505',
  );
});
it('two concurrent session opens have exactly one winner', async () => {
  const table = await db.prisma.dining_table.findFirstOrThrow({ where: { code: 'B03' } });
  const results = await Promise.allSettled(
    [1, 2].map(() => db.pool.query('INSERT INTO table_session(table_id) VALUES($1)', [table.id])),
  );
  expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
  expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
});

it('production cookies are Secure, HttpOnly and SameSite Strict', async () => {
  const secureApp = buildApp(db);
  await registerAuth(secureApp, db, {
    secret: 'b'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: true,
  });
  try {
    const res = await secureApp.inject({
      method: 'POST',
      url: '/auth/login',
      headers,
      payload: { username: 'admin', password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.every((c) => c.secure && c.httpOnly && c.sameSite === 'Strict')).toBe(true);
  } finally {
    await secureApp.close();
  }
});

it('an authenticated route still enforces its declared permission', async () => {
  app.get(
    '/test-admin-only',
    { config: { authenticated: true, permission: 'admin.workspace' } },
    async () => ({ ok: true }),
  );
  const staff = await login();
  expect(
    (await app.inject({ url: '/test-admin-only', headers: { cookie: cookies(staff) } })).statusCode,
  ).toBe(403);
  const manager = await login('admin', '127.0.0.2');
  expect(
    (await app.inject({ url: '/test-admin-only', headers: { cookie: cookies(manager) } }))
      .statusCode,
  ).toBe(200);
});
