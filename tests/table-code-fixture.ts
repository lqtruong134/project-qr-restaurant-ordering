import type { Database } from '../packages/database/src/index.js';
import type { buildApp } from '../apps/api/src/app.js';
import { digest } from '../apps/api/src/modules/shared/core-persistence.js';
// Existing suites focus on billing, stock, names and consent. Supply the staff-issued code
// in their fixtures; table-access.integration tests deliberately use the unmodified public API.
export async function withTableCode(
  app: ReturnType<typeof buildApp>,
  db: Database,
  staffCookie: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const b = body as Record<string, unknown>;
  if (!b || typeof b.token !== 'string' || b.accessCode !== undefined) return body;
  const qr = (
    await db.pool.query('SELECT table_id FROM table_qr_token WHERE token_hash=$1', [
      digest(b.token),
    ])
  ).rows[0];
  if (!qr) return body;
  const r = await app.inject({
    method: 'POST',
    url: `/core/tables/${qr.table_id}/access-code`,
    headers: { ...headers, cookie: staffCookie },
    payload: {},
  });
  return { ...b, accessCode: r.statusCode === 200 ? r.json().accessCode : '0000' };
}
