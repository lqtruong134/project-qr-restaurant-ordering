import { type Actor, type Connection, one, reject } from '../shared/core-persistence.js';
import { cancelItems } from './item-lifecycle.service.js';
// Keep the batch endpoint for clients, but eligibility/effects are always item-level.
export async function cancelBatch(
  c: Connection,
  id: string,
  restaurant: string,
  actor: Actor,
  reason: string,
) {
  const batch = await one(c, 'SELECT * FROM order_batch WHERE id=$1', [id]);
  if (actor.type === 'GUEST' && batch.created_by_participant_id !== actor.id)
    reject('Bạn chỉ được hủy lượt do mình gửi.', 403);
  const rows = (
    await c.query('SELECT id FROM order_item WHERE order_batch_id=$1 ORDER BY id', [id])
  ).rows;
  if (!rows.length) reject('Lượt gọi không có món để hủy.');
  const result = await cancelItems(
    c,
    rows.map((i) => i.id),
    restaurant,
    actor,
    reason,
  );
  const current = await one(c, 'SELECT * FROM order_batch WHERE id=$1', [id]);
  return { ...current, ...result, status: current.status };
}
