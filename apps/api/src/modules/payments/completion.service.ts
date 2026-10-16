import { digest, one, type Connection } from '../shared/core-persistence.js';
// Fingerprint only stable receipt data. Re-reading/recalculating the account must not invalidate it.
export async function receiptKey(c: Connection, id: string) {
  const place = await one(
    c,
    'SELECT t.id,t.code,t.name,r.name AS restaurant_name,r.address,r.timezone FROM table_session s JOIN dining_table t ON t.id=s.table_id JOIN restaurant r ON r.id=t.restaurant_id WHERE s.id=$1',
    [id],
  );
  const lines = (
    await c.query(
      'SELECT i.id,i.product_name_snapshot,i.quantity,i.unit_price_snapshot,i.status,i.owner_participant_id,f.amount,f.discount_amount,f.tax_amount,f.tax_snapshot,f.promotion_snapshot,f.status AS charge_status FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id LEFT JOIN financial_charge f ON f.order_item_id=i.id WHERE b.session_id=$1 ORDER BY i.id,f.id',
      [id],
    )
  ).rows;
  const charges = (
    await c.query(
      'SELECT id,amount,discount_amount,tax_amount,tax_snapshot,promotion_snapshot,status FROM financial_charge WHERE session_id=$1 ORDER BY id',
      [id],
    )
  ).rows;
  const payments = (
    await c.query(
      "SELECT id,amount,method FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED' ORDER BY id",
      [id],
    )
  ).rows;
  const refunds = (
    await c.query(
      "SELECT t.id,t.amount FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id=$1 AND t.status='SUCCEEDED' ORDER BY t.id",
      [id],
    )
  ).rows;
  const participants = (
    await c.query(
      'SELECT id,display_name FROM session_participant WHERE session_id=$1 ORDER BY id',
      [id],
    )
  ).rows;
  const handovers = (
    await c.query(
      "SELECT id FROM business_audit_event WHERE action='CASH_CHANGE_RETURNED' AND details->>'sessionId'=$1 ORDER BY id",
      [id],
    )
  ).rows;
  return digest(
    JSON.stringify({ place, lines, charges, payments, refunds, participants, handovers }),
  );
}
export async function completionStatus(c: Connection, id: string) {
  const pendingChange = (
    await c.query(
      "SELECT p.id,p.amount,p.metadata FROM payment_transaction p WHERE p.session_id=$1 AND p.status='SUCCEEDED' AND p.method='CASH' AND p.metadata->>'cashHandlingVersion'='1' AND (p.metadata->>'changeGiven')::bigint>0 AND NOT EXISTS(SELECT 1 FROM business_audit_event e WHERE e.resource_id=p.id AND e.action='CASH_CHANGE_RETURNED')",
      [id],
    )
  ).rows;
  const key = await receiptKey(c, id);
  const delivery =
    (
      await c.query(
        "SELECT e.details,e.created_at,u.display_name AS confirmed_by_name FROM business_audit_event e LEFT JOIN app_user u ON u.id=e.actor_id WHERE e.resource_id=$1 AND e.action='RECEIPT_PROVIDED' AND e.details->>'billKey'=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 1",
        [id, key],
      )
    ).rows[0] ?? null;
  const count = await one(
    c,
    "SELECT count(*)::int AS n FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM outstanding_balance_case WHERE session_id=$1 AND status IN ('PENDING_ADMIN_REVIEW','IN_RECOVERY','PARTIALLY_RECOVERED','WRITTEN_OFF'))",
    [id],
  );
  return {
    pendingChange,
    receiptKey: key,
    receiptDelivery: delivery,
    receiptRequired: count.n > 0,
  };
}
