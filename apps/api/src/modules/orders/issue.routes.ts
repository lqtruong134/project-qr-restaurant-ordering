import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  transaction,
  one,
  session,
  idParam,
  object,
  reject,
  history,
  event,
} from '../shared/core-persistence.js';
import { aggregateBatch } from './item-lifecycle.service.js';
import { parseReason } from './reasons.js';
export async function recordItemAudit(
  c: import('../shared/core-persistence.js').Connection,
  restaurant: string,
  actor: string,
  item: string,
  action: string,
  reason: string,
  details: Record<string, unknown>,
) {
  return one(
    c,
    "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,$3,'ORDER_ITEM',$4,$5,$6) RETURNING id",
    [restaurant, actor, action, item, reason, JSON.stringify(details)],
  );
}
export async function resolveItemIssue(
  c: import('../shared/core-persistence.js').Connection,
  item: string,
  actor: string,
  reason: string,
  restaurant: string,
) {
  const reports = (
    await c.query(
      "SELECT e.id,e.details FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid WHERE e.resource_id=$1 AND e.restaurant_id=$2 AND e.action='KITCHEN_ISSUE_REPORTED' AND a.status<>'RESOLVED'",
      [item, restaurant],
    )
  ).rows;
  for (const report of reports) {
    await c.query(
      "UPDATE operational_alert SET status='RESOLVED',resolved_at=now(),resolved_by=$2,resolution_note=$3 WHERE id=$1",
      [report.details.alertId, actor, reason],
    );
    await recordItemAudit(c, restaurant, actor, item, 'KITCHEN_ISSUE_RESOLVED', reason, {
      reportId: report.id,
    });
  }
}
export function registerItemIssues(app: FastifyInstance, db: Database, restaurant: string) {
  app.post(
    '/core/items/:id/report-issue',
    { config: { permission: 'kitchen.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          reason = parseReason(object(r.body), 'KITCHEN_ISSUE');
        const source = await one(
          c,
          'SELECT b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=$1',
          [id],
        );
        const s = await session(c, source.session_id, restaurant);
        const item = await one(c, 'SELECT * FROM order_item WHERE id=$1 FOR UPDATE', [id]);
        const pending = (
          await c.query(
            "SELECT e.id,e.reason FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid WHERE e.resource_id=$1 AND e.action='KITCHEN_ISSUE_REPORTED' AND a.status<>'RESOLVED'",
            [id],
          )
        ).rows[0];
        if (pending) {
          if (pending.reason !== reason.text) reject('Món đã có báo cáo khác đang chờ quản trị.');
          return { status: 'ok', alreadyProcessed: true };
        }
        if (!['IN_PREPARATION', 'READY'].includes(item.status))
          reject('Chỉ báo sự cố cho món đang chế biến hoặc chưa mang ra.');
        await c.query(
          "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancel_reason_code=$3,cancelled_by_type='USER',cancelled_by_user_id=$4,version=version+1 WHERE id=$1",
          [id, reason.text, reason.code, r.identity!.id],
        );
        await history(
          c,
          item.order_batch_id,
          id,
          item.status,
          'CANCELLED',
          { type: 'USER', id: r.identity!.id },
          reason.text,
        );
        await aggregateBatch(c, item.order_batch_id, { type: 'USER', id: r.identity!.id });
        const cost = await one(
          c,
          'SELECT COALESCE(sum(cogs_value),0)::text AS amount FROM order_item_ingredient_snapshot WHERE order_item_id=$1',
          [id],
        );
        await recordItemAudit(c, restaurant, r.identity!.id, id, 'LATE_CANCEL', reason.text, {
          previousStatus: item.status,
          consumedCost: cost.amount,
          chargeRetained: true,
          reasonCode: reason.code,
          awaitingAdmin: true,
        });
        const alert = await one(
          c,
          "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'OTHER','WARNING') RETURNING id",
          [s.id, s.table_id],
        );
        const guestAlert = await one(
          c,
          "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'OTHER','WARNING') RETURNING id",
          [s.id, s.table_id],
        );
        await recordItemAudit(
          c,
          restaurant,
          r.identity!.id,
          id,
          'KITCHEN_ISSUE_GUEST_NOTICE',
          reason.text,
          { reasonCode: reason.code, alertId: guestAlert.id, adminAlertId: alert.id },
        );
        await recordItemAudit(
          c,
          restaurant,
          r.identity!.id,
          id,
          'KITCHEN_ISSUE_REPORTED',
          reason.text,
          { reasonCode: reason.code, alertId: alert.id, note: reason.note },
        );
        await event(c, item.order_batch_id, 'KITCHEN_ISSUE_REPORTED');
        return { status: 'ok', awaitingAdmin: true };
      }),
  );
}
