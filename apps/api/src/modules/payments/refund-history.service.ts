import type { Connection } from '../shared/core-persistence.js';
import { refundApprovalJoin } from './refund-approval.service.js';

type RefundScope = 'ITEM' | 'SHARED_SESSION' | 'SESSION';
type RefundHistoryCase = {
  id: string;
  status: string;
  amount: string;
  refunded_amount: string;
  remaining_amount: string;
  scope: RefundScope;
  association_source:
    'ORDER_ITEM' | 'APPROVAL_SNAPSHOT' | 'LEGACY_SINGLE_ITEM' | 'LEGACY_SESSION_CONTEXT';
  related_item_ids: string[];
  approved_at: unknown;
  last_refunded_at: unknown;
};
const itemIds = (input: unknown): string[] =>
  Array.isArray(input)
    ? [...new Set(input.filter((id): id is string => typeof id === 'string'))]
    : [];

// A session document can cover several reversed items. Without a saved money
// allocation it must stay shared/session context; never repeat its total as each
// item's refund. Older documents use only reversals predating their creation.
export async function withItemRefundHistory(c: Connection, rows: Record<string, unknown>[]) {
  if (!rows.length) return rows;
  const sessionIds = [...new Set(rows.map((row) => String(row.session_id)))];
  const documents = (
    await c.query(
      `SELECT f.*,approval.approved_at,approval.approval_details,
        COALESCE(returned.amount,0)::text AS returned_amount,returned.last_refunded_at,
        legacy.item_ids AS legacy_item_ids
       FROM refund_case f ${refundApprovalJoin}
       LEFT JOIN LATERAL (
         SELECT sum(t.amount) AS amount,max(t.processed_at) AS last_refunded_at
         FROM refund_transaction t WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'
       ) returned ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT charge.order_item_id ORDER BY charge.order_item_id) AS item_ids
         FROM financial_charge charge
         WHERE charge.session_id=f.session_id AND charge.charge_type='ITEM'
           AND charge.status='REVERSED' AND charge.amount>0 AND charge.order_item_id IS NOT NULL
           AND charge.reversed_at<=f.created_at
           AND EXISTS(SELECT 1 FROM payment_allocation allocation
             WHERE allocation.payment_transaction_id=f.source_payment_transaction_id
               AND allocation.financial_charge_id=charge.id AND allocation.reversed_amount>0)
       ) legacy ON true
       WHERE f.session_id=ANY($1::uuid[]) AND f.status<>'CANCELLED'
       ORDER BY f.created_at,f.id`,
      [sessionIds],
    )
  ).rows;
  return rows.map((row) => {
    const cases: RefundHistoryCase[] = [];
    for (const document of documents) {
      if (document.session_id !== row.session_id) continue;
      if (document.approval_details?.refundKind === 'UNAPPLIED_PAYMENT') continue;
      const saved = document.approval_details?.associationVersion === 1;
      const related = document.order_item_id
        ? [String(document.order_item_id)]
        : saved
          ? itemIds(document.approval_details.relatedItemIds)
          : itemIds(document.legacy_item_ids);
      if (!related.includes(String(row.id))) continue;
      const scope: RefundScope =
        saved && document.approval_details.associationScope === 'SHARED_SESSION'
          ? 'SHARED_SESSION'
          : related.length === 1
            ? 'ITEM'
            : saved
              ? 'SHARED_SESSION'
              : 'SESSION';
      const remaining = BigInt(document.amount) - BigInt(document.returned_amount);
      cases.push({
        id: String(document.id),
        status: String(document.status),
        amount: String(document.amount),
        refunded_amount: String(document.returned_amount),
        remaining_amount: (remaining > 0n ? remaining : 0n).toString(),
        scope,
        association_source: document.order_item_id
          ? 'ORDER_ITEM'
          : saved
            ? 'APPROVAL_SNAPSHOT'
            : related.length === 1
              ? 'LEGACY_SINGLE_ITEM'
              : 'LEGACY_SESSION_CONTEXT',
        related_item_ids: related,
        approved_at: document.approved_at,
        last_refunded_at: document.last_refunded_at,
      });
    }
    const scope = cases.some((document) => document.scope === 'SHARED_SESSION')
      ? 'SHARED_SESSION'
      : cases.some((document) => document.scope === 'SESSION')
        ? 'SESSION'
        : cases.length
          ? 'ITEM'
          : 'NONE';
    const sum = (field: 'amount' | 'refunded_amount' | 'remaining_amount') =>
      cases.reduce((total, document) => total + BigInt(document[field]), 0n).toString();
    const exact = scope === 'ITEM' || scope === 'NONE';
    return {
      ...row,
      refund_history: {
        scope,
        amount: exact ? sum('amount') : null,
        refunded_amount: exact ? sum('refunded_amount') : null,
        remaining_amount: exact ? sum('remaining_amount') : null,
        cases,
      },
    };
  });
}
