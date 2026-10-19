import { describe, expect, it } from 'vitest';
import {
  onlinePaymentState,
  paymentMethodLabel,
  safeCheckoutUrl,
  type PaymentIntent,
} from './online-payment';

const now = Date.parse('2026-10-14T05:00:00Z');
function intent(status = 'PENDING'): PaymentIntent {
  return {
    id: 'intent',
    amount: '150000',
    method: 'ONLINE',
    status: 'PENDING',
    online: {
      provider: 'PAYOS',
      status: status as NonNullable<PaymentIntent['online']>['status'],
      orderCode: '123456',
      qrCode: '000201010212',
      checkoutUrl: 'https://pay.payos.vn/web/test-payment',
      expiresAt: '2026-10-14T05:10:00Z',
      lastError: null,
      paidAmount: '0',
      remainingAmount: '150000',
    },
  };
}
describe('online payment presentation safeguards', () => {
  it('keeps paid confirmation server-derived and hides QR', () => {
    const payment = intent();
    payment.status = 'SUCCEEDED';
    Object.assign(payment.online!, {
      recordedAmount: '150000',
      appliedAmount: '150000',
      refundedAmount: '0',
      unallocatedAmount: '0',
    });
    expect(onlinePaymentState(payment, now)).toMatchObject({ kind: 'paid', showQr: false });
  });
  it('never treats PAID with bank or gross-only money as committed invoice payment', () => {
    const payment = intent('PAID');
    payment.status = 'SUCCEEDED';
    payment.online!.paidAmount = '150000';
    Object.assign(payment.online!, { bankReportedAmount: '150000', recordedAmount: '150000' });
    expect(onlinePaymentState(payment, now)).toMatchObject({ kind: 'pending', showQr: false });
    expect(
      onlinePaymentState(payment, now, {
        recorded: 150000n,
        applied: 150000n,
        refunded: 0n,
        refundable: 0n,
      }),
    ).toMatchObject({ kind: 'paid', showQr: false });
  });
  it('keeps refunded money separate from successful invoice allocation', () => {
    const payment = intent('PAID');
    payment.status = 'SUCCEEDED';
    Object.assign(payment.online!, {
      recordedAmount: '150000',
      appliedAmount: '0',
      refundedAmount: '150000',
      unallocatedAmount: '0',
    });
    expect(onlinePaymentState(payment, now)).toMatchObject({ kind: 'refunded', showQr: false });
  });
  it('prioritizes reconciliation over a succeeded intent so staff cannot recollect', () => {
    const payment = intent('REQUIRES_RECONCILIATION');
    payment.status = 'SUCCEEDED';
    expect(onlinePaymentState(payment, now)).toMatchObject({ kind: 'review', showQr: false });
  });
  it('does not call provider PAID a payment before the restaurant commits receipt', () => {
    expect(onlinePaymentState(intent('PAID'), now)).toMatchObject({
      kind: 'pending',
      showQr: false,
    });
    expect(onlinePaymentState(intent('PAID'), now).title).toContain('xác nhận');
  });
  it('underpaid keeps the same QR with actual bank progress', () => {
    const payment = intent('UNDERPAID');
    payment.online!.paidAmount = '100000';
    payment.online!.remainingAmount = '50000';
    expect(onlinePaymentState(payment, now)).toMatchObject({ kind: 'pending', showQr: true });
    expect(payment.online!.remainingAmount).toBe('50000');
    expect(onlinePaymentState(payment, now).detail).toContain('không chuyển lại toàn bộ');
  });
  it.each(['CANCELLED', 'EXPIRED', 'CANCEL_PENDING', 'ERROR', 'CREATE_PENDING'])(
    '%s never exposes a payable QR',
    (status) => expect(onlinePaymentState(intent(status), now).showQr).toBe(false),
  );
  it('local expiry hides QR without changing persisted financial status', () => {
    const payment = intent();
    expect(onlinePaymentState(payment, now + 11 * 60 * 1000)).toMatchObject({
      kind: 'expired',
      showQr: false,
    });
    expect(payment.status).toBe('PENDING');
    expect(payment.online!.status).toBe('PENDING');
  });
  it('unknown online state fails closed', () => {
    const payment = intent('UNRECOGNIZED');
    expect(onlinePaymentState(payment, now)).toMatchObject({ kind: 'review', showQr: false });
  });
  it('checkout links only permit HTTPS without embedded credentials', () => {
    expect(safeCheckoutUrl('https://pay.payos.vn/web/test')).toBe('https://pay.payos.vn/web/test');
    for (const value of [
      'javascript:alert(1)',
      'http://pay.payos.vn',
      'https://secret@pay.payos.vn',
      '/payment',
      null,
    ])
      expect(safeCheckoutUrl(value)).toBeUndefined();
  });
  it('online method remains distinct from manual bank transfers', () => {
    expect(paymentMethodLabel('ONLINE')).toBe('Online (payOS)');
    expect(paymentMethodLabel('BANK_TRANSFER')).toBe('Chuyển khoản');
  });
});
