import type { GuestOnlinePayment } from '@thesis/contracts';
import { isOnlinePaymentPending } from '../shared/online-payment';
import { vnd } from '../shared/components';
import { guestOnlinePaymentStatus } from './payment-status';

export function GuestOnlinePayments({ payments }: { payments: GuestOnlinePayment[] }) {
  if (!payments.length) return null;
  return (
    <section aria-label="Trạng thái thanh toán online" className="guest-online-payments">
      {payments.slice(0, 5).map((payment) => {
        const status = guestOnlinePaymentStatus(payment);
        return (
          <article
            className={'core-card online-payment-card online-' + status.kind}
            key={payment.id}
          >
            <small>
              {payment.scope === 'TABLE' ? 'Khoản thanh toán của bàn' : 'Khoản thanh toán của bạn'}{' '}
              · payOS
            </small>
            <h3 role="status" aria-live="polite">
              {status.title}
            </h3>
            <p>{status.detail}</p>
            <div className="core-stats">
              <p>
                Số tiền khoản thu<strong>{vnd(payment.amount)}</strong>
              </p>
              <p>
                Đã nhận (ghi nhận giao dịch)<strong>{vnd(payment.paidAmount)}</strong>
              </p>
              {payment.appliedAmount !== undefined && (
                <p>
                  Đã tính vào tiền món<strong>{vnd(payment.appliedAmount)}</strong>
                </p>
              )}
              {BigInt(payment.refundedAmount ?? '0') > 0n && (
                <p>
                  Đã hoàn lại khách<strong>{vnd(payment.refundedAmount)}</strong>
                </p>
              )}
              {BigInt(payment.refundableAmount ?? '0') > 0n && (
                <p>
                  Cần hoàn lại khách<strong>{vnd(payment.refundableAmount)}</strong>
                </p>
              )}
              {isOnlinePaymentPending(payment.status) && (
                <p>
                  Còn thiếu cho khoản thu này<strong>{vnd(payment.remainingAmount)}</strong>
                </p>
              )}
            </div>
            {BigInt(payment.bankConfirmedAmount) > BigInt(payment.paidAmount) && (
              <p role="status">
                Ngân hàng đã xác nhận {vnd(payment.bankConfirmedAmount)}. Nhà hàng đang đối soát
                phần chưa ghi nhận vào thanh toán; bạn chưa cần chuyển lại.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
