import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@thesis/database';
import type { FastifyRequest } from 'fastify';
const connect = async (db: Database) => db.pool.connect();
export type Connection = Awaited<ReturnType<typeof connect>>;
export type Actor = { type: 'USER' | 'GUEST'; id: string };
export function reject(message: string, statusCode = 409): never {
  throw Object.assign(new Error(message), { statusCode, publicMessage: message });
}
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    reject('Dữ liệu không hợp lệ.', 400);
  return input as Record<string, unknown>;
}
export function text(input: unknown, max = 200): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > max)
    reject('Vui lòng kiểm tra nội dung nhập.', 400);
  return input.trim();
}
export function uuid(input: unknown): string {
  const value = text(input, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    reject('Mã đối tượng không hợp lệ.', 400);
  return value;
}
export function integer(input: unknown, min = 1, max = 100): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max)
    reject('Số lượng ngoài giới hạn.', 400);
  return input;
}
export function money(input: unknown, allowZero = false): string {
  if (typeof input !== 'string' || !/^\d{1,12}$/.test(input))
    reject('Tiền VND phải là chuỗi số nguyên.', 400);
  const n = BigInt(input);
  if (n < (allowZero ? 0n : 1n) || n > 100000000000n) reject('Số tiền ngoài giới hạn.', 400);
  return n.toString();
}
export function decimal(input: unknown, zero = false): string {
  if (
    typeof input !== 'string' ||
    !/^\d{1,9}(\.\d{1,6})?$/.test(input) ||
    (!zero && !/[1-9]/.test(input))
  )
    reject('Số lượng cần tối đa 6 chữ số thập phân.', 400);
  return input;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const idParam = (r: FastifyRequest) => uuid(object(r.params).id);
export async function one(c: Connection, sql: string, values: unknown[] = []) {
  const result = await c.query(sql, values);
  if (!result.rows[0]) reject('Không tìm thấy dữ liệu hoặc dữ liệu đã thay đổi.', 404);
  return result.rows[0];
}
export async function transaction<T>(db: Database, fn: (c: Connection) => Promise<T>): Promise<T> {
  const c = await connect(db);
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '5s'");
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    const code = (error as { code?: string }).code;
    if (['23505', '23503', '23514', '40001', '40P01', '55P03'].includes(code ?? ''))
      reject('Dữ liệu xung đột hoặc đã thay đổi. Vui lòng tải lại.');
    throw error;
  } finally {
    c.release();
  }
}
export async function session(c: Connection, id: string, restaurant: string, active = true) {
  const row = await one(
    c,
    `SELECT s.*,t.restaurant_id,t.code AS table_code FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=$1 AND t.restaurant_id=$2 FOR UPDATE OF s`,
    [id, restaurant],
  );
  if (active && row.session_status !== 'ACTIVE') reject('Phiên bàn đã kết thúc.');
  return row;
}
export async function guest(c: Connection, r: FastifyRequest, restaurant: string) {
  const credential = r.cookies.guest;
  if (!credential || credential.length > 128) reject('Vui lòng quét QR để tham gia bàn.', 401);
  const row = await one(
    c,
    `SELECT p.*,t.restaurant_id FROM session_participant p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE p.credential_hash=$1 AND t.restaurant_id=$2`,
    [digest(credential), restaurant],
  );
  await session(c, row.session_id, restaurant);
  const current = await one(
    c,
    'SELECT status,blocked_until FROM session_participant WHERE id=$1 FOR UPDATE',
    [row.id],
  );
  if (
    current.status === 'BLOCKED' &&
    current.blocked_until &&
    new Date(current.blocked_until).getTime() <= Date.now()
  ) {
    await c.query("UPDATE session_participant SET status='ACTIVE',blocked_until=NULL WHERE id=$1", [
      row.id,
    ]);
  } else if (current.status !== 'ACTIVE')
    reject('Người tham gia đang bị chặn hoặc đã rời bàn.', 403);
  await c.query('UPDATE session_participant SET last_seen_at=now() WHERE id=$1', [row.id]);
  return row;
}
export async function history(
  c: Connection,
  batch: string,
  item: string | null,
  from: string | null,
  to: string,
  actor: Actor,
  reason: string | null = null,
) {
  await c.query(
    `INSERT INTO order_status_history(order_batch_id,order_item_id,old_status,new_status,actor_type,actor_user_id,actor_participant_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      batch,
      item,
      from,
      to,
      actor.type,
      actor.type === 'USER' ? actor.id : null,
      actor.type === 'GUEST' ? actor.id : null,
      reason,
    ],
  );
}
export async function event(c: Connection, batch: string, type: string) {
  await c.query(
    `INSERT INTO outbox_event(aggregate_type,order_batch_id,event_type,payload) VALUES('ORDER_BATCH',$1::uuid,$2,jsonb_build_object('orderBatchId',$1::uuid::text))`,
    [batch, type],
  );
}
