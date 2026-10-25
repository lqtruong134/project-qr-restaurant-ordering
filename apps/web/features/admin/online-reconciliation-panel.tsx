'use client';
import type {
  ArchivedPayosTestCase,
  PaymentReconciliationCase,
  UnmatchedPaymentWebhook,
} from '@thesis/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, vnd } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { restaurantDateTime } from '../shared/restaurant-time';
import { SessionReference } from '../shared/session-reference';
import BillPanel from '../workspace/bill-panel';
import styles from './payment-exceptions.module.css';
import BankEvidenceDialog from './bank-evidence-dialog';

const providerStates: Record<string, string> = {
  CREATE_PENDING: 'Đang tạo khoản thu',
  PENDING: 'Đang chờ khách thanh toán',
  PROCESSING: 'Đang kiểm tra giao dịch',
  UNDERPAID: 'Đã nhận một phần số tiền yêu cầu',
  PAID: 'payOS báo đã thanh toán',
  CANCEL_PENDING: 'Đang hủy khoản thu',
  CANCELLED: 'Khoản thu đã hủy',
  EXPIRED: 'Khoản thu đã hết hạn',
  FAILED: 'Khoản thu thất bại',
  ERROR: 'Chưa đối chiếu được với payOS',
  REQUIRES_RECONCILIATION: 'Đang cần đối chiếu',
};
const money = (value: string | undefined) => (value === undefined ? 'Chưa có dữ liệu' : vnd(value));
const positive = (value: string | undefined) =>
  value !== undefined && /^\d+$/.test(value) && BigInt(value) > 0n;

function CaseCard({
  row,
  refresh,
  refund,
  bankEvidence,
  notify,
}: {
  row: PaymentReconciliationCase;
  refresh: () => Promise<void>;
  refund: () => void;
  bankEvidence: () => void;
  notify: (message: string) => void;
}) {
  const closed = row.status === 'RESOLVED';
  const blockers = row.resolution_blockers ?? ['Cập nhật kết quả đối chiếu trước khi đóng hồ sơ.'];
  const hasRefund = positive(row.unapplied_amount) || positive(row.refund_due_amount);
  return (
    <article
      className="online-reconciliation-card"
      aria-label={`Ngoại lệ thanh toán bàn ${row.table_code}`}
    >
      <div className={styles.header}>
        <div>
          <h3>
            Bàn {row.table_code}
            <SessionReference id={row.session_id} />
          </h3>
          <p className="small-note">
            {row.session_status === 'CLOSED' ? 'Phiên đã đóng' : 'Phiên đang phục vụ'} · Cập nhật{' '}
            {restaurantDateTime(row.updated_at)}
          </p>
        </div>
        <span className={styles.status + (closed ? ' ' + styles.closed : '')}>
          {closed
            ? 'Đã đóng hồ sơ'
            : row.acknowledged_at
              ? 'Đã tiếp nhận · còn cần xử lý'
              : 'Chờ quản trị kiểm tra'}
        </span>
      </div>
      <div className="online-reconciliation-facts">
        {[
          ['Số tiền yêu cầu', row.amount],
          ['payOS báo đã nhận', row.paid_amount],
          ['Đã ghi sổ giao dịch', row.recorded_amount],
          ['Đã tính vào tiền món', row.allocated_amount],
          ['Chưa phân bổ vào tiền món', row.unapplied_amount],
          ['Còn cần hoàn của cả phiên', row.refund_due_amount],
          ['Đã hoàn thực tế', row.refunded_amount],
          ['Chưa được phép ghi sổ', row.quarantined_amount],
        ].map(([title, value]) => (
          <div key={title}>
            <span>{title}</span>
            <strong>{money(value)}</strong>
          </div>
        ))}
      </div>
      {row.verification_source && row.verification_source !== 'UNVERIFIED' && (
        <p className="small-note" aria-label="Nguồn xác minh thanh toán">
          <strong>Nguồn ghi nhận:</strong>{' '}
          {row.verification_source === 'BANK_ADMIN_VERIFIED'
            ? 'Quản trị đã đối chiếu ngân hàng'
            : row.verification_source === 'MIXED'
              ? 'payOS tự xác minh và quản trị đối chiếu ngân hàng'
              : 'payOS đã xác minh tự động'}
          {row.provider_evidence_attached &&
            row.verification_source === 'BANK_ADMIN_VERIFIED' &&
            ' · payOS đã bổ sung bằng chứng cho giao dịch này.'}
        </p>
      )}
      <p className="small-note">
        Tiền payOS báo đã nhận chỉ giảm công nợ khi đã được xác minh và tính vào tiền món. Tiền chưa
        phân bổ và khoản cần hoàn được xử lý riêng.
      </p>
      {row.reason && (
        <div className={styles.reason}>
          <strong>Nguyên nhân cần kiểm tra</strong>
          <p>{row.reason}</p>
        </div>
      )}
      <dl className={styles.stages} aria-label="Tiến trình xử lý hồ sơ">
        <div>
          <dt>Tiếp nhận cảnh báo</dt>
          <dd>
            {row.acknowledged_at
              ? `Đã tiếp nhận${row.acknowledged_by_name ? ' · ' + row.acknowledged_by_name : ''}`
              : 'Chưa tiếp nhận'}
          </dd>
        </div>
        <div>
          <dt>Xác minh giao dịch</dt>
          <dd>
            {row.verification_source === 'BANK_ADMIN_VERIFIED'
              ? `Ngân hàng do quản trị đối chiếu${row.bank_verified_at ? ' · ' + restaurantDateTime(row.bank_verified_at) : ''}`
              : row.verified_at
                ? `Đã kiểm tra dữ liệu payOS · ${restaurantDateTime(row.verified_at)}`
                : row.verification_source === 'MIXED'
                  ? 'Ngân hàng đã được quản trị đối chiếu'
                  : 'Chưa đủ bằng chứng xác minh'}
          </dd>
        </div>
        <div>
          <dt>Kết thúc hồ sơ</dt>
          <dd>{closed ? 'Đã đóng và lưu lịch sử' : 'Hồ sơ đang mở'}</dd>
        </div>
      </dl>
      <details className={styles.evidence}>
        <summary>Xem đối chiếu và bằng chứng</summary>
        <dl>
          <div>
            <dt>Trạng thái payOS</dt>
            <dd>
              {providerStates[row.provider_status] ?? 'Chưa xác định trạng thái'}{' '}
              <small>({row.provider_status})</small>
            </dd>
          </div>
          <div>
            <dt>Tham chiếu đã nhận từ payOS</dt>
            <dd>
              {row.provider_references?.length
                ? row.provider_references.map((reference) => (
                    <code key={reference}>{reference}</code>
                  ))
                : 'Chưa có tham chiếu đáng tin cậy.'}
            </dd>
          </div>
          {row.last_error && (
            <div>
              <dt>Kết quả kiểm tra gần nhất</dt>
              <dd>{row.last_error}</dd>
            </div>
          )}
          {row.acknowledged_at && (
            <div>
              <dt>Thời điểm tiếp nhận</dt>
              <dd>{restaurantDateTime(row.acknowledged_at)}</dd>
            </div>
          )}
          {row.resolved_at && (
            <div>
              <dt>Thời điểm đóng hồ sơ</dt>
              <dd>{restaurantDateTime(row.resolved_at)}</dd>
            </div>
          )}
          {row.resolution_note && (
            <div>
              <dt>Kết quả đã lưu</dt>
              <dd>{row.resolution_note}</dd>
            </div>
          )}
        </dl>
      </details>
      {closed &&
        (row.verification_source === 'BANK_ADMIN_VERIFIED' ||
          row.verification_source === 'MIXED') && (
          <button type="button" className="secondary-button" onClick={bankEvidence}>
            Xem chứng từ ngân hàng
          </button>
        )}
      {!closed && (
        <div className={styles.next}>
          <h4>Bước xử lý tiếp theo</h4>
          {!row.can_resolve && (
            <div className={styles.blockers}>
              <p>Chưa thể đóng hồ sơ</p>
              <ul>
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
          {positive(row.unapplied_amount) ? (
            <p>
              Còn {vnd(row.unapplied_amount)} đã nhận nhưng chưa tính vào tiền món. Lập phiếu hoàn
              từ đúng giao dịch gốc, chờ trả tiền và xác nhận thực tế trước khi đóng hồ sơ.
            </p>
          ) : positive(row.refund_due_amount) ? (
            <p>
              Phiên còn {vnd(row.refund_due_amount)} cần hoàn. Kiểm tra các giao dịch gốc và hoàn
              tất trả tiền thực tế trước khi đóng hồ sơ.
            </p>
          ) : null}
          <div className={styles.actions}>
            {!row.acknowledged_at && (
              <Action
                run={async () => {
                  await api('/core/admin/payment-reconciliation/' + row.id + '/acknowledge', {});
                  await refresh();
                  notify(
                    'Đã tiếp nhận cảnh báo. Việc tiếp nhận chưa xác minh giao dịch và không thay đổi số dư.',
                  );
                }}
              >
                Tiếp nhận kiểm tra
              </Action>
            )}
            <Action
              run={async () => {
                try {
                  await api('/core/admin/payment-reconciliation/' + row.id + '/refresh', {});
                } finally {
                  await refresh();
                }
              }}
            >
              <Icon name="refresh" size={16} /> Đối chiếu lại với payOS
            </Action>
            <button className="secondary-button" type="button" onClick={bankEvidence}>
              <Icon name="shield" size={16} /> Xác minh qua ngân hàng
            </button>
            {hasRefund && (
              <button className="secondary-button" type="button" onClick={refund}>
                Mở xử lý hoàn tiền tại bàn
              </button>
            )}
            {row.can_resolve && (
              <Action
                confirmTitle="Đóng hồ sơ ngoại lệ thanh toán?"
                confirmLabel="Đóng hồ sơ"
                confirm="Hệ thống sẽ kiểm tra lại bằng chứng, sổ thu và tiền hoàn trước khi đóng hồ sơ. Thao tác này không thay cho việc nhận hoặc trả tiền thực tế."
                successMessage="Đã đóng hồ sơ ngoại lệ. Lịch sử được giữ lại."
                run={async () => {
                  try {
                    await api('/core/admin/payment-reconciliation/' + row.id + '/resolve', {
                      resolution: 'RECONCILED',
                    });
                  } finally {
                    await refresh();
                  }
                }}
              >
                Đóng hồ sơ sau đối chiếu
              </Action>
            )}
          </div>
          <p className="small-note">
            Tiếp nhận chỉ ghi người đang kiểm tra. Xác minh và đóng hồ sơ luôn dựa trên bằng chứng
            cùng số tiền thực tế.
          </p>
        </div>
      )}
    </article>
  );
}

export default function OnlineReconciliationPanel({
  onUpdated,
}: {
  onUpdated?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<PaymentReconciliationCase[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [notice, setNotice] = useState(''),
    [status, setStatus] = useState('OPEN'),
    [refundSession, setRefundSession] = useState<string>(),
    [bankEvidenceId, setBankEvidenceId] = useState<string>();
  const [unmatched, setUnmatched] = useState<UnmatchedPaymentWebhook[]>([]),
    [inboxError, setInboxError] = useState('');
  const [archives, setArchives] = useState<ArchivedPayosTestCase[]>([]);
  const [archiveError, setArchiveError] = useState('');
  const loading = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const results = await Promise.allSettled([
        api<PaymentReconciliationCase[]>('/core/admin/payment-reconciliation'),
        api<UnmatchedPaymentWebhook[]>('/core/admin/payment-webhooks/unmatched'),
        api<ArchivedPayosTestCase[]>('/core/admin/payment-test-archives'),
      ]);
      if (results[0].status === 'fulfilled') {
        setRows(results[0].value);
        setError('');
      } else setError('Chưa cập nhật được hồ sơ. Dữ liệu gần nhất được giữ lại; hãy thử làm mới.');
      if (results[1].status === 'fulfilled') {
        setUnmatched(results[1].value);
        setInboxError('');
      } else setInboxError('Chưa cập nhật được thông báo payOS chưa khớp.');
      if (results[2].status === 'fulfilled') {
        setArchives(results[2].value);
        setArchiveError('');
      } else setArchiveError('Chưa tải được hồ sơ thử đã lưu trữ.');
    } finally {
      loading.current = false;
      setLoaded(true);
    }
  }, []);
  const refreshAll = async () => {
    await refresh();
    await onUpdated?.();
  };
  useEffect(() => {
    void refresh();
    const tick = () => {
      if (!document.hidden && navigator.onLine) void refresh();
    };
    const timer = setInterval(tick, 5000);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);
  const pending = rows.filter((row) => row.status === 'OPEN');
  const selected = rows
    .filter(
      (row) =>
        (status === 'ALL' || row.status === status) &&
        matches(
          [
            row.table_code,
            row.session_id,
            row.id,
            row.reason,
            row.provider_status,
            ...(row.provider_references ?? []),
          ].join(' '),
          search,
        ),
    )
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return (
    <section
      className={'online-reconciliation-panel ' + styles.panel}
      aria-label="Đối soát thanh toán online"
    >
      <div className={styles.summary}>
        <strong>
          {loaded
            ? `${pending.length} hồ sơ ngoại lệ đang chờ`
            : 'Đang kiểm tra ngoại lệ thanh toán…'}
        </strong>
        <p className="small-note">
          Giao dịch hợp lệ được tự động ghi nhận. Chỉ các khoản bất thường cần quản trị xử lý.
        </p>
      </div>
      <div className="online-reconciliation-toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Tìm bàn, mã phiên, tham chiếu hoặc nguyên nhân…"
        />
        <label>
          Trạng thái hồ sơ
          <select
            aria-label="Trạng thái hồ sơ"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="OPEN">Cần xử lý</option>
            <option value="RESOLVED">Lịch sử đã đóng</option>
            <option value="ALL">Tất cả hồ sơ</option>
          </select>
        </label>
        <Action run={refreshAll}>
          <Icon name="refresh" size={16} /> Làm mới đối soát
        </Action>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p role="status">Đang tải hồ sơ đối soát…</p>
      ) : !selected.length && !error ? (
        <Empty
          title={
            search
              ? 'Không tìm thấy hồ sơ đối soát'
              : status === 'RESOLVED'
                ? 'Chưa có hồ sơ đã đóng'
                : status === 'ALL'
                  ? 'Chưa có hồ sơ ngoại lệ thanh toán'
                  : 'Không có khoản online cần đối soát'
          }
          icon="receipt"
        >
          {search
            ? 'Thử tên bàn, mã phiên hoặc tham chiếu khác.'
            : 'Các khoản thanh toán online hợp lệ được hệ thống tự ghi nhận.'}
        </Empty>
      ) : (
        <div className="online-reconciliation-list">
          {selected.map((row) => (
            <CaseCard
              key={row.id}
              row={row}
              refresh={refreshAll}
              refund={() => setRefundSession(row.session_id)}
              bankEvidence={() => setBankEvidenceId(row.id)}
              notify={setNotice}
            />
          ))}
        </div>
      )}
      <section className={styles.history} aria-label="Thông báo payOS chưa khớp khoản thu">
        <h3>Thông báo payOS chưa khớp khoản thu {loaded && `(${unmatched.length})`}</h3>
        <p className="small-note">
          Thông báo có chữ ký hợp lệ nhưng chưa tìm được khoản thu tương ứng. Số tiền này chưa được
          ghi vào hóa đơn. Kiểm tra tham chiếu với payOS và sao kê; thông báo này không đủ để tự gán
          tiền vào một bàn.
        </p>
        {inboxError && (
          <p className="form-error" role="alert">
            {inboxError}
          </p>
        )}
        {!loaded ? (
          <p role="status">Đang tải thông báo chưa khớp…</p>
        ) : !inboxError && !unmatched.length ? (
          <Empty title="Không có thông báo payOS chưa khớp" icon="receipt">
            Không có thông báo có số tiền dương cần kiểm tra.
          </Empty>
        ) : (
          <div className="online-reconciliation-list">
            {unmatched.map((notification) => (
              <article className="online-reconciliation-card" key={notification.id}>
                <div className={styles.header}>
                  <h3>Mã thanh toán {notification.orderCode ?? 'chưa có'}</h3>
                  <span className={styles.status}>Chưa khớp khoản thu</span>
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
                <p className="small-note">Chưa xác nhận đã nhận tiền cho bàn.</p>
              </article>
            ))}
          </div>
        )}
      </section>
      {(archives.length > 0 || archiveError) && (
        <details className={styles.history}>
          <summary>
            <span>Hồ sơ thử đã lưu trữ ({archives.length})</span>
            {archives.some((row) => row.unexpected_webhooks > 0) && (
              <strong> · Có thông báo mới cần kiểm tra</strong>
            )}
          </summary>
          <p className="small-note">
            Có tiền thật. Lưu trữ không đồng nghĩa đã thu, hoàn hoặc đối soát xong.
          </p>
          {archiveError && <p role="alert">{archiveError}</p>}
          {archives.map((row) => (
            <article
              className="online-reconciliation-card"
              key={row.id}
              aria-label={`Hồ sơ thử đã lưu trữ bàn ${row.table_code}`}
            >
              <h3>
                Bàn {row.table_code}
                <SessionReference id={row.session_id} />
              </h3>
              <p>
                {vnd(row.amount)} ·{' '}
                {row.recorded_amount === '0'
                  ? 'Chưa ghi sổ'
                  : `Đã ghi sổ ${vnd(row.recorded_amount)}`}{' '}
                · Chặn ghi nhận tự động
              </p>
              <p className="small-note">
                Lưu trữ {restaurantDateTime(row.archived_at)} · Giữ{' '}
                {row.original_audit_count.toLocaleString('vi-VN')} sự kiện audit
              </p>
              {row.visible_in_operations && (
                <p className="small-note">Đã đưa trở lại hàng đợi kiểm tra; vẫn chặn ghi sổ.</p>
              )}
              {row.unexpected_webhooks > 0 && (
                <p role="alert">
                  Có {row.unexpected_webhooks} thông báo mới không khớp hồ sơ. Cần kiểm tra riêng;
                  chưa ghi nhận tiền.
                </p>
              )}
            </article>
          ))}
        </details>
      )}
      {bankEvidenceId && (
        <BankEvidenceDialog
          id={bankEvidenceId}
          close={() => setBankEvidenceId(undefined)}
          done={refreshAll}
        />
      )}
      {refundSession && (
        <Modal
          title="Kiểm tra và hoàn tiền từ giao dịch gốc"
          wide
          close={() => setRefundSession(undefined)}
        >
          <div className={styles.refundDialog}>
            <BillPanel
              id={refundSession}
              products={[]}
              financialOnly
              focusRefund
              onClose={() => setRefundSession(undefined)}
              done={refreshAll}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
