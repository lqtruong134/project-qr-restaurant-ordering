import type { BillingSummary } from '@thesis/contracts';

type MoneyRow = { [key: string]: unknown };
export function moneyValue(value: unknown): bigint {
  const text = String(value ?? '0');
  return /^-?\d+$/.test(text) ? BigInt(text) : 0n;
}

/** Read the saved server quote. Never reconstruct tax for receipts predating VAT snapshots. */
export function billingLine(billing: BillingSummary | undefined, row: MoneyRow) {
  return billing?.lines.find(
    (line) =>
      line.chargeId === row.charge_id ||
      line.chargeId === row.id ||
      line.orderItemId === row.item_id ||
      line.orderItemId === row.order_item_id,
  );
}

export function payableItemAmount(row: MoneyRow, billing?: BillingSummary): bigint {
  if (row.charge_status === 'REVERSED' || row.status === 'REVERSED') return 0n;
  if (row.charge_status && row.charge_status !== 'ACTIVE') return 0n;
  const line = billingLine(billing, row);
  return moneyValue(
    line?.payableAmount ?? row.net_amount ?? row.original_amount ?? row.line_total ?? row.amount,
  );
}

export function taxLabel(treatment: string, rate: number | null | undefined) {
  if (treatment === 'EXEMPT') return 'Không chịu VAT';
  if (treatment === 'LEGACY' || rate === null || rate === undefined) return 'Chưa có chi tiết VAT';
  return `VAT ${rate.toLocaleString('vi-VN')}%`;
}

export function pricingFacts(billing: BillingSummary | undefined, account: MoneyRow) {
  return {
    subtotal: moneyValue(billing?.subtotalAmount ?? account.charge_total),
    discount: moneyValue(billing?.discountAmount),
    payable: moneyValue(billing?.payableAmount ?? account.charge_total),
    beforeVat: billing ? moneyValue(billing.beforeVatAmount) : null,
    vat: billing ? moneyValue(billing.vatAmount) : null,
    hasTaxDetails: Boolean(billing && !billing.legacyTaxUnavailable),
  };
}
