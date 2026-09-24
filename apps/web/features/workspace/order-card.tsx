'use client';
import { Action, EntryForm, label, vnd, type Order } from '../shared/components';
import { Icon } from '../shared/primitives';
export default function OrderCard({
  o,
  kitchen,
  act,
}: {
  o: Order;
  kitchen: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <article className="core-card order-card">
      <div className="core-line">
        <h3>Bàn {o.table_code}</h3>
        <span className="status-pill" data-status={o.status}>
          {label(o.status)}
        </span>
      </div>
      <div className="order-meta">
        <Icon name="clock" size={13} />
        {o.created_at
          ? new Date(o.created_at).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Đang chờ xử lý'}
      </div>
      {o.items?.map((i) => (
        <div key={i.id} className="core-order-item">
          <strong>
            {i.quantity} × {i.product_name_snapshot}
          </strong>
          {i.note && <p>Ghi chú: {String(i.note)}</p>}
          <p>
            <span className="status-pill" data-status={i.status}>
              {label(i.status)}
            </span>
          </p>
          {i.status === 'UNAVAILABLE' && i.cancel_reason && (
            <p className="form-error">Lý do: {String(i.cancel_reason)}</p>
          )}
          {kitchen && i.status === 'ACCEPTED' && (
            <div className="order-item-actions">
              <Action run={() => act('/core/items/' + i.id + '/prepare')}>Bắt đầu chế biến</Action>
              <details className="rare-action">
                <summary>Hủy món</summary>
                <EntryForm
                  title="Xác nhận hủy món"
                  fields={[
                    {
                      key: 'reason',
                      label: 'Lý do không thể chế biến',
                      value: 'Nguyên liệu không đạt yêu cầu',
                    },
                  ]}
                  submit="Xác nhận hủy món"
                  onSubmit={(v) => act('/core/items/' + i.id + '/unavailable', v)}
                />
              </details>
            </div>
          )}
          {kitchen && i.status === 'IN_PREPARATION' && (
            <Action run={() => act('/core/items/' + i.id + '/ready')}>Món đã xong</Action>
          )}
          {!kitchen && i.status === 'READY' && (
            <Action run={() => act('/core/items/' + i.id + '/serve')}>Đã mang ra bàn</Action>
          )}
        </div>
      ))}
      <p className="order-total">
        <span>Tổng lượt gọi</span>
        <strong>{vnd(o.total_amount)}</strong>
      </p>
      {kitchen && o.status === 'SUBMITTED' && (
        <Action run={() => act('/core/orders/' + o.id + '/accept')}>Bếp nhận cả lượt</Action>
      )}
      {!kitchen && o.status === 'PENDING_REVIEW' && (
        <>
          <Action run={() => act('/core/orders/' + o.id + '/review', { approve: true })}>
            Duyệt gửi bếp
          </Action>
          <EntryForm
            title="Từ chối lượt gọi"
            fields={[{ key: 'reason', label: 'Lý do' }]}
            submit="Từ chối"
            onSubmit={(v) => act('/core/orders/' + o.id + '/review', { ...v, approve: false })}
          />
        </>
      )}
      {!kitchen && ['SUBMITTED', 'ACCEPTED'].includes(o.status) && (
        <details>
          <summary>Hủy lượt chưa chế biến</summary>
          <EntryForm
            title="Hủy lượt gọi"
            fields={[{ key: 'reason', label: 'Lý do hủy' }]}
            submit="Xác nhận hủy"
            onSubmit={(v) => act('/core/orders/' + o.id + '/cancel', v)}
          />
        </details>
      )}
    </article>
  );
}
