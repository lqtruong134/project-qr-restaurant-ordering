import { completePaymentHandover } from './dining-completion-fixture.js';
import { withTableCode } from './table-code-fixture.js';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { attendanceSummary } from '../apps/api/src/modules/workforce/workforce.service.js';
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
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' = body === undefined ? 'GET' : 'POST',
) {
  if (path === '/guest/join')
    body = await withTableCode(
      app,
      db,
      cookies.pv001 ?? cookies.quyettruong05!,
      { origin, 'x-csrf-protection': '1' },
      body,
    );
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
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH',
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
  const duplicate = responses.find((r) => r.statusCode === 409)!.json().userMessage;
  const person = (await db.pool.query('SELECT display_name FROM app_user WHERE id=$1', [u])).rows[0]
    .display_name;
  expect(duplicate).toContain(person);
  expect(duplicate).toContain('đã được phân công vào ca');
  expect(duplicate).toContain('Ca thử');
  expect(duplicate).toContain('05/01/2026 09:00 → 05/01/2026 15:00');
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
it('records self attendance with server time and rejects another employee and safely replays check-in', async () => {
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
  ).toBe(200);
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
  await ok('/core/payroll/' + run.id + '/slips/' + detail.slips[0].id + '/paid', 'quyettruong05', {
    reference: 'Chi tiền mặt; chứng từ thử',
  });
  expect(
    (
      await request(
        '/core/payroll/' + run.id + '/slips/' + detail.slips[0].id + '/paid',
        'quyettruong05',
        { reference: 'Lặp' },
      )
    ).statusCode,
  ).toBe(200);
  const paidDetail = await ok('/core/payroll/' + run.id);
  expect(paidDetail.payments).toHaveLength(1);
  expect(paidDetail.payments[0].amount).toBe(paidDetail.slips[0].total_amount);
  await expect(
    db.pool.query('DELETE FROM payroll_payment WHERE id=$1', [paidDetail.payments[0].id]),
  ).rejects.toMatchObject({ code: '23514' });
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
    acceptedPolicyVersion: restaurantPolicy.version,
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
  const refund = await ok('/core/sessions/' + s.id + '/refunds', 'quyettruong05', {
    paymentId: payment.id,
    amount: product.base_price,
    reason: 'Bếp không thể thực hiện',
  });
  await ok('/core/refunds/' + refund.id + '/complete', 'pv001', { method: 'CASH' });
  expect(
    (await ok('/core/alerts', 'pv001')).filter(
      (a: { session_id: string; alert_type: string }) =>
        a.session_id === s.id && a.alert_type === 'REFUND_REQUIRED',
    ),
  ).toHaveLength(0);
  const notices = (await ok('/core/alerts', 'pv001')).filter(
    (a: { session_id: string; guest_notice: boolean }) => a.session_id === s.id && a.guest_notice,
  );
  for (const notice of notices)
    await ok('/core/alerts/' + notice.id + '/guest-notified', 'pv001', {});
  await completePaymentHandover(app, cookies.pv001!, { origin, 'x-csrf-protection': '1' }, s.id);
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

it('suggests paid attendance only inside the scheduled overnight shift and separates breaks', () => {
  const a = {
    starts_at: '2026-01-10T22:00:00+07:00',
    ends_at: '2026-01-11T06:00:00+07:00',
    break_minutes: 30,
    checked_in_at: '2026-01-10T21:45:00+07:00',
    checked_out_at: '2026-01-11T06:30:00+07:00',
  };
  expect(attendanceSummary(a)).toMatchObject({
    suggested_minutes: 450,
    scheduled_minutes: 450,
    late_minutes: 0,
    early_leave_minutes: 0,
  });
  expect(
    attendanceSummary({
      ...a,
      checked_in_at: '2026-01-10T22:15:00+07:00',
      checked_out_at: '2026-01-11T05:45:00+07:00',
    }),
  ).toMatchObject({
    suggested_minutes: 450,
    actual_minutes: 420,
    late_minutes: 15,
    early_leave_minutes: 15,
  });
  expect(attendanceSummary({ ...a, checked_out_at: null }).suggested_minutes).toBe(0);
});

it('requires explicit exceptional-hours approval and retains original attendance and audit', async () => {
  const u = await worker(),
    s = await shift('2026-03-18T09:00:00+07:00', '2026-03-18T15:00:00+07:00'),
    a = await assign(s.id, u);
  await db.pool.query(
    "INSERT INTO attendance_record(restaurant_id,assignment_id,checked_in_at,checked_out_at) VALUES($1,$2,'2026-03-18T08:45:00+07:00','2026-03-18T15:30:00+07:00')",
    [restaurantId, a.id],
  );
  const payload = {
    minutes: 360,
    outcome: 'WORKED',
    note: 'Quản trị xác nhận thêm 30 phút bàn giao ca',
  };
  expect(
    (await request('/core/workforce/assignments/' + a.id + '/approve', 'quyettruong05', payload))
      .statusCode,
  ).toBe(400);
  const approved = await ok('/core/workforce/assignments/' + a.id + '/approve', 'quyettruong05', {
    ...payload,
    approveExtra: true,
  });
  expect(approved.approved_minutes).toBe(360);
  expect(new Date(approved.checked_in_at).toISOString()).toBe('2026-03-18T01:45:00.000Z');
  await ok('/core/workforce/assignments/' + a.id + '/approve', 'quyettruong05', {
    ...payload,
    approveExtra: true,
  });
  const audit = await db.pool.query(
    "SELECT details FROM business_audit_event WHERE action='APPROVE_ATTENDANCE' AND resource_id=$1",
    [a.id],
  );
  expect(audit.rowCount).toBe(1);
  expect(audit.rows[0].details).toMatchObject({ extraApproved: true, suggestedMinutes: 330 });
});

const templateBody = (extra: Record<string, unknown> = {}) => ({
  code: randomUUID(),
  name: 'Ca dùng lại',
  startTime: '09:00',
  endTime: '15:00',
  endsNextDay: false,
  hasBreak: false,
  useShiftRate: false,
  sortOrder: 0,
  ...extra,
});
async function template(extra: Record<string, unknown> = {}) {
  return ok('/core/workforce/templates', 'quyettruong05', templateBody(extra));
}
async function schedule(t: string[], day: string, users?: string[], to = day) {
  return ok('/core/workforce/schedule', 'quyettruong05', {
    templateIds: t,
    from: day,
    to,
    userIds: users,
  });
}
async function punches(id: string, enter: string | null, exit: string | null) {
  await db.pool.query(
    'INSERT INTO attendance_record(restaurant_id,assignment_id,checked_in_at,checked_out_at) VALUES($1,$2,$3,$4)',
    [restaurantId, id, enter, exit],
  );
}
async function approve(
  id: string,
  minutes: number,
  approvalMode = 'FULL',
  outcome = 'WORKED',
  approveExtra = false,
) {
  return ok('/core/workforce/assignments/' + id + '/approve', 'quyettruong05', {
    minutes,
    approvalMode,
    outcome,
    approveExtra,
    note: 'Đối chiếu ca làm và xác nhận công kiểm thử',
  });
}

it('creates optional breaks and overnight templates, checks permissions and validates duration', async () => {
  const noBreak = await template(),
    withBreak = await template({ hasBreak: true, breakMinutes: 30 }),
    night = await template({ startTime: '22:00', endTime: '02:00', endsNextDay: true });
  expect(noBreak.break_minutes).toBe(0);
  expect(withBreak.break_minutes).toBe(30);
  const materialized = await schedule([night.id], '2026-04-01');
  expect(
    new Date(materialized.shifts[0].ends_at).getTime() -
      new Date(materialized.shifts[0].starts_at).getTime(),
  ).toBe(4 * 3600000);
  expect(materialized.shifts[0].scheduled_date.slice(0, 10)).toBe('2026-04-01');
  for (const body of [
    templateBody({ startTime: '22:00', endTime: '02:00' }),
    templateBody({ hasBreak: true, breakMinutes: 360 }),
    templateBody({ useShiftRate: true, hourlyRate: '0' }),
  ])
    expect((await request('/core/workforce/templates', 'quyettruong05', body)).statusCode).toBe(
      400,
    );
  expect((await request('/core/workforce/templates', 'pv001', templateBody())).statusCode).toBe(
    403,
  );
});

it('snapshots template edits, prevents stale edits and only materializes a bounded requested range', async () => {
  const t = await template({ useShiftRate: true, hourlyRate: '45000' });
  const a = await schedule([t.id], '2026-04-02', undefined, '2026-04-04');
  expect(a.shifts).toHaveLength(3);
  const b = {
    ...templateBody({
      code: t.code,
      name: t.name,
      startTime: '09:30',
      endTime: '15:30',
      useShiftRate: true,
      hourlyRate: '50000',
    }),
    version: t.version,
    isActive: true,
    reason: 'Đổi lịch áp dụng cho ca tạo mới',
  };
  await ok('/core/workforce/templates/' + t.id, 'quyettruong05', b, 'PATCH');
  expect(
    (await request('/core/workforce/templates/' + t.id, 'quyettruong05', b, 'PATCH')).statusCode,
  ).toBe(409);
  const again = await schedule([t.id], '2026-04-02');
  expect(again.shifts[0]).toMatchObject({
    id: a.shifts[0].id,
    hourly_rate_override: '45000',
    template_version: 1,
  });
  const fresh = await schedule([t.id], '2026-04-05');
  expect(fresh.shifts[0]).toMatchObject({ hourly_rate_override: '50000', template_version: 2 });
  expect(fresh.shifts[0].starts_at).toContain('02:30:00');
  expect(
    (
      await request('/core/workforce/schedule', 'quyettruong05', {
        templateIds: [t.id],
        from: '2026-04-01',
        to: '2026-05-02',
      })
    ).statusCode,
  ).toBe(400);
  await ok(
    '/core/workforce/templates/' + t.id,
    'quyettruong05',
    { ...b, version: 2, isActive: false, reason: 'Tạm ngừng ca' },
    'PATCH',
  );
  expect(
    (
      await request('/core/workforce/schedule', 'quyettruong05', {
        templateIds: [t.id],
        from: '2026-04-06',
        to: '2026-04-06',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM work_shift WHERE template_id=$1', [t.id]))
      .rows[0].n,
  ).toBe(4);
  expect(
    (
      await db.pool.query(
        'SELECT action FROM business_audit_event WHERE resource_id=$1 ORDER BY created_at',
        [t.id],
      )
    ).rows.map((r) => r.action),
  ).toEqual(['CREATE_SHIFT_TEMPLATE', 'UPDATE_SHIFT_TEMPLATE', 'DISABLE_SHIFT_TEMPLATE']);
});

it('allows adjacent ca assignments, rolls back overlap and safely replays concurrent materialization', async () => {
  const u = await worker(),
    a = await template({ endTime: '12:00' }),
    b = await template({ startTime: '12:00', endTime: '15:00' }),
    c = await template({ startTime: '11:00', endTime: '14:00' });
  const response = await schedule([a.id, b.id], '2026-04-10', [u]);
  expect(response.assignments).toHaveLength(2);
  expect(response.counts).toEqual({
    createdShifts: 2,
    existingShifts: 0,
    createdAssignments: 2,
    existingAssignments: 0,
  });
  const replay = await schedule([a.id, b.id], '2026-04-10', [u]);
  expect(replay.counts).toEqual({
    createdShifts: 0,
    existingShifts: 2,
    createdAssignments: 0,
    existingAssignments: 2,
  });
  expect(
    (
      await request('/core/workforce/schedule', 'quyettruong05', {
        templateIds: [c.id],
        from: '2026-04-10',
        to: '2026-04-11',
        userIds: [u],
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM work_shift WHERE template_id=$1', [c.id]))
      .rows[0].n,
  ).toBe(0);
  const body = { templateIds: [a.id], from: '2026-04-11', to: '2026-04-11', userIds: [u] };
  const results = await Promise.all([
    request('/core/workforce/schedule', 'quyettruong05', body),
    request('/core/workforce/schedule', 'quyettruong05', body),
  ]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(results[0].json().assignments[0].id).toBe(results[1].json().assignments[0].id);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM work_shift WHERE template_id=$1 AND scheduled_date=$2',
        [a.id, '2026-04-11'],
      )
    ).rows[0].n,
  ).toBe(1);
  for (const row of response.assignments) await approve(row.id, 0, 'ZERO', 'ABSENT');
  await approve(results[0].json().assignments[0].id, 0, 'ZERO', 'LEAVE');
});

it('rejects impossible ad-hoc dates instead of silently normalizing them', async () => {
  const response = await request('/core/workforce/shifts', 'quyettruong05', {
    code: randomUUID(),
    name: 'Ngày không tồn tại',
    startsAt: '2026-02-30T09:00:00+07:00',
    endsAt: '2026-02-30T15:00:00+07:00',
    breakMinutes: 0,
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().userMessage).toContain('Ngày không hợp lệ');
});

it('names overnight conflicts, allows adjacency and reports mixed new/existing schedules', async () => {
  const u = await worker(),
    person = (await db.pool.query('SELECT display_name FROM app_user WHERE id=$1', [u])).rows[0]
      .display_name,
    night = await template({
      name: 'Ca đêm kiểm thử',
      startTime: '22:00',
      endTime: '02:00',
      endsNextDay: true,
    }),
    early = await template({ startTime: '01:00', endTime: '03:00' }),
    adjacent = await template({ startTime: '02:00', endTime: '04:00' });
  await schedule([night.id], '2030-03-01', [u]);
  const blocked = await request('/core/workforce/schedule', 'quyettruong05', {
    templateIds: [early.id],
    from: '2030-03-02',
    to: '2030-03-02',
    userIds: [u],
  });
  expect(blocked.statusCode).toBe(409);
  expect(blocked.json().userMessage).toContain(person);
  expect(blocked.json().userMessage).toContain('Ca đêm kiểm thử');
  expect(blocked.json().userMessage).toContain('01/03/2030 22:00 → 02/03/2030 02:00');
  expect(blocked.json().userMessage).toContain('Không có lịch hoặc phân công mới nào được lưu');
  expect(
    (
      await db.pool.query('SELECT count(*)::int AS n FROM work_shift WHERE template_id=$1', [
        early.id,
      ])
    ).rows[0].n,
  ).toBe(0);
  const first = await schedule([adjacent.id], '2030-03-02', [u]);
  expect(first.counts).toEqual({
    createdShifts: 1,
    existingShifts: 0,
    createdAssignments: 1,
    existingAssignments: 0,
  });
  const morning = await template({ startTime: '09:00', endTime: '12:00' });
  const mixed = await schedule([adjacent.id, morning.id], '2030-03-02', [u]);
  expect(mixed.counts).toEqual({
    createdShifts: 1,
    existingShifts: 1,
    createdAssignments: 1,
    existingAssignments: 1,
  });
  expect(mixed.assignments).toHaveLength(2);
});

it('applies current duration/break limits only to newly materialized ca', async () => {
  const long = await template({ startTime: '09:00', endTime: '17:00' }),
    breaks = await template({ hasBreak: true, breakMinutes: 30 }),
    longOld = (await schedule([long.id], '2030-04-01')).shifts[0],
    breakOld = (await schedule([breaks.id], '2030-04-01')).shifts[0];
  const config = await ok('/core/risk');
  const current = { ...config.defaults } as Record<string, number | boolean>;
  for (const row of config.policies) current[row.config_key] = row.value_json;
  try {
    await ok('/core/risk', 'quyettruong05', {
      SHIFT_MAX_MINUTES: 360,
      SHIFT_MAX_BREAK_MINUTES: 15,
    });
    for (const t of [long, breaks]) {
      const blocked = await request('/core/workforce/schedule', 'quyettruong05', {
        templateIds: [t.id],
        from: '2030-04-02',
        to: '2030-04-02',
      });
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json().userMessage).toContain('vượt cấu hình nhà hàng hiện tại');
      expect(
        (
          await db.pool.query('SELECT count(*)::int AS n FROM work_shift WHERE template_id=$1', [
            t.id,
          ])
        ).rows[0].n,
      ).toBe(1);
    }
    const replay = await schedule([long.id, breaks.id], '2030-04-01');
    expect(replay.shifts.map((row: { id: string }) => row.id).sort()).toEqual(
      [longOld.id, breakOld.id].sort(),
    );
    expect(replay.counts).toEqual({
      createdShifts: 0,
      existingShifts: 2,
      createdAssignments: 0,
      existingAssignments: 0,
    });
  } finally {
    await ok('/core/risk', 'quyettruong05', {
      SHIFT_MAX_MINUTES: current.SHIFT_MAX_MINUTES,
      SHIFT_MAX_BREAK_MINUTES: current.SHIFT_MAX_BREAK_MINUTES,
    });
  }
});

it('uses full ca within grace, effective employee rate and immutable shift override snapshots', async () => {
  const u = await worker(),
    t = await template({
      hasBreak: true,
      breakMinutes: 30,
      useShiftRate: true,
      hourlyRate: '45000',
    }),
    scheduled = await schedule([t.id], '2026-04-12', [u]),
    a = scheduled.assignments[0];
  await punches(a.id, '2026-04-12T08:55:00+07:00', '2026-04-12T15:07:00+07:00');
  const row = (
    await ok(
      '/core/history/attendance?q=' +
        encodeURIComponent(t.name) +
        '&period=custom&from=2026-04-12&to=2026-04-12&category=normal',
    )
  ).rows.find((r: { id: string }) => r.id === a.id);
  expect(row).toMatchObject({
    classification: 'NORMAL',
    suggested_minutes: 330,
    effective_hourly_rate: '45000',
  });
  const approved = await approve(a.id, 330);
  expect(approved).toMatchObject({
    hourly_rate_snapshot: '45000',
    rate_source: 'SHIFT',
    amount: '247500',
    approval_mode: 'FULL',
  });
  await ok(
    '/core/workforce/templates/' + t.id,
    'quyettruong05',
    {
      ...templateBody({
        code: t.code,
        name: t.name,
        hasBreak: true,
        breakMinutes: 30,
        useShiftRate: true,
        hourlyRate: '50000',
      }),
      version: 1,
      isActive: true,
      reason: 'Đổi giá ca sau này',
    },
    'PATCH',
  );
  const fallback = await template({ startTime: '18:00', endTime: '22:00' }),
    normal = (await schedule([fallback.id], '2026-04-12', [u])).assignments[0];
  await punches(normal.id, '2026-04-12T17:55:00+07:00', '2026-04-12T22:08:00+07:00');
  expect(await approve(normal.id, 240)).toMatchObject({
    rate_source: 'EMPLOYEE',
    hourly_rate_snapshot: '35000',
    amount: '140000',
  });
  await ok('/core/workforce/pay-rates', 'quyettruong05', {
    userId: u,
    effectiveFrom: '2026-04-13T00:00:00+07:00',
    hourlyRate: '40000',
    reason: 'Áp dụng từ ngày kế tiếp',
  });
  expect(
    (
      await db.pool.query(
        'SELECT hourly_rate_snapshot FROM attendance_record WHERE assignment_id=$1',
        [normal.id],
      )
    ).rows[0].hourly_rate_snapshot,
  ).toBe('35000');
  expect(
    (
      await request('/core/workforce/assignments/' + a.id + '/approve', 'quyettruong05', {
        minutes: 360,
        approvalMode: 'EXCEPTION',
        outcome: 'WORKED',
        note: 'Không được ghi đè',
      })
    ).statusCode,
  ).toBe(409);
});

it('reviews late, early and missing punches without fabricating original timestamps', async () => {
  const u = await worker(),
    t = await template({
      startTime: '18:00',
      endTime: '22:00',
      useShiftRate: true,
      hourlyRate: '45000',
    });
  const rows = (await schedule([t.id], '2026-04-14', [u], '2026-04-17')).assignments;
  await punches(rows[0].id, '2026-04-14T18:30:00+07:00', '2026-04-14T22:00:00+07:00');
  await punches(rows[1].id, '2026-04-15T18:00:00+07:00', '2026-04-15T21:30:00+07:00');
  await punches(rows[2].id, '2026-04-16T18:00:00+07:00', null);
  const queue = await ok(
    '/core/history/attendance?period=custom&from=2026-04-14&to=2026-04-17&status=pending&category=exceptions',
  );
  expect(queue.total).toBe(4);
  expect(queue.rows.map((r: { classification: string }) => r.classification).sort()).toEqual([
    'EARLY_LEAVE',
    'LATE',
    'MISSING_IN',
    'MISSING_OUT',
  ]);
  expect(await approve(rows[0].id, 210, 'ACTUAL')).toMatchObject({
    approved_minutes: 210,
    amount: '157500',
  });
  expect(await approve(rows[1].id, 240, 'FULL')).toMatchObject({
    approved_minutes: 240,
    amount: '180000',
  });
  expect(await approve(rows[2].id, 240, 'EXCEPTION', 'MISSED_CLOCK', true)).toMatchObject({
    checked_out_at: null,
    approved_minutes: 240,
  });
  expect(await approve(rows[3].id, 0, 'ZERO', 'LEAVE')).toMatchObject({
    checked_in_at: null,
    checked_out_at: null,
    amount: '0',
  });
});

it('enforces snapshot clock windows, late checkout handling and concurrent punch replay', async () => {
  const u = await worker('bep001');
  await db.pool.query(
    "UPDATE shift_assignment SET status='CANCELLED',cancellation_reason='Isolated policy test' WHERE user_id=$1 AND status='ASSIGNED' AND NOT EXISTS(SELECT 1 FROM attendance_record t WHERE t.assignment_id=shift_assignment.id)",
    [u],
  );
  const early = await shift(
    new Date(Date.now() + 16 * 60000).toISOString(),
    new Date(Date.now() + 76 * 60000).toISOString(),
  );
  const a = await assign(early.id, u);
  expect(
    (await request('/core/workforce/assignments/' + a.id + '/check-in', 'bep001', {})).statusCode,
  ).toBe(409);
  await ok('/core/workforce/assignments/' + a.id + '/cancel', 'quyettruong05', {
    reason: 'Chưa đến giờ; kiểm tra ca khác',
  });
  const within = await shift(
      new Date(Date.now() + 14 * 60000).toISOString(),
      new Date(Date.now() + 74 * 60000).toISOString(),
    ),
    b = await assign(within.id, u);
  const entered = await Promise.all([
    request('/core/workforce/assignments/' + b.id + '/check-in', 'bep001', {}),
    request('/core/workforce/assignments/' + b.id + '/check-in', 'bep001', {}),
  ]);
  expect(entered.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(entered[0].json().id).toBe(entered[1].json().id);
  await ok('/core/workforce/assignments/' + b.id + '/check-out', 'bep001', {});
  const old = await shift(
      new Date(Date.now() - 181 * 60000).toISOString(),
      new Date(Date.now() - 121 * 60000).toISOString(),
    ),
    c = await assign(old.id, u);
  await punches(c.id, old.starts_at, null);
  expect(
    (await request('/core/workforce/assignments/' + c.id + '/check-out', 'bep001', {})).statusCode,
  ).toBe(409);
  const mine = await ok('/core/workforce/me', 'bep001');
  expect(mine.assignments.find((r: { id: string }) => r.id === c.id)).toMatchObject({
    classification: 'MISSING_OUT',
    can_check_out: false,
  });
  expect(
    (
      await db.pool.query('SELECT checked_out_at FROM attendance_record WHERE assignment_id=$1', [
        c.id,
      ])
    ).rows[0].checked_out_at,
  ).toBeNull();
});

it('pays only the selected employee, protects draft privacy, prevents double pay and completes only all positive slips', async () => {
  const first = await worker(),
    second = await worker('pv002'),
    zero = await worker('bep001'),
    t = await template({
      startTime: '18:00',
      endTime: '22:00',
      useShiftRate: true,
      hourlyRate: '45000',
    });
  const a = (await schedule([t.id], '2026-05-05', [first, second, zero])).assignments;
  for (const row of a)
    await approve(
      row.id,
      row.user_id === zero ? 0 : 240,
      row.user_id === zero ? 'ZERO' : 'FULL',
      row.user_id === zero ? 'LEAVE' : 'MISSED_CLOCK',
    );
  const run = await ok('/core/payroll', 'quyettruong05', {
    periodStart: '2026-05-01',
    periodEnd: '2026-06-01',
  });
  let detail = await ok('/core/payroll/' + run.id);
  const firstSlip = detail.slips.find((s: { user_id: string }) => s.user_id === first),
    secondSlip = detail.slips.find((s: { user_id: string }) => s.user_id === second),
    zeroSlip = detail.slips.find((s: { user_id: string }) => s.user_id === zero);
  expect(
    (await ok('/core/payroll/me', 'pv001')).slips.some(
      (s: { id: string }) => s.id === firstSlip.id,
    ),
  ).toBe(false);
  expect(
    (
      await request(
        '/core/payroll/' + run.id + '/slips/' + firstSlip.id + '/paid',
        'quyettruong05',
        { reference: 'Chưa chốt' },
      )
    ).statusCode,
  ).toBe(409);
  await ok('/core/payroll/' + run.id + '/adjustments', 'quyettruong05', {
    slipId: firstSlip.id,
    type: 'BONUS',
    amount: '20000',
    description: 'Thưởng ca lễ',
  });
  await ok('/core/payroll/' + run.id + '/adjustments', 'quyettruong05', {
    slipId: firstSlip.id,
    type: 'DEDUCTION',
    amount: '5000',
    description: 'Khấu trừ theo thỏa thuận',
  });
  await ok('/core/payroll/' + run.id + '/finalize', 'quyettruong05', {});
  expect(
    (await ok('/core/payroll/me', 'pv001')).slips.find(
      (s: { id: string }) => s.id === firstSlip.id,
    ),
  ).toMatchObject({ payment_status: 'UNPAID' });
  const path = '/core/payroll/' + run.id + '/slips/' + firstSlip.id + '/paid';
  const results = await Promise.all([
    request(path, 'quyettruong05', { reference: 'Đã chi nhân viên 1' }),
    request(path, 'quyettruong05', { reference: 'Bấm lặp' }),
  ]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(results[0].json().id).toBe(results[1].json().id);
  expect(results[0].json().amount).toBe('195000');
  detail = await ok('/core/payroll/' + run.id);
  expect(detail.run.status).toBe('FINALIZED');
  expect(detail.payments).toHaveLength(1);
  expect(detail.slips.find((s: { id: string }) => s.id === firstSlip.id)).toMatchObject({
    payment_status: 'PAID',
    work_amount: '180000',
    bonus_amount: '20000',
    deduction_amount: '5000',
  });
  expect(detail.slips.find((s: { id: string }) => s.id === secondSlip.id).payment_status).toBe(
    'UNPAID',
  );
  expect(detail.slips.find((s: { id: string }) => s.id === zeroSlip.id).payment_status).toBe(
    'NOT_REQUIRED',
  );
  await expect(
    db.pool.query(
      "UPDATE payroll_run SET status='PAID',paid_by=$2,paid_at=now(),payment_reference='Sai' WHERE id=$1",
      [run.id, await worker('quyettruong05')],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await request(path, 'pv001', { reference: 'Không có quyền' })).statusCode).toBe(403);
  expect(
    (
      await request(
        '/core/payroll/' + run.id + '/slips/' + zeroSlip.id + '/paid',
        'quyettruong05',
        { reference: 'Không tạo giao dịch 0' },
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request(
        '/core/payroll/' + run.id + '/slips/' + randomUUID() + '/paid',
        'quyettruong05',
        { reference: 'Sai phiếu' },
      )
    ).statusCode,
  ).toBe(404);
  await ok('/core/payroll/' + run.id + '/slips/' + secondSlip.id + '/paid', 'quyettruong05', {
    reference: 'Đã chi nhân viên 2',
  });
  detail = await ok('/core/payroll/' + run.id);
  expect(detail.run.status).toBe('PAID');
  expect(detail.payments).toHaveLength(2);
  expect(
    (await ok('/core/payroll/me', 'pv001')).slips.every(
      (s: { user_id: string }) => s.user_id === first,
    ),
  ).toBe(true);
  expect((await ok('/core/payroll/me', 'quyettruong05')).slips).toHaveLength(0);
});

it('completes a zero payroll without a fake payment and retains legacy dated shifts', async () => {
  const t = await template({ useShiftRate: true, hourlyRate: '45000' }),
    a = (await schedule([t.id], '2026-06-05', [await worker()])).assignments[0];
  await approve(a.id, 0, 'ZERO', 'ABSENT');
  const run = await ok('/core/payroll', 'quyettruong05', {
    periodStart: '2026-06-01',
    periodEnd: '2026-07-01',
  });
  expect((await ok('/core/payroll/' + run.id + '/finalize', 'quyettruong05', {})).status).toBe(
    'PAID',
  );
  expect((await ok('/core/payroll/' + run.id)).payments).toHaveLength(0);
  const legacy = await db.pool.query(
    'SELECT template_id,break_minutes FROM work_shift WHERE code=$1',
    [
      String(
        (await db.pool.query('SELECT code FROM work_shift WHERE template_id IS NULL LIMIT 1'))
          .rows[0].code,
      ),
    ],
  );
  expect(legacy.rows[0].template_id).toBeNull();
});

it('loads the selected schedule window before limits and does not silently omit past or overnight ca', async () => {
  const window = await ok('/core/workforce?from=2026-04-01&to=2026-04-12');
  expect(
    window.shifts.some((s: { starts_at: string }) => s.starts_at === '2026-04-01T15:00:00.000Z'),
  ).toBe(true);
  expect(
    window.assignments.filter(
      (a: { starts_at: string }) => a.starts_at === '2026-04-10T02:00:00.000Z',
    ),
  ).toHaveLength(1);
  expect(
    window.assignments.every(
      (a: { starts_at: string; ends_at: string }) =>
        Date.parse(a.starts_at) < Date.parse('2026-04-13T00:00:00+07:00') &&
        Date.parse(a.ends_at) > Date.parse('2026-04-01T00:00:00+07:00'),
    ),
  ).toBe(true);
  expect((await request('/core/workforce?from=2026-04-01')).statusCode).toBe(400);
  expect((await request('/core/workforce?from=2026-04-01&to=2026-06-01')).statusCode).toBe(400);
  const mine = await ok('/core/workforce/me?from=2026-04-01&to=2026-04-12', 'pv001');
  expect(
    mine.assignments.some((a: { starts_at: string }) => a.starts_at === '2026-04-10T02:00:00.000Z'),
  ).toBe(true);
  expect(
    [...mine.assignments, ...mine.currentAssignments].every(
      (a: { user_id: string }) =>
        a.user_id ===
        window.assignments.find(
          (a: { starts_at: string }) => a.starts_at === '2026-04-10T02:00:00.000Z',
        ).user_id,
    ),
  ).toBe(true);
  expect((await request('/core/workforce/me?from=2026-04-01', 'pv001')).statusCode).toBe(400);
});

it('snapshots configurable clock and grace policies only on newly scheduled ca', async () => {
  const t = await template(),
    old = (await schedule([t.id], '2026-07-01')).shifts[0];
  await ok('/core/risk', 'quyettruong05', {
    CLOCK_IN_EARLY_MINUTES: 10,
    CLOCK_OUT_LATE_MINUTES: 60,
    ATTENDANCE_GRACE_MINUTES: 5,
  });
  const current = (await schedule([t.id], '2026-07-02')).shifts[0],
    same = (await schedule([t.id], '2026-07-01')).shifts[0];
  expect(current).toMatchObject({
    clock_in_early_minutes: 10,
    clock_out_late_minutes: 60,
    attendance_grace_minutes: 5,
  });
  expect(same).toMatchObject({
    id: old.id,
    clock_in_early_minutes: 15,
    clock_out_late_minutes: 120,
    attendance_grace_minutes: 15,
  });
  expect(
    (await request('/core/risk', 'quyettruong05', { CLOCK_OUT_LATE_MINUTES: 1440 })).statusCode,
  ).toBe(400);
  expect(
    (await request('/core/risk', 'quyettruong05', { ATTENDANCE_GRACE_MINUTES: 61 })).statusCode,
  ).toBe(400);
});
