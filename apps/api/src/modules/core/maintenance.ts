import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { event, session, transaction } from './common.js';
import { release } from './inventory.js';
import { recalculate } from './orders.js';

// The session lock is the same lock used by submit, review, kitchen and payment.
// Multiple API processes may run this job; each transition is checked again under lock.
export async function maintainCore(db: Database, restaurant: string) {
  const idle = await db.pool.query(
    `SELECT s.id FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND s.session_status='ACTIVE' AND s.verification_status='UNVERIFIED' AND s.opened_at<now()-interval '15 minutes' AND NOT EXISTS(SELECT 1 FROM order_batch b WHERE b.session_id=s.id) AND NOT EXISTS(SELECT 1 FROM session_participant p WHERE p.session_id=s.id AND COALESCE(p.last_seen_at,p.joined_at)>now()-interval '15 minutes') LIMIT 100`,
    [restaurant],
  );
  for (const row of idle.rows)
    await transaction(db, async (c) => {
      const s = await session(c, row.id, restaurant, false);
      if (s.session_status !== 'ACTIVE' || s.verification_status !== 'UNVERIFIED') return;
      const recent = await c.query(
        "SELECT id FROM session_participant WHERE session_id=$1 AND COALESCE(last_seen_at,joined_at)>now()-interval '15 minutes' UNION ALL SELECT id FROM order_batch WHERE session_id=$1",
        [s.id],
      );
      if (recent.rowCount) return;
      await c.query(
        "UPDATE table_session SET session_status='CANCELLED',closed_at=now(),close_reason='EMPTY_IDLE_TIMEOUT',version=version+1 WHERE id=$1",
        [s.id],
      );
      await c.query("UPDATE session_participant SET status='LEFT' WHERE session_id=$1", [s.id]);
      await c.query(
        "UPDATE dining_table SET table_status='AVAILABLE',version=version+1 WHERE id=$1",
        [s.table_id],
      );
    });
  const expired = await db.pool.query(
    `SELECT DISTINCT b.session_id FROM order_review r JOIN order_batch b ON b.id=r.order_batch_id JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND r.status='PENDING' AND r.expires_at<=now() LIMIT 100`,
    [restaurant],
  );
  for (const row of expired.rows)
    await transaction(db, async (c) => {
      await session(c, row.session_id, restaurant, false);
      const reviews = (
        await c.query(
          "SELECT r.* FROM order_review r JOIN order_batch b ON b.id=r.order_batch_id WHERE b.session_id=$1 AND r.status='PENDING' AND r.expires_at<=now() FOR UPDATE OF r",
          [row.session_id],
        )
      ).rows;
      for (const r of reviews) {
        await release(c, r.order_batch_id);
        await c.query(
          "UPDATE order_review SET status='EXPIRED',decided_at=now(),decision_reason='Hết thời gian chờ duyệt',version=version+1 WHERE id=$1",
          [r.id],
        );
        await c.query(
          "UPDATE order_item SET status='CANCELLED',cancel_reason='Hết thời gian chờ duyệt',cancelled_by_type='SYSTEM',version=version+1 WHERE order_batch_id=$1",
          [r.order_batch_id],
        );
        await c.query(
          "UPDATE order_batch SET status='REJECTED',version=version+1 WHERE id=$1 AND status='PENDING_REVIEW'",
          [r.order_batch_id],
        );
        await c.query(
          "INSERT INTO order_status_history(order_batch_id,old_status,new_status,actor_type,reason) VALUES($1,'PENDING_REVIEW','REJECTED','SYSTEM','Hết thời gian chờ duyệt')",
          [r.order_batch_id],
        );
        await event(c, r.order_batch_id, 'ORDER_REVIEW_EXPIRED');
      }
    });
  const payments = await db.pool.query(
    `SELECT DISTINCT p.session_id FROM payment_intent p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND p.status IN ('CREATED','PENDING') AND p.expires_at<=now() LIMIT 100`,
    [restaurant],
  );
  for (const row of payments.rows)
    await transaction(db, async (c) => {
      await session(c, row.session_id, restaurant, false);
      await c.query(
        "UPDATE payment_intent SET status='EXPIRED',version=version+1 WHERE session_id=$1 AND status IN ('CREATED','PENDING') AND expires_at<=now()",
        [row.session_id],
      );
      await recalculate(c, row.session_id);
    });
  await transaction(db, async (c) => {
    const events = (
      await c.query(
        "SELECT id FROM outbox_event WHERE status='PENDING' AND available_at<=now() AND core_tenant('outbox_event',id)=$1 ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED",
        [restaurant],
      )
    ).rows;
    for (const e of events) {
      await c.query("SELECT pg_notify('core_events', $1)", [
        JSON.stringify({ id: e.id, restaurantId: restaurant }),
      ]);
      await c.query(
        "UPDATE outbox_event SET status='PUBLISHED',published_at=now(),attempts=attempts+1 WHERE id=$1",
        [e.id],
      );
    }
  });
}
export function registerMaintenance(app: FastifyInstance, db: Database, restaurant: string) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  app.addHook('onReady', async () => {
    timer = setInterval(() => {
      if (!running)
        running = maintainCore(db, restaurant)
          .catch(() => {
            app.log.error('CORE maintenance failed; will retry on next interval');
          })
          .finally(() => {
            running = undefined;
          });
    }, 5000);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    await running;
  });
}
