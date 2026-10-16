import { vnd, type Row } from './components';
import { paymentFlowSummary } from './payment-summary';

export function PaymentBreakdown({
  account,
  payments = [],
  compact = false,
}: {
  account: Row;
  payments?: Row[];
  compact?: boolean;
}) {
  const flow = paymentFlowSummary(account, payments);
  const facts: [string, bigint][] = [
    ...(flow.hasCash && !flow.incomplete
      ? [['Tiền mặt khách đưa', flow.cashTendered] as [string, bigint]]
      : []),
    ...(flow.bankReceived > 0n
      ? [['Đã nhận qua chuyển khoản', flow.bankReceived] as [string, bigint]]
      : []),
    ...(flow.onlineReceived > 0n
      ? [['Đã thanh toán trực tuyến', flow.onlineReceived] as [string, bigint]]
      : []),
    ...(flow.otherReceived > 0n
      ? [['Đã nhận qua phương thức khác', flow.otherReceived] as [string, bigint]]
      : []),
    ...(flow.hasCash && !flow.incomplete
      ? [['Tiền thối đã trả', flow.changeReturned] as [string, bigint]]
      : []),
    ...(flow.changePending > 0n
      ? [['Tiền thối chưa trả', flow.changePending] as [string, bigint]]
      : []),
    ...(flow.changeUnconfirmed > 0n
      ? [['Tiền thối chưa có xác nhận', flow.changeUnconfirmed] as [string, bigint]]
      : []),
    ...(!compact
      ? [['Đã thu cho hóa đơn (trước hoàn)', flow.collectedTotal] as [string, bigint]]
      : []),
    ...(flow.refundedTotal > 0n
      ? [['Đã hoàn tiền món', flow.refundedTotal] as [string, bigint]]
      : []),
    ...(!compact ? [['Đã thanh toán (sau hoàn)', flow.netPaid] as [string, bigint]] : []),
    ...(flow.customerRetained !== null
      ? [['Nhà hàng còn giữ', flow.customerRetained] as [string, bigint]]
      : []),
  ];
  return (
    <div className="payment-flow-breakdown">
      <dl className="payment-flow-facts">
        {facts.map(([label, amount]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{vnd(amount)}</dd>
          </div>
        ))}
      </dl>
      {!compact && (
        <p className="small-note">
          Tiền thối là phần dư khi khách đưa tiền mặt. Tiền hoàn là khoản trả lại do hủy hoặc điều
          chỉnh món.
        </p>
      )}
      {!compact &&
        flow.customerGiven !== null &&
        flow.customerRetained !== null &&
        flow.hasCash && (
          <p className="payment-flow-equation">
            {vnd(flow.customerGiven)} {flow.nonCashReceived > 0n ? 'khách đã trả' : 'khách đưa'} −{' '}
            {vnd(flow.changeReturned)} đã thối − {vnd(flow.refundedTotal)} hoàn tiền món ={' '}
            <strong>{vnd(flow.customerRetained)} còn giữ.</strong>
          </p>
        )}
      {flow.changePending > 0n && (
        <p className="small-note">
          Số tiền nhà hàng còn giữ gồm {vnd(flow.changePending)} tiền thối chưa trả.
        </p>
      )}
      {(flow.incomplete || flow.changeUnconfirmed > 0n) && (
        <p className="small-note">
          Chưa đủ thông tin tiền khách đưa hoặc xác nhận thối tiền để đối chiếu.
        </p>
      )}
    </div>
  );
}
