import { describe, expect, it } from 'vitest';
import { onlineReceivedIncrease, paymentRevision } from './payment-refresh';
import { hasPendingOnlinePayment, type PaymentIntent } from './online-payment';
const payment = (id: string, amount = '0', status = 'PENDING'): PaymentIntent => ({
  id,
  amount: '100000',
  method: 'ONLINE',
  status: status === 'PAID' ? 'SUCCEEDED' : 'PENDING',
  online: {
    provider: 'PAYOS',
    status: status as NonNullable<PaymentIntent['online']>['status'],
    orderCode: '1',
    qrCode: null,
    checkoutUrl: null,
    expiresAt: '2026-10-18T00:00:00Z',
    lastError: null,
    paidAmount: amount,
    remainingAmount: String(100000n - BigInt(amount)),
  },
});
describe('payment read-model changes', () => {
  it('keeps partial online requests live, stops terminal requests, and does not infer payment from local time', () => {
    for (const status of [
      'CREATE_PENDING',
      'PENDING',
      'UNDERPAID',
      'PROCESSING',
      'CANCEL_PENDING',
      'ERROR',
    ])
      expect(hasPendingOnlinePayment([payment('a', '1000', status)])).toBe(true);
    for (const status of ['PAID', 'CANCELLED', 'EXPIRED', 'FAILED', 'REQUIRES_RECONCILIATION'])
      expect(hasPendingOnlinePayment([payment('a', '1000', status)])).toBe(false);
  });
  it('detects real account, request completion and provider progress while ignoring object/key order', () => {
    const model = {
      account: { id: 'account', paid_total: '0', outstanding_amount: '100000' },
      intents: [payment('b'), payment('a')],
      paymentRequests: [{ id: 'request', status: 'ACKNOWLEDGED' }],
    };
    const revision = paymentRevision(model);
    expect(paymentRevision({ ...model, intents: [...model.intents].reverse() })).toBe(revision);
    expect(
      paymentRevision({ ...model, paymentRequests: [{ id: 'request', status: 'RESOLVED' }] }),
    ).not.toBe(revision);
    expect(
      paymentRevision({ ...model, account: { ...model.account, paid_total: '1000' } }),
    ).not.toBe(revision);
    expect(paymentRevision({ ...model, intents: [payment('a', '1000', 'UNDERPAID')] })).not.toBe(
      revision,
    );
  });
  it('announces only newly posted online transactions, never quarantined bank receipts or unchanged snapshots', () => {
    const payment = { id: 'a', method: 'ONLINE', status: 'SUCCEEDED', amount: '30000' };
    expect(onlineReceivedIncrease([payment], [payment])).toBe(0n);
    expect(
      onlineReceivedIncrease([payment], [payment, { ...payment, id: 'b', amount: '20000' }]),
    ).toBe(20000n);
    expect(onlineReceivedIncrease([], [{ ...payment, status: 'PENDING' }])).toBe(0n);
    expect(onlineReceivedIncrease([payment], [{ ...payment, status: 'FAILED' }])).toBe(0n);
    expect(onlineReceivedIncrease([], [{ ...payment, method: 'CASH' }])).toBe(0n);
  });
});
