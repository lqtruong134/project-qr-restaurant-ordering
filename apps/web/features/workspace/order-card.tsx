'use client';
import { SessionReference } from '../shared/session-reference';
import { Action, EntryForm, label, vnd, type Order } from '../shared/components';
import { Icon } from '../shared/primitives';
import { restaurantTime } from '../shared/restaurant-time';
import { restaurantPolicy } from '@thesis/contracts';
import { PolicyNotice, reasonFields } from '../shared/policy-ui';
import { KitchenIssue } from './kitchen-issue';
import { ComboContents } from '../shared/combo-contents';
export default function OrderCard({
  o,
  kitchen,
  act,
  hideServe = false,
}: {
  o: Order;
  kitchen: boolean;
  hideServe?: boolean;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <article className="core-card order-card" data-status={o.status}>
      <div className="core-line">
        <h3>
          Bàn {o.table_code}
          <SessionReference id={o.session_id} />
        </h3>
        <span className="status-pill" data-status={o.status}>
          {label(o.status)}
        </span>
      </div>
      <div className="order-meta">
        {o.area_name && <span>{o.area_name} - </span>}
        <span className="ticket-number">#{o.id.slice(0, 6).toUpperCase()}</span>
        <Icon name="clock" size={16} />
        {o.created_at
          ? restaurantTime(o.created_at, {
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
          <ComboContents components={i.combo_components_snapshot} />
          {i.note && (
            <p className="kitchen-note">
              <Icon name="menu" size={16} /> Ghi chú: {String(i.note)}
            </p>
          )}
          {i.status === 'READY' && i.ready_at && (
            <small>
              Chờ mang ra{' '}
              {Math.max(
                0,
                Math.floor((Date.now() - new Date(String(i.ready_at)).getTime()) / 60000),
              )}{' '}
              phút
            </small>
          )}
          <p>
            <span className="status-pill" data-status={i.status}>
              {label(i.status)}
            </span>
          </p>
          {i.status === 'UNAVAILABLE' && i.cancel_reason && (
            <p className="form-error">Lý do: {String(i.cancel_reason)}</p>
          )}
          {kitchen && i.status === 'SUBMITTED' && o.status !== 'PENDING_REVIEW' && (
            <Action
              successMessage={`Đã nhận món ${i.product_name_snapshot}.`}
              run={() => act('/core/items/' + i.id + '/accept')}
            >
              Nhận món này
            </Action>
          )}
          {!kitchen && ['SUBMITTED', 'ACCEPTED'].includes(i.status) && (
            <details>
              <summary>Hủy riêng món này</summary>
              <EntryForm
                title="Hủy món trước chế biến"
                successMessage={false}
                fields={reasonFields('STAFF_CANCEL')}
                confirm={
                  String(i.quantity) +
                  ' × ' +
                  i.product_name_snapshot +
                  ' - ' +
                  vnd(i.line_total) +
                  '. ' +
                  restaurantPolicy.notices.staffCancel
                }
                confirmLabel="Xác nhận hủy món"
                submit="Xác nhận hủy món"
                onSubmit={(v) => act('/core/items/cancel', { ...v, itemIds: [i.id] })}
              />
            </details>
          )}
          {kitchen && i.status === 'ACCEPTED' && (
            <div className="order-item-actions">
              <PolicyNotice>{restaurantPolicy.notices.prepare}</PolicyNotice>
              <Action
                successMessage={`Đã ghi nhận bắt đầu chế biến ${i.product_name_snapshot}.`}
                run={() => act('/core/items/' + i.id + '/prepare')}
              >
                Bắt đầu chế biến
              </Action>
              <details className="rare-action">
                <summary>
                  <Icon name="warning" size={16} /> Không thể phục vụ món này
                </summary>
                <EntryForm
                  title="Không thể phục vụ món này"
                  successMessage="Đã báo món không thể phục vụ. Nhân viên sẽ trao đổi với khách."
                  fields={reasonFields('KITCHEN_UNAVAILABLE')}
                  notice={<PolicyNotice>{restaurantPolicy.notices.unavailable}</PolicyNotice>}
                  confirm={
                    String(i.quantity) +
                    ' × ' +
                    i.product_name_snapshot +
                    ' - ' +
                    vnd(i.line_total) +
                    '. ' +
                    restaurantPolicy.notices.unavailable
                  }
                  submit="Xác nhận không thể phục vụ"
                  onSubmit={(v) => act('/core/items/' + i.id + '/unavailable', v)}
                />
              </details>
            </div>
          )}
          {kitchen && i.status === 'IN_PREPARATION' && (
            <Action
              successMessage={`Đã báo ${i.product_name_snapshot} sẵn sàng phục vụ.`}
              run={() => act('/core/items/' + i.id + '/ready')}
            >
              Món đã xong
            </Action>
          )}
          {kitchen && ['IN_PREPARATION', 'READY'].includes(i.status) && (
            <KitchenIssue submit={(v) => act('/core/items/' + i.id + '/report-issue', v)} />
          )}
          {!kitchen && !hideServe && i.status === 'READY' && (
            <Action
              successMessage={`Đã ghi nhận phục vụ ${i.product_name_snapshot}.`}
              run={() => act('/core/items/' + i.id + '/serve')}
            >
              Đã mang ra bàn
            </Action>
          )}
        </div>
      ))}
      <p className="order-total">
        <span>Giá trị lượt gọi ban đầu</span>
        <strong>{vnd(o.total_amount)}</strong>
      </p>
      {kitchen &&
        o.status !== 'PENDING_REVIEW' &&
        o.items?.some((i) => i.status === 'SUBMITTED') && (
          <Action
            successMessage="Bếp đã nhận lượt gọi."
            run={() => act('/core/orders/' + o.id + '/accept')}
          >
            Bếp nhận cả lượt
          </Action>
        )}
      {!kitchen && o.status === 'PENDING_REVIEW' && (
        <>
          <Action
            successMessage="Đã duyệt và gửi lượt gọi đến bếp."
            run={() => act('/core/orders/' + o.id + '/review', { approve: true })}
          >
            Duyệt gửi bếp
          </Action>
          <EntryForm
            title="Từ chối lượt gọi"
            successMessage="Đã từ chối lượt gọi."
            fields={[{ key: 'reason', label: 'Lý do' }]}
            submit="Từ chối"
            onSubmit={(v) => act('/core/orders/' + o.id + '/review', { ...v, approve: false })}
          />
        </>
      )}
      {!kitchen && o.items.some((i) => ['SUBMITTED', 'ACCEPTED'].includes(i.status)) && (
        <details>
          <summary>Hủy các món chưa chế biến trong lượt</summary>
          <EntryForm
            title="Hủy món chưa chế biến"
            successMessage={false}
            fields={reasonFields('STAFF_CANCEL')}
            confirm={restaurantPolicy.notices.staffCancel}
            confirmLabel="Xác nhận hủy"
            submit="Xác nhận hủy"
            onSubmit={(v) => act('/core/orders/' + o.id + '/cancel', v)}
          />
        </details>
      )}
    </article>
  );
}
