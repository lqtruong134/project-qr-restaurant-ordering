'use client';
import type { PaymentReconciliationCase } from '@thesis/contracts';
import styles from './payment-exceptions.module.css';
import { refundsOutsidePaymentCases } from './payment-work';
import { SessionReference } from '../shared/session-reference';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openShortfalls } from './operations-inbox';
import { api, vnd, type Row } from '../shared/components';
import { Icon, Modal } from '../shared/primitives';
import BillPanel from '../workspace/bill-panel';
export function useUrgentWork() {
  const [issues, setIssues] = useState<Row[]>([]),
    [refunds, setRefunds] = useState<Row[]>([]),
    [outstanding, setOutstanding] = useState<Row[]>([]),
    [paymentCases, setPaymentCases] = useState<PaymentReconciliationCase[]>([]),
    [paymentError, setPaymentError] = useState(''),
    [error, setError] = useState(''),
    [updatedAt, setUpdatedAt] = useState<string>();
  const reads = useRef<AbortController | null>(null);
  const loading = useRef<AbortSignal | null>(null);
  const refresh = useCallback(async () => {
    const signal = reads.current?.signal;
    if (!signal || signal.aborted || loading.current === signal) return;
    loading.current = signal;
    try {
      const [items, alerts, cases] = await Promise.all([
        api<Row[]>('/core/order-exceptions?pending=true', undefined, 'GET', false, signal),
        api<Row[]>('/core/alerts', undefined, 'GET', false, signal),
        api<Row[]>('/core/outstanding', undefined, 'GET', false, signal),
      ]);
      if (!signal.aborted) {
        setIssues([
          ...items,
          ...alerts
            .filter((a) => a.stock_inspection === true)
            .map((a) => ({
              ...a,
              stock_inspection: true,
              product_name_snapshot: a.item_name ?? null,
              quantity: a.item_quantity ?? null,
              reported_at: a.created_at ?? null,
              reported_reason_code: a.issue_reason_code ?? null,
            })),
        ]);
        setOutstanding(openShortfalls(cases));
        setUpdatedAt(new Date().toISOString());
        setRefunds(
          Array.from(
            new Map(
              alerts
                .filter(
                  (a) =>
                    a.alert_type === 'REFUND_REQUIRED' &&
                    BigInt(String(a.refund_due_amount ?? 0)) > 0n,
                )
                .map((a) => [a.session_id, a]),
            ).values(),
          ),
        );
        setError('');
      }
    } catch {
      if (!signal.aborted)
        setError('Chưa tải được danh sách công việc. Chọn Tải lại dữ liệu để thử lại.');
    } finally {
      try {
        if (!signal.aborted) {
          const cases = await api<PaymentReconciliationCase[]>(
            '/core/admin/payment-reconciliation',
            undefined,
            'GET',
            false,
            signal,
          );
          if (!signal.aborted) {
            setPaymentCases(cases.filter((item) => item.status === 'OPEN'));
            setPaymentError('');
          }
        }
      } catch {
        if (!signal.aborted)
          setPaymentError('Chưa cập nhật được ngoại lệ thanh toán. Dữ liệu gần nhất được giữ lại.');
      } finally {
        if (loading.current === signal) loading.current = null;
      }
    }
  }, []);
  useEffect(() => {
    reads.current = new AbortController();
    const tick = () => {
      if (!document.hidden) void refresh();
    };
    const stopReads = () => reads.current?.abort();
    const resumeReads = () => {
      if (reads.current?.signal.aborted) reads.current = new AbortController();
      tick();
    };
    void refresh();
    const timer = setInterval(tick, 3000);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    // Full navigation does not unmount React before the browser tears down its fetches.
    window.addEventListener('pagehide', stopReads);
    window.addEventListener('pageshow', resumeReads);
    return () => {
      stopReads();
      reads.current = null;
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('pagehide', stopReads);
      window.removeEventListener('pageshow', resumeReads);
    };
  }, [refresh]);
  return {
    issues,
    refunds: refundsOutsidePaymentCases(refunds, paymentCases),
    outstanding,
    paymentCases,
    paymentError,
    error,
    updatedAt,
    refresh,
  };
}
export function UrgentBar({
  issues,
  refunds,
  outstanding,
  error,
  open,
  openReports,
  updatedAt,
  paymentCases = [],
  paymentError,
  openPayments,
}: {
  issues: Row[];
  refunds: Row[];
  outstanding: Row[];
  openReports: () => void;
  error: string;
  open: () => void;
  updatedAt?: string;
  paymentCases?: PaymentReconciliationCase[];
  paymentError?: string;
  openPayments?: () => void;
}) {
  return (
    <div
      className={
        'urgent-bar' +
        (issues.length || refunds.length || outstanding.length || paymentCases.length
          ? ' has-urgent'
          : '')
      }
    >
      <button onClick={open} className="urgent-entry">
        <Icon name="bell" size={20} />
        <span>
          <strong>
            {updatedAt
              ? `Việc cần xử lý - ${issues.length + refunds.length + outstanding.length + paymentCases.length}`
              : 'Đang kiểm tra việc cần xử lý…'}
          </strong>
          <small>
            {issues.length || refunds.length || outstanding.length || paymentCases.length
              ? `${issues.length} món / kho cần xử lý - ${refunds.length} bàn cần hoàn tiền - ${outstanding.length} hồ sơ thiếu tiền${paymentCases.length ? ` - ${paymentCases.length} ngoại lệ thanh toán` : ''}`
              : 'Không có công việc đang chờ xử lý.'}
          </small>
        </span>
        <Icon name="arrow" size={18} />
      </button>
      {outstanding.length > 0 && (
        <button className="urgent-outstanding" onClick={openReports}>
          <Icon name="warning" size={18} />
          <strong>{outstanding.length} hồ sơ thiếu tiền cần xử lý</strong>
          <Icon name="arrow" size={16} />
        </button>
      )}
      {paymentCases.length > 0 && openPayments && (
        <button className={styles.urgentLink} onClick={openPayments}>
          <Icon name="warning" size={18} />
          <strong>{paymentCases.length} ngoại lệ thanh toán cần kiểm tra</strong>
          <Icon name="arrow" size={16} />
        </button>
      )}
      {paymentError && <small role="status">{paymentError}</small>}
      {error && <small role="status">{error}</small>}
    </div>
  );
}
export function RefundWork({ rows, done }: { rows: Row[]; done: () => Promise<void> }) {
  const [selected, setSelected] = useState('');
  const sessions = Array.from(new Map(rows.map((row) => [String(row.session_id), row])).values());
  return (
    <section className="refund-work">
      <h2>
        Tiền cần hoàn cho khách <span>- {sessions.length} bàn</span>
      </h2>
      <p>
        Chỉ ghi nhận “đã hoàn” sau khi thực sự trả tiền. Miễn tiền món chưa phải là trả lại tiền cho
        khách.
      </p>
      {sessions.map((row) => (
        <article className="task-card" key={row.id}>
          <div>
            <strong>
              Bàn {String(row.table_code)}
              <SessionReference id={row.session_id} code={row.session_code} />
            </strong>
            <p>Cần hoàn {vnd(row.refund_due_amount)}</p>
          </div>
          <button className="primary-button" onClick={() => setSelected(String(row.session_id))}>
            Mở hoàn tiền tại bàn
          </button>
        </article>
      ))}
      {selected && (
        <Modal title="Hoàn tiền tại bàn" wide close={() => setSelected('')}>
          <BillPanel
            focusRefund
            financialOnly
            id={selected}
            products={[]}
            onClose={() => setSelected('')}
            done={done}
          />
        </Modal>
      )}
    </section>
  );
}
