'use client';
import type { PaymentReconciliationCase, UnmatchedPaymentWebhook } from '@thesis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api, EntryForm, vnd } from '../shared/components';
import { Empty, Search, matches } from '../shared/primitives';
import { restaurantDateTime } from '../shared/restaurant-time';
import { SessionReference } from '../shared/session-reference';

export default function OnlineReconciliationPanel() {
  const [rows, setRows] = useState<PaymentReconciliationCase[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('OPEN');
  const [unmatched, setUnmatched] = useState<UnmatchedPaymentWebhook[]>([]),
    [inboxLoaded, setInboxLoaded] = useState(false),
    [inboxError, setInboxError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setRows(await api<PaymentReconciliationCase[]>('/core/admin/payment-reconciliation'));
      setError('');
      setLoaded(true);
    } catch (error) {
      setError((error as Error).message);
    }
  }, []);
  const refreshInbox = useCallback(async () => {
    try {
      setUnmatched(await api<UnmatchedPaymentWebhook[]>('/core/admin/payment-webhooks/unmatched'));
      setInboxError('');
    } catch (error) {
      setInboxError((error as Error).message);
    } finally {
      setInboxLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    void refreshInbox();
  }, [refresh, refreshInbox]);
  const selected = rows.filter(
    (row) =>
      (status === 'ALL' || row.status === status) &&
      matches(
        [row.table_code, row.session_id, row.id, row.reason, row.provider_status].join(' '),
        search,
      ),
  );
  return (
    <section className="online-reconciliation-panel" aria-label="Đối soát thanh toán online">
      <p className="small-note">
        Kiểm tra giao dịch cần đối soát với sao kê và payOS. Việc kết thúc hồ sơ không tự ghi nhận
        thêm tiền vào hóa đơn.
      </p>
      <div className="online-reconciliation-toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Tìm bàn, mã phiên hoặc lý do đối soát…"
        />
        <label>
          Trạng thái hồ sơ
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="OPEN">Cần đối soát</option>
            <option value="RESOLVED">Đã xử lý</option>
            <option value="ALL">Tất cả</option>
          </select>
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            void refresh();
            void refreshInbox();
          }}
        >
          Làm mới đối soát
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p role="status">Đang tải hồ sơ đối soát…</p>
      ) : !selected.length ? (
        <Empty
          title={search ? 'Không tìm thấy hồ sơ đối soát' : 'Không có khoản online cần đối soát'}
          icon="receipt"
        >
          {search
            ? 'Thử tên bàn hoặc mã phiên khác.'
            : 'Các khoản thanh toán online hợp lệ được hệ thống tự ghi nhận.'}
        </Empty>
      ) : (
        <div className="online-reconciliation-list">
          {selected.map((row) => (
            <article className="online-reconciliation-card" key={row.id}>
              <div className="core-line">
                <h3>
                  Bàn {row.table_code}
                  <SessionReference id={row.session_id} />
                </h3>
                <strong>{row.status === 'OPEN' ? 'Cần đối soát' : 'Đã xử lý'}</strong>
              </div>
              <p className="small-note">
                {row.session_status === 'CLOSED' ? 'Phiên đã đóng' : 'Phiên đang phục vụ'} · Cập
                nhật {restaurantDateTime(row.updated_at)}
              </p>
              <div className="online-reconciliation-facts">
                <div>
                  <span>Số tiền yêu cầu</span>
                  <strong>{vnd(row.amount)}</strong>
                </div>
                <div>
                  <span>Ngân hàng đã xác nhận</span>
                  <strong>{vnd(row.paid_amount)}</strong>
                </div>
                <div>
                  <span>Tiền cần kiểm tra riêng</span>
                  <strong>{vnd(row.quarantined_amount)}</strong>
                </div>
              </div>
              {row.reason && <p>{row.reason}</p>}
              {row.last_error && <p className="small-note">{row.last_error}</p>}
              {row.status === 'OPEN' && (
                <EntryForm
                  title="Ghi nhận kết quả đối soát"
                  fields={[
                    {
                      key: 'resolution',
                      label: 'Kết quả xử lý',
                      options: [
                        ...(row.session_status !== 'CLOSED'
                          ? [{ value: 'RECONCILED', label: 'Đã đối chiếu, kết thúc hồ sơ' }]
                          : []),
                        {
                          value: 'RETURNED_EXTERNALLY',
                          label: 'Đã trả tiền qua ngân hàng',
                        },
                      ],
                    },
                    { key: 'reference', label: 'Mã giao dịch / tham chiếu sao kê', maxLength: 120 },
                    {
                      key: 'reason',
                      type: 'textarea',
                      label: 'Nội dung đối soát và căn cứ xử lý',
                      maxLength: 300,
                    },
                  ]}
                  submit="Lưu kết quả đối soát"
                  successMessage="Đã lưu kết quả đối soát thanh toán online."
                  confirm={(values) =>
                    values.resolution === 'RETURNED_EXTERNALLY'
                      ? 'Bạn đã kiểm tra và thực sự trả tiền qua ngân hàng? Thao tác này chỉ lưu kết quả đối soát, không sửa phiếu đã chốt.'
                      : 'Bạn đã đối chiếu tiền nhận, trạng thái payOS và xử lý đủ các khoản hoàn?'
                  }
                  onSubmit={async (values) => {
                    await api('/core/admin/payment-reconciliation/' + row.id + '/resolve', values);
                    await refresh();
                  }}
                />
              )}
            </article>
          ))}
        </div>
      )}
      <section aria-label="Thông báo payOS chưa khớp khoản thu">
        <h3>Thông báo payOS chưa khớp khoản thu</h3>
        <p className="small-note">
          Các thông báo đã xác minh chữ ký nhưng chưa tìm được khoản thu trong nhà hàng. Có thể là
          thông báo kiểm tra webhook hoặc giao dịch ngoài luồng; số tiền bên dưới chưa được ghi vào
          hóa đơn. Đối chiếu dashboard payOS và sao kê trước khi kết luận.
        </p>
        {inboxError && (
          <p className="form-error" role="alert">
            Chưa tải được thông báo chưa khớp: {inboxError}
          </p>
        )}
        {!inboxLoaded ? (
          <p role="status">Đang tải thông báo payOS chưa khớp…</p>
        ) : !inboxError && !unmatched.length ? (
          <Empty title="Không có thông báo payOS chưa khớp" icon="receipt">
            Không có thông báo có số tiền dương cần kiểm tra trong danh sách này.
          </Empty>
        ) : (
          <div className="online-reconciliation-list">
            {unmatched.map((notification) => (
              <article className="online-reconciliation-card" key={notification.id}>
                <div className="core-line">
                  <h3>Mã thanh toán {notification.orderCode ?? 'chưa có'}</h3>
                  <strong>Chưa khớp khoản thu</strong>
                </div>
                <p className="small-note">
                  Nhận thông báo {restaurantDateTime(notification.receivedAt)}
                </p>
                <div className="online-reconciliation-facts">
                  <div>
                    <span>Số tiền trong thông báo</span>
                    <strong>
                      {notification.currency === 'VND'
                        ? vnd(notification.amount)
                        : notification.amount + ' ' + (notification.currency ?? 'chưa rõ tiền tệ')}
                    </strong>
                  </div>
                  <div>
                    <span>Tham chiếu thông báo</span>
                    <strong>{notification.reference}</strong>
                  </div>
                </div>
                <p className="small-note">Chỉ để đối chiếu; chưa xác nhận đã nhận tiền cho bàn.</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
