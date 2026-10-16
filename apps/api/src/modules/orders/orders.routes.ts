import { parseReason } from './reasons.js';
import { aggregateBatch } from './item-lifecycle.service.js';
import { recordItemAudit } from './issue.routes.js';
import { transitionItem, cancelItems } from './item-lifecycle.service.js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  event,
  guest,
  history,
  idParam,
  object,
  text,
  one,
  reject,
  session,
  transaction,
  uuid,
} from '../shared/core-persistence.js';
import { release, releaseItem } from '../inventory/inventory.service.js';
import { submit } from './orders.service.js';
import { addCharges, reverseItemCharge } from '../finance/ledger.service.js';
export function registerOrders(app: FastifyInstance, db: Database, restaurant: string) {
  app.post('/guest/orders', { config: { public: true } }, async (r) => {
    const result = await transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      await c.query('SAVEPOINT guest_submit');
      try {
        return await submit(
          c,
          p.session_id,
          restaurant,
          { type: 'GUEST', id: p.id },
          object(r.body),
        );
      } catch (error) {
        if (!(error instanceof Error) || !('blockGuest' in error)) throw error;
        await c.query('ROLLBACK TO SAVEPOINT guest_submit');
        await c.query(
          "UPDATE session_participant SET status='BLOCKED',blocked_until=now()+interval '10 minutes' WHERE id=$1",
          [p.id],
        );
        return { blocked: true };
      }
    });
    if (result.blocked)
      reject(
        'Tạm dừng gọi món trong 10 phút do gửi quá nhiều lượt. Vui lòng nhờ nhân viên hỗ trợ.',
        429,
      );
    return result;
  });
  app.post('/core/sessions/:id/orders', { config: { permission: 'staff.workspace' } }, async (r) =>
    transaction(db, (c) =>
      submit(c, idParam(r), restaurant, { type: 'USER', id: r.identity!.id }, object(r.body)),
    ),
  );
  app.get('/core/orders', { config: { permission: 'staff.workspace' } }, async () =>
    db.pool
      .query(
        `SELECT b.*,t.code AS table_code,a.name AS area_name,(SELECT jsonb_agg(i ORDER BY i.created_at) FROM order_item i WHERE i.order_batch_id=b.id) AS items FROM order_batch b JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id JOIN dining_area a ON a.id=t.area_id WHERE t.restaurant_id=$1 AND s.session_status='ACTIVE' ORDER BY b.created_at`,
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.get('/core/kitchen', { config: { permission: 'kitchen.workspace' } }, async () =>
    db.pool
      .query(
        `SELECT b.*,t.code AS table_code,a.name AS area_name,(SELECT jsonb_agg(i ORDER BY i.created_at) FROM order_item i WHERE i.order_batch_id=b.id) AS items FROM order_batch b JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id JOIN dining_area a ON a.id=t.area_id WHERE t.restaurant_id=$1 AND b.status IN ('SUBMITTED','ACCEPTED','IN_PROGRESS') ORDER BY b.submitted_at`,
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.post(
    '/core/items/:id/unavailable',
    { config: { permission: 'kitchen.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          reason = parseReason(object(r.body), 'KITCHEN_UNAVAILABLE');
        const source = await one(
          c,
          'SELECT b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=$1',
          [id],
        );
        const activeSession = await session(c, source.session_id, restaurant);
        const item = await one(c, 'SELECT * FROM order_item WHERE id=$1 FOR UPDATE', [id]);
        if (
          item.status === 'UNAVAILABLE' &&
          item.cancel_reason_code === reason.code &&
          item.cancel_reason === reason.text
        )
          return { status: 'ok', alreadyProcessed: true };
        if (item.status !== 'ACCEPTED')
          reject(
            'Món đã thay đổi trạng thái. Chỉ dừng theo cách này khi bếp đã nhận và chưa chế biến.',
          );

        await c.query(
          "UPDATE product SET availability_status='UNAVAILABLE',version=version+1 WHERE id=$1 AND restaurant_id=$2 AND availability_status='AVAILABLE'",
          [item.product_id, restaurant],
        );
        await releaseItem(c, id);
        await c.query(
          "UPDATE order_item SET status='UNAVAILABLE',cancel_reason=$2,cancel_reason_code=$3,cancelled_by_type='USER',cancelled_by_user_id=$4,version=version+1 WHERE id=$1",
          [id, reason.text, reason.code, r.identity!.id],
        );
        const actor = { type: 'USER' as const, id: r.identity!.id };
        await history(c, item.order_batch_id, id, 'ACCEPTED', 'UNAVAILABLE', actor, reason.text);
        await aggregateBatch(c, item.order_batch_id, actor);
        const result = await reverseItemCharge(c, id, source.session_id);
        await recordItemAudit(c, restaurant, r.identity!.id, id, 'ITEM_UNAVAILABLE', reason.text, {
          reasonCode: reason.code,
          amount: result.amount,
          chargeRetained: false,
        });
        // Reserve release is not a physical stock adjustment. Admin must inspect the discrepancy.
        const inspection = await one(
          c,
          "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'OTHER','WARNING') RETURNING id",
          [source.session_id, activeSession.table_id],
        );
        const notice = await one(
          c,
          "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'OTHER','WARNING') RETURNING id",
          [source.session_id, activeSession.table_id],
        );
        await recordItemAudit(
          c,
          restaurant,
          r.identity!.id,
          id,
          'KITCHEN_UNAVAILABLE_REPORTED',
          reason.text,
          {
            reasonCode: reason.code,
            alertId: inspection.id,
            productId: item.product_id,
            chargeRetained: false,
          },
        );
        await recordItemAudit(
          c,
          restaurant,
          r.identity!.id,
          id,
          'KITCHEN_ISSUE_GUEST_NOTICE',
          reason.text,
          {
            reasonCode: reason.code,
            alertId: notice.id,
            adminAlertId: inspection.id,
            beforePreparation: true,
          },
        );
        // Stop further orders for this dish, without fabricating an inventory count.

        await event(c, item.order_batch_id, 'ITEM_UNAVAILABLE');
        return { status: 'ok' };
      }),
  );
  app.post('/core/orders/:id/review', { config: { permission: 'staff.workspace' } }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        id = idParam(r);
      const existing = await one(c, 'SELECT session_id FROM order_batch WHERE id=$1', [id]);
      await session(c, existing.session_id, restaurant);
      const batch = await one(c, 'SELECT * FROM order_batch WHERE id=$1 FOR UPDATE', [id]);
      const review = await one(c, 'SELECT * FROM order_review WHERE order_batch_id=$1 FOR UPDATE', [
        id,
      ]);
      if (batch.status !== 'PENDING_REVIEW' || review.status !== 'PENDING')
        reject('Lượt gọi đã được xử lý.');
      const approve = b.approve === true,
        expired = new Date(review.expires_at).getTime() <= Date.now();
      if (typeof b.approve !== 'boolean') reject('Quyết định không hợp lệ.', 400);
      if (approve && expired) reject('Yêu cầu duyệt đã hết hạn.');
      if (approve) {
        const invalid = await c.query(
          `SELECT i.id FROM order_item i JOIN product p ON p.id=i.product_id JOIN menu_category m ON m.id=p.category_id WHERE i.order_batch_id=$1 AND i.status='SUBMITTED' AND (NOT p.is_active OR NOT m.is_active OR p.availability_status<>'AVAILABLE' OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(i.combo_components_snapshot) component
            JOIN product child ON child.id=(component->>'product_id')::uuid
            JOIN menu_category child_category ON child_category.id=child.category_id
            WHERE NOT child.is_active OR NOT child_category.is_active OR child.availability_status<>'AVAILABLE'
          ))`,
          [id],
        );
        if (invalid.rowCount)
          reject('Món đã ngừng phục vụ. Từ chối lượt này và yêu cầu khách chọn món khác.');
        await c.query(
          "UPDATE inventory_reservation SET status='ACTIVE',reservation_type='CONFIRMED',expires_at=NULL WHERE order_item_id IN (SELECT id FROM order_item WHERE order_batch_id=$1) AND status='PROVISIONAL'",
          [id],
        );
        await addCharges(c, id, batch.session_id);
      } else {
        await release(c, id);
        await c.query(
          "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancelled_by_type='USER',cancelled_by_user_id=$3,version=version+1 WHERE order_batch_id=$1 AND status='SUBMITTED'",
          [id, text(b.reason, 300), r.identity!.id],
        );
      }
      await c.query(
        'UPDATE order_review SET status=$2,reviewer_id=$3,decided_at=now(),decision_reason=$4,version=version+1 WHERE id=$1',
        [
          review.id,
          approve ? 'APPROVED' : 'REJECTED',
          r.identity!.id,
          approve ? 'Đã kiểm tra tại bàn' : text(b.reason, 300),
        ],
      );
      await c.query('UPDATE order_batch SET status=$2,version=version+1 WHERE id=$1', [
        id,
        approve ? 'SUBMITTED' : 'REJECTED',
      ]);
      await history(c, id, null, batch.status, approve ? 'SUBMITTED' : 'REJECTED', {
        type: 'USER',
        id: r.identity!.id,
      });
      await event(c, id, approve ? 'ORDER_SUBMITTED' : 'ORDER_REJECTED');
      return { status: 'ok' };
    }),
  );
  app.post('/core/orders/:id/accept', { config: { permission: 'kitchen.workspace' } }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        batch = await one(c, 'SELECT session_id FROM order_batch WHERE id=$1', [id]);
      await session(c, batch.session_id, restaurant);
      const items = (
        await c.query(
          "SELECT id FROM order_item WHERE order_batch_id=$1 AND status='SUBMITTED' ORDER BY id",
          [id],
        )
      ).rows;
      if (!items.length) reject('Không còn món chờ bếp nhận.');
      for (const i of items)
        await transitionItem(c, i.id, restaurant, { type: 'USER', id: r.identity!.id }, 'accept');
      await c.query('UPDATE order_batch SET accepted_at=COALESCE(accepted_at,now()) WHERE id=$1', [
        id,
      ]);
      return { status: 'ok' };
    }),
  );
  for (const action of ['accept', 'prepare', 'ready', 'serve']) {
    app.post(
      '/core/items/:id/' + action,
      { config: { permission: action === 'serve' ? 'staff.workspace' : 'kitchen.workspace' } },
      async (r) =>
        transaction(db, (c) =>
          transitionItem(c, idParam(r), restaurant, { type: 'USER', id: r.identity!.id }, action),
        ),
    );
  }
  app.post(
    '/core/sessions/:id/serve-items',
    { config: { permission: 'staff.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const sid = idParam(r),
          b = object(r.body);
        await session(c, sid, restaurant);
        if (!Array.isArray(b.itemIds) || !b.itemIds.length || b.itemIds.length > 100)
          reject('Chọn 1–100 món.', 400);
        const ids = b.itemIds.map(uuid);
        if (new Set(ids).size !== ids.length) reject('Món bị chọn trùng.', 400);
        const rows = (
          await c.query(
            'SELECT i.id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=ANY($1::uuid[]) AND b.session_id=$2',
            [ids, sid],
          )
        ).rows;
        if (rows.length !== ids.length)
          reject('Chỉ được phục vụ món thuộc phiên bàn đang chọn.', 400);
        for (const id of ids.sort())
          await transitionItem(c, id, restaurant, { type: 'USER', id: r.identity!.id }, 'serve');
        return { status: 'ok', served: ids };
      }),
  );
  for (const audience of ['core', 'guest'])
    app.post(
      '/' + audience + '/items/cancel',
      { config: audience === 'guest' ? { public: true } : { permission: 'staff.workspace' } },
      async (r) =>
        transaction(db, async (c) => {
          const b = object(r.body);
          if (!Array.isArray(b.itemIds) || !b.itemIds.length || b.itemIds.length > 100)
            reject('Chọn 1–100 món.', 400);
          const ids = b.itemIds.map(uuid);
          if (new Set(ids).size !== ids.length) reject('Món bị chọn trùng.', 400);
          const p = audience === 'guest' ? await guest(c, r, restaurant) : null;
          const reason = parseReason(b, p ? 'GUEST_CANCEL' : 'STAFF_CANCEL');
          return cancelItems(
            c,
            ids,
            restaurant,
            p ? { type: 'GUEST', id: p.id } : { type: 'USER', id: r.identity!.id },
            reason.text,
            reason.code,
          );
        }),
    );
}
