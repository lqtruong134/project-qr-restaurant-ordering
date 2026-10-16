import { describe, it, expect } from 'vitest';
import { guestPaymentStatus } from './payment-status';
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
