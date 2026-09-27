import { readPolicy } from '../risk/policy.service.js';
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
    const { policy } = await readPolicy(c, restaurant);
    const result = await one(
      c,
      `INSERT INTO payment_intent(session_id,payer_participant_id,method,amount,currency,client_request_id,expires_at) VALUES($1,$2,$3,$4,'VND',$5,now()+$6::int*interval '1 minute') RETURNING *`,
      [
        sid,
        actor.type === 'GUEST' ? actor.id : null,
        method,
        amount,
        key,
        Number(policy.PAYMENT_TTL_MINUTES),
      ],
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
      if (reference) {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          restaurant + ':bank:' + reference,
        ]);
        const duplicate = await c.query(
          "SELECT p.id FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND p.method='BANK_TRANSFER' AND p.status='SUCCEEDED' AND p.metadata->>'reference'=$2",
          [restaurant, reference],
        );
        if (duplicate.rowCount) reject('Mã chuyển khoản đã được xác nhận cho một giao dịch khác.');
      }
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
      const current = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
      if (current.status === 'CANCELLED') return current;
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
      const requestKey = b.requestId === undefined ? null : text(b.requestId, 100);
      if (requestKey) {
        const old = (
          await c.query('SELECT * FROM refund_case WHERE session_id=$1 AND request_key=$2', [
            sid,
            requestKey,
          ])
        ).rows[0];
        if (old) {
          if (
            String(old.amount) !== money(b.amount) ||
            old.source_payment_transaction_id !== uuid(b.paymentId) ||
            old.reason !== text(b.reason, 300)
          )
            reject('Mã gửi lại đã dùng cho nội dung hoàn tiền khác.');
          return old;
        }
      }
      const a = await recalculate(c, sid);
      const pending = await one(
        c,
        "SELECT COALESCE(sum(f.amount-COALESCE((SELECT sum(t.amount) FROM refund_transaction t WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'),0)),0) AS amount FROM refund_case f WHERE session_id=$1 AND status IN ('OPEN','IN_PROGRESS')",
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
        'INSERT INTO refund_case(session_id,source_payment_transaction_id,amount,reason,assigned_staff_id,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [sid, source.id, amount, text(b.reason, 300), r.identity!.id, requestKey],
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
      const key = b.requestId === undefined ? 'legacy-complete' : text(b.requestId, 100);
      const old = (
        await c.query(
          'SELECT * FROM refund_transaction WHERE refund_case_id=$1 AND request_key=$2',
          [id, key],
        )
      ).rows[0];
      if (old) {
        if (
          (b.amount !== undefined && money(b.amount) !== String(old.amount)) ||
          b.method !== old.method ||
          (old.method === 'BANK_TRANSFER' && b.reference !== old.reference)
        )
          reject('Mã gửi lại đã dùng cho nội dung hoàn tiền khác.');
        return old;
      }
      if (['RESOLVED_CASH', 'RESOLVED_TRANSFER'].includes(f.status)) return f;
      const totals = await one(
        c,
        "SELECT COALESCE(sum(amount),0) AS amount FROM refund_transaction WHERE refund_case_id=$1 AND status='SUCCEEDED'",
        [id],
      );
      const remaining = BigInt(f.amount) - BigInt(totals.amount);
      const amount = b.amount === undefined ? remaining.toString() : money(b.amount);
      if (BigInt(amount) > remaining) reject('Số tiền vượt phần còn phải hoàn của hồ sơ.');
      if (!['OPEN', 'IN_PROGRESS'].includes(f.status)) reject('Hồ sơ hoàn đã đóng.');
      const a = await recalculate(c, f.session_id);
      if (BigInt(amount) > BigInt(a.refund_due_amount)) reject('Số dư cần hoàn đã thay đổi.');
      const method = text(b.method);
      if (!['CASH', 'BANK_TRANSFER'].includes(method))
        reject('Chọn tiền mặt hoặc chuyển khoản.', 400);
      const reference = method === 'BANK_TRANSFER' ? text(b.reference, 120) : null;
      await c.query(
        "INSERT INTO refund_transaction(refund_case_id,method,amount,reference,status,processed_by,processed_at,request_key) VALUES($1,$2,$3,$4,'SUCCEEDED',$5,now(),$6)",
        [id, method, amount, reference, r.identity!.id, key],
      );
      await c.query('UPDATE refund_case SET status=$2,resolution_method=$3 WHERE id=$1', [
        id,
        BigInt(amount) < remaining
          ? 'IN_PROGRESS'
          : method === 'CASH'
            ? 'RESOLVED_CASH'
            : 'RESOLVED_TRANSFER',
        method,
      ]);
      await recalculate(c, f.session_id);
      return { status: 'ok' };
    }),
  );
  app.get('/core/reports/sessions/:id', { config: { permission: 'admin.workspace' } }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant, false);
      return {
        bill: await readBill(c, s, restaurant),
        exceptions: (
          await c.query(
            `SELECT e.action,e.reason,e.created_at,u.display_name FROM business_audit_event e LEFT JOIN app_user u ON u.id=e.actor_id WHERE e.restaurant_id=$2 AND (e.resource_id=$1 OR e.resource_id IN (SELECT i.id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=$1)) ORDER BY e.created_at`,
            [s.id, restaurant],
          )
        ).rows,
      };
    }),
  );
  app.get('/core/reports', { config: { permission: 'admin.workspace' } }, async () => ({
    reconciliation: (
      await db.pool.query(
        `SELECT s.id,s.receipt_number,t.code AS table_code,s.opened_at,s.closed_at,
      COALESCE((SELECT sum(amount) FROM financial_charge WHERE session_id=s.id AND status='ACTIVE'),0)::text AS payable,
      COALESCE((SELECT sum(amount) FROM payment_transaction WHERE session_id=s.id AND status='SUCCEEDED'),0)::text AS collected,
      COALESCE((SELECT sum(rt.amount) FROM refund_transaction rt JOIN refund_case f ON f.id=rt.refund_case_id WHERE f.session_id=s.id AND rt.status='SUCCEEDED'),0)::text AS refunded,
      COALESCE((SELECT sum(outstanding_amount) FROM outstanding_balance_case WHERE session_id=s.id AND status='WRITTEN_OFF'),0)::text AS written_off,
      COALESCE((SELECT sum(f.amount) FROM financial_charge f WHERE f.session_id=s.id AND f.status='REVERSED'),0)::text AS reversed,
      COALESCE((SELECT sum((e.details->>'consumedCost')::bigint) FROM business_audit_event e JOIN order_item i ON i.id=e.resource_id JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=s.id AND e.action='LATE_CANCEL'),0)::text AS stock_loss
      FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 ORDER BY s.opened_at DESC`,
        [restaurant],
      )
    ).rows,

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
