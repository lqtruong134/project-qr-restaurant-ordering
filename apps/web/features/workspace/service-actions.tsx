'use client';
import { SessionReference } from '../shared/session-reference';
import { Action, EntryForm, label, vnd, type Row } from '../shared/components';
import { reasonLabel } from '@thesis/contracts';
export function AlertActions({
  rows,
  act,
  openRefund,
}: {
  rows: Row[];
  openRefund: () => void;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <>
      {rows
        .filter((a) => !a.payment_reconciliation)
        .map((a) => (
          <article className="task-card alert-card" key={a.id}>
            <div>
              <strong>
                {String(a.table_code)}
                <SessionReference id={a.session_id} /> -{' '}
                {a.guest_notice
                  ? 'Đến bàn trao đổi về món bị dừng'
                  : a.requires_admin
                    ? a.stock_inspection
                      ? 'Quản trị cần kiểm tra nguyên liệu / thiết bị'
                      : 'Sự cố món cần quản trị xử lý'
                    : a.alert_type === 'REFUND_REQUIRED'
                      ? 'Cần hoàn tiền'
                      : a.alert_type === 'PAYMENT_SHORTFALL'
                        ? 'Thiếu tiền thanh toán'
                        : 'Kiểm tra giao dịch'}
              </strong>
              <p>
                {a.requires_admin || a.guest_notice
                  ? String(a.item_name ?? 'Món ăn')
                  : vnd(
                      a.alert_type === 'REFUND_REQUIRED'
                        ? a.approved_refund_amount
                        : a.outstanding_amount,
                    )}{' '}
                - {a.stock_inspection ? 'Chờ quản trị kiểm tra' : label(a.status)}
              </p>
            </div>
            {a.guest_notice ? (
              <div className="dish-guest-task">
                <p>
                  {reasonLabel(a.issue_reason_code)}. Đến bàn báo món đã dừng, xin lỗi khách và trao
                  đổi món thay thế nếu khách muốn.
                </p>
                <Action
                  successMessage="Đã ghi nhận trao đổi với khách tại bàn."
                  run={() => act('/core/alerts/' + a.id + '/guest-notified')}
                >
                  Đã trao đổi với khách tại bàn
                </Action>
              </div>
            ) : a.requires_admin ? (
              <p>
                {a.stock_inspection
                  ? 'Món đã dừng trước chế biến và được bỏ tính tiền. Phần kiểm tra nguyên liệu hoặc thiết bị vẫn chờ quản trị xử lý. Món đang tạm ngừng nhận thêm.'
                  : 'Bếp đã dừng món. Tiền món chờ quản trị kiểm tra và quyết định.'}
              </p>
            ) : a.alert_type === 'REFUND_REQUIRED' ? (
              <div className="refund-alert-action">
                <p>
                  Quản trị đã duyệt phiếu hoàn. Trả tiền cho khách rồi xác nhận. Việc này hoàn tất
                  khi đã trả đủ khoản được duyệt.
                </p>
                <button className="primary-button" onClick={openRefund}>
                  Mở xác nhận hoàn tiền
                </button>
              </div>
            ) : ['NEW', 'ESCALATED'].includes(String(a.status)) ? (
              <Action
                successMessage="Đã ghi nhận tiếp nhận cảnh báo."
                run={() => act('/core/alerts/' + a.id + '/acknowledge')}
              >
                Xác nhận đã nhận cảnh báo
              </Action>
            ) : (
              <EntryForm
                title="Kết quả xử lý cảnh báo"
                fields={[{ key: 'reason', label: 'Nội dung đã xử lý' }]}
                submit="Hoàn tất cảnh báo"
                successMessage="Đã hoàn tất xử lý cảnh báo."
                onSubmit={(v) => act('/core/alerts/' + a.id + '/resolve', v)}
              />
            )}
          </article>
        ))}
    </>
  );
}
