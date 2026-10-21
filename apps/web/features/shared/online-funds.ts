import type { OnlinePaymentView } from '@thesis/contracts';

export type OnlineIntentFunds = {
  recorded: bigint;
  applied: bigint;
  refunded: bigint;
  refundable: bigint;
};
/** New live responses carry these verified bookkeeping amounts directly; older receipts use source rows. */
export function onlineViewFunds(
  online: OnlinePaymentView | null | undefined,
): OnlineIntentFunds | undefined {
  if (!online) return undefined;
  const fields = [
    online.recordedAmount,
    online.appliedAmount,
    online.refundedAmount,
    online.unallocatedAmount,
  ];
  if (fields.some((value) => !/^\d+$/.test(String(value ?? '')))) return undefined;
  return {
    recorded: BigInt(online.recordedAmount!),
    applied: BigInt(online.appliedAmount!),
    refunded: BigInt(online.refundedAmount!),
    refundable: BigInt(online.unallocatedAmount!),
  };
}
