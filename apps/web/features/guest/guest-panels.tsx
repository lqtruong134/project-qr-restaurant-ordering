'use client';
import type {
  GuestPaymentAssistanceRequest,
  BillingSummary,
  CollectionAvailability,
  PaymentFinancialSummary,
  DiscountOffer,
  GuestOnlinePayment,
  MenuPromotion,
} from '@thesis/contracts';
import { SupportRetry } from './support-retry';
import { useRef, useState } from 'react';
import { api, type Product, type Row } from '../shared/components';
import { Empty } from '../shared/primitives';
import { isOnlinePaymentPending } from '../shared/online-payment';
import type { PaymentStatus } from './payment-status';
export type GuestParticipant = { id: string; display_name: string | null; joined_at?: string };
export type GuestState = {
  financialSummary?: PaymentFinancialSummary;
  collectionAvailability?: CollectionAvailability;
  participant: { id: string; displayName: string };
  participants?: GuestParticipant[];
  session: Row;
  cart: { cart_version: number };
  items: (Row & {
    quantity: number;
    unit_price_preview: string;
    owner_participant_id: string;
    name: string;
  })[];
  products: Product[];
  promotions?: MenuPromotion[];
  orders: Row[];
  account: Row;
  billing?: BillingSummary;
  discountPrograms?: DiscountOffer[];
  support?: Row[];
  refundTransactions?: Row[];
  payments?: Row[];
  onlinePayments?: GuestOnlinePayment[];
};
export function PaymentForm({
  participantId,
  done,
  available,
  paymentStatus,
  requests = [],
  onlinePayments = [],
}: {
  participantId: string;
  done: () => Promise<void>;
  available: string;
  paymentStatus: PaymentStatus;
  requests?: Row[];
  onlinePayments?: GuestOnlinePayment[];
}) {
  const submission = useRef<string | null>(null),
    sending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = requests.find(
    (r) => r.request_type === 'BILL' && ['NEW', 'ACKNOWLEDGED'].includes(String(r.status)),
  );
  // A server-settled balance takes precedence over an old support request.
  if (BigInt(available) <= 0n)
    return (
      <Empty title={paymentStatus.title} icon="receipt">
        {paymentStatus.detail}
      </Empty>
    );
  if (onlinePayments.some((payment) => isOnlinePaymentPending(payment.status)))
    return (
      <p className="small-note" role="status">
        Khoản online đang được theo dõi tự động ở phía trên. Bạn không cần gửi lại yêu cầu hoặc
        chuyển lại khi chưa rõ kết quả.
      </p>
    );
  if (pending)
    return (
      <div className="guest-payment-sent">
        <strong>Đã gọi nhân viên thanh toán</strong>
        <p role="status">
          {pending.status === 'ACKNOWLEDGED'
            ? 'Nhân viên đã tiếp nhận, vui lòng chờ tại bàn.'
            : 'Nhân viên sẽ đến bàn hỗ trợ bạn.'}
        </p>
        <SupportRetry request={pending} done={done} />
      </div>
    );
  return (
    <form
      className="guest-payment-request"
      aria-busy={busy}
      aria-label="Yêu cầu thanh toán"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending.current) return;
        sending.current = true;
        setBusy(true);
        setError('');
        try {
          const storageKey = 'payment-assistance:' + participantId;
          if (!submission.current) {
            try {
              submission.current = sessionStorage.getItem(storageKey);
            } catch {
              /* Storage may be unavailable. */
            }
            submission.current ??= crypto.randomUUID();
          }
          try {
            sessionStorage.setItem(storageKey, submission.current);
          } catch {
            /* Keep in memory. */
          }
          const body: GuestPaymentAssistanceRequest = { requestId: submission.current };
          await api<Row>('/guest/payment-requests', body, 'POST', true);
          await done();
          submission.current = null;
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* Storage may be unavailable. */
          }
        } catch (e) {
          setError((e as Error).message);
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      <h3>Thanh toán với nhân viên</h3>
      <p>Nhân viên sẽ đến bàn hỗ trợ. Bạn có thể trả cả bàn hoặc phần của mình.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? 'Đang báo nhân viên…' : 'Gọi nhân viên thanh toán'}
      </button>
    </form>
  );
}
