import { randomInt, timingSafeEqual } from 'node:crypto';
import { encryptQrToken, decryptQrToken } from '../catalog/qr-token.js';
import { digest, one, reject, type Connection } from '../shared/core-persistence.js';

export const supportRetrySeconds = 60;
const codeSecret = () => process.env.AUTH_SECRET ?? '';
export function sessionAccessCode(s: Record<string, unknown>): string | null {
  return s.access_code_ciphertext
    ? decryptQrToken(String(s.access_code_ciphertext), codeSecret())
    : null;
}
export function codeMatches(s: Record<string, unknown>, value: unknown) {
  const expected = sessionAccessCode(s);
  return (
    typeof value === 'string' &&
    /^\d{4}$/.test(value) &&
    expected !== null &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
// Caller locks the table before this function. Printed QR stays fixed; the code belongs to a visit.
export async function issueTableCode(c: Connection, table: Record<string, unknown>, actor: string) {
  if (!table.is_active || table.table_status === 'NEEDS_CLEANING')
    reject('Bàn chưa sẵn sàng đón khách. Dọn và kiểm tra bàn trước khi cấp mã.');
  let s = (
    await c.query(
      "SELECT * FROM table_session WHERE table_id=$1 AND session_status='ACTIVE' FOR UPDATE",
      [table.id],
    )
  ).rows[0];
  if (!s) {
    if (table.table_status !== 'AVAILABLE') reject('Bàn chưa sẵn sàng mở phiên.');
    s = await one(c, 'INSERT INTO table_session(table_id) VALUES($1) RETURNING *', [table.id]);
    await c.query('INSERT INTO session_cart(session_id) VALUES($1)', [s.id]);
    await c.query('INSERT INTO session_financial_account(session_id) VALUES($1)', [s.id]);
    await c.query("UPDATE dining_table SET table_status='OCCUPIED',version=version+1 WHERE id=$1", [
      table.id,
    ]);
  }
  if (s.risk_status !== 'NORMAL')
    reject('Bàn đang bị hạn chế gọi món. Kiểm tra cảnh báo trước khi cấp mã.');
  let code = sessionAccessCode(s);
  if (!code) {
    const previous = (
      await c.query(
        'SELECT access_code_ciphertext FROM table_session WHERE table_id=$1 AND id<>$2 AND access_code_ciphertext IS NOT NULL ORDER BY opened_at DESC LIMIT 1',
        [table.id, s.id],
      )
    ).rows[0];
    const old = previous ? sessionAccessCode(previous) : null;
    do {
      code = randomInt(0, 10000).toString().padStart(4, '0');
    } while (code === old);
  }
  const updated = await one(
    c,
    `UPDATE table_session SET access_code_ciphertext=COALESCE(access_code_ciphertext,$2),
    access_code_issued_at=COALESCE(access_code_issued_at,now()),verification_status='VERIFIED',
    verified_at=COALESCE(verified_at,now()),verified_by=COALESCE(verified_by,$3),version=version+1 WHERE id=$1 RETURNING *`,
    [s.id, encryptQrToken(code, codeSecret()), actor],
  );
  await c.query(
    "UPDATE support_request SET session_id=$2,table_id=NULL WHERE table_id=$1 AND request_type='ACCESS_CODE' AND status IN ('NEW','ACKNOWLEDGED')",
    [table.id, s.id],
  );
  await c.query(
    `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details)
    VALUES($1,$2,'TABLE_ACCESS_CODE_ISSUED','TABLE_SESSION',$3,'Nhân viên xác nhận khách tại bàn và cấp mã tham gia.',$4)`,
    [table.restaurant_id, actor, s.id, JSON.stringify({ tableId: table.id })],
  );
  const { access_code_ciphertext: _ciphertext, ...publicSession } = updated;
  void _ciphertext;
  return { ...publicSession, sessionId: s.id, accessCode: code };
}
export async function qrTable(c: Connection, token: string, restaurant: string) {
  return one(
    c,
    `SELECT t.* FROM table_qr_token q JOIN dining_table t ON t.id=q.table_id
    JOIN dining_area a ON a.id=t.area_id JOIN restaurant r ON r.id=t.restaurant_id
    WHERE q.token_hash=$1 AND q.status='ACTIVE' AND (q.expires_at IS NULL OR q.expires_at>now())
    AND t.restaurant_id=$2 AND t.is_active AND a.is_active AND r.status='ACTIVE' FOR UPDATE OF t`,
    [digest(token), restaurant],
  );
}
// Database buckets work across API processes. Failed-code counters commit before returning an error.
export async function accessLimit(
  c: Connection,
  restaurant: string,
  key: string,
  action: string,
  limit: number,
  consume: boolean,
) {
  const hash = digest(restaurant + ':' + action + ':' + key);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [hash]);
  const row = (await c.query('SELECT * FROM table_access_limit WHERE bucket_hash=$1', [hash]))
    .rows[0];
  const live = row && new Date(row.started_at).getTime() > Date.now() - 300000;
  if (live && row.attempts >= limit) return false;
  if (consume)
    await c.query(
      `INSERT INTO table_access_limit(bucket_hash,restaurant_id,attempts) VALUES($1,$2,1)
    ON CONFLICT(bucket_hash) DO UPDATE SET attempts=CASE WHEN table_access_limit.started_at>now()-interval '5 minutes' THEN table_access_limit.attempts+1 ELSE 1 END,
    started_at=CASE WHEN table_access_limit.started_at>now()-interval '5 minutes' THEN table_access_limit.started_at ELSE now() END`,
      [hash, restaurant],
    );
  return true;
}
