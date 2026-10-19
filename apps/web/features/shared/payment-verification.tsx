import type { PaymentFinancialSummary } from '@thesis/contracts';
import { vnd } from './components';

/** Read-only facts from one backend projection. A pending QR never counts as payment. */
export function PaymentVerification({ summary }: { summary?: PaymentFinancialSummary }) {
  if (!summary) return null;
  const facts = [
    ['Ngân hàng báo đã chuyển', summary.bankReportedAmount],
    ['Nhà hàng đã ghi nhận tiền', summary.recordedAmount],
    ['Đã thanh toán cho tiền món', summary.appliedAmount],
    ['Khoản online đang chờ', summary.pendingOnlineAmount],
    ['Phần đang giữ cho khoản thu chờ', summary.reservedAmount],
    ['Tiền dư chưa tính vào món', summary.unallocatedAmount],
    ['Cần hoàn lại khách', summary.refundDueAmount],
    ['Đã hoàn thực tế', summary.refundedAmount],
  ];
  return (
    <details className="payment-verification">
      <summary>Chi tiết tiền chuyển và khoản đang chờ</summary>
      <dl className="payment-flow-facts">
        {facts.map(([label, amount]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{vnd(amount)}</dd>
          </div>
        ))}
      </dl>
      <p className="small-note">
        Tiền ngân hàng báo và khoản đang chờ không tự làm giảm công nợ. Số còn phải trả chỉ giảm sau
        khi nhà hàng xác minh và ghi nhận thanh toán cho tiền món.
      </p>
    </details>
  );
}
