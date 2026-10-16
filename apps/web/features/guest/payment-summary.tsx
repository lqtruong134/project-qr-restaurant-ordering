import type { BillingSummary } from '@thesis/contracts';
import { BillingTotals } from '../shared/billing-totals';
import { vnd, type Row } from '../shared/components';
import { paymentFlowSummary } from '../shared/payment-summary';
import { PaymentBreakdown } from '../shared/payment-breakdown';

export function GuestPaymentSummary({
  account,
  billing,
  requests = [],
  payments = [],
}: {
  account: Row;
  billing?: BillingSummary;
  requests?: Row[];
  payments?: Row[];
}) {
  const totals = paymentFlowSummary(account, payments);
  const pending = requests.filter(
    (request) => request.payment_method && ['NEW', 'ACKNOWLEDGED'].includes(String(request.status)),
  );
  return (
    <>
      <BillingTotals billing={billing} account={account} />
      <div className="core-stats">
        <p>
          Đã thanh toán (sau hoàn)<strong>{vnd(totals.netPaid)}</strong>
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
              : 'Chưa yêu cầu'}
          </strong>
        </p>
      </div>
      {totals.refundedTotal > 0n && <p className="small-note">Đã trừ tiền hoàn món.</p>}
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
