'use client';
import { SessionReference } from '../shared/session-reference';
import { supportLabels } from '../shared/support-labels';
import { HistoryList } from '../shared/history-filters';
import { useRef, useState } from 'react';
import { supportStatuses } from '@thesis/contracts';
import { api, type Row } from '../shared/components';
import { Modal } from '../shared/primitives';
import { restaurantDateTime } from '../shared/restaurant-time';
const handoffLabels: Record<string, string> = {
  PENDING: 'Chờ phản hồi',
  ACCEPTED: 'Đã nhận',
  DECLINED: 'Đã từ chối',
  CANCELLED: 'Đã rút/đóng',
};
const actions: Record<string, string> = {
  SUPPORT_REQUEST_CREATED: 'Khách gọi hỗ trợ',
  SUPPORT_REQUEST_REPLACED: 'Khách gọi lại; chuyển sang yêu cầu mới',
  SUPPORT_REQUEST_EXPIRED: 'Yêu cầu cấp mã đã kết thúc',
  SUPPORT_ACCESS_CODE_ISSUED: 'Cấp mã vào bàn',
  SUPPORT_REQUEST_CLAIMED: 'Nhận xử lý',
  SUPPORT_REQUEST_RESOLVED: 'Hoàn tất hỗ trợ',
  SUPPORT_REQUEST_CANCELLED: 'Kết thúc lời gọi vì bàn đã thanh toán đủ',
  SUPPORT_REASSIGN: 'Chuyển người phụ trách (cơ chế cũ)',
  SUPPORT_HANDOFF_REQUESTED: 'Gửi bàn giao',
  SUPPORT_HANDOFF_ACCEPTED: 'Đồng ý nhận bàn giao',
  SUPPORT_HANDOFF_DECLINED: 'Từ chối bàn giao',
  SUPPORT_HANDOFF_CANCELLED: 'Rút/đóng bàn giao',
};
type History = { request: Row; handoffs: Row[]; audit: Row[] };
export function SupportHistory({ id, admin = false }: { id: string; admin?: boolean }) {
  const [data, setData] = useState<History>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setData(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <>
      <button
        className="secondary-button"
        ref={trigger}
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            setData(
              await api<History>(
                (admin ? '/core/admin/support/' : '/core/support/') + id + '/history',
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Lịch sử hỗ trợ
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {data && (
        <Modal title="Lịch sử hỗ trợ tại bàn" close={close}>
          <p>
            <strong>
              {String(data.request.table_code)}
              <SessionReference id={data.request.session_id} /> -{' '}
              {supportLabels[String(data.request.request_type)]}
            </strong>
          </p>
          <p>
            Khách {String(data.request.display_name ?? 'Không ghi nhận tên')} gửi lúc{' '}
            {restaurantDateTime(data.request.created_at)}.
          </p>
          <p>
            Trạng thái:{' '}
            {data.request.request_type === 'BILL' && data.request.status === 'CANCELLED'
              ? 'Lời gọi thu tiền đã kết thúc'
              : supportStatuses[String(data.request.status)]}
            . Người phụ trách: {String(data.request.acknowledged_by_name ?? 'Chưa có')}.
          </p>
          {data.request.content && <p>{String(data.request.content)}</p>}
          <h3>Nhật ký xử lý</h3>
          {!data.audit.length && (
            <p>
              Yêu cầu cũ chưa có nhật ký thao tác chi tiết. Không suy diễn lịch sử từ người phụ
              trách hiện tại.
            </p>
          )}
          <HistoryList
            items={data.audit}
            date={(e) => e.created_at}
            search={(e) => [actions[String(e.action)], e.actor_name, e.reason].join(' ')}
          >
            {(rows) => (
              <ol className="support-history-list">
                {rows.map((e) => (
                  <li key={e.id}>
                    <strong>{actions[String(e.action)] ?? String(e.action)}</strong>
                    <small>
                      {String(e.actor_name)} - {restaurantDateTime(e.created_at)}
                    </small>
                    <p>{String(e.reason)}</p>
                  </li>
                ))}
              </ol>
            )}
          </HistoryList>
          <h3>Các lần bàn giao</h3>
          {!data.handoffs.length && <p>Chưa có bàn giao theo cơ chế xác nhận.</p>}
          <HistoryList
            items={data.handoffs}
            date={(h) => h.requested_at}
            search={(h) => [h.from_name, h.to_name, h.reason, h.response_reason].join(' ')}
            state={(h) => String(h.status)}
            statuses={Object.entries(handoffLabels).map(([value, label]) => ({ value, label }))}
          >
            {(rows) => (
              <>
                {rows.map((h) => (
                  <article key={h.id} className="support-history-entry">
                    <strong>
                      {String(h.from_name)} → {String(h.to_name)}
                    </strong>
                    <p>{String(h.reason)}</p>
                    <small>
                      {restaurantDateTime(h.requested_at)} - {handoffLabels[String(h.status)]}
                    </small>
                    {h.responded_at && (
                      <p>
                        {String(h.responded_by_name)} - {restaurantDateTime(h.responded_at)}
                        <br />
                        {String(h.response_reason)}
                      </p>
                    )}
                  </article>
                ))}
              </>
            )}
          </HistoryList>
        </Modal>
      )}
    </>
  );
}
