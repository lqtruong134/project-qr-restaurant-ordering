import type { PaymentLink } from '@payos/node';

// Normalize optional recipient fields only after the SDK has verified the signed response.
// Account identifiers remain strings: converting them to numbers would lose leading zeroes.
export type PayosRecipient = { accountNumber?: unknown; virtualAccountNumber?: unknown };
export function normalizePayosAccount(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && !['null', 'undefined'].includes(normalized) ? normalized : null;
}
function recipients(value: PayosRecipient) {
  return [
    normalizePayosAccount(value.accountNumber),
    normalizePayosAccount(value.virtualAccountNumber),
  ].filter((entry): entry is string => entry !== null);
}
export function recipientMatches(expected: string, value: PayosRecipient) {
  const normalized = normalizePayosAccount(expected);
  const virtual = normalizePayosAccount(value.virtualAccountNumber);
  // An explicit order-specific VA is stronger than a shared merchant account.
  // Never accept a different VA merely because the primary accounts happen to match.
  return (
    normalized !== null &&
    (virtual !== null
      ? virtual === normalized
      : normalizePayosAccount(value.accountNumber) === normalized)
  );
}
export function sameRecipient(left: PayosRecipient, right: PayosRecipient) {
  const leftVirtual = normalizePayosAccount(left.virtualAccountNumber);
  const rightVirtual = normalizePayosAccount(right.virtualAccountNumber);
  if (leftVirtual !== null && rightVirtual !== null) return leftVirtual === rightVirtual;
  const rightAccounts = recipients(right);
  return recipients(left).some((entry) => rightAccounts.includes(entry));
}
/** Both inputs must already be signature-verified and tied to the same exact
 * order/link/reference/amount/currency by the caller. A webhook may carry the VA
 * omitted by a GET transaction, while both identify the same primary account.
 * A conflicting explicit VA can never be repaired by another message.
 */
export function recipientMatchesWithEvidence(
  expected: string,
  bank: PayosRecipient,
  corroboration?: PayosRecipient,
) {
  if (
    corroboration &&
    normalizePayosAccount(corroboration.virtualAccountNumber) !== null &&
    !recipientMatches(expected, corroboration)
  )
    return false;
  if (recipientMatches(expected, bank)) return !corroboration || sameRecipient(bank, corroboration);
  if (normalizePayosAccount(bank.virtualAccountNumber) !== null || !corroboration) return false;
  const primary = normalizePayosAccount(bank.accountNumber);
  return (
    primary !== null &&
    primary === normalizePayosAccount(corroboration.accountNumber) &&
    recipientMatches(expected, corroboration)
  );
}
export function normalizePayosLink(link: PaymentLink): PaymentLink {
  // The provider documents an empty object for an unpaid transaction list. Do not
  // infer transactions or accept malformed lists once any money has been received.
  const transactions: unknown = link.transactions;
  if (
    link.amountPaid === 0 &&
    transactions !== null &&
    typeof transactions === 'object' &&
    !Array.isArray(transactions) &&
    Object.keys(transactions).length === 0
  )
    return { ...link, transactions: [] };
  return link;
}
export function payosErrorCategory(error: unknown) {
  if (error instanceof Error) {
    if (['TimeoutError', 'APIConnectionTimeoutError', 'AbortError'].includes(error.name))
      return 'TIMEOUT';
    if (error.name === 'InvalidSignatureError' || error.message === 'PAYOS_INVALID_RESPONSE')
      return 'INVALID_RESPONSE';
  }
  if (error && typeof error === 'object' && 'status' in error) {
    if (error.status === 429) return 'RATE_LIMITED';
    if (error.status === 401 || error.status === 403) return 'PROVIDER_AUTH';
  }
  return 'UNAVAILABLE';
}
