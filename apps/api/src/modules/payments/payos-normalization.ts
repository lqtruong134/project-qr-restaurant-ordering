import type { PaymentLink } from '@payos/node';

// Normalize optional recipient fields only after the SDK has verified the signed response.
// Account identifiers remain strings: converting them to numbers would lose leading zeroes.
type Recipient = { accountNumber?: unknown; virtualAccountNumber?: unknown };
function account(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && !['null', 'undefined'].includes(normalized) ? normalized : null;
}
function recipients(value: Recipient) {
  return [account(value.accountNumber), account(value.virtualAccountNumber)].filter(
    (entry): entry is string => entry !== null,
  );
}
export function recipientMatches(expected: string, value: Recipient) {
  const normalized = account(expected);
  return normalized !== null && recipients(value).includes(normalized);
}
export function sameRecipient(left: Recipient, right: Recipient) {
  const rightAccounts = recipients(right);
  return recipients(left).some((entry) => rightAccounts.includes(entry));
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
