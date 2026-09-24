import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
let host: Database, db: Database, app: ReturnType<typeof buildApp>;
const databaseName = 'thesis_workforce_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex'),
  cookies: Record<string, string> = {};
const origin = 'http://localhost:3100';
async function request(
  path: string,
  user = 'quyettruong05',
  body?: unknown,
  method: 'GET' | 'POST' | 'DELETE' = body === undefined ? 'GET' : 'POST',
) {
  return app.inject({
    url: path,
    method,
    headers: { origin, 'x-csrf-protection': '1', cookie: cookies[user] ?? user },
    payload: body as Record<string, unknown>,
  });
}
async function ok(
  path: string,
  user = 'quyettruong05',
  body?: unknown,
  method?: 'GET' | 'POST' | 'DELETE',
) {
  const res = await request(path, user, body, method);
  expect(res.statusCode, path + ' ' + res.body).toBe(200);
  return res.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  const folder = 'packages/database/prisma/migrations';
  for (const file of readdirSync(folder)
    .filter((f) => /^\d/.test(f))
    .sort())
    await db.pool.query(readFileSync(folder + '/' + file + '/migration.sql', 'utf8'));
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'w'.repeat(96),
    restaurantId,
    origins: [origin],
    secure: false,
  });
  registerModules(app, db, restaurantId);
  app.addHook('onError', async (_r, _p, e) => {
    if (!e.statusCode || e.statusCode >= 500) console.error('Workforce test:', e.message);
  });
  for (const user of ['quyettruong05', 'pv001', 'pv002', 'bep001']) {
    const res = await request('/auth/login', '', { username: user, password });
    expect(res.statusCode).toBe(200);
    cookies[user] = res.cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
});
async function worker(name = 'pv001') {
  return (await db.pool.query('SELECT id FROM app_user WHERE username=$1', [name])).rows[0]
    .id as string;
}
async function shift(start: string, end: string) {
  return ok('/core/workforce/shifts', 'quyettruong05', {
    code: randomUUID(),
    name: 'Ca thử',
    startsAt: start,
    endsAt: end,
    breakMinutes: 30,
  });
}
async function assign(s: string, u: string) {
  return ok('/core/workforce/assignments', 'quyettruong05', { shiftId: s, userId: u });
}

it('prevents concurrent overlapping assignments, cross-restaurant links and unauthorized management', async () => {
  const u = await worker(),
    s = await shift('2026-01-05T09:00:00+07:00', '2026-01-05T15:00:00+07:00');
  const responses = await Promise.all([
    request('/core/workforce/assignments', 'quyettruong05', { shiftId: s.id, userId: u }),
    request('/core/workforce/assignments', 'quyettruong05', { shiftId: s.id, userId: u }),
  ]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const overlap = await shift('2026-01-05T14:00:00+07:00', '2026-01-05T20:00:00+07:00');
  expect(
    (
      await request('/core/workforce/assignments', 'quyettruong05', {
        shiftId: overlap.id,
        userId: u,
      })
    ).statusCode,
  ).toBe(409);
  await expect(
    db.pool.query(
      'INSERT INTO shift_assignment(restaurant_id,shift_id,user_id,starts_at,ends_at,assigned_by) VALUES($1,$2,$3,$4,$5,$3)',
      [restaurantId, overlap.id, u, overlap.starts_at, overlap.ends_at],
    ),
  ).rejects.toMatchObject({ code: '23P01' });
  expect((await request('/core/workforce', 'pv001')).statusCode).toBe(403);
  const other = (await db.pool.query("INSERT INTO restaurant(name) VALUES('Other') RETURNING id"))
    .rows[0].id;
  const area = (
    await db.pool.query(
      "INSERT INTO dining_area(restaurant_id,code,name) VALUES($1,'X','Other') RETURNING id",
      [other],
    )
  ).rows[0].id;
  expect(
    (
      await request('/core/workforce/assignments', 'quyettruong05', {
        shiftId: s.id,
        userId: await worker('pv002'),
        areaId: area,
      })
    ).statusCode,
  ).toBe(404);
  const bad = await request('/core/workforce/shifts', 'quyettruong05', {
    code: 'BAD',
    name: 'Sai',
    startsAt: '2026-01-01T10:00:00Z',
    endsAt: '2026-01-01T09:00:00Z',
    breakMinutes: 0,
  });
  expect(bad.statusCode).toBe(400);
});
it('records self attendance with server time and rejects another employee or duplicate check-in', async () => {
  const u = await worker('pv002');
  await db.pool.query(
    "UPDATE shift_assignment SET status='CANCELLED',cancellation_reason='Isolated clock test' WHERE user_id=$1 AND status='ASSIGNED'",
    [u],
  );
  const s = await shift(
    new Date(Date.now() - 600000).toISOString(),
    new Date(Date.now() + 3600000).toISOString(),
  );
  const a = await assign(s.id, u);
  expect(
    (await request('/core/workforce/assignments/' + a.id + '/check-in', 'pv001', {})).statusCode,
  ).toBe(404);
  const entered = await ok('/core/workforce/assignments/' + a.id + '/check-in', 'pv002', {});
  expect(entered.checked_in_at).toBeTruthy();
  expect(
    (await request('/core/workforce/assignments/' + a.id + '/check-in', 'pv002', {})).statusCode,
  ).toBe(409);
  await ok('/core/workforce/assignments/' + a.id + '/check-out', 'pv002', {});
  expect(
    (
      await request('/core/workforce/assignments/' + a.id + '/cancel', 'quyettruong05', {
        reason: 'No',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request('/core/workforce/assignments/' + a.id + '/approve', 'quyettruong05', {
        minutes: 30,
        note: 'Too early',
      })
    ).statusCode,
  ).toBe(409);
  const mine = await ok('/core/workforce/me', 'pv001');
  expect(mine.assignments.every((x: { user_id: string }) => x.user_id !== u)).toBe(true);
});
it('snapshots approved pay, handles multiple shifts, locks payroll and keeps employee payslips private', async () => {
  const u = await worker();
  await ok('/core/workforce/pay-rates', 'quyettruong05', {
    userId: u,
    effectiveFrom: '2026-01-01T00:00:00+07:00',
    hourlyRate: '35000',
    reason: 'Thỏa thuận thử',
  });
  const a = (
    await db.pool.query(
      "SELECT a.id FROM shift_assignment a WHERE user_id=$1 AND starts_at='2026-01-05T09:00:00+07:00'",
      [u],
    )
  ).rows[0];
  const s = await shift('2026-01-06T21:00:00+07:00', '2026-01-07T03:00:00+07:00'),
    b = await assign(s.id, u);
  expect(
    (
      await request('/core/payroll', 'quyettruong05', {
        periodStart: '2026-01-01',
        periodEnd: '2026-02-01',
      })
    ).statusCode,
  ).toBe(409);
  const first = await ok('/core/workforce/assignments/' + a.id + '/approve', 'quyettruong05', {
    minutes: 330,
    note: 'Quên chấm công; quản trị đối chiếu ca thực tế.',
  });
  expect(first.amount).toBe('192500');
  await ok('/core/workforce/assignments/' + b.id + '/approve', 'quyettruong05', {
    minutes: 300,
    note: 'Đã trừ giờ nghỉ.',
  });
  await expect(
    db.pool.query('UPDATE attendance_record SET approved_minutes=1 WHERE id=$1', [first.id]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await request('/core/workforce/pay-rates', 'quyettruong05', {
        userId: u,
        effectiveFrom: '2026-01-02T00:00:00+07:00',
        hourlyRate: '40000',
        reason: 'Hồi tố',
      })
    ).statusCode,
  ).toBe(409);
  const run = await ok('/core/payroll', 'quyettruong05', {
    periodStart: '2026-01-01',
    periodEnd: '2026-02-01',
  });
  let detail = await ok('/core/payroll/' + run.id);
  expect(detail.slips).toHaveLength(1);
  expect(detail.lines).toHaveLength(2);
  expect(detail.slips[0].total_amount).toBe('367500');
  expect((await ok('/core/payroll/me', 'pv001')).slips).toHaveLength(0);
  await ok('/core/payroll/' + run.id + '/adjustments', 'quyettruong05', {
    slipId: detail.slips[0].id,
    type: 'BONUS',
    amount: '50000',
    description: 'Thưởng phục vụ',
  });
  await ok('/core/payroll/' + run.id + '/adjustments', 'quyettruong05', {
    slipId: detail.slips[0].id,
    type: 'DEDUCTION',
    amount: '17500',
    description: 'Hoàn ứng đã nhận',
  });
  await ok('/core/payroll/' + run.id + '/finalize', 'quyettruong05', {});
  detail = await ok('/core/payroll/' + run.id);
  expect(detail.slips[0].total_amount).toBe('400000');
  expect((await ok('/core/payroll/me', 'pv001')).slips).toHaveLength(1);
  expect((await ok('/core/payroll/me', 'pv002')).slips).toHaveLength(0);
  expect((await request('/core/payroll/' + run.id, 'pv001')).statusCode).toBe(403);
  expect((await request('/core/payroll/' + run.id, 'quyettruong05', {}, 'DELETE')).statusCode).toBe(
    404,
  );
  await expect(
    db.pool.query('DELETE FROM payroll_line WHERE payroll_slip_id=$1', [detail.slips[0].id]),
  ).rejects.toMatchObject({ code: '23514' });
  const blocked = await request('/core/workforce/shifts', 'quyettruong05', {
    code: 'RETRO',
    name: 'Ca bổ sung',
    startsAt: '2026-01-08T09:00:00+07:00',
    endsAt: '2026-01-08T15:00:00+07:00',
    breakMinutes: 30,
  });
  expect(blocked.statusCode).toBe(409);
  await ok('/core/payroll/' + run.id + '/paid', 'quyettruong05', {
    reference: 'Chi tiền mặt; chứng từ thử',
  });
  expect(
    (await request('/core/payroll/' + run.id + '/paid', 'quyettruong05', { reference: 'Lặp' }))
      .statusCode,
  ).toBe(404);
  await expect(
    db.pool.query("UPDATE payroll_run SET status='DRAFT' WHERE id=$1", [run.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('deletes and rebuilds drafts without losing approved attendance; rejects negative net pay', async () => {
  const s = await shift('2026-02-03T09:00:00+07:00', '2026-02-03T15:00:00+07:00'),
    a = await assign(s.id, await worker());
  await ok('/core/workforce/assignments/' + a.id + '/approve', 'quyettruong05', {
    minutes: 60,
    note: 'Một giờ thực tế',
  });
  const run = await ok('/core/payroll', 'quyettruong05', {
      periodStart: '2026-02-01',
      periodEnd: '2026-03-01',
    }),
    detail = await ok('/core/payroll/' + run.id);
  await ok('/core/payroll/' + run.id + '/adjustments', 'quyettruong05', {
    slipId: detail.slips[0].id,
    type: 'DEDUCTION',
    amount: '40000',
    description: 'Khoản vượt lương',
  });
  expect(
    (await request('/core/payroll/' + run.id + '/finalize', 'quyettruong05', {})).statusCode,
  ).toBe(409);
  await ok('/core/payroll/' + run.id, 'quyettruong05', {}, 'DELETE');
  const again = await ok('/core/payroll', 'quyettruong05', {
    periodStart: '2026-02-01',
    periodEnd: '2026-03-01',
  });
  expect((await ok('/core/payroll/' + again.id)).slips[0].total_amount).toBe('35000');
});
it('moves the whole live session and preserves guest/cart/order/payment/history; rejects stale or busy targets', async () => {
  const tables = await ok('/core/tables', 'pv001'),
    source = tables[0],
    target = tables[1];
  const s = await ok('/core/tables/' + source.id + '/open', 'pv001', {});
  const qr = await ok('/core/tables/' + source.id + '/qr', 'quyettruong05', {});
  const joined = await request('/guest/join', '', {
    token: qr.joinPath.split('#')[1],
    name: 'Khách chuyển bàn',
  });
  expect(joined.statusCode).toBe(200);
  const guestCookie = joined.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const product = (await ok('/core/catalog')).products[0];
  await ok('/guest/cart', guestCookie, { productId: product.id, quantity: 1, cartVersion: 1 });
  const order = await ok('/core/sessions/' + s.id + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: product.id, quantity: 1, note: '' }],
  });
  const alert = (
    await db.pool.query(
      "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'PAYMENT_SHORTFALL','CRITICAL') RETURNING id",
      [s.id, source.id],
    )
  ).rows[0];
  const account = (
    await db.pool.query('SELECT * FROM session_financial_account WHERE session_id=$1', [s.id])
  ).rows[0];
  const moved = await ok('/core/sessions/' + s.id + '/transfer', 'pv001', {
    fromTableId: source.id,
    tableId: target.id,
    partySize: 1,
    reason: 'Khách muốn đổi khu vực',
  });
  expect(moved.sessionId).toBe(s.id);
  expect(
    (await db.pool.query('SELECT id FROM session_financial_account WHERE session_id=$1', [s.id]))
      .rows[0].id,
  ).toBe(account.id);
  expect(
    (
      await db.pool.query('SELECT session_id FROM order_batch WHERE id=$1', [
        order.id ?? order.orderBatchId,
      ])
    ).rows[0]?.session_id ??
      (
        await db.pool.query('SELECT count(*)::int AS n FROM order_batch WHERE session_id=$1', [
          s.id,
        ])
      ).rows[0].n,
  ).toBeTruthy();
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM cart_item i JOIN session_cart c ON c.id=i.cart_id WHERE c.session_id=$1',
        [s.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect((await request('/guest/state', guestCookie)).statusCode).toBe(200);
  const alertUi = (await ok('/core/alerts', 'pv001')).find(
    (a: { id: string }) => a.id === alert.id,
  );
  expect(alertUi.table_code).toBe(target.code);
  expect(alertUi.original_table_code).toBe(source.code);
  await ok('/core/alerts/' + alert.id + '/acknowledge', 'pv001', {});
  const after = await ok('/core/tables', 'pv001');
  expect(after.find((t: { id: string }) => t.id === source.id).table_status).toBe('NEEDS_CLEANING');
  expect(after.find((t: { id: string }) => t.id === target.id).session_id).toBe(s.id);
  expect(
    (
      await request('/core/sessions/' + s.id + '/transfer', 'pv001', {
        fromTableId: source.id,
        tableId: tables[2].id,
        partySize: 1,
        reason: 'Stale',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request('/core/sessions/' + s.id + '/transfer', 'bep001', {
        fromTableId: target.id,
        tableId: tables[2].id,
        partySize: 1,
        reason: 'No permission',
      })
    ).statusCode,
  ).toBe(403);
  expect(await ok('/core/sessions/' + s.id + '/transfers', 'pv001')).toHaveLength(1);
  const other = await ok('/core/tables/' + tables[2].id + '/open', 'pv001', {});
  const races = await Promise.all([
    request('/core/sessions/' + s.id + '/transfer', 'pv001', {
      fromTableId: target.id,
      tableId: tables[3].id,
      partySize: 1,
      reason: 'Race',
    }),
    request('/core/sessions/' + other.id + '/transfer', 'pv001', {
      fromTableId: tables[2].id,
      tableId: tables[3].id,
      partySize: 1,
      reason: 'Race',
    }),
  ]);
  expect(races.map((r) => r.statusCode).sort()).toEqual([200, 409]);
});

it('reverses an unavailable paid dish and freezes a printable final receipt after refund and close', async () => {
  const table = (await ok('/core/tables', 'pv001')).find(
    (t: { table_status: string }) => t.table_status === 'AVAILABLE',
  );
  const s = await ok('/core/tables/' + table.id + '/open', 'pv001', {});
  const product = (await ok('/core/catalog')).products[0];
  const order = await ok('/core/sessions/' + s.id + '/orders', 'pv001', {
    requestId: randomUUID(),
    lines: [{ productId: product.id, quantity: 1, note: '' }],
  });
  const pi = await ok('/core/sessions/' + s.id + '/payments', 'pv001', {
    requestId: randomUUID(),
    method: 'CASH',
    amount: product.base_price,
  });
  const payment = await ok('/core/payments/' + pi.id + '/confirm', 'pv001', {
    amount: product.base_price,
    receivedAmount: '1000000',
  });
  await ok('/core/orders/' + order.id + '/accept', 'bep001', {});
  const item = (
    await db.pool.query('SELECT id FROM order_item WHERE order_batch_id=$1', [order.id])
  ).rows[0];
  await ok('/core/items/' + item.id + '/unavailable', 'bep001', {
    reason: 'Nguyên liệu không đạt yêu cầu',
  });
  const bill = await ok('/core/sessions/' + s.id + '/bill', 'pv001');
  expect(bill.account.charge_total).toBe('0');
  expect(bill.account.refund_due_amount).toBe(product.base_price);
  expect((await request('/core/sessions/' + s.id + '/close', 'pv001', {})).statusCode).toBe(409);
  const refund = await ok('/core/sessions/' + s.id + '/refunds', 'pv001', {
    paymentId: payment.id,
    amount: product.base_price,
    reason: 'Bếp không thể thực hiện',
  });
  await ok('/core/refunds/' + refund.id + '/complete', 'pv001', { method: 'CASH' });
  await ok('/core/sessions/' + s.id + '/close', 'pv001', {});
  const closed = await ok('/core/sessions/' + s.id + '/bill', 'pv001');
  expect(closed.session.receipt_number).toMatch(/^PT-/);
  expect(closed.session.closed_at).toBeTruthy();
  expect(closed.account.refunded_total).toBe(product.base_price);
  expect(closed.account.outstanding_amount).toBe('0');
  expect(closed.payments[0].metadata.changeGiven).toBe(
    (1000000n - BigInt(product.base_price)).toString(),
  );
  await db.pool.query("UPDATE restaurant SET name='Đã đổi tên sau khi đóng' WHERE id=$1", [
    restaurantId,
  ]);
  expect((await ok('/core/sessions/' + s.id + '/bill', 'pv001')).store.name).toBe(
    closed.store.name,
  );
  await expect(
    db.pool.query("UPDATE table_session SET receipt_snapshot='{}'::jsonb WHERE id=$1", [s.id]),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await ok('/core/receipts', 'pv001')).some((row: { id: string }) => row.id === s.id)).toBe(
    true,
  );
});
