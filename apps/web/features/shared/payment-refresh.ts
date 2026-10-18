import type { Row } from './components';
import type { PaymentIntent } from './online-payment';

export function paymentRevision(model: {
  account: Row;
  intents: PaymentIntent[];
  paymentRequests?: Row[];
}) {
  return JSON.stringify([
    [
      'charge_total',
      'paid_total',
      'refunded_total',
      'outstanding_amount',
      'refund_due_amount',
      'reserved_payment_amount',
    ].map((key) => model.account[key]),
    model.intents
      .map((intent) => [
        intent.id,
        intent.status,
        intent.online?.status,
        intent.online?.paidAmount,
        intent.online?.remainingAmount,
      ])
      .sort(),
    (model.paymentRequests ?? [])
      .map((request) => [request.id, request.status, request.acknowledged_by])
      .sort(),
  ]);
}

export function onlineReceivedIncrease(previous: Row[], next: Row[]) {
  const recorded = new Map(
    previous
      .filter((payment) => payment.method === 'ONLINE' && payment.status === 'SUCCEEDED')
      .map((payment) => [payment.id, BigInt(String(payment.amount ?? '0'))]),
  );
  return next.reduce((sum, payment) => {
    if (payment.method !== 'ONLINE' || payment.status !== 'SUCCEEDED') return sum;
    const increase = BigInt(String(payment.amount ?? '0')) - (recorded.get(payment.id) ?? 0n);
    return sum + (increase > 0n ? increase : 0n);
  }, 0n);
}
