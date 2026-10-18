import { describe, expect, it } from 'vitest';
import { refundableSources, refundReasonForSource } from './refund-source';
import type { Row } from './components';

describe('server-authoritative original payment refund budgets', () => {
  it('offers only the unapplied 2k online source, never cash still paying active dishes', () => {
    const payments: Row[] = [
      {
        id: 'cash',
        status: 'SUCCEEDED',
        amount: '8000',
        allocated_amount: '8000',
        refundable_amount: '0',
        available_refund_amount: '0',
      },
      {
        id: 'online',
        status: 'SUCCEEDED',
        amount: '12000',
        allocated_amount: '10000',
        refundable_amount: '2000',
        available_refund_amount: '2000',
      },
    ];
    expect(
      refundableSources(payments).map(({ payment, available }) => [payment.id, available]),
    ).toEqual([['online', 2000n]]);
  });
  it('uses the API budget after completed refunds and pending documents without subtracting twice', () => {
    expect(
      refundableSources([
        {
          id: 'source',
          status: 'SUCCEEDED',
          amount: '12000',
          allocated_amount: '10000',
          refunded_amount: '1000',
          refundable_amount: '1000',
          pending_refund_amount: '500',
          available_refund_amount: '500',
        },
      ]).map((source) => source.available),
    ).toEqual([500n]);
  });
  it('never derives a fallback budget from gross receipts, cash tender or stale refund history', () => {
    expect(
      refundableSources([
        {
          id: 'source',
          status: 'SUCCEEDED',
          amount: '45000',
          cash_received_amount: '100000',
          change_amount: '55000',
        },
      ]),
    ).toEqual([]);
  });
  it('rejects failed, exhausted, missing and malformed source budgets', () => {
    for (const available of [undefined, '', '-1', '1.5', 'wrong', '0'])
      expect(
        refundableSources([
          {
            id: 'source',
            status: 'SUCCEEDED',
            amount: '10000',
            available_refund_amount: available ?? null,
          },
        ]),
      ).toEqual([]);
    expect(
      refundableSources([
        { id: 'failed', status: 'FAILED', amount: '10000', available_refund_amount: '10000' },
      ]),
    ).toEqual([]);
  });
  it('preserves whole-dong precision from the source budget', () => {
    expect(
      refundableSources([
        {
          id: 'source',
          status: 'SUCCEEDED',
          amount: '9007199254740993',
          available_refund_amount: '9007199254740993',
        },
      ])[0]!.available,
    ).toBe(9007199254740993n);
  });
});

describe('refund reasons stay attached to the selected source', () => {
  it.each(['UNAPPLIED_PAYMENT', 'MIXED_PAYMENT_BALANCE', null])(
    'requires a separate operator reason for %s even if the table has a meal cancellation',
    (kind) => {
      const result = refundReasonForSource(
        { id: 'source', refund_context_kind: kind },
        'Món có ruồi',
      );
      expect(result.useDecisionReason).toBe(false);
      expect(result.reason).not.toContain('ruồi');
      expect(result.reason).toContain('chuyển dư');
    },
  );
  it('reuses a decision reason only for a source whose refundable balance belongs to bill adjustments', () => {
    expect(
      refundReasonForSource(
        { id: 'source', refund_context_kind: 'BILL_ADJUSTMENT' },
        'Món có ruồi',
      ),
    ).toEqual({ useDecisionReason: true, reason: 'Món có ruồi' });
    expect(
      refundReasonForSource({ id: 'source', refund_context_kind: 'BILL_ADJUSTMENT' })
        .useDecisionReason,
    ).toBe(false);
  });
});
