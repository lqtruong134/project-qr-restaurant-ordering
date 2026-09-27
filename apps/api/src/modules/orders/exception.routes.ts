import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  one,
  session,
  transaction,
  idParam,
  object,
  text,
  reject,
  history,
  event,
} from '../shared/core-persistence.js';
import { aggregateBatch } from './item-lifecycle.service.js';
import { recalculate } from '../finance/ledger.service.js';
export function registerOrderExceptions(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'admin.workspace' };
  app.get(
    '/core/order-exceptions',
    { config },
    async () =>
      (
        await db.pool.query(
          `SELECT i.*,t.code AS table_code,b.session_id,
 EXISTS(SELECT 1 FROM business_audit_event e WHERE e.resource_id=i.id AND e.action='LATE_CANCEL') AS late_cancelled,
 EXISTS(SELECT 1 FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE') AS has_charge
 FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id
 WHERE t.restaurant_id=$1 AND s.session_status='ACTIVE' AND i.status IN ('IN_PREPARATION','READY','SERVED','CANCELLED') ORDER BY i.created_at DESC LIMIT 200`,
          [restaurant],
        )
      ).rows,
  );
  for (const action of ['late-cancel', 'waive'])
    app.post('/core/items/:id/' + action, { config }, async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          reason = text(object(r.body).reason, 500),
          actor = { type: 'USER' as const, id: r.identity!.id };
        const source = await one(
          c,
          'SELECT b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=$1',
          [id],
        );
        const s = await session(c, source.session_id, restaurant);
        const item = await one(c, 'SELECT * FROM order_item WHERE id=$1 FOR UPDATE', [id]);
        if (action === 'late-cancel') {
          if (!['IN_PREPARATION', 'READY', 'SERVED'].includes(item.status))
            reject('Chỉ dùng hủy muộn cho món đã bắt đầu chế biến.');
          await c.query(
            "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancelled_by_type='USER',cancelled_by_user_id=$3,version=version+1 WHERE id=$1",
            [id, reason, actor.id],
          );
          await history(c, item.order_batch_id, id, item.status, 'CANCELLED', actor, reason);
          await aggregateBatch(c, item.order_batch_id, actor);
          const loss = await one(
            c,
            'SELECT COALESCE(sum(cogs_value),0)::text AS amount FROM order_item_ingredient_snapshot WHERE order_item_id=$1',
            [id],
          );
          await c.query(
            "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'LATE_CANCEL','ORDER_ITEM',$3,$4,$5)",
            [
              restaurant,
              actor.id,
              id,
              reason,
              JSON.stringify({
                previousStatus: item.status,
                consumedCost: loss.amount,
                chargeRetained: true,
              }),
            ],
          );
        } else {
          const cancelled = await c.query(
            "SELECT id FROM business_audit_event WHERE resource_id=$1 AND action='LATE_CANCEL'",
            [id],
          );
          if (!cancelled.rowCount) reject('Chỉ miễn tiền riêng cho món đã được quản trị hủy muộn.');
          const charges = await c.query(
            "UPDATE financial_charge SET status='REVERSED',reversed_at=now() WHERE order_item_id=$1 AND status='ACTIVE' RETURNING amount",
            [id],
          );
          if (!charges.rowCount) reject('Khoản thu đã được miễn hoặc không phát sinh.');
          await c.query(
            'UPDATE payment_allocation SET reversed_amount=allocated_amount WHERE financial_charge_id IN (SELECT id FROM financial_charge WHERE order_item_id=$1)',
            [id],
          );
          await c.query(
            "UPDATE payment_intent SET status='CANCELLED',version=version+1 WHERE session_id=$1 AND status IN ('CREATED','PENDING')",
            [s.id],
          );
          const account = await recalculate(c, s.id);
          await c.query(
            "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'WAIVE_ITEM','ORDER_ITEM',$3,$4,$5)",
            [restaurant, actor.id, id, reason, JSON.stringify({ amount: charges.rows[0].amount })],
          );
          if (BigInt(account.refund_due_amount) > 0n)
            await c.query(
              "INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) VALUES($1,$2,'REFUND_REQUIRED','WARNING',$3)",
              [s.id, s.table_id, account.refund_due_amount],
            );
        }
        await event(
          c,
          item.order_batch_id,
          action === 'waive' ? 'ITEM_WAIVED' : 'ITEM_LATE_CANCELLED',
        );
        return { status: 'ok' };
      }),
    );
}
