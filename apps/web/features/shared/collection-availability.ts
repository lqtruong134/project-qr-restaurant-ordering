import type { CollectionAvailability } from '@thesis/contracts';
import type { Row } from './components';

/** Current responses are server-computed. The fallback only keeps older stored/read fixtures usable. */
export function collectionAmounts(
  account: Row,
  charges: Row[],
  participantId: string,
  availability?: CollectionAvailability,
) {
  const nonnegative = (value: unknown) => {
    const amount = BigInt(String(value ?? 0));
    return amount > 0n ? amount : 0n;
  };
  const outstanding = nonnegative(availability?.outstandingAmount ?? account.outstanding_amount);
  const reserved = nonnegative(availability?.reservedAmount ?? account.reserved_payment_amount);
  const available = availability
    ? nonnegative(availability.availableAmount)
    : outstanding > reserved
      ? outstanding - reserved
      : 0n;
  const own = availability?.participants.find((p) => p.participantId === participantId);
  const ownOutstanding = own
    ? nonnegative(own.outstandingAmount)
    : charges
        .filter((c) => c.status === 'ACTIVE' && c.owner_participant_id === participantId)
        .reduce((sum, c) => sum + nonnegative(c.unpaid_amount), 0n);
  const ownAvailable = own
    ? nonnegative(own.availableAmount)
    : ownOutstanding < available
      ? ownOutstanding
      : available;
  return {
    outstanding,
    reserved,
    available,
    ownOutstanding,
    ownAvailable,
    blockedReason: availability?.blockedReason ?? null,
  };
}
