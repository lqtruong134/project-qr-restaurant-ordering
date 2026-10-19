import { describe, expect, it } from 'vitest';
import { collectionAmounts } from './collection-availability';
const account = { id: 'account', outstanding_amount: '69000', reserved_payment_amount: '5000' };
const charges = [
  { id: 'charge', status: 'ACTIVE', owner_participant_id: 'guest', unpaid_amount: '69000' },
];
const availability = {
  outstandingAmount: '69000',
  reservedAmount: '5000',
  availableAmount: '64000',
  blockedReason: null,
  participants: [
    {
      participantId: 'guest',
      outstandingAmount: '69000',
      reservedAmount: '0',
      availableAmount: '64000',
    },
  ],
};
describe('collection scope follows the authoritative server read model', () => {
  it('keeps 69k owed and 64k collection capacity distinct for table and participant while 5k waits', () => {
    expect(collectionAmounts(account, charges, 'guest', availability)).toEqual({
      outstanding: 69000n,
      reserved: 5000n,
      available: 64000n,
      ownOutstanding: 69000n,
      ownAvailable: 64000n,
      blockedReason: null,
    });
  });
  it('uses committed server balances instead of stale local charge sums or local expiry', () => {
    expect(
      collectionAmounts(account, charges, 'guest', {
        ...availability,
        outstandingAmount: '64000',
        reservedAmount: '0',
        availableAmount: '64000',
        participants: [
          {
            participantId: 'guest',
            outstandingAmount: '64000',
            reservedAmount: '0',
            availableAmount: '64000',
          },
        ],
      }),
    ).toMatchObject({ outstanding: 64000n, ownOutstanding: 64000n, available: 64000n });
  });
  it('keeps an explicit server collection block and does not hide it behind a positive amount', () => {
    expect(
      collectionAmounts(account, charges, 'guest', {
        ...availability,
        blockedReason: 'Khoản chuyển đang cần quản trị kiểm tra.',
      }).blockedReason,
    ).toBe('Khoản chuyển đang cần quản trị kiểm tra.');
  });
  it('caps the historical participant fallback to table capacity without inventing payment', () => {
    expect(collectionAmounts(account, charges, 'guest')).toMatchObject({
      outstanding: 69000n,
      ownOutstanding: 69000n,
      ownAvailable: 64000n,
    });
  });
});
