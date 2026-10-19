import { payosBankReportedJoin } from './payment-reported-funds.js';
import type { CollectionAvailability, PaymentFinancialSummary } from '@thesis/contracts';
import type { Connection } from '../shared/core-persistence.js';

/** Keep reservation membership aligned with collection/ledger mutations; never substitute it for an allocation. */
export const reservedIntentPredicate = `((p.status IN ('CREATED','PENDING') AND (p.expires_at>now() OR p.provider='PAYOS')) OR (p.provider='PAYOS' AND EXISTS(SELECT 1 FROM payos_payment_request q WHERE q.payment_intent_id=p.id AND (q.status IN ('CREATE_PENDING','ERROR','CANCEL_PENDING') OR q.reconciliation_status='OPEN') AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED'))))`;
export const uncertainIntentPredicate = `((q.status IN ('CREATE_PENDING','ERROR','CANCEL_PENDING') AND COALESCE(q.provider_status,'') NOT IN ('CANCELLED','EXPIRED','PAID','FAILED')) OR q.reconciliation_status='OPEN' OR (p.status IN ('CANCELLED','EXPIRED') AND COALESCE(q.provider_status,'') NOT IN ('CANCELLED','EXPIRED','PAID','FAILED')))`;

export async function readPaymentPosition(
  c: Connection,
  sid: string,
  account: Record<string, unknown>,
  participantId: string | null = null,
): Promise<{
  financialSummary: PaymentFinancialSummary;
  collectionAvailability: CollectionAvailability;
}> {
  const {
    rows: [totals],
  } = await c.query(
    `WITH intents AS (
      SELECT p.*,q.status AS online_status,GREATEST(q.paid_amount,COALESCE(reported.amount,0)) AS paid_amount,q.reconciliation_status,
        GREATEST(p.amount-COALESCE((SELECT sum(t.amount) FROM payment_transaction t WHERE t.payment_intent_id=p.id AND t.status='SUCCEEDED'),0),0) AS reserve,
        ${reservedIntentPredicate} AS reserves,
        CASE WHEN p.provider='PAYOS' THEN ${uncertainIntentPredicate} ELSE false END AS blocks
      FROM payment_intent p LEFT JOIN payos_payment_request q ON q.payment_intent_id=p.id ${payosBankReportedJoin} WHERE p.session_id=$1
    ) SELECT COALESCE(sum(reserve) FILTER(WHERE reserves),0)::text AS reserved,
      COALESCE(sum(reserve) FILTER(WHERE reserves AND provider='PAYOS' AND online_status IN ('CREATE_PENDING','PENDING','PROCESSING','UNDERPAID','CANCEL_PENDING','ERROR')),0)::text AS pending,
      COALESCE(sum(paid_amount) FILTER(WHERE provider='PAYOS'),0)::text AS reported,
      COALESCE(bool_or(blocks),false) AS blocked,
      COALESCE(bool_or(reconciliation_status='OPEN'),false) AS review FROM intents`,
    [sid],
  );
  const { rows: participants } = await c.query(
    `SELECT sp.id AS participant_id,
      COALESCE((SELECT sum(GREATEST(f.amount-f.discount_amount-COALESCE((SELECT sum(a.allocated_amount-a.reversed_amount) FROM payment_allocation a JOIN payment_transaction t ON t.id=a.payment_transaction_id WHERE a.financial_charge_id=f.id AND t.status='SUCCEEDED'),0),0)) FROM financial_charge f JOIN order_item i ON i.id=f.order_item_id WHERE f.session_id=$1 AND f.status='ACTIVE' AND i.owner_participant_id=sp.id),0)::text AS outstanding,
      COALESCE((SELECT sum(GREATEST(p.amount-COALESCE((SELECT sum(t.amount) FROM payment_transaction t WHERE t.payment_intent_id=p.id AND t.status='SUCCEEDED'),0),0)) FROM payment_intent p WHERE p.session_id=$1 AND p.payer_participant_id=sp.id AND p.collection_scope='PARTICIPANT' AND ${reservedIntentPredicate}),0)::text AS reserved
     FROM session_participant sp WHERE sp.session_id=$1 AND ($2::uuid IS NULL OR sp.id=$2) ORDER BY sp.id`,
    [sid, participantId],
  );
  const bill = BigInt(String(account.charge_total ?? 0));
  const outstanding = BigInt(String(account.outstanding_amount ?? 0));
  const reserved = BigInt(totals.reserved);
  const cap = (amount: bigint) => (amount > 0n ? amount : 0n);
  const available = totals.blocked ? 0n : cap(outstanding - reserved);
  const collectionAvailability: CollectionAvailability = {
    outstandingAmount: outstanding.toString(),
    reservedAmount: reserved.toString(),
    availableAmount: available.toString(),
    blockedReason: totals.blocked
      ? 'Khoản online đang được nhà hàng kiểm tra. Không thu lại khoản này; quản trị xử lý ngoại lệ trước khi lập khoản thu mới.'
      : null,
    participants: participants.map((row) => {
      const ownAvailable = cap(BigInt(row.outstanding) - BigInt(row.reserved));
      return {
        participantId: row.participant_id,
        outstandingAmount: row.outstanding,
        reservedAmount: row.reserved,
        availableAmount: (ownAvailable < available ? ownAvailable : available).toString(),
      };
    }),
  };
  const financialSummary: PaymentFinancialSummary = {
    billTotal: bill.toString(),
    bankReportedAmount: totals.reported,
    recordedAmount: String(account.paid_total ?? '0'),
    appliedAmount: cap(bill - outstanding).toString(),
    outstandingAmount: outstanding.toString(),
    pendingOnlineAmount: totals.pending,
    reservedAmount: reserved.toString(),
    availableToCollect: available.toString(),
    unallocatedAmount: String(account.refund_due_amount ?? '0'),
    refundDueAmount: String(account.refund_due_amount ?? '0'),
    refundedAmount: String(account.refunded_total ?? '0'),
    reviewRequired: totals.review,
  };
  return { financialSummary, collectionAvailability };
}
