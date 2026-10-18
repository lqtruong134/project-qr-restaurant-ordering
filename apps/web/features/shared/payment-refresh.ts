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

export type OnlineIntentFunds = {
  recorded: bigint;
  applied: bigint;
  refunded: bigint;
  refundable: bigint;
};
/** Sum the source budgets already computed by the server; do not spend unallocated money on other items. */
export function onlineIntentFunds(
  intentId: string,
  payments: Row[],
): OnlineIntentFunds | undefined {
  const rows = payments.filter(
    (payment) => payment.status === 'SUCCEEDED' && payment.payment_intent_id === intentId,
  );
  if (
    !rows.length ||
    rows.some((payment) =>
      ['amount', 'allocated_amount', 'refunded_amount', 'refundable_amount'].some(
        (field) => !/^\d+$/.test(String(payment[field] ?? '')),
      ),
    )
  )
    return undefined;
  return rows.reduce(
    (sum, payment) => ({
      recorded: sum.recorded + BigInt(String(payment.amount)),
      applied: sum.applied + BigInt(String(payment.allocated_amount)),
      refunded: sum.refunded + BigInt(String(payment.refunded_amount)),
      refundable: sum.refundable + BigInt(String(payment.refundable_amount)),
    }),
    { recorded: 0n, applied: 0n, refunded: 0n, refundable: 0n },
  );
}
