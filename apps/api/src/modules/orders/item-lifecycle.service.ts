import {
  type Connection,
  type Actor,
  one,
  reject,
  session,
  history,
  event,
} from '../shared/core-persistence.js';
import { releaseItem, consume } from '../inventory/inventory.service.js';
import { recalculate } from '../finance/ledger.service.js';

/** Batch is an aggregate. Never use its state to authorize an individual item transition. */
export async function aggregateBatch(c: Connection, id: string, actor: Actor) {
  const batch = await one(c, 'SELECT * FROM order_batch WHERE id=$1 FOR UPDATE', [id]);
  const items = (await c.query('SELECT status FROM order_item WHERE order_batch_id=$1', [id])).rows;
  const active = items.filter((i) => !['CANCELLED', 'UNAVAILABLE', 'SERVED'].includes(i.status));
  let status = batch.status;
  if (!active.length)
    status = items.every((i) => i.status === 'CANCELLED') ? 'CANCELLED' : 'COMPLETED';
  else if (batch.status !== 'PENDING_REVIEW') {
    status = items.some((i) => ['IN_PREPARATION', 'READY', 'SERVED'].includes(i.status))
      ? 'IN_PROGRESS'
      : active.some((i) => i.status === 'ACCEPTED')
        ? 'ACCEPTED'
        : 'SUBMITTED';
  }
  if (status !== batch.status) {
    await c.query('UPDATE order_batch SET status=$2,version=version+1 WHERE id=$1', [id, status]);
    await history(c, id, null, batch.status, status, actor);
  }
  if (!active.length)
    await c.query(
      "UPDATE order_review SET status='CANCELLED',decided_at=now(),decision_reason='Không còn món chờ duyệt',version=version+1 WHERE order_batch_id=$1 AND status='PENDING'",
      [id],
    );
}

export async function transitionItem(
  c: Connection,
  id: string,
  restaurant: string,
  actor: Actor,
  action: string,
) {
  const source = await one(
    c,
    'SELECT i.*,b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=$1',
    [id],
  );
  await session(c, source.session_id, restaurant);
  const item = await one(c, 'SELECT * FROM order_item WHERE id=$1 FOR UPDATE', [id]);
  const batch = await one(c, 'SELECT status FROM order_batch WHERE id=$1 FOR UPDATE', [
    item.order_batch_id,
  ]);
  const transitions: Record<string, [string, string, string]> = {
    accept: ['SUBMITTED', 'ACCEPTED', 'received_at'],
    prepare: ['ACCEPTED', 'IN_PREPARATION', 'preparation_started_at'],
    ready: ['IN_PREPARATION', 'READY', 'ready_at'],
    serve: ['READY', 'SERVED', 'served_at'],
  };
  const rule = transitions[action];
  if (!rule) reject('Thao tác không hợp lệ.', 400);
  const [from, to, column] = rule;
  if (item.status === to) reject('Thao tác đã được xử lý. Vui lòng tải lại.');
  if (item.status !== from || ['PENDING_REVIEW', 'REJECTED', 'CANCELLED'].includes(batch.status))
    reject('Trạng thái món đã thay đổi. Vui lòng tải lại.');
  if (action === 'prepare') await consume(c, id, actor.id);
  await c.query(`UPDATE order_item SET status=$2,${column}=now(),version=version+1 WHERE id=$1`, [
    id,
    to,
  ]);
  await history(c, item.order_batch_id, id, from, to, actor);
  await aggregateBatch(c, item.order_batch_id, actor);
  await event(c, item.order_batch_id, 'ITEM_' + to);
  return { status: 'ok', alreadyProcessed: false };
}

export async function cancelItems(
  c: Connection,
  ids: string[],
  restaurant: string,
  actor: Actor,
  reason: string,
) {
  const sources = (
    await c.query(
      'SELECT i.*,b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=ANY($1::uuid[]) ORDER BY i.id',
      [ids],
    )
  ).rows;
  if (sources.length !== ids.length) reject('Không tìm thấy đủ các món đã chọn.', 404);
  const sid = sources[0].session_id;
  if (sources.some((i) => i.session_id !== sid))
    reject('Chỉ được chọn món của cùng một phiên bàn.', 400);
  await session(c, sid, restaurant);
  if (actor.type === 'GUEST' && sources.some((i) => i.owner_participant_id !== actor.id))
    reject('Bạn chỉ được hủy món của mình.', 403);
  const items = (
    await c.query('SELECT * FROM order_item WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids])
  ).rows;
  const cancelled: string[] = [],
    skipped: string[] = [],
    alreadyCancelled: string[] = [];
  const batches = new Set<string>();
  for (const item of items) {
    if (item.status === 'CANCELLED') {
      alreadyCancelled.push(item.id);
      continue;
    }
    if (!['SUBMITTED', ...(actor.type === 'USER' ? ['ACCEPTED'] : [])].includes(item.status)) {
      skipped.push(item.id);
      continue;
    }
    await releaseItem(c, item.id);
    await c.query(
      "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancelled_by_type=$3,cancelled_by_user_id=$4,cancelled_by_participant_id=$5,version=version+1 WHERE id=$1",
      [
        item.id,
        reason,
        actor.type,
        actor.type === 'USER' ? actor.id : null,
        actor.type === 'GUEST' ? actor.id : null,
      ],
    );
    await c.query(
      "UPDATE financial_charge SET status='REVERSED',reversed_at=now() WHERE order_item_id=$1 AND status='ACTIVE'",
      [item.id],
    );
    await c.query(
      'UPDATE payment_allocation SET reversed_amount=allocated_amount WHERE financial_charge_id IN (SELECT id FROM financial_charge WHERE order_item_id=$1)',
      [item.id],
    );
    await history(c, item.order_batch_id, item.id, item.status, 'CANCELLED', actor, reason);
    cancelled.push(item.id);
    batches.add(item.order_batch_id);
  }
  if (!cancelled.length && !alreadyCancelled.length)
    reject('Các món đã được tiếp nhận hoặc chế biến; không còn được hủy trực tiếp.');
  for (const id of batches) {
    await aggregateBatch(c, id, actor);
    await event(c, id, 'ITEMS_CANCELLED');
  }
  if (cancelled.length) {
    await c.query(
      "UPDATE payment_intent SET status='CANCELLED',version=version+1 WHERE session_id=$1 AND status IN ('CREATED','PENDING')",
      [sid],
    );
    const account = await recalculate(c, sid);
    if (BigInt(account.refund_due_amount) > 0n)
      await c.query(
        "INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) SELECT id,table_id,'REFUND_REQUIRED','WARNING',$2 FROM table_session WHERE id=$1",
        [sid, account.refund_due_amount],
      );
  }
  return { status: 'ok', cancelled, skipped, alreadyCancelled };
}
