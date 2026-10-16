import type { Database } from '@thesis/database';
import type { FastifyRequest } from 'fastify';
import { digest, reject, type Connection } from '../shared/core-persistence.js';

/** Internal infrastructure, never passed to a model/provider or exported by the route API. */
export async function readOnlyAssistantTransaction<T>(
  db: Database,
  work: (connection: Connection) => Promise<T>,
): Promise<T> {
  const connection = await db.pool.connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await connection.query("SET LOCAL statement_timeout = '3s'");
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

/** Authentication stays outside the public AI data projection and never updates guest state. */
export async function verifyAssistantGuest(
  connection: Connection,
  request: FastifyRequest,
  restaurant: string,
): Promise<string> {
  const credential = request.cookies.guest;
  if (!credential || credential.length > 128) reject('Vui lòng quét QR để tham gia bàn.', 401);
  const row = (
    await connection.query(
      `SELECT p.id AS participant_id,p.status AS participant_status,p.blocked_until,s.session_status
      FROM session_participant p JOIN table_session s ON s.id=p.session_id
      JOIN dining_table t ON t.id=s.table_id JOIN restaurant r ON r.id=t.restaurant_id
      WHERE p.credential_hash=$1 AND t.restaurant_id=$2 AND r.status='ACTIVE'`,
      [digest(credential), restaurant],
    )
  ).rows[0];
  if (!row || row.session_status !== 'ACTIVE')
    reject('Phiên bàn đã kết thúc hoặc hết hiệu lực. Vui lòng quét lại QR.', 401);
  if (
    row.participant_status !== 'ACTIVE' &&
    !(
      row.participant_status === 'BLOCKED' &&
      row.blocked_until &&
      new Date(row.blocked_until).getTime() <= Date.now()
    )
  )
    reject('Người tham gia đang bị chặn hoặc đã rời bàn.', 403);
  return String(row.participant_id);
}

export function readAssistantIdentity(db: Database, request: FastifyRequest, restaurant: string) {
  return readOnlyAssistantTransaction(db, (connection) =>
    verifyAssistantGuest(connection, request, restaurant),
  );
}
