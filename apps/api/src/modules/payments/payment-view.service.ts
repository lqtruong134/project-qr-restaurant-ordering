const moneyValue = (value: unknown) =>
  typeof value === 'string' && /^\d+$/.test(value) ? value : null;

// Cash handed over and change are separate from the amount credited to the bill.
// A recorded change amount is not proof it was handed back: that needs the audit timestamp.
export function withCashPaymentFields<T extends Record<string, unknown>>(payment: T) {
  const metadata =
    payment.metadata && typeof payment.metadata === 'object'
      ? (payment.metadata as Record<string, unknown>)
      : {};
  const cash = payment.method === 'CASH';
  return {
    ...payment,
    cash_received_amount: cash
      ? moneyValue(payment.cash_received_amount ?? metadata.cashReceived)
      : null,
    change_amount: cash ? moneyValue(payment.change_amount ?? metadata.changeGiven) : null,
    change_returned_at: payment.change_returned_at ?? null,
  };
}
