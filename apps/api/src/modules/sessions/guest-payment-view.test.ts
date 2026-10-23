import { describe, expect, it } from 'vitest';
import { guestOnlinePaymentView } from './guest-payment-view.js';

const row = {
  id: '27ad2930-74f0-48a8-87e1-a78ce944d162',
  collection_scope: 'TABLE' as const,
  amount: '5000',
  status: 'PENDING' as const,
  recorded_amount: '0',
  bank_confirmed_amount: '0',
  allocated_amount: '0',
  original_allocated_amount: '0',
  refunded_amount: '0',
  unapplied_amount: '0',
  created_at: new Date('2026-10-17T01:00:00Z'),
  expires_at: '2026-10-17T01:15:00Z',
  support_request_id: null,
};
const participant = '7cbdca8b-1db5-4d7b-8d91-6aa8fbc4a74c';

describe('guest online payment projection', () => {
  it('allowlists display fields and creates stable participant-scoped opaque keys', () => {
    const privateRow = {
      ...row,
      order_code: '100000000001',
      account_number: 'private-bank-account',
      created_by: 'private-staff-id',
      provider_transaction_id: 'private-bank-reference',
      qr_code: 'private-qr',
      checkout_url: 'https://pay.payos.vn/private',
      request_payload: { secret: 'private-provider-payload' },
      last_error: 'private-reconciliation-details',
    };
    const result = guestOnlinePaymentView(privateRow, participant);
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'scope',
        'amount',
        'status',
        'paidAmount',
        'bankConfirmedAmount',
        'appliedAmount',
        'refundedAmount',
        'refundableAmount',
        'remainingAmount',
        'expiresAt',
        'createdAt',
        'verificationSource',
        'providerEvidenceAttached',
      ].sort(),
    );
    expect(result.id).toMatch(/^[a-f0-9]{64}$/);
    expect(result.id).not.toBe(row.id);
    expect(result.id).toBe(guestOnlinePaymentView(row, participant).id);
    expect(result.id).not.toBe(guestOnlinePaymentView(row, 'another-participant').id);
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(result.expiresAt).toBe('2026-10-17T01:15:00.000Z');
  });

  it('never counts quarantined provider-confirmed funds as ledger payment', () => {
    const result = guestOnlinePaymentView(
      {
        ...row,
        status: 'REQUIRES_RECONCILIATION',
        bank_confirmed_amount: '5000',
      },
      participant,
    );
    expect(result.status).toBe('REQUIRES_RECONCILIATION');
    expect(result.bankConfirmedAmount).toBe('5000');
    expect(result.paidAmount).toBe('0');
    expect(result.remainingAmount).toBe('5000');
  });

  it.each([
    { recorded: '9007199254740992', remaining: '1' },
    { recorded: '9007199254740994', remaining: '0' },
  ])(
    'keeps exact recorded amounts and clamps remaining funds: $recorded',
    ({ recorded, remaining }) => {
      const result = guestOnlinePaymentView(
        {
          ...row,
          amount: '9007199254740993',
          recorded_amount: recorded,
          allocated_amount: recorded,
          original_allocated_amount: recorded,
          bank_confirmed_amount: recorded,
          support_request_id: 'visible-own-request',
        },
        participant,
      );
      expect(result.paidAmount).toBe(recorded);
      expect(result.remainingAmount).toBe(remaining);
      expect(result.supportRequestId).toBe('visible-own-request');
    },
  );
  it('separates a partial quote overpayment from bill allocations and actual returns', () => {
    const before = guestOnlinePaymentView(
      {
        ...row,
        amount: '10000',
        status: 'REQUIRES_RECONCILIATION',
        recorded_amount: '12000',
        bank_confirmed_amount: '12000',
        allocated_amount: '10000',
        original_allocated_amount: '10000',
        unapplied_amount: '2000',
      },
      participant,
    );
    expect(before).toMatchObject({
      paidAmount: '12000',
      bankConfirmedAmount: '12000',
      appliedAmount: '10000',
      refundedAmount: '0',
      refundableAmount: '2000',
      remainingAmount: '0',
    });
    const after = guestOnlinePaymentView(
      {
        ...row,
        amount: '10000',
        status: 'PAID',
        recorded_amount: '12000',
        bank_confirmed_amount: '12000',
        allocated_amount: '10000',
        original_allocated_amount: '10000',
        refunded_amount: '2000',
        unapplied_amount: '0',
      },
      participant,
    );
    expect(after).toMatchObject({
      paidAmount: '12000',
      bankConfirmedAmount: '12000',
      appliedAmount: '10000',
      refundedAmount: '2000',
      refundableAmount: '0',
      remainingAmount: '0',
    });
  });

  it('does not reopen a previously fulfilled quote when its items are later refunded', () => {
    const result = guestOnlinePaymentView(
      {
        ...row,
        recorded_amount: '5000',
        bank_confirmed_amount: '5000',
        original_allocated_amount: '5000',
        refunded_amount: '5000',
      },
      participant,
    );
    expect(result.appliedAmount).toBe('0');
    expect(result.refundedAmount).toBe('5000');
    expect(result.remainingAmount).toBe('0');
  });
});
