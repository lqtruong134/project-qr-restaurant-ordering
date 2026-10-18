'use client';
import type {
  BillingSummary,
  DiscountOffer,
  GuestOnlinePayment,
  MenuPromotion,
} from '@thesis/contracts';
import { SupportRetry } from './support-retry';
import { useState } from 'react';
import { api, type Product, type Row } from '../shared/components';
import { Empty } from '../shared/primitives';
import { isOnlinePaymentPending } from '../shared/online-payment';
import type { PaymentStatus } from './payment-status';
export type GuestParticipant = { id: string; display_name: string | null; joined_at?: string };
export type GuestState = {
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
  done,
  available,
  paymentStatus,
  requests = [],
  onlinePayments = [],
}: {
  done: () => Promise<void>;
  available: string;
  paymentStatus: PaymentStatus;
  requests?: Row[];
  onlinePayments?: GuestOnlinePayment[];
}) {
  const [method, setMethod] = useState('CASH'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = requests.find(
    (r) =>
      r.request_type === 'BILL' &&
      r.payment_method &&
      ['NEW', 'ACKNOWLEDGED'].includes(String(r.status)),
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
        <strong>Bạn đã báo nhân viên hỗ trợ thanh toán</strong>
        <p role="status">
          {pending.status === 'ACKNOWLEDGED'
            ? 'Nhân viên đã tiếp nhận yêu cầu. Vui lòng chờ tại bàn để được hỗ trợ thanh toán.'
            : 'Yêu cầu đã được gửi. Nhân viên sẽ đến bàn hỗ trợ bạn thanh toán.'}
        </p>
        <span>
          {pending.payment_method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'} -{' '}
          {pending.status === 'ACKNOWLEDGED' ? 'Nhân viên đang xử lý' : 'Đang chờ nhân viên'}
        </span>
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
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await api<Row>('/guest/payment-requests', { method }, 'POST', true);
          await done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Bạn muốn thanh toán bằng cách nào?</h3>
      <div className="amount-choices" role="group" aria-label="Hình thức thanh toán">
        {[
          ['CASH', 'Tiền mặt', 'Nhân viên đến bàn thu tiền'],
          ['BANK_TRANSFER', 'Chuyển khoản', 'Nhân viên hướng dẫn chuyển khoản'],
        ].map(([m, label, hint]) => (
          <button
            type="button"
            key={m}
            aria-label={label}
            aria-pressed={method === m}
            disabled={busy}
            onClick={() => setMethod(m!)}
          >
            <strong>{label}</strong>
            <span>{hint}</span>
          </button>
        ))}
      </div>
      <p>
        Bạn có thể trả cho cả bàn hoặc riêng món của mình. Hãy cho nhân viên biết phần bạn muốn
        thanh toán.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? 'Đang báo nhân viên…' : 'Báo nhân viên thu tiền'}
      </button>
    </form>
  );
}
