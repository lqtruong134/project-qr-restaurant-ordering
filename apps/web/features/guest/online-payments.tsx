import type { GuestOnlinePayment } from '@thesis/contracts';
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
              {(payment.appliedAmount === undefined ||
                BigInt(payment.paidAmount) !== BigInt(payment.appliedAmount) ||
                BigInt(payment.refundedAmount ?? '0') > 0n) && (
                <p>
                  Nhà hàng đã nhận<strong>{vnd(payment.paidAmount)}</strong>
                </p>
              )}
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
              {['PENDING', 'UNDERPAID'].includes(payment.status) &&
                BigInt(payment.bankConfirmedAmount) <= BigInt(payment.paidAmount) && (
                  <p>
                    Còn thiếu cho khoản thu này<strong>{vnd(payment.remainingAmount)}</strong>
                  </p>
                )}
            </div>
            {BigInt(payment.bankConfirmedAmount) > BigInt(payment.paidAmount) && (
              <p role="status">
                Ngân hàng đã ghi nhận giao dịch {vnd(payment.bankConfirmedAmount)}; nhà hàng đang
                đối chiếu. Phần này chưa được tính là đã thanh toán; vui lòng không chuyển lại cùng
                khoản tiền.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
