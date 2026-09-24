import { type Connection, one } from '../shared/core-persistence.js';
export async function addCharges(c: Connection, batch: string, sid: string) {
  await c.query(
    `INSERT INTO financial_charge(session_id,order_item_id,charge_type,amount) SELECT $2,id,'ITEM',line_total FROM order_item WHERE order_batch_id=$1 AND status<>'CANCELLED' ON CONFLICT DO NOTHING`,
    [batch, sid],
  );
  await recalculate(c, sid);
}
export async function recalculate(c: Connection, sid: string) {
  await c.query(
    'INSERT INTO session_financial_account(session_id) VALUES($1) ON CONFLICT(session_id) DO NOTHING',
    [sid],
  );
  await c.query(
    `UPDATE session_financial_account SET charge_total=(SELECT COALESCE(sum(amount),0) FROM financial_charge WHERE session_id=$1 AND status='ACTIVE'),paid_total=(SELECT COALESCE(sum(amount),0) FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED'),refunded_total=(SELECT COALESCE(sum(t.amount),0) FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id=$1 AND t.status='SUCCEEDED'),reserved_payment_amount=(SELECT COALESCE(sum(amount),0) FROM payment_intent WHERE session_id=$1 AND status IN ('CREATED','PENDING') AND expires_at>now()),version=version+1 WHERE session_id=$1`,
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
