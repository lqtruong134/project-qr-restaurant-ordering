import { reject, type Connection } from '../shared/core-persistence.js';

export type RefundSourceKind = 'UNAPPLIED_PAYMENT' | 'BILL_ADJUSTMENT' | 'MIXED_PAYMENT_BALANCE';
export type RefundSourceBudget = {
  id: string;
  amount: string;
  provider: string | null;
  allocated_amount: string;
  original_allocated_amount: string;
  refunded_amount: string;
  pending_refund_amount: string;
  refundable_amount: string;
  available_refund_amount: string;
  reversed_item_ids: string[];
  refund_context_kind: RefundSourceKind;
};

// All mutations call this while holding the session lock. Actual successful
// returns release money; an approval or a source's gross receipt never does.
export async function readRefundSourceBudgets(
  c: Connection,
  sessionId: string,
  paymentId: string | null = null,
  excludingCaseId: string | null = null,
  paymentIntentId: string | null = null,
): Promise<RefundSourceBudget[]> {
  return (
    await c.query<Omit<RefundSourceBudget, 'refund_context_kind'>>(
      `SELECT p.id,p.amount::text,p.provider,
        COALESCE(a.active_amount,0)::text AS allocated_amount,
        COALESCE(a.original_amount,0)::text AS original_allocated_amount,
        COALESCE(r.amount,0)::text AS refunded_amount,
        COALESCE(pending.amount,0)::text AS pending_refund_amount,
        greatest(p.amount-COALESCE(r.amount,0)-COALESCE(a.active_amount,0),0)::text AS refundable_amount,
        greatest(p.amount-COALESCE(r.amount,0)-COALESCE(a.active_amount,0)-COALESCE(pending.amount,0),0)::text AS available_refund_amount,
        COALESCE(a.reversed_item_ids,ARRAY[]::uuid[]) AS reversed_item_ids
       FROM payment_transaction p
       LEFT JOIN LATERAL (
         SELECT sum(x.allocated_amount) AS original_amount,
           sum(CASE WHEN f.status='ACTIVE' THEN x.allocated_amount-x.reversed_amount ELSE 0 END) AS active_amount,
           array_agg(DISTINCT f.order_item_id ORDER BY f.order_item_id)
             FILTER(WHERE f.status='REVERSED' AND x.reversed_amount>0 AND f.order_item_id IS NOT NULL) AS reversed_item_ids
         FROM payment_allocation x JOIN financial_charge f ON f.id=x.financial_charge_id
         WHERE x.payment_transaction_id=p.id
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT sum(t.amount) AS amount FROM refund_transaction t
         JOIN refund_case f ON f.id=t.refund_case_id
         WHERE f.source_payment_transaction_id=p.id AND t.status='SUCCEEDED'
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT sum(greatest(f.amount-COALESCE((SELECT sum(t.amount) FROM refund_transaction t
           WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'),0),0)) AS amount
         FROM refund_case f WHERE f.source_payment_transaction_id=p.id
           AND f.status IN ('OPEN','IN_PROGRESS') AND ($3::uuid IS NULL OR f.id<>$3)
       ) pending ON true
       WHERE p.session_id=$1 AND p.status='SUCCEEDED' AND ($2::uuid IS NULL OR p.id=$2)
         AND ($4::uuid IS NULL OR p.payment_intent_id=$4)
       ORDER BY p.created_at,p.id`,
      [sessionId, paymentId, excludingCaseId, paymentIntentId],
    )
  ).rows.map((source) => ({
    ...source,
    refund_context_kind: source.reversed_item_ids.length
      ? BigInt(source.original_allocated_amount) < BigInt(source.amount)
        ? 'MIXED_PAYMENT_BALANCE'
        : 'BILL_ADJUSTMENT'
      : 'UNAPPLIED_PAYMENT',
  }));
}

export const payosIntentFundsJoin = `LEFT JOIN LATERAL (
  SELECT sum(receipt.amount) AS recorded_amount,
    sum(COALESCE(applied.amount,0)) AS allocated_amount,
    sum(COALESCE(applied.original_amount,0)) AS original_allocated_amount,
    sum(COALESCE(returned.amount,0)) AS refunded_amount,
    sum(greatest(receipt.amount-COALESCE(applied.amount,0)-COALESCE(returned.amount,0),0)) AS unapplied_amount
  FROM payment_transaction receipt
  LEFT JOIN LATERAL (
    SELECT sum(a.allocated_amount) AS original_amount,
      sum(CASE WHEN f.status='ACTIVE' THEN a.allocated_amount-a.reversed_amount ELSE 0 END) AS amount
    FROM payment_allocation a JOIN financial_charge f ON f.id=a.financial_charge_id
    WHERE a.payment_transaction_id=receipt.id
  ) applied ON true
  LEFT JOIN LATERAL (
    SELECT sum(r.amount) AS amount FROM refund_transaction r JOIN refund_case f ON f.id=r.refund_case_id
    WHERE f.source_payment_transaction_id=receipt.id AND r.status='SUCCEEDED'
  ) returned ON true
  WHERE receipt.payment_intent_id=p.id AND receipt.session_id=p.session_id
    AND receipt.provider='PAYOS' AND receipt.status='SUCCEEDED'
) funds ON true`;

export async function requireRefundSourceBudget(
  c: Connection,
  sessionId: string,
  paymentId: string,
  excludingCaseId: string | null = null,
) {
  if (!paymentId)
    reject('Hồ sơ chưa xác định giao dịch thu gốc; cần quản trị kiểm tra nguồn hoàn.');
  const source = (await readRefundSourceBudgets(c, sessionId, paymentId, excludingCaseId))[0];
  if (!source) reject('Không tìm thấy giao dịch thu thành công trong phiên bàn.', 404);
  return source;
}
