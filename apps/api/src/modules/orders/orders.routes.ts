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
} from '../shared/core-persistence.js';
import { consume, release } from '../inventory/inventory.service.js';
import { submit } from './orders.service.js';
import { addCharges } from '../finance/ledger.service.js';
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
        `SELECT b.*,t.code AS table_code,(SELECT jsonb_agg(i ORDER BY i.created_at) FROM order_item i WHERE i.order_batch_id=b.id) AS items FROM order_batch b JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND s.session_status='ACTIVE' ORDER BY b.created_at`,
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.get('/core/kitchen', { config: { permission: 'kitchen.workspace' } }, async () =>
    db.pool
      .query(
        `SELECT b.*,t.code AS table_code,(SELECT jsonb_agg(i ORDER BY i.created_at) FROM order_item i WHERE i.order_batch_id=b.id) AS items FROM order_batch b JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND b.status IN ('SUBMITTED','ACCEPTED','IN_PROGRESS') ORDER BY b.submitted_at`,
        [restaurant],
      )
      .then((v) => v.rows),
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
          `SELECT i.id FROM order_item i JOIN product p ON p.id=i.product_id JOIN menu_category m ON m.id=p.category_id WHERE i.order_batch_id=$1 AND (NOT p.is_active OR NOT m.is_active OR p.availability_status<>'AVAILABLE' OR p.base_price<>i.unit_price_snapshot)`,
          [id],
        );
        if (invalid.rowCount)
          reject('Món hoặc giá đã thay đổi. Từ chối lượt này và yêu cầu khách đặt lại.');
        await c.query(
          "UPDATE inventory_reservation SET status='ACTIVE',reservation_type='CONFIRMED',expires_at=NULL WHERE order_item_id IN (SELECT id FROM order_item WHERE order_batch_id=$1) AND status='PROVISIONAL'",
          [id],
        );
        await addCharges(c, id, batch.session_id);
      } else {
        await release(c, id);
        await c.query(
          "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancelled_by_type='USER',cancelled_by_user_id=$3,version=version+1 WHERE order_batch_id=$1",
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
        e = await one(c, 'SELECT session_id FROM order_batch WHERE id=$1', [id]);
      await session(c, e.session_id, restaurant);
      const batch = await one(c, 'SELECT * FROM order_batch WHERE id=$1 FOR UPDATE', [id]);
      if (batch.status !== 'SUBMITTED') reject('Bếp chỉ tiếp nhận lượt đã được gửi duyệt hợp lệ.');
      await c.query(
        "UPDATE order_batch SET status='ACCEPTED',accepted_at=now(),version=version+1 WHERE id=$1",
        [id],
      );
      await c.query(
        "UPDATE order_item SET status='ACCEPTED',version=version+1 WHERE order_batch_id=$1 AND status='SUBMITTED'",
        [id],
      );
      await history(c, id, null, 'SUBMITTED', 'ACCEPTED', { type: 'USER', id: r.identity!.id });
      await event(c, id, 'ORDER_ACCEPTED');
      return { status: 'ok' };
    }),
  );
  for (const [action, permission, from, to] of [
    ['prepare', 'kitchen.workspace', 'ACCEPTED', 'IN_PREPARATION'],
    ['ready', 'kitchen.workspace', 'IN_PREPARATION', 'READY'],
    ['serve', 'staff.workspace', 'READY', 'SERVED'],
  ]) {
    app.post('/core/items/:id/' + action, { config: { permission: permission! } }, async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          i = await one(
            c,
            'SELECT i.*,b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=$1',
            [id],
          );
        await session(c, i.session_id, restaurant);
        const item = await one(c, 'SELECT * FROM order_item WHERE id=$1 FOR UPDATE', [id]);
        if (item.status !== from) reject('Trạng thái món đã thay đổi.');
        if (action === 'prepare') await consume(c, id, r.identity!.id);
        await c.query('UPDATE order_item SET status=$2,version=version+1 WHERE id=$1', [id, to]);
        const remaining = await one(
          c,
          "SELECT count(*)::int AS n FROM order_item WHERE order_batch_id=$1 AND status NOT IN ('SERVED','CANCELLED')",
          [item.order_batch_id],
        );
        await c.query('UPDATE order_batch SET status=$2,version=version+1 WHERE id=$1', [
          item.order_batch_id,
          remaining.n === 0 ? 'COMPLETED' : 'IN_PROGRESS',
        ]);
        await history(c, item.order_batch_id, id, item.status, to!, {
          type: 'USER',
          id: r.identity!.id,
        });
        await event(c, item.order_batch_id, 'ITEM_' + to);
        return { status: 'ok' };
      }),
    );
  }
}
