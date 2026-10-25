import type {
  BillingSummary,
  GuestOnlinePayment,
  PaymentFinancialSummary,
} from '@thesis/contracts';
import { BillingTotals } from '../shared/billing-totals';
import { vnd, type Row } from '../shared/components';
import { paymentFlowSummary } from '../shared/payment-summary';
import { PaymentVerification } from '../shared/payment-verification';
import { PaymentBreakdown } from '../shared/payment-breakdown';
import { GuestOnlinePayments } from './online-payments';

export function GuestPaymentSummary({
  account,
  billing,
  requests = [],
  payments = [],
  onlinePayments = [],
  financialSummary,
}: {
  account: Row;
  billing?: BillingSummary;
  requests?: Row[];
  payments?: Row[];
  onlinePayments?: GuestOnlinePayment[];
  financialSummary?: PaymentFinancialSummary;
}) {
  const totals = paymentFlowSummary(account, payments, financialSummary);
  const pending =
    totals.outstanding > 0n
      ? requests.filter(
          (request) =>
            request.request_type === 'BILL' &&
            ['NEW', 'ACKNOWLEDGED'].includes(String(request.status)),
        )
      : [];
  return (
    <>
      <BillingTotals billing={billing} account={account} />
      <div className="core-stats">
        {(totals.unappliedHeld > 0n || totals.refundedTotal > 0n) && (
          <p>
            Đã nhận (trước hoàn)<strong>{vnd(totals.collectedTotal)}</strong>
          </p>
        )}
        {totals.refundDue > 0n && (
          <p>
            Cần hoàn lại khách<strong>{vnd(totals.refundDue)}</strong>
          </p>
        )}
        <p>
          Đã thanh toán<small className="payment-paid-label-note">Đã tính vào tiền món</small>
          <strong>{vnd(totals.appliedTotal)}</strong>
        </p>
        <p>
          Còn phải thanh toán<strong>{vnd(totals.outstanding)}</strong>
        </p>
        <p>
          Nhân viên hỗ trợ
          <strong>
            {pending.length
              ? pending.some((request) => request.status === 'ACKNOWLEDGED')
                ? 'Đã tiếp nhận'
                : 'Đang chờ'
              : totals.outstanding === 0n && totals.netPaid > 0n
                ? 'Thanh toán đã ghi nhận'
                : 'Chưa yêu cầu'}
          </strong>
        </p>
      </div>
      {totals.outstanding > 0n && totals.refundDue > 0n && (
        <p role="status" className="small-note">
          Bàn còn {vnd(totals.outstanding)} tiền món và nhà hàng cần hoàn lại{' '}
          {vnd(totals.refundDue)}. Tiền cần hoàn chưa tự bù vào tiền món còn thiếu; vui lòng trao
          đổi với nhân viên để xử lý riêng hai khoản.
        </p>
      )}
      {financialSummary && BigInt(financialSummary.reservedAmount) > 0n && (
        <p className="payment-reservation-note" role="status">
          Có {vnd(financialSummary.reservedAmount)} đang chờ xác nhận. Khoản chờ chưa phải tiền đã
          thanh toán và chưa làm giảm số còn phải trả.
        </p>
      )}
      <PaymentVerification summary={financialSummary} />
      <GuestOnlinePayments payments={onlinePayments} />
      {totals.refundedTotal > 0n && (
        <p className="small-note">Đã trừ các khoản thực tế hoàn lại khách.</p>
      )}
      {totals.changePending > 0n && (
        <p className="small-note">
          Còn chờ nhận tiền thối: <strong>{vnd(totals.changePending)}</strong>.
        </p>
      )}
      <details>
        <summary>Chi tiết thu và hoàn tiền</summary>
        <PaymentBreakdown account={account} payments={payments} />
      </details>
    </>
  );
}
