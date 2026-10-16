import { refreshSessionPricing } from './pricing.service.js';
import { type Connection, one } from '../shared/core-persistence.js';
export async function addCharges(c: Connection, batch: string, sid: string) {
  await c.query(
    `INSERT INTO financial_charge(session_id,order_item_id,charge_type,amount,tax_snapshot,tax_amount) SELECT $2,id,'ITEM',line_total,tax_snapshot,CASE WHEN tax_snapshot IS NULL THEN NULL WHEN tax_snapshot->>'treatment'='EXEMPT' THEN 0 ELSE round(line_total::numeric*(tax_snapshot->>'ratePercent')::int/(100+(tax_snapshot->>'ratePercent')::int))::bigint END FROM order_item WHERE order_batch_id=$1 AND status<>'CANCELLED' AND line_total>0 ON CONFLICT DO NOTHING`,
    [batch, sid],
  );
  await recalculate(c, sid);
}
export async function recalculate(c: Connection, sid: string) {
  await refreshSessionPricing(c, sid);
  await c.query(
    'INSERT INTO session_financial_account(session_id) VALUES($1) ON CONFLICT(session_id) DO NOTHING',
    [sid],
  );
  await c.query(
    `UPDATE session_financial_account SET charge_total=(SELECT COALESCE(sum(amount-discount_amount),0) FROM financial_charge WHERE session_id=$1 AND status='ACTIVE'),paid_total=(SELECT COALESCE(sum(amount),0) FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED'),refunded_total=(SELECT COALESCE(sum(t.amount),0) FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id=$1 AND t.status='SUCCEEDED'),reserved_payment_amount=(SELECT COALESCE(sum(greatest(p.amount-COALESCE((SELECT sum(t.amount) FROM payment_transaction t WHERE t.payment_intent_id=p.id AND t.status='SUCCEEDED'),0),0)),0) FROM payment_intent p WHERE p.session_id=$1 AND ((p.status IN ('CREATED','PENDING') AND (p.expires_at>now() OR p.provider='PAYOS')) OR (p.provider='PAYOS' AND EXISTS(SELECT 1 FROM payos_payment_request q WHERE q.payment_intent_id=p.id AND (q.status IN ('CREATE_PENDING','ERROR','CANCEL_PENDING') OR q.reconciliation_status='OPEN') AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED'))))),version=version+1 WHERE session_id=$1`,
    [sid],
  );
  const a = await one(
    c,
    'UPDATE session_financial_account SET outstanding_amount=greatest(charge_total-paid_total+refunded_total,0),refund_due_amount=greatest(paid_total-refunded_total-charge_total,0) WHERE session_id=$1 RETURNING *',
    [sid],
  );
  const status =
    BigInt(a.refund_due_amount) > 0n
      ? 'REFUND_DUE'
      : BigInt(a.outstanding_amount) === 0n
        ? 'SETTLED'
        : BigInt(a.paid_total) > 0n
          ? 'PARTIALLY_PAID'
          : 'UNPAID';
  await c.query(
    "UPDATE table_session SET financial_status=$2 WHERE id=$1 AND financial_status<>'OUTSTANDING_EXCEPTION'",
    [sid, status],
  );
  return a;
}

// Caller holds the session lock; stock and successful payment history remain untouched.
export async function reverseItemCharge(c: Connection, item: string, sid: string) {
  const charges = await c.query(
    "UPDATE financial_charge SET status='REVERSED',reversed_at=now() WHERE order_item_id=$1 AND session_id=$2 AND status='ACTIVE' RETURNING amount-discount_amount AS amount",
    [item, sid],
  );
  if (charges.rowCount) {
    await c.query(
      'UPDATE payment_allocation SET reversed_amount=allocated_amount WHERE financial_charge_id IN (SELECT id FROM financial_charge WHERE order_item_id=$1 AND session_id=$2)',
      [item, sid],
    );
    await c.query(
      "UPDATE payment_intent SET status='CANCELLED',version=version+1 WHERE session_id=$1 AND status IN ('CREATED','PENDING')",
      [sid],
    );
    await c.query(
      "UPDATE payos_payment_request q SET cancel_requested=true,status='CANCEL_PENDING',next_poll_at=now() FROM payment_intent p WHERE q.payment_intent_id=p.id AND p.session_id=$1 AND p.provider='PAYOS' AND p.status='CANCELLED' AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED')",
      [sid],
    );
  }
  const account = await recalculate(c, sid);
  if (BigInt(account.refund_due_amount) > 0n) {
    const alerts = await c.query(
      "UPDATE operational_alert SET outstanding_amount=$2 WHERE session_id=$1 AND alert_type='REFUND_REQUIRED' AND status<>'RESOLVED' RETURNING id",
      [sid, account.refund_due_amount],
    );
    if (!alerts.rowCount)
      await c.query(
        "INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) SELECT id,table_id,'REFUND_REQUIRED','WARNING',$2 FROM table_session WHERE id=$1",
        [sid, account.refund_due_amount],
      );
  }
  return {
    reversed: Boolean(charges.rowCount),
    amount: charges.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n).toString(),
    account,
  };
}
