import { expect, it } from 'vitest';
import { payosResolutionReadiness, type PayosResolutionFacts } from './payos-resolution.js';
const valid: PayosResolutionFacts = {
  sessionStatus: 'ACTIVE',
  providerStatus: 'PAID',
  requestedAmount: '5000',
  bankReportedAmount: '5000',
  quarantinedAmount: '0',
  recordedAmount: '5000',
  allocatedAmount: '5000',
  originalAllocatedAmount: '5000',
  refundedAmount: '0',
  unappliedAmount: '0',
  sessionRefundDue: '0',
  quoteInvalidatedAtReceipt: false,
  verified: true,
  open: true,
};
it('closes only a verified, fully accounted exception without requiring the entire table to have paid', () => {
  expect(payosResolutionReadiness(valid)).toEqual({ canResolve: true, blockers: [] });
});
it.each([
  { verified: false },
  { open: false },
  { providerStatus: 'PENDING' },
  { quarantinedAmount: '5000' },
  { sessionStatus: 'CLOSED' },
  { unappliedAmount: '2000' },
  { sessionRefundDue: '2000' },
  { recordedAmount: '0' },
  { allocatedAmount: '4000' },
  { originalAllocatedAmount: '4000' },
])(
  'does not turn acknowledgement, a typed reference, pending or unresolved funds into settlement: %j',
  (change) => {
    expect(payosResolutionReadiness({ ...valid, ...change }).canResolve).toBe(false);
    expect(payosResolutionReadiness({ ...valid, ...change }).blockers.length).toBeGreaterThan(0);
  },
);
it('allows a partial quote overpayment to close only after the extra is actually returned', () => {
  const f = {
    ...valid,
    requestedAmount: '10000',
    bankReportedAmount: '12000',
    recordedAmount: '12000',
    allocatedAmount: '10000',
    originalAllocatedAmount: '10000',
    unappliedAmount: '2000',
    sessionRefundDue: '2000',
  };
  expect(payosResolutionReadiness(f).canResolve).toBe(false);
  expect(
    payosResolutionReadiness({
      ...f,
      refundedAmount: '2000',
      unappliedAmount: '0',
      sessionRefundDue: '0',
    }).canResolve,
  ).toBe(true);
});
it('a verified cancellation with no bank money can leave the queue without claiming payment', () => {
  expect(
    payosResolutionReadiness({
      ...valid,
      providerStatus: 'CANCELLED',
      recordedAmount: '0',
      bankReportedAmount: '0',
      allocatedAmount: '0',
      originalAllocatedAmount: '0',
    }).canResolve,
  ).toBe(true);
});

it('accepts independently verified bank funds only after actual returns, never unknown money', () => {
  const bank = {
    ...valid,
    providerStatus: 'PENDING',
    requestedAmount: '10000',
    bankReportedAmount: '0',
    recordedAmount: '12000',
    allocatedAmount: '10000',
    originalAllocatedAmount: '10000',
    refundedAmount: '2000',
    independentBankVerified: true,
    verified: false,
  };
  expect(payosResolutionReadiness(bank).canResolve).toBe(true);
  expect(payosResolutionReadiness({ ...bank, independentBankVerified: false }).canResolve).toBe(
    false,
  );
  expect(payosResolutionReadiness({ ...bank, unpostedBankReferences: true }).canResolve).toBe(
    false,
  );
  expect(payosResolutionReadiness({ ...bank, bankReportedAmount: '13000' }).canResolve).toBe(false);
  expect(
    payosResolutionReadiness({
      ...bank,
      refundedAmount: '0',
      unappliedAmount: '2000',
      sessionRefundDue: '2000',
    }).canResolve,
  ).toBe(false);
});
