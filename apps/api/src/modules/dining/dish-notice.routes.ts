import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  object,
  text,
  reject,
  one,
  session,
  transaction,
  event,
} from '../shared/core-persistence.js';
import { recordItemAudit } from '../orders/issue.routes.js';

// Guest communication and the monetary decision are separate durable tasks.
export function registerDishNotices(app: FastifyInstance, db: Database, restaurant: string) {
  app.post('/core/alerts/:id/stock-checked', { config: { permission: 'admin.workspace' } }, (r) =>
    transaction(db, async (c) => {
      const row = await one(
        c,
        "SELECT a.*,e.resource_id,e.restaurant_id FROM operational_alert a JOIN business_audit_event e ON e.details->>'alertId'=a.id::text AND e.action='KITCHEN_UNAVAILABLE_REPORTED' WHERE a.id=$1 AND e.restaurant_id=$2",
        [idParam(r), restaurant],
      );
      // All mutations use the same session-first lock order.
      await session(c, row.session_id, restaurant, false);
      const a = await one(c, 'SELECT * FROM operational_alert WHERE id=$1 FOR UPDATE', [row.id]);
      if (a.status === 'RESOLVED')
        reject('Cảnh báo đã được người khác hoàn tất. Dữ liệu đã thay đổi.');
      const note = text(object(r.body).reason, 500);
      await c.query(
        "UPDATE operational_alert SET status='RESOLVED',resolved_at=now(),resolved_by=$2,resolution_note=$3 WHERE id=$1",
        [row.id, r.identity!.id, note],
      );
      await recordItemAudit(
        c,
        restaurant,
        r.identity!.id,
        row.resource_id,
        'KITCHEN_STOCK_CHECKED',
        note,
        { alertId: row.id },
      );
      return { status: 'ok' };
    }),
  );
  app.post(
    '/core/alerts/:id/guest-notified',
    { config: { permission: 'staff.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const source = await one(
          c,
          `SELECT a.session_id,e.resource_id,i.order_batch_id FROM operational_alert a
         JOIN business_audit_event e ON e.details->>'alertId'=a.id::text AND e.action='KITCHEN_ISSUE_GUEST_NOTICE'
         JOIN order_item i ON i.id=e.resource_id
         WHERE a.id=$1 AND e.restaurant_id=$2`,
          [idParam(r), restaurant],
        );
        await session(c, source.session_id, restaurant, false);
        const alert = await one(c, 'SELECT * FROM operational_alert WHERE id=$1 FOR UPDATE', [
          idParam(r),
        ]);
        if (alert.status === 'RESOLVED') return { status: 'ok', alreadyProcessed: true };
        await c.query(
          `UPDATE operational_alert SET status='RESOLVED',acknowledged_by=COALESCE(acknowledged_by,$2),
        resolved_at=now(),resolved_by=$2,resolution_note='Đã trao đổi trực tiếp với khách tại bàn' WHERE id=$1`,
          [alert.id, r.identity!.id],
        );
        await recordItemAudit(
          c,
          restaurant,
          r.identity!.id,
          source.resource_id,
          'GUEST_NOTIFIED_OF_DISH_ISSUE',
          'Đã trao đổi trực tiếp với khách tại bàn',
          { alertId: alert.id, sessionId: source.session_id },
        );
        await event(c, source.order_batch_id, 'GUEST_NOTIFIED_OF_DISH_ISSUE');
        return { status: 'ok' };
      }),
  );
}
