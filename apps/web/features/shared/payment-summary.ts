export type PaymentAccount = {
  [key: string]: unknown;
  charge_total?: unknown;
  paid_total?: unknown;
  refunded_total?: unknown;
  outstanding_amount?: unknown;
  refund_due_amount?: unknown;
};

/** Successful invoice collections exclude cash tender and change; only actual refunds reduce them. */
export function paymentSummary(account: PaymentAccount | null | undefined) {
  const billTotal = BigInt(String(account?.charge_total ?? 0));
  const collectedTotal = BigInt(String(account?.paid_total ?? 0));
  const refundedTotal = BigInt(String(account?.refunded_total ?? 0));
  return {
    billTotal,
    collectedTotal,
    refundedTotal,
    netPaid: collectedTotal - refundedTotal,
    outstanding: BigInt(String(account?.outstanding_amount ?? 0)),
    refundDue: BigInt(String(account?.refund_due_amount ?? 0)),
  };
}

type PaymentTransaction = { [key: string]: unknown };

function recordedMoney(value: unknown): bigint | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const text = String(value);
  return /^\d+$/.test(text) ? BigInt(text) : undefined;
}

/** Cash handed over and change are separate from invoice credits and cancellation refunds. */
export function paymentFlowSummary(
  account: PaymentAccount | null | undefined,
  payments: readonly PaymentTransaction[] = [],
) {
  const totals = paymentSummary(account);
  let cashTendered = 0n;
  let nonCashReceived = 0n;
  let bankReceived = 0n;
  let onlineReceived = 0n;
  let otherReceived = 0n;
  let changeReturned = 0n;
  let changePending = 0n;
  let changeUnconfirmed = 0n;
  let ledgerCollected = 0n;
  let hasCash = false;
  let missingCashDetails = false;
  for (const payment of payments) {
    if (payment.status !== 'SUCCEEDED') continue;
    const amount = recordedMoney(payment.amount);
    if (amount === undefined) continue;
    ledgerCollected += amount;
    if (payment.method !== 'CASH') {
      nonCashReceived += amount;
      if (payment.method === 'BANK_TRANSFER') bankReceived += amount;
      else if (payment.method === 'ONLINE') onlineReceived += amount;
      else otherReceived += amount;
      continue;
    }
    hasCash = true;
    const metadata =
      payment.metadata && typeof payment.metadata === 'object'
        ? (payment.metadata as Record<string, unknown>)
        : {};
    const received = recordedMoney(payment.cash_received_amount ?? metadata.cashReceived);
    const change = recordedMoney(payment.change_amount ?? metadata.changeGiven);
    if (received === undefined || change === undefined || received - change !== amount) {
      missingCashDetails = true;
      continue;
    }
    cashTendered += received;
    if (payment.change_returned_at) changeReturned += change;
    else if (metadata.cashHandlingVersion === 1) changePending += change;
    else changeUnconfirmed += change;
  }
  const complete = !missingCashDetails && ledgerCollected === totals.collectedTotal;
  const customerGiven = complete ? cashTendered + nonCashReceived : null;
  const customerRetained =
    customerGiven !== null && changeUnconfirmed === 0n
      ? customerGiven - changeReturned - totals.refundedTotal
      : null;
  return {
    ...totals,
    hasCash,
    cashTendered,
    nonCashReceived,
    bankReceived,
    onlineReceived,
    otherReceived,
    changeReturned,
    changePending,
    changeUnconfirmed,
    incomplete: !complete,
    customerGiven,
    customerRetained,
  };
}
