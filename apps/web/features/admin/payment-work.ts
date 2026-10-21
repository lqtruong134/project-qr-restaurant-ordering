import type { PaymentReconciliationCase } from '@thesis/contracts';
import type { Row } from '../shared/components';

/** Only deduplicates work links. It never changes balances or the original alerts. */
export function refundsOutsidePaymentCases(refunds: Row[], cases: PaymentReconciliationCase[]) {
  const covered = new Map<string, bigint>();
  for (const item of cases) {
    if (item.status !== 'OPEN' || !/^\d+$/.test(item.unapplied_amount ?? '')) continue;
    covered.set(
      item.session_id,
      (covered.get(item.session_id) ?? 0n) + BigInt(item.unapplied_amount!),
    );
  }
  return refunds.filter((refund) => {
    const amount = String(refund.refund_due_amount ?? '');
    return (
      !/^\d+$/.test(amount) ||
      BigInt(amount) === 0n ||
      (covered.get(String(refund.session_id)) ?? 0n) < BigInt(amount)
    );
  });
}
