import { type Actor, type Connection, event, history, one, reject, session } from './common.js';
import { release } from './inventory.js';
import { recalculate } from './orders.js';
export async function cancelBatch(
  c: Connection,
  id: string,
  restaurant: string,
  actor: Actor,
  reason: string,
) {
  const e = await one(c, 'SELECT session_id FROM order_batch WHERE id=$1', [id]);
  await session(c, e.session_id, restaurant);
  const batch = await one(c, 'SELECT * FROM order_batch WHERE id=$1 FOR UPDATE', [id]);
  if (actor.type === 'GUEST' && batch.created_by_participant_id !== actor.id)
    reject('Bạn chỉ được hủy lượt do mình gửi.', 403);
  const allowed =
    actor.type === 'GUEST'
      ? ['SUBMITTED', 'PENDING_REVIEW']
      : ['SUBMITTED', 'PENDING_REVIEW', 'ACCEPTED'];
  if (!allowed.includes(batch.status))
    reject('Lượt đã được bếp tiếp nhận hoặc đang chế biến. Vui lòng liên hệ nhân viên.');
  if (
    (
      await c.query(
        "SELECT id FROM order_item WHERE order_batch_id=$1 AND status IN ('IN_PREPARATION','READY','SERVED')",
        [id],
      )
    ).rowCount
  )
    reject('Có món đã được chế biến.');
  await release(c, id);
  await c.query(
    "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancelled_by_type=$3,cancelled_by_user_id=$4,cancelled_by_participant_id=$5,version=version+1 WHERE order_batch_id=$1",
    [
      id,
      reason,
      actor.type,
      actor.type === 'USER' ? actor.id : null,
      actor.type === 'GUEST' ? actor.id : null,
    ],
  );
  await c.query("UPDATE order_batch SET status='CANCELLED',version=version+1 WHERE id=$1", [id]);
  if (actor.type === 'USER')
    await c.query(
      "UPDATE order_review SET status='REJECTED',reviewer_id=$2,decided_at=now(),decision_reason=$3,version=version+1 WHERE order_batch_id=$1 AND status='PENDING'",
      [id, actor.id, reason],
    );
  else
    await c.query(
      "UPDATE order_review SET status='CANCELLED',decided_at=now(),decision_reason=$2,version=version+1 WHERE order_batch_id=$1 AND status='PENDING'",
      [id, 'Khách rút lượt gọi: ' + reason],
    );
  await c.query(
    "UPDATE financial_charge SET status='REVERSED',reversed_at=now() WHERE order_item_id IN (SELECT id FROM order_item WHERE order_batch_id=$1) AND status='ACTIVE'",
    [id],
  );
  await c.query(
    'UPDATE payment_allocation SET reversed_amount=allocated_amount WHERE financial_charge_id IN (SELECT id FROM financial_charge WHERE order_item_id IN (SELECT id FROM order_item WHERE order_batch_id=$1))',
    [id],
  );
  await c.query(
    "UPDATE payment_intent SET status='CANCELLED',version=version+1 WHERE session_id=$1 AND status IN ('CREATED','PENDING')",
    [batch.session_id],
  );
  const a = await recalculate(c, batch.session_id);
  if (BigInt(a.refund_due_amount) > 0n)
    await c.query(
      "INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) SELECT id,table_id,'REFUND_REQUIRED','WARNING',$2 FROM table_session WHERE id=$1",
      [batch.session_id, a.refund_due_amount],
    );
  await history(c, id, null, batch.status, 'CANCELLED', actor, reason);
  await event(c, id, 'ORDER_CANCELLED');
  return { status: 'ok' };
}
