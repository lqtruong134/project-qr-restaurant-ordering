import { expect, it } from 'vitest';
import {
  allocateDiscount,
  allocateMoney,
  inclusiveVat,
  promotionDiscount,
  summarizeBilling,
} from './billing-math.js';
it('reconciles uneven VND splits and does not depend on input order', () => {
  const rows = [
    { id: 'c', amount: 3n },
    { id: 'a', amount: 1n },
    { id: 'b', amount: 2n },
  ];
  const parts = allocateMoney(2n, rows);
  expect([...parts.values()].reduce((a, b) => a + b, 0n)).toBe(2n);
  expect(Object.fromEntries(parts)).toEqual(
    Object.fromEntries(allocateMoney(2n, [...rows].reverse())),
  );
});
it('never allocates more than 50% discount to an odd or tiny line', () => {
  const rows = [
    { id: 'a', amount: 1n },
    { id: 'b', amount: 3n },
    { id: 'c', amount: 7n },
  ];
  const parts = allocateDiscount(4n, rows);
  for (const row of rows) expect(parts.get(row.id)! * 2n).toBeLessThanOrEqual(row.amount);
  expect([...parts.values()].reduce((a, b) => a + b, 0n)).toBe(4n);
  expect(() => allocateDiscount(5n, rows)).toThrow();
});
it('uses integer VND for percent caps, fixed prices and inclusive VAT after discount', () => {
  expect(
    promotionDiscount(
      { type: 'PERCENT', percent: 10, fixedAmount: null, maxDiscountAmount: '50000' },
      700000n,
    ),
  ).toBe(50000n);
  expect(
    promotionDiscount(
      { type: 'FIXED', percent: null, fixedAmount: '30000', maxDiscountAmount: null },
      300000n,
    ),
  ).toBe(30000n);
  expect(inclusiveVat(44100n, 8)).toBe(3267n);
  expect(44100n - inclusiveVat(44100n, 8)).toBe(40833n);
  expect(inclusiveVat(108000n, 8)).toBe(8000n);
});
it('preserves zero-rated, exempt and unavailable legacy VAT as separate groups', () => {
  const rows = [
    {
      id: 'a',
      amount: '108000',
      discount_amount: '0',
      tax_amount: '8000',
      tax_snapshot: { treatment: 'TAXABLE' as const, ratePercent: 8 },
    },
    {
      id: 'b',
      amount: '10000',
      tax_amount: '0',
      tax_snapshot: { treatment: 'TAXABLE' as const, ratePercent: 0 },
    },
    {
      id: 'c',
      amount: '5000',
      tax_amount: '0',
      tax_snapshot: { treatment: 'EXEMPT' as const, ratePercent: null },
    },
    { id: 'd', amount: '3000' },
  ];
  const bill = summarizeBilling(rows);
  expect(bill.payableAmount).toBe('126000');
  expect(bill.beforeVatAmount).toBe('118000');
  expect(bill.vatAmount).toBe('8000');
  expect(bill.vatGroups).toHaveLength(4);
  expect(bill.legacyTaxUnavailable).toBe(true);
});
