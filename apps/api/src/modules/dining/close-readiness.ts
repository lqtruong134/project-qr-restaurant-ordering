import { completionStatus } from '../payments/completion.service.js';
import { type Connection } from '../shared/core-persistence.js';
export type CloseBlocker = {
  code: string;
  title: string;
  detail: string;
  tab: 'orders' | 'payments' | 'tasks';
  count: number;
};
export type CloseReadiness = { canClose: boolean; blockers: CloseBlocker[] };
const formatMoney = (value: unknown) => BigInt(String(value ?? 0)).toLocaleString('vi-VN') + ' đ';
// The preview and the mutation share these guards. Call while holding the session lock.
export async function closeReadiness(
  c: Connection,
  id: string,
  account: Record<string, unknown>,
): Promise<CloseReadiness> {
  const blockers: CloseBlocker[] = [];
  const hasRefundDue = BigInt(String(account.refund_due_amount)) > 0n;
  const add = (code: string, title: string, detail: string, tab: CloseBlocker['tab'], count = 1) =>
    blockers.push({ code, title, detail, tab, count });
  if (BigInt(String(account.outstanding_amount)) > 0n)
    add(
      'UNPAID',
      'Chưa thu đủ tiền',
      'Còn phải thu ' +
        formatMoney(account.outstanding_amount) +
        '. Kiểm tra khoản thu hoặc lập hồ sơ thiếu tiền.',
      'payments',
    );
  if (hasRefundDue)
    add(
      'REFUND_DUE',
      'Còn tiền phải hoàn khách',
      'Cần hoàn ' +
        formatMoney(account.refund_due_amount) +
        '. Chỉ ghi nhận sau khi đã trả tiền thực tế.',
      'payments',
    );
  const batches = (
    await c.query(
      "SELECT id,status FROM order_batch WHERE session_id=$1 AND status NOT IN ('COMPLETED','REJECTED','CANCELLED')",
      [id],
    )
  ).rows;
  const items = (
    await c.query(
      "SELECT i.product_name_snapshot,i.quantity,i.status,b.status AS batch_status FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=$1 AND b.status NOT IN ('COMPLETED','REJECTED','CANCELLED') AND i.status NOT IN ('SERVED','CANCELLED','REJECTED','UNAVAILABLE') ORDER BY b.created_at,i.created_at,i.id",
      [id],
    )
  ).rows;
  const stages: [string, string, string, string[]][] = [
    [
      'REVIEW',
      'Lượt gọi chưa được duyệt',
      'Nhân viên kiểm tra và duyệt hoặc từ chối lượt gọi.',
      ['PENDING_REVIEW'],
    ],
    [
      'KITCHEN_WAIT',
      'Bếp chưa nhận món',
      'Bếp cần tiếp nhận; nếu khách không dùng nữa, xử lý hủy theo đúng điều kiện.',
      ['SUBMITTED'],
    ],
    [
      'COOKING',
      'Món chưa chế biến xong',
      'Bếp tiếp tục chế biến và báo sẵn sàng, hoặc báo sự cố nếu không thể làm.',
      ['ACCEPTED', 'IN_PREPARATION'],
    ],
    [
      'SERVING',
      'Món chưa mang ra bàn',
      'Nhân viên mang đúng món và xác nhận đã phục vụ.',
      ['READY'],
    ],
  ];
  let listed = 0;
  for (const [code, title, action, statuses] of stages) {
    const group = items.filter(
      (item) =>
        statuses.includes(code === 'REVIEW' ? item.batch_status : item.status) &&
        (code === 'REVIEW' || item.batch_status !== 'PENDING_REVIEW'),
    );
    if (!group.length) continue;
    listed += group.length;
    add(
      code,
      title,
      group.map((item) => item.quantity + ' × ' + item.product_name_snapshot).join(', ') +
        '. ' +
        action,
      'orders',
      group.length,
    );
  }
  if (batches.length && !listed)
    add(
      'ORDER_OPEN',
      'Lượt gọi chưa kết thúc',
      batches.length + ' lượt cần kiểm tra trạng thái trước khi kết thúc bàn.',
      'orders',
      batches.length,
    );
  const intents = (
    await c.query(
      "SELECT CASE WHEN p.status IN ('CREATED','PENDING','REQUIRES_RECONCILIATION') THEN p.status ELSE 'PENDING' END AS status,count(*)::int AS n FROM payment_intent p WHERE p.session_id=$1 AND (p.status IN ('CREATED','PENDING','REQUIRES_RECONCILIATION') OR (p.provider='PAYOS' AND EXISTS(SELECT 1 FROM payos_payment_request q WHERE q.payment_intent_id=p.id AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED')))) GROUP BY 1",
      [id],
    )
  ).rows;
  for (const row of intents)
    add(
      'PAYMENT_' + row.status,
      row.status === 'REQUIRES_RECONCILIATION'
        ? 'Giao dịch cần đối soát'
        : 'Khoản thu chưa xác nhận',
      row.n +
        ' khoản đang chờ. Kiểm tra kết quả thu hoặc hủy; online phải được hệ thống đối chiếu trước khi đóng phiên.',
      'payments',
      row.n,
    );
  const refunds = (
    await c.query(
      "SELECT id FROM refund_case WHERE session_id=$1 AND status IN ('OPEN','IN_PROGRESS')",
      [id],
    )
  ).rows;
  if (hasRefundDue && refunds.length)
    add(
      'REFUND_OPEN',
      'Hồ sơ hoàn tiền chưa xong',
      refunds.length + ' hồ sơ cần hoàn tất.',
      'payments',
      refunds.length,
    );
  const tasks = (
    await c.query(
      "SELECT request_type,status,count(*)::int AS n FROM support_request WHERE session_id=$1 AND status IN ('NEW','ACKNOWLEDGED') GROUP BY request_type,status",
      [id],
    )
  ).rows;
  for (const task of tasks)
    add(
      'SUPPORT_' + task.request_type + '_' + task.status,
      task.request_type === 'BILL'
        ? 'Yêu cầu thu tiền chưa kết thúc'
        : task.request_type === 'ACCESS_CODE'
          ? 'Yêu cầu cấp mã chưa hoàn tất'
          : 'Yêu cầu hỗ trợ chưa kết thúc',
      task.n +
        ' yêu cầu ' +
        (task.status === 'NEW' ? 'chưa nhận' : 'đang xử lý') +
        '. Người phụ trách cần hoàn tất hoặc ghi nhận không thực hiện.',
      task.request_type === 'BILL' ? 'payments' : 'tasks',
      task.n,
    );
  const alerts = (
    await c.query(
      "SELECT alert_type,count(*)::int AS n FROM operational_alert WHERE session_id=$1 AND status<>'RESOLVED' AND (alert_type<>'REFUND_REQUIRED' OR $2) AND NOT EXISTS(SELECT 1 FROM business_audit_event e WHERE e.action='KITCHEN_UNAVAILABLE_REPORTED' AND e.details->>'alertId'=operational_alert.id::text) GROUP BY alert_type",
      [id, hasRefundDue],
    )
  ).rows;
  for (const alert of alerts)
    add(
      'ALERT_' + alert.alert_type,
      'Cảnh báo tại bàn chưa giải quyết',
      alert.n +
        ' cảnh báo (' +
        ((
          {
            REFUND_REQUIRED: 'hoàn tiền',
            PAYMENT_SHORTFALL: 'thiếu tiền',
            OTHER: 'sự cố cần xử lý',
          } as Record<string, string>
        )[alert.alert_type] ?? 'cần kiểm tra') +
        '). Kiểm tra việc tại bàn; sự cố cần duyệt chuyển quản trị.',
      'tasks',
      alert.n,
    );
  const cases = (
    await c.query(
      "SELECT id FROM outstanding_balance_case WHERE session_id=$1 AND status NOT IN ('RECOVERED','CANCELLED','WRITTEN_OFF')",
      [id],
    )
  ).rows;
  if (cases.length)
    add(
      'OUTSTANDING_CASE',
      'Quản trị chưa chốt hồ sơ thiếu tiền',
      'Báo quản trị xử lý hồ sơ trước khi kết thúc bàn.',
      'payments',
      cases.length,
    );
  const completion = await completionStatus(c, id);
  if (completion.pendingChange.length)
    add(
      'CASH_CHANGE',
      'Chưa xác nhận trả tiền thừa',
      'Trả tiền thừa cho khách và xác nhận từng lần thu tiền mặt.',
      'payments',
      completion.pendingChange.length,
    );
  if (completion.receiptRequired && !completion.receiptDelivery)
    add(
      'RECEIPT',
      'Chưa xác nhận giao phiếu',
      'In và giao phiếu, hoặc ghi nhận khách không cần phiếu giấy. Nếu tiền món thay đổi, cần xác nhận lại.',
      'payments',
    );
  return { canClose: blockers.length === 0, blockers };
}
