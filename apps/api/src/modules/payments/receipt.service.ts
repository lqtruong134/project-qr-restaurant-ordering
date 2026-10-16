import { readPaymentIntents } from './payos.service.js';
import { payosCapabilities } from './payos-adapter.js';
import { readBillingSummary, consumePromotion } from '../finance/pricing.service.js';
import { completionStatus } from './completion.service.js';
import { withCashPaymentFields } from './payment-view.service.js';
import { readRefundContext } from './refund-context.service.js';
import { refundApprovalJoin, readRefundWorkflow } from './refund-approval.service.js';
import { one, type Connection } from '../shared/core-persistence.js';
import { recalculate } from '../finance/ledger.service.js';
import { closeReadiness } from '../dining/close-readiness.js';
export async function readBill(c: Connection, s: Record<string, unknown>, restaurant: string) {
  if (s.receipt_snapshot) {
    const snapshot = s.receipt_snapshot as Record<string, unknown>;
    return {
      ...snapshot,
      payments: Array.isArray(snapshot.payments)
        ? snapshot.payments.map((payment) => withCashPaymentFields(payment))
        : [],
    };
  }
  const account = await recalculate(c, String(s.id));
  return {
    session: s,
    account,
    billing: await readBillingSummary(c, String(s.id)),
    completion: await completionStatus(c, String(s.id)),
    refundContext: await readRefundContext(c, String(s.id)),
    refundWorkflow: await readRefundWorkflow(c, String(s.id), String(account.refund_due_amount)),
    ...(s.session_status === 'ACTIVE'
      ? { closure: await closeReadiness(c, String(s.id), account) }
      : {}),
    paymentCapabilities: payosCapabilities(),
    generatedAt: new Date().toISOString(),
    store: await one(c, 'SELECT name,address,timezone FROM restaurant WHERE id=$1', [restaurant]),
    charges: (
      await c.query(
        `SELECT f.*,i.owner_participant_id,sp.display_name AS owner_name,(f.amount-f.discount_amount)::text AS net_amount,CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount-COALESCE((SELECT sum(allocated_amount-reversed_amount) FROM payment_allocation WHERE financial_charge_id=f.id),0) ELSE 0 END::text AS unpaid_amount,i.product_name_snapshot,i.product_kind_snapshot,i.combo_components_snapshot,i.quantity,i.unit_price_snapshot,i.status AS item_status,i.cancel_reason,i.cancel_reason_code,
    EXISTS(SELECT 1 FROM business_audit_event report JOIN operational_alert alert ON alert.id=(report.details->>'alertId')::uuid WHERE report.resource_id=i.id AND report.action='KITCHEN_ISSUE_REPORTED' AND alert.status<>'RESOLVED') AS awaiting_admin,
           (SELECT e.reason FROM business_audit_event e WHERE e.resource_id=i.id AND e.action IN ('WAIVE_ITEM','RESTAURANT_FAULT_CONFIRMED') ORDER BY e.created_at DESC LIMIT 1) AS finance_reason,
    (SELECT e.details->>'reasonCode' FROM business_audit_event e WHERE e.resource_id=i.id AND e.action IN ('WAIVE_ITEM','RESTAURANT_FAULT_CONFIRMED') ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS finance_reason_code
           FROM financial_charge f LEFT JOIN order_item i ON i.id=f.order_item_id LEFT JOIN session_participant sp ON sp.id=i.owner_participant_id WHERE f.session_id=$1 ORDER BY f.created_at,f.id`,
        [s.id],
      )
    ).rows,
    waivedItems: (
      await c.query(
        `SELECT i.id,i.owner_participant_id,(SELECT display_name FROM session_participant WHERE id=i.owner_participant_id) AS owner_name,i.product_name_snapshot,i.product_kind_snapshot,i.combo_components_snapshot,i.quantity,i.unit_price_snapshot,i.status AS item_status,i.cancel_reason_code,e.reason,e.details->>'reasonCode' AS finance_reason_code
         FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id
         JOIN business_audit_event e ON e.resource_id=i.id AND e.action='WAIVE_ITEM'
         WHERE b.session_id=$1 ORDER BY i.created_at,i.id`,
        [s.id],
      )
    ).rows,
    cancelledItems: (
      await c.query(
        "SELECT i.id,i.owner_participant_id,(SELECT display_name FROM session_participant WHERE id=i.owner_participant_id) AS owner_name,i.product_name_snapshot,i.product_kind_snapshot,i.combo_components_snapshot,i.quantity,i.unit_price_snapshot,i.status AS item_status,i.cancel_reason_code,i.cancel_reason FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=$1 AND i.status IN ('CANCELLED','UNAVAILABLE') ORDER BY i.created_at,i.id",
        [s.id],
      )
    ).rows,
    complimentaryItems: (
      await c.query(
        "SELECT i.id,i.owner_participant_id,(SELECT display_name FROM session_participant WHERE id=i.owner_participant_id) AS owner_name,i.product_name_snapshot,i.product_kind_snapshot,i.combo_components_snapshot,i.quantity FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=$1 AND i.line_total=0 AND i.status NOT IN ('CANCELLED','REJECTED','UNAVAILABLE') ORDER BY i.created_at,i.id",
        [s.id],
      )
    ).rows,
    participants: (
      await c.query(
        'SELECT id,display_name,status FROM session_participant WHERE session_id=$1 ORDER BY joined_at,id',
        [s.id],
      )
    ).rows,
    paymentRequests: (
      await c.query(
        "SELECT x.*,p.display_name,u.display_name AS acknowledged_by_name FROM support_request x LEFT JOIN session_participant p ON p.id=x.participant_id LEFT JOIN app_user u ON u.id=x.acknowledged_by WHERE x.session_id=$1 AND x.request_type='BILL' AND x.status IN ('NEW','ACKNOWLEDGED') ORDER BY x.created_at DESC,x.id",
        [s.id],
      )
    ).rows,
    intents: await readPaymentIntents(c, String(s.id)),
    payments: (
      await c.query(
        `SELECT p.*,(SELECT e.created_at FROM business_audit_event e WHERE e.resource_id=p.id AND e.action='CASH_CHANGE_RETURNED' ORDER BY e.created_at LIMIT 1) AS change_returned_at,(SELECT u.display_name FROM business_audit_event e JOIN app_user u ON u.id=e.actor_id WHERE e.resource_id=p.id AND e.action='CASH_CHANGE_RETURNED' ORDER BY e.created_at LIMIT 1) AS change_returned_by_name,u.display_name AS confirmed_by_name,u.username AS confirmed_by_username FROM payment_transaction p LEFT JOIN app_user u ON u.id=p.confirmed_by WHERE p.session_id=$1 ORDER BY p.created_at DESC`,
        [s.id],
      )
    ).rows.map((payment) => withCashPaymentFields(payment)),
    refunds: (
      await c.query(
        `SELECT f.*,f.amount-COALESCE((SELECT sum(t.amount) FROM refund_transaction t WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'),0) AS remaining_amount,
          approval.approved_at,approval.approved_by_id,approval.approved_by_name,
          approval.approved_at IS NULL AS approval_required
         FROM refund_case f ${refundApprovalJoin} WHERE f.session_id=$1 ORDER BY f.created_at DESC`,
        [s.id],
      )
    ).rows,
    refundTransactions: (
      await c.query(
        `SELECT t.*,u.display_name AS processed_by_name FROM refund_transaction t
       JOIN refund_case f ON f.id=t.refund_case_id LEFT JOIN app_user u ON u.id=t.processed_by
       WHERE f.session_id=$1 AND t.status='SUCCEEDED' ORDER BY t.processed_at,t.id`,
        [s.id],
      )
    ).rows,
    closedBy: s.closed_by
      ? await one(c, 'SELECT display_name,username FROM app_user WHERE id=$1', [s.closed_by])
      : null,
  };
}
export async function freezeReceipt(c: Connection, id: string, restaurant: string, actor: string) {
  await c.query(
    "UPDATE table_session SET closed_by=$2,receipt_number='PT-'||to_char(closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYYMMDD')||'-'||lpad(nextval('receipt_number_seq')::text,8,'0') WHERE id=$1 AND receipt_snapshot IS NULL",
    [id, actor],
  );
  const s = await one(
    c,
    'SELECT s.*,t.code AS table_code,t.name AS table_name FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=$1',
    [id],
  );
  await consumePromotion(c, id);
  const bill = await readBill(c, s, restaurant);
  await c.query(
    'UPDATE table_session SET receipt_snapshot=$2::jsonb WHERE id=$1 AND receipt_snapshot IS NULL',
    [id, JSON.stringify(bill)],
  );
}
