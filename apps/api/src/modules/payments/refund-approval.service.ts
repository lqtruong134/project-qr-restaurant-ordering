import { one, reject, type Connection } from '../shared/core-persistence.js';
import { recalculate } from '../finance/ledger.service.js';
import { requireRefundSourceBudget } from './refund-budget.service.js';
import { readRefundRelatedItems } from './refund-context.service.js';

// The document is approved by an explicit ADMIN action. Bind its audit approval to
// the amount and original transaction so later edits cannot reuse an old approval.
export const refundApprovalJoin = `LEFT JOIN LATERAL (
  SELECT e.created_at AS approved_at,e.actor_id AS approved_by_id,u.display_name AS approved_by_name,e.details AS approval_details
  FROM business_audit_event e LEFT JOIN app_user u ON u.id=e.actor_id
  WHERE e.resource_type='REFUND_CASE' AND e.resource_id=f.id AND e.action='REFUND_APPROVED'
    AND e.details->>'amount'=f.amount::text
    AND e.details->>'paymentId'=f.source_payment_transaction_id::text
  ORDER BY e.created_at,e.id LIMIT 1
) approval ON true`;

export async function readRefundCase(c: Connection, id: string) {
  return one(
    c,
    `SELECT f.*,approval.approved_at,approval.approved_by_id,approval.approved_by_name,
      approval.approved_at IS NULL AS approval_required
     FROM refund_case f ${refundApprovalJoin} WHERE f.id=$1`,
    [id],
  );
}

// Caller holds the session lock, then locks the document. Creation and approval
// retries share this path, so one approval event authorizes one document.
export async function approveRefund(c: Connection, id: string, restaurant: string, actor: string) {
  const f = await one(c, 'SELECT * FROM refund_case WHERE id=$1 FOR UPDATE', [id]);
  const current = await readRefundCase(c, id);
  if (current.approved_at) return current;
  if (!['OPEN', 'IN_PROGRESS'].includes(f.status)) reject('Hồ sơ hoàn đã đóng.');
  const returned = await one(
    c,
    "SELECT COALESCE(sum(amount),0) AS amount FROM refund_transaction WHERE refund_case_id=$1 AND status='SUCCEEDED'",
    [id],
  );
  const remaining = BigInt(f.amount) - BigInt(returned.amount);
  if (remaining <= 0n) reject('Hồ sơ không còn số tiền cần hoàn.');
  const account = await recalculate(c, f.session_id);
  const approved = await one(
    c,
    `SELECT COALESCE(sum(f.amount-COALESCE((SELECT sum(t.amount) FROM refund_transaction t
       WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'),0)),0) AS amount
     FROM refund_case f ${refundApprovalJoin}
     WHERE f.session_id=$1 AND f.id<>$2 AND f.status IN ('OPEN','IN_PROGRESS')
       AND approval.approved_at IS NOT NULL`,
    [f.session_id, id],
  );
  if (remaining > BigInt(account.refund_due_amount) - BigInt(approved.amount))
    reject('Số dư cần hoàn đã thay đổi; kiểm tra lại hồ sơ trước khi duyệt.');
  const source = await requireRefundSourceBudget(
    c,
    f.session_id,
    f.source_payment_transaction_id,
    id,
  );
  if (remaining > BigInt(source.available_refund_amount))
    reject('Nguồn thu không còn đủ phần tiền cần hoàn sau khi trừ các phiếu khác.');
  const refundKind = source.refund_context_kind;
  // Only reversals funded by this exact receipt are item context. A QR overpay
  // must not appear as a refund for unrelated canceled dishes in the session.
  const priorReversals = new Set(await readRefundRelatedItems(c, f.session_id, f.created_at));
  const relatedItemIds =
    refundKind === 'UNAPPLIED_PAYMENT'
      ? []
      : f.order_item_id
        ? [String(f.order_item_id)]
        : source.reversed_item_ids.filter((itemId) => priorReversals.has(itemId));
  await c.query(
    "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'REFUND_APPROVED','REFUND_CASE',$3,$4,$5)",
    [
      restaurant,
      actor,
      id,
      f.reason || 'Quản trị duyệt hồ sơ hoàn tiền',
      JSON.stringify({
        sessionId: f.session_id,
        paymentId: source.id,
        amount: String(f.amount),
        associationVersion: 1,
        refundKind,
        associationScope: refundKind === 'MIXED_PAYMENT_BALANCE' ? 'SHARED_SESSION' : null,
        relatedItemIds,
      }),
    ],
  );
  return readRefundCase(c, id);
}

export async function requireRefundApproval(c: Connection, id: string) {
  const f = await readRefundCase(c, id);
  if (!f.approved_at)
    reject(
      'Hồ sơ hoàn tiền chưa được quản trị duyệt. Chờ quản trị lập hoặc duyệt hồ sơ trước khi hoàn.',
    );
  return f;
}

export async function readRefundWorkflow(c: Connection, sessionId: string, refundDue: string) {
  const totals = await one(
    c,
    `SELECT COALESCE(sum(greatest(f.amount-COALESCE((SELECT sum(t.amount)
      FROM refund_transaction t WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'),0),0))
      FILTER(WHERE approval.approved_at IS NOT NULL),0) AS approved_amount,
      COALESCE(sum(greatest(f.amount-COALESCE((SELECT sum(t.amount)
      FROM refund_transaction t WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'),0),0))
      FILTER(WHERE approval.approved_at IS NULL),0) AS unapproved_amount
     FROM refund_case f ${refundApprovalJoin}
     WHERE f.session_id=$1 AND f.status IN ('OPEN','IN_PROGRESS')`,
    [sessionId],
  );
  const due = BigInt(refundDue);
  const approved = BigInt(totals.approved_amount);
  return {
    approvedAmount: (approved < due ? approved : due).toString(),
    awaitingApprovalAmount: String(totals.unapproved_amount),
    reviewAmount: (due > approved ? due - approved : 0n).toString(),
  };
}
