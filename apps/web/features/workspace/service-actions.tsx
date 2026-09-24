'use client';
import { Action, label, vnd, type Row } from '../shared/components';
export function SupportActions({
  rows,
  userId,
  act,
}: {
  rows: Row[];
  userId: string;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <>
      {rows.map((s) => (
        <article className="task-card" key={s.id}>
          <div>
            <strong>
              {String(s.table_code)} · {label(s.request_type)}
            </strong>
            <p>{String(s.content ?? 'Khách cần hỗ trợ tại bàn.')}</p>
            <small>
              {s.status === 'ACKNOWLEDGED'
                ? 'Đang xử lý: ' + s.acknowledged_by_name + ' · ' + s.acknowledged_by_username
                : 'Chưa có người tiếp nhận'}
            </small>
          </div>
          {s.status === 'NEW' ? (
            <Action run={() => act('/core/support/' + s.id + '/claim')}>Tôi tiếp nhận</Action>
          ) : s.acknowledged_by === userId ? (
            <Action run={() => act('/core/support/' + s.id + '/resolve')}>
              Tôi đã hỗ trợ xong
            </Action>
          ) : (
            <span className="status-pill">Đồng nghiệp đang xử lý</span>
          )}
        </article>
      ))}
    </>
  );
}
export function AlertActions({
  rows,
  act,
}: {
  rows: Row[];
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <>
      {rows.map((a) => (
        <article className="task-card alert-card" key={a.id}>
          <div>
            <strong>
              {String(a.table_code)} ·{' '}
              {a.alert_type === 'REFUND_REQUIRED'
                ? 'Cần hoàn tiền'
                : a.alert_type === 'PAYMENT_SHORTFALL'
                  ? 'Thiếu tiền thanh toán'
                  : 'Kiểm tra giao dịch'}
            </strong>
            <p>
              {vnd(a.outstanding_amount)} · {label(a.status)}
            </p>
          </div>
          {['NEW', 'ESCALATED'].includes(String(a.status)) ? (
            <Action run={() => act('/core/alerts/' + a.id + '/acknowledge')}>
              Xác nhận đã nhận cảnh báo
            </Action>
          ) : (
            <Action run={() => act('/core/alerts/' + a.id + '/resolve')}>Đã xử lý cảnh báo</Action>
          )}
        </article>
      ))}
    </>
  );
}
