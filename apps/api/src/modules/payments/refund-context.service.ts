import { reasonLabel } from '@thesis/contracts';
import type { Connection } from '../shared/core-persistence.js';

// Saved charge reversals are the source of the reason; staff do not rewrite them.
export async function readRefundContext(c: Connection, sessionId: string, paymentId?: string) {
  const decisions = (
    await c.query(
      `SELECT i.id AS item_id,i.product_name_snapshot,i.quantity,e.reason,
        e.details->>'reasonCode' AS reason_code,e.created_at AS decided_at,e.action
       FROM financial_charge f JOIN order_item i ON i.id=f.order_item_id
       JOIN LATERAL (
         SELECT e.* FROM business_audit_event e
         WHERE e.resource_id=i.id AND e.action IN ('RESTAURANT_FAULT_CONFIRMED','WAIVE_ITEM','ITEM_UNAVAILABLE')
         ORDER BY e.created_at DESC,e.id DESC LIMIT 1
       ) e ON true
       WHERE f.session_id=$1 AND f.charge_type='ITEM' AND f.status='REVERSED' AND f.amount>0
         AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM payment_allocation a
           WHERE a.financial_charge_id=f.id AND a.payment_transaction_id=$2 AND a.reversed_amount>0))
       ORDER BY e.created_at,i.id`,
      [sessionId, paymentId ?? null],
    )
  ).rows;
  if (!decisions.length) return null;
  const beforePreparation = decisions.filter((d) => d.action === 'ITEM_UNAVAILABLE').length;
  const prefix =
    beforePreparation === decisions.length
      ? 'Hoàn tiền do món dừng trước chế biến: '
      : beforePreparation > 0
        ? 'Hoàn tiền theo xử lý món đã ghi nhận: '
        : 'Hoàn tiền theo quyết định quản trị: ';
  const full =
    prefix +
    decisions
      .map(
        (d) =>
          d.quantity +
          ' × ' +
          d.product_name_snapshot +
          ' — ' +
          (d.reason || reasonLabel(d.reason_code)),
      )
      .join('; ');
  return { reason: full.length > 300 ? full.slice(0, 297) + '…' : full, decisions };
}

// Keep a stable relationship to the reversals already present when a document
// was created. It is a context snapshot, never an allocation of money to items.
export async function readRefundRelatedItems(c: Connection, sessionId: string, createdAt?: Date) {
  const rows = (
    await c.query(
      `SELECT DISTINCT order_item_id FROM financial_charge
       WHERE session_id=$1 AND charge_type='ITEM' AND status='REVERSED' AND amount>0
         AND order_item_id IS NOT NULL AND ($2::timestamptz IS NULL OR reversed_at<=$2) ORDER BY order_item_id`,
      [sessionId, createdAt ?? null],
    )
  ).rows;
  return rows.map((row) => String(row.order_item_id));
}
