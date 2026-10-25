import { createHash } from 'node:crypto';
import type { Database } from '@thesis/database';
import { session, transaction, reject, type Connection } from '../shared/core-persistence.js';

export function canonicalArchiveJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonicalArchiveJson).join(',') + ']';
  const record = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalArchiveJson(record[key]))
      .join(',') +
    '}'
  );
}
export const archiveHash = (value: unknown) =>
  createHash('sha256').update(canonicalArchiveJson(value)).digest('hex');

export async function archivedPayosIntent(c: Connection, restaurant: string, id: string) {
  return (
    await c.query(
      'SELECT * FROM payos_test_case_archive WHERE restaurant_id=$1 AND payment_intent_id=$2',
      [restaurant, id],
    )
  ).rows[0];
}
export async function requireOperationalPayosIntent(c: Connection, restaurant: string, id: string) {
  if (await archivedPayosIntent(c, restaurant, id))
    reject(
      'Khoản thử có tiền thật đã được lưu trữ. Xem hồ sơ lưu trữ; chưa xác nhận thanh toán hoặc hoàn tiền.',
      409,
    );
}
export async function appendArchiveEvidence(
  c: Connection,
  id: string,
  kind: string,
  payload: Record<string, unknown>,
) {
  await c.query(
    `INSERT INTO payos_test_archive_event(archive_id,event_kind,payload_hash,payload_snapshot)
    VALUES($1,$2,$3,$4) ON CONFLICT(archive_id,event_kind,payload_hash) DO NOTHING`,
    [id, kind, archiveHash(payload), canonicalArchiveJson(payload)],
  );
}

type ArchivedWebhookData = {
  orderCode: number;
  amount: number;
  reference: string;
  paymentLinkId: string;
  currency: string;
  code: string;
};
/** Only called after signature verification. Durable receipt of evidence never posts money. */
export async function captureArchivedPayosWebhookWithConnection(
  c: Connection,
  restaurant: string,
  data: ArchivedWebhookData,
) {
  const candidates = (
    await c.query(
      `SELECT id,session_id FROM payos_test_case_archive
    WHERE restaurant_id=$1 AND (order_code=$2 OR bank_reference=$3 OR payment_link_id=$4)
    ORDER BY session_id,id`,
      [restaurant, data.orderCode, data.reference, data.paymentLinkId],
    )
  ).rows;
  if (!candidates.length) return null;
  for (const id of [...new Set(candidates.map((row) => String(row.session_id)))].sort())
    await session(c, id, restaurant, false);
  const archives = (
    await c.query('SELECT * FROM payos_test_case_archive WHERE id=ANY($1::uuid[]) ORDER BY id', [
      candidates.map((row) => row.id),
    ])
  ).rows;
  let allMatched = true;
  for (const archived of archives) {
    const matched =
      String(data.orderCode) === String(archived.order_code) &&
      data.paymentLinkId === archived.payment_link_id &&
      data.reference === archived.bank_reference &&
      String(data.amount) === String(archived.amount) &&
      data.currency === 'VND' &&
      data.code === '00';
    allMatched &&= matched;
    await appendArchiveEvidence(c, archived.id, matched ? 'WEBHOOK_REPLAY' : 'WEBHOOK_CONFLICT', {
      ...data,
    });
  }
  // ACK means signed evidence was durably received, never settlement or a refund.
  return {
    status: allMatched ? 'ARCHIVED_TEST' : 'ARCHIVED_REVIEW_REQUIRED',
    financiallyResolved: false,
  };
}

export async function captureArchivedPayosWebhook(
  db: Database,
  restaurant: string,
  data: ArchivedWebhookData,
) {
  return transaction(db, (c) => captureArchivedPayosWebhookWithConnection(c, restaurant, data));
}

export async function readPayosTestArchives(db: Database, restaurant: string) {
  const rows = (
    await db.pool.query(
      `SELECT a.id,a.payment_intent_id,a.session_id,a.table_code,a.amount::text,
    a.original_audit_count,a.archived_at,a.visible_in_operations,a.visibility_restored_at,
    (SELECT retired_at FROM payos_test_session_retirement r WHERE r.archive_id=a.id) AS session_retired_at,
    (SELECT count(*)::int FROM payos_test_archive_event e WHERE e.archive_id=a.id) AS evidence_events,
    (SELECT count(*)::int FROM payos_test_archive_event e WHERE e.archive_id=a.id AND e.event_kind='WEBHOOK_CONFLICT') AS unexpected_webhooks,
    COALESCE((SELECT sum(p.amount) FROM payment_transaction p WHERE p.payment_intent_id=a.payment_intent_id AND p.status='SUCCEEDED'),0)::text AS recorded_amount
    FROM payos_test_case_archive a WHERE a.restaurant_id=$1 ORDER BY a.table_code,a.id`,
      [restaurant],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    classification: 'CONFIRMED_TEST_WITH_REAL_FUNDS',
    financially_resolved: false,
    posting_blocked: true,
    note: 'Lưu trữ riêng; chưa xác nhận thu, hoàn hoặc đối soát thành công.',
  }));
}
