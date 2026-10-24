import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { BillingSummary } from '@thesis/contracts';
import Receipt, { type Bill } from './receipt';

const billing: BillingSummary = {
  version: 1,
  priceIncludesVat: true,
  subtotalAmount: '55000',
  discountAmount: '0',
  payableAmount: '55000',
  beforeVatAmount: '50926',
  vatAmount: '4074',
  vatGroups: [
    {
      treatment: 'TAXABLE',
      ratePercent: 8,
      beforeVatAmount: '50926',
      vatAmount: '4074',
      totalAmount: '55000',
    },
  ],
  promotion: null,
  lines: [],
  legacyTaxUnavailable: false,
};
function bill(): Bill {
  return {
    session: {
      id: 'session',
      table_code: 'A06',
      session_status: 'ACTIVE',
      opened_at: '2026-10-25T03:00:00Z',
    },
    store: { id: 'store', name: 'Nhà hàng', timezone: 'Asia/Ho_Chi_Minh' },
    generatedAt: '2026-10-25T04:00:00Z',
    closedBy: null,
    account: {
      id: 'account',
      charge_total: '55000',
      paid_total: '0',
      outstanding_amount: '55000',
      refunded_total: '0',
      refund_due_amount: '0',
    },
    charges: [
      {
        id: 'charge',
        product_name_snapshot: 'Chả giò giòn',
        quantity: 1,
        unit_price_snapshot: '55000',
        amount: '55000',
        status: 'ACTIVE',
        item_status: 'SERVED',
      },
    ],
    billing: structuredClone(billing),
    intents: [],
    payments: [],
    refunds: [],
  };
}
const render = (value: Bill) =>
  renderToStaticMarkup(createElement(Receipt, { id: 'receipt', bill: value, visible: true }));
it('prints a compact unpaid bill with inclusive tax exactly once and no empty money sections', () => {
  const value = bill(),
    before = JSON.stringify(value),
    html = render(value);
  expect(html).toContain('PHIẾU TẠM TÍNH');
  expect(html).toContain('Chả giò giòn');
  expect(html).toContain('50.926 đ');
  expect(html).toContain('4.074 đ');
  expect(html.match(/Đã gồm VAT/g)).toHaveLength(1);
  expect(html).not.toContain('Tiền món trước khuyến mãi');
  expect(html).not.toContain('Nhà hàng còn giữ');
  expect(html).not.toContain('receipt-money-breakdown');
  expect(html).not.toContain('receipt-payments');
  expect(html).not.toContain('Giờ ra');
  expect(JSON.stringify(value)).toBe(before);
});
it('keeps actual cash tender and returned change distinct from invoice coverage and refunds', () => {
  const value = bill();
  value.account.paid_total = '55000';
  value.account.outstanding_amount = '0';
  value.payments = [
    {
      id: 'cash',
      status: 'SUCCEEDED',
      method: 'CASH',
      amount: '55000',
      cash_received_amount: '100000',
      change_amount: '45000',
      change_returned_at: '2026-10-25T04:00:00Z',
    },
  ];
  const html = render(value);
  expect(html).toContain('Đã thanh toán');
  expect(html).toContain('100.000 đ');
  expect(html).toContain('Tiền thối đã trả');
  expect(html).toContain('45.000 đ');
  expect(html).not.toContain('Đã hoàn lại khách');
  expect(html).not.toContain('Nhà hàng còn giữ');
});
it('does not credit reported but unverified money and retains the outstanding amount', () => {
  const value = bill();
  value.financialSummary = {
    billTotal: '55000',
    bankReportedAmount: '18000',
    recordedAmount: '0',
    appliedAmount: '0',
    outstandingAmount: '55000',
    pendingOnlineAmount: '18000',
    reservedAmount: '18000',
    availableToCollect: '37000',
    unallocatedAmount: '0',
    refundDueAmount: '0',
    refundedAmount: '0',
    reviewRequired: true,
  };
  const html = render(value);
  expect(html).toContain('chưa tính vào số đã thanh toán');
  expect(html).toContain('Còn phải thanh toán');
  expect(html).toContain('55.000 đ');
  expect(html).not.toContain('18.000 đ');
  expect(html).not.toContain('receipt-payments');
});
it('does not manufacture VAT for a legacy frozen receipt', () => {
  const value = bill();
  delete value.billing;
  value.session.session_status = 'CLOSED';
  const html = render(value);
  expect(html).toContain('PHIẾU THANH TOÁN');
  expect(html).toContain('chưa có thông tin VAT');
  expect(html).not.toContain('VAT 8%');
  expect(html).not.toContain('4.074 đ');
});
it('retains every tax group and the saved discount without recomputing historical amounts', () => {
  const value = bill();
  value.billing!.discountAmount = '5000';
  value.billing!.payableAmount = '50000';
  value.billing!.beforeVatAmount = '45000';
  value.billing!.vatAmount = '5000';
  value.billing!.vatGroups.push({
    treatment: 'TAXABLE',
    ratePercent: 10,
    beforeVatAmount: '1000',
    vatAmount: '100',
    totalAmount: '1100',
  });
  const before = JSON.stringify(value),
    html = render(value);
  expect(html).toContain('Khuyến mãi');
  expect(html).toContain('−5.000 đ');
  expect(html).toContain('VAT 8%');
  expect(html).toContain('VAT 10%');
  expect(html).toContain('50.000 đ');
  expect(JSON.stringify(value)).toBe(before);
});

it('shows pending cash change without claiming it was returned or refunded', () => {
  const value = bill();
  value.account.paid_total = '55000';
  value.account.outstanding_amount = '0';
  value.payments = [
    {
      id: 'cash',
      status: 'SUCCEEDED',
      method: 'CASH',
      amount: '55000',
      cash_received_amount: '100000',
      change_amount: '45000',
      metadata: { cashHandlingVersion: 1 },
    } as unknown as Bill['payments'][number],
  ];
  const html = render(value);
  expect(html).toContain('100.000 đ');
  expect(html).toContain('Tiền thối chưa trả');
  expect(html).toContain('45.000 đ');
  expect(html).not.toContain('Tiền thối đã trả');
  expect(html).not.toContain('Đã hoàn lại khách');
});

it('does not claim VAT is included when every line is exempt', () => {
  const value = bill();
  value.billing!.beforeVatAmount = '55000';
  value.billing!.vatAmount = '0';
  value.billing!.vatGroups = [
    {
      treatment: 'EXEMPT',
      ratePercent: null,
      beforeVatAmount: '55000',
      vatAmount: '0',
      totalAmount: '55000',
    },
  ];
  const html = render(value);
  expect(html).toContain('Không chịu VAT');
  expect(html).not.toContain('Đã gồm VAT');
  expect(html).not.toContain('Tiền trước VAT');
});

it('retains the cash handover detail for multiple tenders and reconciles an actual full refund', () => {
  const value = bill();
  delete value.billing;
  value.account.charge_total = '0';
  value.account.paid_total = '55000';
  value.account.refunded_total = '55000';
  value.account.outstanding_amount = '0';
  value.charges[0]!.status = 'REVERSED';
  value.payments = [
    {
      id: 'cash-1',
      status: 'SUCCEEDED',
      method: 'CASH',
      amount: '25000',
      cash_received_amount: '50000',
      change_amount: '25000',
      change_returned_at: '2026-10-25T04:00:00Z',
    },
    {
      id: 'cash-2',
      status: 'SUCCEEDED',
      method: 'CASH',
      amount: '30000',
      cash_received_amount: '50000',
      change_amount: '20000',
      change_returned_at: '2026-10-25T04:00:00Z',
    },
  ];
  const html = render(value);
  expect(html.match(/class="cash-history"/g)).toHaveLength(2);
  expect(html).toContain('100.000 đ');
  expect(html).toContain('45.000 đ');
  expect(html).toContain('Đã hoàn lại khách');
  expect(html).toContain('55.000 đ');
  expect(html).toMatch(/Nhà hàng còn giữ<\/dt><dd>0 đ/);
});
