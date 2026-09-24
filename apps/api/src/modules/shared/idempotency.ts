import { type Connection, type Actor, digest, one, reject } from './core-persistence.js';
export async function idempotent(
  c: Connection,
  actor: Actor,
  scope: string,
  key: string,
  body: unknown,
  resource: 'ORDER_BATCH' | 'PAYMENT_INTENT',
  fn: () => Promise<{ id: string }>,
) {
  const hash = digest(JSON.stringify(body));
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    scope + ':' + actor.type + ':' + actor.id + ':' + key,
  ]);
  const old = (
    await c.query(
      'SELECT * FROM idempotency_record WHERE scope=$1 AND actor_type=$2 AND idempotency_key=$3 AND (actor_user_id=$4 OR actor_participant_id=$4)',
      [scope, actor.type, key, actor.id],
    )
  ).rows[0];
  if (old) {
    if (old.request_hash !== hash) reject('Mã gửi lại đã dùng cho nội dung khác.');
    if (old.status === 'SUCCEEDED') return old.response_snapshot;
    reject('Yêu cầu đang được xử lý.');
  }
  const record = await one(
    c,
    `INSERT INTO idempotency_record(scope,idempotency_key,request_hash,resource_type,expires_at,actor_type,actor_user_id,actor_participant_id) VALUES($1,$2,$3,$4,now()+interval '7 days',$5,$6,$7) RETURNING id`,
    [
      scope,
      key,
      hash,
      resource,
      actor.type,
      actor.type === 'USER' ? actor.id : null,
      actor.type === 'GUEST' ? actor.id : null,
    ],
  );
  const result = await fn();
  const column = resource === 'ORDER_BATCH' ? 'order_batch_id' : 'payment_intent_id';
  await c.query(
    `UPDATE idempotency_record SET status='SUCCEEDED',${column}=$2,response_snapshot=$3::jsonb WHERE id=$1`,
    [record.id, result.id, JSON.stringify(result)],
  );
  return result;
}
