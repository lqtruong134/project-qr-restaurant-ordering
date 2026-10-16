import type { BillingLine, BillingSummary, DiscountProgram, VatTreatment } from '@thesis/contracts';

// Every rounding operation is in integer VND. A deterministic largest remainder
// distributes the last đồng; discounts and VAT always reconcile to the bill.
export function allocateMoney(total: bigint, lines: { id: string; amount: bigint }[]) {
  const sum = lines.reduce((n, line) => n + line.amount, 0n);
  if (total < 0n || total > sum || lines.some((line) => line.amount < 0n))
    throw new Error('Invalid money allocation');
  if (sum === 0n) return new Map(lines.map((line) => [line.id, 0n]));
  const parts = lines.map((line) => ({
    id: line.id,
    value: (total * line.amount) / sum,
    remainder: (total * line.amount) % sum,
  }));
  let left = total - parts.reduce((n, part) => n + part.value, 0n);
  for (const part of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (left === 0n) break;
    part.value++;
    left--;
  }
  return new Map(parts.map((part) => [part.id, part.value]));
}

export function promotionDiscount(
  program: Pick<DiscountProgram, 'type' | 'percent' | 'fixedAmount' | 'maxDiscountAmount'>,
  eligible: bigint,
) {
  let discount =
    program.type === 'PERCENT'
      ? (eligible * BigInt(program.percent ?? 0)) / 100n
      : BigInt(program.fixedAmount ?? 0);
  if (program.maxDiscountAmount !== null)
    discount =
      discount < BigInt(program.maxDiscountAmount) ? discount : BigInt(program.maxDiscountAmount);
  return discount < eligible ? discount : eligible;
}

export function inclusiveVat(total: bigint, percent: number) {
  if (![0, 5, 8, 10].includes(percent) || total < 0n) throw new Error('Invalid VAT');
  const denominator = BigInt(100 + percent);
  return (total * BigInt(percent) + denominator / 2n) / denominator;
}

export type ChargeBillingRow = {
  id: string;
  order_item_id?: string | null;
  amount: string;
  discount_amount?: string;
  tax_amount?: string | null;
  tax_snapshot?: { treatment: 'TAXABLE' | 'EXEMPT'; ratePercent: number | null } | null;
  promotion_snapshot?: { id: string } | null;
};

export function summarizeBilling(
  rows: ChargeBillingRow[],
  promotion: BillingSummary['promotion'] = null,
): BillingSummary {
  const lines: BillingLine[] = rows.map((row) => {
    const payable = BigInt(row.amount) - BigInt(row.discount_amount ?? '0');
    const vat = BigInt(row.tax_amount ?? '0');
    return {
      chargeId: row.id,
      orderItemId: row.order_item_id ?? null,
      grossAmount: row.amount,
      discountAmount: row.discount_amount ?? '0',
      payableAmount: payable.toString(),
      beforeVatAmount: (payable - vat).toString(),
      vatAmount: vat.toString(),
      taxTreatment: row.tax_snapshot?.treatment ?? 'LEGACY',
      vatRatePercent: row.tax_snapshot?.ratePercent ?? null,
      promotionId: row.promotion_snapshot?.id ?? null,
    };
  });
  const sum = (
    field: 'grossAmount' | 'discountAmount' | 'payableAmount' | 'beforeVatAmount' | 'vatAmount',
  ) => lines.reduce((total, line) => total + BigInt(line[field]), 0n).toString();
  const groups = new Map<
    string,
    {
      treatment: VatTreatment;
      ratePercent: number | null;
      beforeVatAmount: bigint;
      vatAmount: bigint;
      totalAmount: bigint;
    }
  >();
  for (const line of lines) {
    const key = line.taxTreatment + ':' + line.vatRatePercent;
    const group = groups.get(key) ?? {
      treatment: line.taxTreatment,
      ratePercent: line.vatRatePercent,
      beforeVatAmount: 0n,
      vatAmount: 0n,
      totalAmount: 0n,
    };
    group.beforeVatAmount += BigInt(line.beforeVatAmount);
    group.vatAmount += BigInt(line.vatAmount);
    group.totalAmount += BigInt(line.payableAmount);
    groups.set(key, group);
  }
  return {
    version: 1,
    priceIncludesVat: true,
    subtotalAmount: sum('grossAmount'),
    discountAmount: sum('discountAmount'),
    payableAmount: sum('payableAmount'),
    beforeVatAmount: sum('beforeVatAmount'),
    vatAmount: sum('vatAmount'),
    vatGroups: [...groups.values()].map((group) => ({
      ...group,
      beforeVatAmount: group.beforeVatAmount.toString(),
      vatAmount: group.vatAmount.toString(),
      totalAmount: group.totalAmount.toString(),
    })),
    promotion,
    lines,
    legacyTaxUnavailable: lines.some((line) => line.taxTreatment === 'LEGACY'),
  };
}

export function allocateDiscount(total: bigint, lines: { id: string; amount: bigint }[]) {
  const sum = lines.reduce((n, line) => n + line.amount, 0n);
  const capacity = lines.reduce((n, line) => n + line.amount / 2n, 0n);
  if (total < 0n || total > capacity) throw new Error('Discount exceeds 50% per line');
  if (sum === 0n) return new Map(lines.map((line) => [line.id, 0n]));
  const parts = lines.map((line) => ({
    id: line.id,
    cap: line.amount / 2n,
    value: (total * line.amount) / sum,
    remainder: (total * line.amount) % sum,
  }));
  let left = total - parts.reduce((n, part) => n + part.value, 0n);
  for (const part of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (left === 0n) break;
    if (part.value < part.cap) {
      part.value++;
      left--;
    }
  }
  if (left !== 0n) throw new Error('Discount allocation cannot reconcile');
  return new Map(parts.map((part) => [part.id, part.value]));
}
