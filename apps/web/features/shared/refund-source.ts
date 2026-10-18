import type { Row } from './components';

/** The API budget already excludes active allocations, completed refunds and pending documents. */
export function refundableSources(payments: Row[]) {
  return payments
    .filter((payment) => payment.status === 'SUCCEEDED')
    .map((payment) => {
      const value = String(payment.available_refund_amount ?? '');
      return { payment, available: /^\d+$/.test(value) ? BigInt(value) : 0n };
    })
    .filter((source) => source.available > 0n);
}

/** A payment excess must not inherit an unrelated item-cancellation reason from the table. */
export function refundReasonForSource(payment: Row, decisionReason?: string) {
  const useDecisionReason =
    payment.refund_context_kind === 'BILL_ADJUSTMENT' && Boolean(decisionReason);
  return {
    useDecisionReason,
    reason: useDecisionReason
      ? decisionReason!
      : payment.refund_context_kind === 'UNAPPLIED_PAYMENT'
        ? 'Hoàn phần khách chuyển dư/chưa phân bổ vào tiền món'
        : 'Hoàn tiền chuyển dư hoặc tiền món được điều chỉnh',
  };
}
