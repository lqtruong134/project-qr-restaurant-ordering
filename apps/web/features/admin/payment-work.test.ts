import { describe, expect, it } from 'vitest';
import type { PaymentReconciliationCase } from '@thesis/contracts';
import { refundsOutsidePaymentCases } from './payment-work';
const refund = { id: 'alert', session_id: 'session', refund_due_amount: '2000' };
const paymentCase = (values: Partial<PaymentReconciliationCase>) =>
  ({
    id: 'intent',
    session_id: 'session',
    status: 'OPEN',
    unapplied_amount: '2000',
    ...values,
  }) as PaymentReconciliationCase;

describe('payment exception work deduplication', () => {
  it('shows one work link when an open case already covers the full source refund', () => {
    const cases = [paymentCase({})];
    expect(refundsOutsidePaymentCases([refund], cases)).toEqual([]);
    expect(refund.refund_due_amount).toBe('2000');
    expect(cases[0]!.unapplied_amount).toBe('2000');
  });
  it('retains refunds from other sources, sessions, or already closed cases', () => {
    for (const item of [
      paymentCase({ unapplied_amount: '1000' }),
      paymentCase({ session_id: 'other' }),
      paymentCase({ status: 'RESOLVED' }),
      paymentCase({ unapplied_amount: undefined }),
    ]) {
      expect(refundsOutsidePaymentCases([refund], [item])).toEqual([refund]);
    }
  });
  it('never treats the whole-session refund amount as proof that one payOS source covers it', () => {
    const item = paymentCase({ unapplied_amount: '0', refund_due_amount: '2000' });
    expect(refundsOutsidePaymentCases([refund], [item])).toEqual([refund]);
  });
});
