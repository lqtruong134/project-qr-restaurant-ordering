import { describe, expect, it } from 'vitest';
import { paymentFlowSummary, paymentSummary } from './payment-summary';

describe('payment totals distinguish invoice collections from actual refunds', () => {
  it('shows 94,000 actually paid after collecting 143,000 and returning 49,000', () => {
    expect(
      paymentSummary({
        charge_total: '94000',
        paid_total: '143000',
        refunded_total: '49000',
        outstanding_amount: '0',
        refund_due_amount: '0',
      }),
    ).toEqual({
      billTotal: 94000n,
      collectedTotal: 143000n,
      refundedTotal: 49000n,
      netPaid: 94000n,
      outstanding: 0n,
      refundDue: 0n,
    });
  });

  it('keeps the full amount paid until an actual refund is recorded', () => {
    const pending = paymentSummary({
      charge_total: '0',
      paid_total: '49000',
      refunded_total: '0',
      outstanding_amount: '0',
      refund_due_amount: '49000',
    });
    expect(pending.netPaid).toBe(49000n);
    expect(pending.refundDue).toBe(49000n);
    const returned = paymentSummary({
      charge_total: '0',
      paid_total: '49000',
      refunded_total: '49000',
      outstanding_amount: '0',
      refund_due_amount: '0',
    });
    expect(returned.billTotal).toBe(0n);
    expect(returned.collectedTotal).toBe(49000n);
    expect(returned.netPaid).toBe(0n);
    expect(returned.refundedTotal).toBe(49000n);
  });

  it('preserves a remaining balance when new dishes are ordered after a refund', () => {
    const totals = paymentSummary({
      charge_total: '15000',
      paid_total: '49000',
      refunded_total: '49000',
      outstanding_amount: '15000',
      refund_due_amount: '0',
    });
    expect(totals.netPaid).toBe(0n);
    expect(totals.outstanding).toBe(15000n);
  });

  it('keeps whole-dong precision beyond Number safe integer values', () => {
    const totals = paymentSummary({
      charge_total: '9007199254740993',
      paid_total: '9007199254789993',
      refunded_total: '49000',
    });
    expect(totals.billTotal).toBe(9007199254740993n);
    expect(totals.netPaid).toBe(totals.billTotal);
  });
});

describe('cash tender, change and refund reconciliation', () => {
  const account = { paid_total: '94000', refunded_total: '94000' };
  const payments = ['45000', '49000'].map((amount) => ({
    status: 'SUCCEEDED',
    method: 'CASH',
    amount,
    metadata: {
      cashReceived: '100000',
      changeGiven: String(100000 - Number(amount)),
      cashHandlingVersion: 1,
    },
    change_returned_at: '2026-10-09T03:00:00Z',
  }));

  it('reconciles two 100,000 tenders, 106,000 change and 94,000 refunds without retaining money', () => {
    const flow = paymentFlowSummary(account, payments);
    expect(flow).toMatchObject({
      customerGiven: 200000n,
      cashTendered: 200000n,
      changeReturned: 106000n,
      collectedTotal: 94000n,
      refundedTotal: 94000n,
      netPaid: 0n,
      customerRetained: 0n,
      changePending: 0n,
      changeUnconfirmed: 0n,
      incomplete: false,
    });
    expect(flow.customerGiven).toBe(
      flow.changeReturned + flow.refundedTotal + flow.customerRetained!,
    );
  });

  it('keeps unreturned change visible even after invoice money has been refunded', () => {
    const flow = paymentFlowSummary(
      account,
      payments.map((p) => ({ ...p, change_returned_at: null })),
    );
    expect(flow.netPaid).toBe(0n);
    expect(flow.changeReturned).toBe(0n);
    expect(flow.changePending).toBe(106000n);
    expect(flow.customerRetained).toBe(106000n);
  });

  it('does not claim legacy recorded change was returned or is still owed without evidence', () => {
    const flow = paymentFlowSummary(
      account,
      payments.map((p) => ({
        ...p,
        change_returned_at: null,
        metadata: { cashReceived: p.metadata.cashReceived, changeGiven: p.metadata.changeGiven },
      })),
    );
    expect(flow.changeReturned).toBe(0n);
    expect(flow.changePending).toBe(0n);
    expect(flow.changeUnconfirmed).toBe(106000n);
    expect(flow.customerRetained).toBeNull();
  });

  it('does not invent cash tender when old transactions lack cash details', () => {
    const flow = paymentFlowSummary({ paid_total: '49000' }, [
      { status: 'SUCCEEDED', method: 'CASH', amount: '49000' },
    ]);
    expect(flow.incomplete).toBe(true);
    expect(flow.customerGiven).toBeNull();
    expect(flow.customerRetained).toBeNull();
    expect(flow.netPaid).toBe(49000n);
  });

  it('reconciles mixed payment methods and ignores failed payments', () => {
    const flow = paymentFlowSummary({ paid_total: '94000', refunded_total: '45000' }, [
      payments[0]!,
      { status: 'SUCCEEDED', method: 'BANK_TRANSFER', amount: '49000' },
      { status: 'FAILED', method: 'CASH', amount: '999000' },
    ]);
    expect(flow).toMatchObject({
      cashTendered: 100000n,
      nonCashReceived: 49000n,
      customerGiven: 149000n,
      changeReturned: 55000n,
      refundedTotal: 45000n,
      customerRetained: 49000n,
      netPaid: 49000n,
    });
  });

  it('uses additive API cash fields and exact whole-dong arithmetic', () => {
    const flow = paymentFlowSummary({ paid_total: '9007199254740993' }, [
      {
        status: 'SUCCEEDED',
        method: 'CASH',
        amount: '9007199254740993',
        cash_received_amount: '9007199254741000',
        change_amount: '7',
        change_returned_at: '2026-10-09',
      },
    ]);
    expect(flow.cashTendered).toBe(9007199254741000n);
    expect(flow.customerRetained).toBe(9007199254740993n);
  });

  it('avoids claiming a physical balance from incomplete or inconsistent transactions', () => {
    expect(paymentFlowSummary({ paid_total: '94000' }, [payments[0]!]).customerRetained).toBeNull();
    expect(
      paymentFlowSummary({ paid_total: '45000' }, [{ ...payments[0]!, change_amount: '1' }])
        .customerRetained,
    ).toBeNull();
  });
});
