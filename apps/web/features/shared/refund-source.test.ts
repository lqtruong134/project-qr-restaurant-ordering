import { describe, expect, it } from 'vitest';
import { refundableSources } from './refund-source';
import type { Row } from './components';

describe('original payment availability for refund approval', () => {
  const payments: Row[] = [
    {
      id: 'first',
      status: 'SUCCEEDED',
      amount: '45000',
      cash_received_amount: '100000',
      change_amount: '55000',
    },
    {
      id: 'second',
      status: 'SUCCEEDED',
      amount: '49000',
      cash_received_amount: '100000',
      change_amount: '51000',
    },
    { id: 'failed', status: 'FAILED', amount: '50000' },
  ];
  it('uses only invoice payments, excluding cash tender and change', () => {
    expect(refundableSources(payments, []).map((source) => source.available)).toEqual([
      45000n,
      49000n,
    ]);
  });
  it('excludes exhausted sources and reserves pending documents as well as actual refunds', () => {
    const refunds: Row[] = [
      {
        id: 'paid',
        source_payment_transaction_id: 'first',
        amount: '45000',
        status: 'RESOLVED_CASH',
      },
      { id: 'pending', source_payment_transaction_id: 'second', amount: '20000', status: 'OPEN' },
      {
        id: 'partial',
        source_payment_transaction_id: 'second',
        amount: '10000',
        status: 'IN_PROGRESS',
        remaining_amount: '4000',
      },
      {
        id: 'cancelled',
        source_payment_transaction_id: 'second',
        amount: '30000',
        status: 'CANCELLED',
      },
    ];
    expect(
      refundableSources(payments, refunds).map((source) => [source.payment.id, source.available]),
    ).toEqual([['second', 19000n]]);
  });
  it('never offers an overcommitted legacy source', () => {
    expect(
      refundableSources(payments.slice(0, 1), [
        { id: 'old', source_payment_transaction_id: 'first', amount: '46000', status: 'OPEN' },
      ]),
    ).toEqual([]);
  });
});
