import { describe, it, expect } from 'vitest';
import { guestPaymentStatus, guestOnlinePaymentStatus } from './payment-status';
import type { GuestOnlinePayment } from '@thesis/contracts';
import type { Row } from '../shared/components';
const zero: Row = {
  id: 'account',
  charge_total: '0',
  paid_total: '0',
  outstanding_amount: '0',
  refund_due_amount: '0',
};
const item: Row = {
  id: 'item',
  status: 'SUBMITTED',
  item_status: 'SERVED',
  charge_status: 'ACTIVE',
};
describe('guest payment status reflects orders and recorded money', () => {
  it('does not label an empty table as paid', () =>
    expect(guestPaymentStatus(zero, []).kind).toBe('empty'));
  it('explains items still in the cart', () =>
    expect(guestPaymentStatus(zero, [], 2).kind).toBe('cart'));
  it('explains provisional orders without treating a zero charge as payment', () =>
    expect(
      guestPaymentStatus(zero, [
        { ...item, status: 'PENDING_REVIEW', item_status: 'SUBMITTED', charge_status: null },
      ]).kind,
    ).toBe('review'));
  it('explains cancelled or fully waived dishes without a paid claim', () => {
    expect(guestPaymentStatus(zero, [{ ...item, item_status: 'CANCELLED' }]).kind).toBe(
      'cancelled',
    );
    expect(guestPaymentStatus(zero, [{ ...item, charge_status: 'REVERSED' }]).kind).toBe(
      'cancelled',
    );
  });
  it('prioritizes a real remaining balance even with another pending order', () =>
    expect(
      guestPaymentStatus(
        { ...zero, charge_total: '90000', paid_total: '40000', outstanding_amount: '50000' },
        [{ ...item, status: 'PENDING_REVIEW' }],
      ).kind,
    ).toBe('due'));
  it('only calls a positive bill paid when money was recorded and no balance or refund remains', () => {
    expect(
      guestPaymentStatus({ ...zero, charge_total: '90000', paid_total: '90000' }, [item]).kind,
    ).toBe('paid');
    expect(guestPaymentStatus(zero, [item]).kind).toBe('zero');
  });
  it('explains both a remaining item balance and unallocated money that needs a separate refund', () => {
    const state = guestPaymentStatus(
      {
        ...zero,
        charge_total: '20000',
        paid_total: '12000',
        outstanding_amount: '10000',
        refund_due_amount: '2000',
      },
      [item],
    );
    expect(state.kind).toBe('due');
    expect(state.detail).toContain('10.000');
    expect(state.detail).toContain('2.000');
    expect(state.detail).toContain('chưa được tự bù');
    expect(state.title).not.toContain('thanh toán đủ');
  });
  it('shows refund due ahead of an otherwise settled or zero balance', () => {
    const status = guestPaymentStatus(
      { ...zero, paid_total: '90000', refund_due_amount: '90000' },
      [{ ...item, charge_status: 'REVERSED' }],
    );
    expect(status.kind).toBe('refund');
    expect(status.detail).toContain('90.000');
  });
});

it('distinguishes partial refunds from fully returned money on a zero bill', () => {
  const orders = [{ ...item, item_status: 'CANCELLED', charge_status: 'REVERSED' }];
  const partial = guestPaymentStatus(
    { ...zero, paid_total: '90000', refunded_total: '20000', refund_due_amount: '70000' },
    orders,
  );
  expect(partial.kind).toBe('refund');
  expect(partial.title).toContain('một phần');
  expect(partial.detail).toContain('20.000');
  expect(partial.detail).toContain('70.000');
  const complete = guestPaymentStatus(
    { ...zero, paid_total: '90000', refunded_total: '90000' },
    orders,
  );
  expect(complete.kind).toBe('refunded');
  expect(complete.title).toContain('hoàn đủ');
  expect(complete.detail).toContain('90.000');
});
it('still requests new charges after a prior refund and explains an adjusted paid bill', () => {
  expect(
    guestPaymentStatus(
      { ...zero, paid_total: '105000', refunded_total: '90000', charge_total: '15000' },
      [item],
    ).title,
  ).toContain('thanh toán đủ và nhận tiền hoàn');
  expect(
    guestPaymentStatus(
      {
        ...zero,
        paid_total: '90000',
        refunded_total: '90000',
        charge_total: '15000',
        outstanding_amount: '15000',
      },
      [item],
    ).kind,
  ).toBe('due');
});

describe('guest online confirmation uses safe server states', () => {
  const online: GuestOnlinePayment = {
    id: 'opaque-ui-key',
    scope: 'TABLE',
    amount: '100000',
    paidAmount: '0',
    bankConfirmedAmount: '0',
    remainingAmount: '100000',
    status: 'PENDING',
    createdAt: '2026-10-17T00:00:00Z',
    expiresAt: '2026-10-17T01:00:00Z',
  };
  it('describes waiting without claiming receipt, even if a return URL says paid', () => {
    expect(guestOnlinePaymentStatus(online)).toMatchObject({
      kind: 'pending',
      title: 'Đang chờ thanh toán online',
    });
    expect(guestOnlinePaymentStatus({ ...online, status: 'PROCESSING' }).title).toContain(
      'ngân hàng xác nhận',
    );
  });
  it('keeps partial receipt distinct from a settled payment', () => {
    const state = guestOnlinePaymentStatus({
      ...online,
      status: 'UNDERPAID',
      paidAmount: '30000',
      remainingAmount: '70000',
    });
    expect(state.kind).toBe('pending');
    expect(state.title).toContain('một phần');
    expect(state.detail).toContain('30.000');
    expect(state.detail).toContain('70.000');
    expect(
      guestOnlinePaymentStatus({
        ...online,
        status: 'PAID',
        paidAmount: '100000',
        remainingAmount: '0',
      }).title,
    ).toBe('Thanh toán thành công');
  });
  it('does not call gross booked funds invoice payment when some money is unallocated', () => {
    const state = guestOnlinePaymentStatus({
      ...online,
      amount: '10000',
      paidAmount: '12000',
      bankConfirmedAmount: '12000',
      appliedAmount: '10000',
      refundableAmount: '2000',
      refundedAmount: '0',
      remainingAmount: '0',
      status: 'REQUIRES_RECONCILIATION',
    });
    expect(state.kind).toBe('review');
    expect(state.detail).toContain('12.000');
    expect(state.detail).toContain('10.000');
    expect(state.detail).toContain('2.000');
    expect(state.title).not.toContain('thành công');
    expect(state.detail).toContain('chưa tự bù');
  });
  it.each(['EXPIRED', 'CANCELLED', 'FAILED', 'REQUIRES_RECONCILIATION'] as const)(
    '%s never asks the guest to pay again without staff checking',
    (status) => {
      const state = guestOnlinePaymentStatus({ ...online, status });
      expect(state.kind).not.toBe('paid');
      expect(state.detail).toMatch(/trước khi|Chưa cần chuyển thêm/);
    },
  );
});
