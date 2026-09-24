import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  guest,
  idParam,
  money,
  object,
  one,
  reject,
  session,
  text,
  transaction,
  uuid,
  type Connection,
  type Actor,
} from '../shared/core-persistence.js';
import { idempotent } from '../shared/idempotency.js';
import { readBill } from './receipt.service.js';
import { recalculate } from '../finance/ledger.service.js';
async function intent(
  c: Connection,
  sid: string,
  restaurant: string,
  actor: Actor,
  b: Record<string, unknown>,
) {
  await session(c, sid, restaurant);
  const key = text(b.requestId, 100);
  return idempotent(c, actor, 'payment:' + sid, key, b, 'PAYMENT_INTENT', async () => {
    const method = text(b.method);
    if (!['CASH', 'BANK_TRANSFER'].includes(method))
      reject('Chưa cấu hình cổng thanh toán online.', 400);
    await c.query(
      "UPDATE payment_intent SET status='EXPIRED',version=version+1 WHERE session_id=$1 AND status IN ('CREATED','PENDING') AND expires_at<=now()",
      [sid],
    );
    const a = await recalculate(c, sid),
      amount = money(b.amount);
    if (BigInt(amount) > BigInt(a.outstanding_amount) - BigInt(a.reserved_payment_amount))
      reject('Số tiền vượt số dư chưa được đặt thanh toán.');
    const result = await one(
      c,
      `INSERT INTO payment_intent(session_id,payer_participant_id,method,amount,currency,client_request_id,expires_at) VALUES($1,$2,$3,$4,'VND',$5,now()+interval '15 minutes') RETURNING *`,
      [sid, actor.type === 'GUEST' ? actor.id : null, method, amount, key],
    );
    await recalculate(c, sid);
    return result;
  });
}
export function registerFinance(app: FastifyInstance, db: Database, restaurant: string) {
  const staff = { permission: 'staff.workspace' };
  app.get('/core/sessions/:id/bill', { config: staff }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant, false);
      return readBill(c, s, restaurant);
    }),
  );
  app.get(
    '/core/receipts',
    { config: staff },
    async () =>
      (
        await db.pool.query(
          `SELECT s.id,s.receipt_number,s.opened_at,s.closed_at,s.close_reason,t.code AS table_code,
    COALESCE(s.receipt_snapshot->'account'->>'charge_total',a.charge_total::text,'0') AS total_amount,
    u.display_name AS closed_by_name FROM table_session s JOIN dining_table t ON t.id=s.table_id
    LEFT JOIN session_financial_account a ON a.session_id=s.id LEFT JOIN app_user u ON u.id=s.closed_by
    WHERE t.restaurant_id=$1 AND s.session_status='CLOSED' ORDER BY s.closed_at DESC LIMIT 100`,
          [restaurant],
        )
      ).rows,
  );
  app.post('/guest/payments', { config: { public: true } }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      return intent(c, p.session_id, restaurant, { type: 'GUEST', id: p.id }, object(r.body));
    }),
  );
  app.post('/core/sessions/:id/payments', { config: staff }, async (r) =>
    transaction(db, (c) =>
      intent(c, idParam(r), restaurant, { type: 'USER', id: r.identity!.id }, object(r.body)),
    ),
  );
  app.post('/core/payments/:id/confirm', { config: staff }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        b = object(r.body),
        e = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, e.session_id, restaurant);
      const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
      if (pi.status === 'SUCCEEDED')
        return one(
          c,
          "SELECT * FROM payment_transaction WHERE payment_intent_id=$1 AND status='SUCCEEDED'",
          [id],
        );
      if (
        !['CREATED', 'PENDING'].includes(pi.status) ||
        new Date(pi.expires_at).getTime() <= Date.now()
      )
        reject('Yêu cầu thanh toán đã hết hạn hoặc đã được xử lý.');
      if (!['CASH', 'BANK_TRANSFER'].includes(pi.method))
        reject('Thanh toán online chỉ được xác nhận từ nhà cung cấp.', 403);
      const amount = money(b.amount);
      if (amount !== pi.amount) reject('Số tiền xác nhận phải khớp yêu cầu thanh toán.');
      const reference = pi.method === 'BANK_TRANSFER' ? text(b.reference, 120) : null;
      const cashReceived = pi.method === 'CASH' ? money(b.receivedAmount ?? amount) : null;
      if (cashReceived !== null && BigInt(cashReceived) < BigInt(amount))
        reject('Tiền khách đưa chưa đủ số tiền xác nhận.', 400);
      const changeGiven =
        cashReceived === null ? null : (BigInt(cashReceived) - BigInt(amount)).toString();
      const a = await recalculate(c, pi.session_id);
      if (BigInt(amount) > BigInt(a.outstanding_amount))
        reject('Số dư đã thay đổi. Vui lòng lập yêu cầu mới.');
      const payment = await one(
        c,
        `INSERT INTO payment_transaction(payment_intent_id,session_id,method,amount,currency,status,confirmed_by,confirmed_at,metadata) VALUES($1,$2,$3,$4,'VND','SUCCEEDED',$5,now(),$6) RETURNING *`,
        [
          id,
          pi.session_id,
          pi.method,
          amount,
          r.identity!.id,
          JSON.stringify({ reference, cashReceived, changeGiven }),
        ],
      );
      const charges = (
        await c.query(
          `SELECT f.*,f.amount-COALESCE((SELECT sum(allocated_amount-reversed_amount) FROM payment_allocation WHERE financial_charge_id=f.id),0) AS remaining FROM financial_charge f WHERE f.session_id=$1 AND f.status='ACTIVE' ORDER BY f.created_at,f.id FOR UPDATE`,
          [pi.session_id],
        )
      ).rows;
      let left = BigInt(amount);
      for (const charge of charges) {
        if (left === 0n) break;
        const available = BigInt(charge.remaining);
        if (available <= 0n) continue;
        const part = left < available ? left : available;
        await c.query(
          'INSERT INTO payment_allocation(payment_transaction_id,financial_charge_id,allocated_amount) VALUES($1,$2,$3)',
          [payment.id, charge.id, part.toString()],
        );
        left -= part;
      }
      if (left !== 0n) reject('Không thể phân bổ đủ tiền vào khoản phải thu.');
      await c.query("UPDATE payment_intent SET status='SUCCEEDED',version=version+1 WHERE id=$1", [
        id,
      ]);
      await c.query(
        `INSERT INTO outbox_event(aggregate_type,payment_transaction_id,event_type,payload) VALUES('PAYMENT_TRANSACTION',$1,'PAYMENT_CONFIRMED',jsonb_build_object('sessionId',$2::text))`,
        [payment.id, pi.session_id],
      );
      await recalculate(c, pi.session_id);
      return payment;
    }),
  );
  app.post('/core/payments/:id/cancel', { config: staff }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        pi = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, pi.session_id, restaurant);
      const result = await one(
        c,
        "UPDATE payment_intent SET status='CANCELLED',version=version+1 WHERE id=$1 AND status IN ('CREATED','PENDING') RETURNING *",
        [id],
      );
      await recalculate(c, pi.session_id);
      return result;
    }),
  );
  app.post('/core/sessions/:id/refunds', { config: staff }, async (r) =>
    transaction(db, async (c) => {
      const sid = idParam(r),
        b = object(r.body);
      await session(c, sid, restaurant, false);
      const a = await recalculate(c, sid);
      const pending = await one(
        c,
        "SELECT COALESCE(sum(amount),0) AS amount FROM refund_case WHERE session_id=$1 AND status IN ('OPEN','IN_PROGRESS')",
        [sid],
      );
      const amount = money(b.amount);
      if (BigInt(amount) > BigInt(a.refund_due_amount) - BigInt(pending.amount))
        reject('Số tiền vượt số dư cần hoàn chưa lập hồ sơ.');
      const source = await one(
        c,
        "SELECT * FROM payment_transaction WHERE id=$1 AND session_id=$2 AND status='SUCCEEDED'",
        [uuid(b.paymentId), sid],
      );
      const refunded = await one(
        c,
        "SELECT COALESCE(sum(amount),0) AS amount FROM refund_case WHERE source_payment_transaction_id=$1 AND status<>'CANCELLED'",
        [source.id],
      );
      if (BigInt(amount) + BigInt(refunded.amount) > BigInt(source.amount))
        reject('Hoàn vượt giao dịch gốc.');
      return one(
        c,
        'INSERT INTO refund_case(session_id,source_payment_transaction_id,amount,reason,assigned_staff_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [sid, source.id, amount, text(b.reason, 300), r.identity!.id],
      );
    }),
  );
  app.post('/core/refunds/:id/complete', { config: staff }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        b = object(r.body),
        e = await one(c, 'SELECT session_id FROM refund_case WHERE id=$1', [id]);
      await session(c, e.session_id, restaurant, false);
      const f = await one(c, 'SELECT * FROM refund_case WHERE id=$1 FOR UPDATE', [id]);
      if (['RESOLVED_CASH', 'RESOLVED_TRANSFER'].includes(f.status)) return f;
      if (!['OPEN', 'IN_PROGRESS'].includes(f.status)) reject('Hồ sơ hoàn đã đóng.');
      const a = await recalculate(c, f.session_id);
      if (BigInt(f.amount) > BigInt(a.refund_due_amount)) reject('Số dư cần hoàn đã thay đổi.');
      const method = text(b.method);
      if (!['CASH', 'BANK_TRANSFER'].includes(method))
        reject('Chọn tiền mặt hoặc chuyển khoản.', 400);
      const reference = method === 'BANK_TRANSFER' ? text(b.reference, 120) : null;
      await c.query(
        "INSERT INTO refund_transaction(refund_case_id,method,amount,reference,status,processed_by,processed_at) VALUES($1,$2,$3,$4,'SUCCEEDED',$5,now())",
        [id, method, f.amount, reference, r.identity!.id],
      );
      await c.query('UPDATE refund_case SET status=$2,resolution_method=$3 WHERE id=$1', [
        id,
        method === 'CASH' ? 'RESOLVED_CASH' : 'RESOLVED_TRANSFER',
        method,
      ]);
      await recalculate(c, f.session_id);
      return { status: 'ok' };
    }),
  );
  app.get('/core/reports', { config: { permission: 'admin.workspace' } }, async () => ({
    store: (await db.pool.query('SELECT name,address FROM restaurant WHERE id=$1', [restaurant]))
      .rows[0],
    sales: (
      await db.pool.query(
        `SELECT i.product_id,i.product_name_snapshot,sum(i.quantity)::text AS quantity,sum(i.line_total)::text AS sales,COALESCE(sum((SELECT sum(s.cogs_value) FROM order_item_ingredient_snapshot s WHERE s.order_item_id=i.id)),0)::text AS cost FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND i.status='SERVED' GROUP BY i.product_id,i.product_name_snapshot ORDER BY sum(i.line_total) DESC`,
        [restaurant],
      )
    ).rows,
    payments: (
      await db.pool.query(
        "SELECT method,sum(amount)::text AS amount FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND p.status='SUCCEEDED' GROUP BY method",
        [restaurant],
      )
    ).rows,
  }));
}
