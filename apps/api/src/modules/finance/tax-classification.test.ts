import { expect, it } from 'vitest';
import { resolveVatRate } from './tax-classification.js';
const initial = {
  default_rate_percent: 8,
  effective_at: '2026-10-13T00:00:00+07:00',
  created_by: null,
};
it('expires temporary explicit 8% without changing past snapshots', () => {
  const product = { tax_treatment: 'TAXABLE', vat_rate_percent: 8 };
  const snapshot = resolveVatRate(product, initial, new Date('2026-12-31T23:59:59+07:00'));
  expect(snapshot.ratePercent).toBe(8);
  const next = resolveVatRate(
    product,
    { ...initial, default_rate_percent: 10, effective_at: '2027-01-01T00:00:00+07:00' },
    new Date('2027-01-01T00:00:00+07:00'),
  );
  expect(next.ratePercent).toBe(10);
  expect(next.requestedRatePercent).toBe(8);
  expect(snapshot.ratePercent).toBe(8);
});
it('allows a newly approved extension while keeping 0% separate from exempt', () => {
  const extension = {
    default_rate_percent: 8,
    effective_at: '2027-01-01T00:00:00+07:00',
    created_by: 'administrator',
  };
  expect(
    resolveVatRate({ tax_treatment: 'DEFAULT' }, extension, new Date('2027-01-01T00:00:00+07:00'))
      .ratePercent,
  ).toBe(8);
  const zero = resolveVatRate(
    { tax_treatment: 'TAXABLE', vat_rate_percent: 0 },
    initial,
    new Date(),
  );
  expect(zero.treatment).toBe('TAXABLE');
  expect(zero.ratePercent).toBe(0);
  const exempt = resolveVatRate({ tax_treatment: 'EXEMPT' }, initial, new Date());
  expect(exempt.treatment).toBe('EXEMPT');
  expect(exempt.ratePercent).toBeNull();
});
