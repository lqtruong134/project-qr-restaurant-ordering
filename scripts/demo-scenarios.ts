import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Database } from '../packages/database/src/index.js';
import { restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';

/** Fictional same-day transactions, created through the application's normal business rules. */
export async function seedScenarios(db: Database, password: string) {
  assert.equal(
    await db.prisma.table_session.count(),
    0,
    'Scenarios require an empty operational dataset.',
  );
  const app = buildApp(db);
  const origin = 'http://localhost:3000';
  await registerAuth(app, db, {
    secret: process.env.AUTH_SECRET!,
    restaurantId,
    origins: [origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  const cookies: Record<string, string> = {};
  async function call(url: string, user: string, payload?: Record<string, unknown>) {
    const r = await app.inject({
      url,
      method: payload === undefined ? 'GET' : 'POST',
      headers: { origin, 'x-csrf-protection': '1', cookie: cookies[user] ?? '' },
      payload,
    });
    assert.equal(r.statusCode, 200, url + ' ' + r.body);
    return r.json();
  }
  try {
    for (const username of ['quyettruong05', 'pv001', 'bep001']) {
      const r = await app.inject({
        url: '/auth/login',
        method: 'POST',
        headers: { origin, 'x-csrf-protection': '1' },
        payload: { username, password },
      });
      assert.equal(r.statusCode, 200, 'Seed account login failed');
      cookies[username] = r.cookies.map((c) => c.name + '=' + c.value).join('; ');
    }
    const tables = await db.prisma.dining_table.findMany({ orderBy: { code: 'asc' } });
    const products = await db.prisma.product.findMany({ orderBy: { code: 'asc' } });
    for (const t of tables) await call('/core/tables/' + t.id + '/qr', 'quyettruong05', {});
    for (let n = 0; n < 15; n++) {
      const t = tables[n]!;
      const session = await call('/core/tables/' + t.id + '/open', 'pv001', {});
      const lines = [0, 1, 2].map((j) => ({
        productId: products[(n * 3 + j) % products.length]!.id,
        quantity: j === 2 ? 2 : 1,
        notes: 'Dữ liệu mô phỏng để học và trình bày luận văn',
      }));
      const batch = await call('/core/sessions/' + session.id + '/orders', 'pv001', {
        requestId: randomUUID(),
        lines,
      });
      const items = await db.prisma.order_item.findMany({
        where: { order_batch_id: batch.id },
        orderBy: { id: 'asc' },
      });
      for (const item of items) {
        const actions =
          n === 12 ? [] : n === 13 ? ['accept', 'prepare'] : ['accept', 'prepare', 'ready'];
        for (const action of actions)
          await call('/core/items/' + item.id + '/' + action, 'bep001', {});
        if (n !== 12 && n !== 13) await call('/core/items/' + item.id + '/serve', 'pv001', {});
      }
      if (n >= 12) continue;
      if (n === 3)
        await call('/core/items/' + items[0]!.id + '/waive', 'quyettruong05', {
          reason: 'DEMO: tặng món chăm sóc khách vì phục vụ chậm',
        });
      const bill = await call('/core/sessions/' + session.id + '/bill', 'pv001');
      const total = BigInt(bill.account.outstanding_amount);
      const parts = n % 3 === 0 ? [total / 2n, total - total / 2n] : [total];
      const payments = [];
      for (const [i, amount] of parts.entries()) {
        const method = (n + i) % 2 === 0 ? 'CASH' : 'BANK_TRANSFER';
        const intent = await call('/core/sessions/' + session.id + '/payments', 'pv001', {
          requestId: randomUUID(),
          method,
          amount: amount.toString(),
        });
        payments.push(
          await call('/core/payments/' + intent.id + '/confirm', 'pv001', {
            amount: amount.toString(),
            ...(method === 'BANK_TRANSFER'
              ? { reference: 'DEMO-IN-' + n + '-' + i }
              : { receivedAmount: (((amount + 9999n) / 10000n) * 10000n).toString() }),
          }),
        );
      }
      if (n === 5) {
        await call('/core/items/' + items[0]!.id + '/waive', 'quyettruong05', {
          reason: 'DEMO: miễn tiền món đã thanh toán, khách chưa hài lòng',
        });
        const refundBill = await call('/core/sessions/' + session.id + '/bill', 'pv001');
        const amount = refundBill.account.refund_due_amount;
        const refund = await call('/core/sessions/' + session.id + '/refunds', 'quyettruong05', {
          paymentId: payments[0].id,
          amount,
          reason: 'DEMO: hoàn tiền món được miễn',
          requestId: randomUUID(),
        });
        await call('/core/refunds/' + refund.id + '/complete', 'pv001', {
          method: 'BANK_TRANSFER',
          reference: 'DEMO-OUT-005',
          amount,
          requestId: randomUUID(),
        });
      }
      const alerts = await db.prisma.operational_alert.findMany({
        where: { session_id: session.id, status: { not: 'RESOLVED' } },
      });
      for (const alert of alerts) {
        if (alert.status !== 'ACKNOWLEDGED')
          await call('/core/alerts/' + alert.id + '/acknowledge', 'pv001', {});
        await call('/core/alerts/' + alert.id + '/resolve', 'pv001', {
          reason: 'DEMO: nhân viên đã kiểm tra và hoàn tất tình huống mô phỏng',
        });
      }
      await call('/core/sessions/' + session.id + '/close', 'pv001', {});
      await call('/core/tables/' + t.id + '/clean', 'pv001', {});
    }
  } finally {
    await app.close();
  }
}

/** Read-only reconciliation: discrepancies must be investigated, never silently repaired. */
export async function verifySeed(db: Database) {
  const stock = await db.pool.query(
    `SELECT b.id FROM inventory_balance b WHERE b.on_hand_qty<>COALESCE((SELECT sum(m.quantity) FROM inventory_movement m WHERE m.location_id=b.location_id AND m.ingredient_id=b.ingredient_id),0) OR b.reserved_qty<>COALESCE((SELECT sum(r.quantity) FROM inventory_reservation r WHERE r.location_id=b.location_id AND r.ingredient_id=b.ingredient_id AND r.status IN ('PROVISIONAL','ACTIVE')),0) OR b.available_qty<>b.on_hand_qty-b.reserved_qty`,
  );
  assert.equal(stock.rowCount, 0, 'Stock/reservation ledger mismatch');
  const finance = await db.pool.query(
    `SELECT a.id FROM session_financial_account a WHERE a.charge_total<>COALESCE((SELECT sum(c.amount) FROM financial_charge c WHERE c.session_id=a.session_id AND c.status='ACTIVE'),0) OR a.paid_total<>COALESCE((SELECT sum(p.amount) FROM payment_transaction p WHERE p.session_id=a.session_id AND p.status='SUCCEEDED'),0) OR a.refunded_total<>COALESCE((SELECT sum(r.amount) FROM refund_transaction r JOIN refund_case f ON f.id=r.refund_case_id WHERE f.session_id=a.session_id AND r.status='SUCCEEDED'),0) OR a.outstanding_amount<>greatest(a.charge_total-a.paid_total+a.refunded_total,0) OR a.refund_due_amount<>greatest(a.paid_total-a.refunded_total-a.charge_total,0)`,
  );
  assert.equal(finance.rowCount, 0, 'Financial ledger mismatch');
  const counts = {
    accounts: await db.prisma.app_user.count(),
    tables: await db.prisma.dining_table.count(),
    products: await db.prisma.product.count(),
    ingredients: await db.prisma.ingredient.count(),
    locations: await db.prisma.stock_location.count(),
    recipes: await db.prisma.recipe_bom.count(),
    closedSessions: await db.prisma.table_session.count({ where: { session_status: 'CLOSED' } }),
    activeSessions: await db.prisma.table_session.count({ where: { session_status: 'ACTIVE' } }),
    payments: await db.prisma.payment_transaction.count(),
    refunds: await db.prisma.refund_transaction.count(),
  };
  assert.equal(counts.products, 48);
  assert.equal(counts.ingredients, 50);
  assert.equal(counts.recipes, 48);
  assert.equal(counts.closedSessions, 12);
  assert.equal(counts.activeSessions, 3);
  return counts;
}
