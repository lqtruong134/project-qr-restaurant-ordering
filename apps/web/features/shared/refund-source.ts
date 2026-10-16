import type { Row } from './components';

export function refundableSources(payments: Row[], refunds: Row[]) {
  return payments
    .filter((payment) => payment.status === 'SUCCEEDED')
    .map((payment) => {
      const committed = refunds
        .filter(
          (refund) =>
            refund.source_payment_transaction_id === payment.id && refund.status !== 'CANCELLED',
        )
        .reduce((total, refund) => total + BigInt(String(refund.amount)), 0n);
      const available = BigInt(String(payment.amount)) - committed;
      return { payment, available: available > 0n ? available : 0n };
    })
    .filter((source) => source.available > 0n);
}
