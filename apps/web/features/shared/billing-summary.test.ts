import { describe, expect, it } from 'vitest';
import type { BillingSummary } from '@thesis/contracts';
import { billingLine, payableItemAmount, pricingFacts, taxLabel } from './billing-summary';

export const quotedBill: BillingSummary = {
  version: 1,
  priceIncludesVat: true,
  subtotalAmount: '157000',
  discountAmount: '15700',
  payableAmount: '141300',
  beforeVatAmount: '129197',
  vatAmount: '12103',
  vatGroups: [
    {
      treatment: 'TAXABLE',
      ratePercent: 8,
      beforeVatAmount: '40833',
      vatAmount: '3267',
      totalAmount: '44100',
    },
    {
      treatment: 'TAXABLE',
      ratePercent: 10,
      beforeVatAmount: '88364',
      vatAmount: '8836',
      totalAmount: '97200',
    },
  ],
  promotion: null,
  lines: [
    {
      chargeId: 'charge-a',
      orderItemId: 'item-a',
      grossAmount: '49000',
      discountAmount: '4900',
      payableAmount: '44100',
      beforeVatAmount: '40833',
      vatAmount: '3267',
      taxTreatment: 'TAXABLE',
      vatRatePercent: 8,
      promotionId: 'promo',
    },
    {
      chargeId: 'charge-b',
      orderItemId: 'item-b',
      grossAmount: '108000',
      discountAmount: '10800',
      payableAmount: '97200',
      beforeVatAmount: '88364',
      vatAmount: '8836',
      taxTreatment: 'TAXABLE',
      vatRatePercent: 10,
      promotionId: 'promo',
    },
  ],
  legacyTaxUnavailable: false,
};

describe('server billing display', () => {
  it('displays the saved payable value, without adding inclusive VAT a second time', () => {
    expect(pricingFacts(quotedBill, { charge_total: '157000' })).toMatchObject({
      subtotal: 157000n,
      discount: 15700n,
      payable: 141300n,
      beforeVat: 129197n,
      vat: 12103n,
    });
  });
  it('matches charge and guest item identifiers so each caller sees their discounted part', () => {
    expect(billingLine(quotedBill, { id: 'charge-a' })?.payableAmount).toBe('44100');
    expect(
      payableItemAmount(
        { item_id: 'item-a', charge_status: 'ACTIVE', original_amount: '49000' },
        quotedBill,
      ),
    ).toBe(44100n);
    expect(
      payableItemAmount(
        { item_id: 'item-b', charge_status: 'ACTIVE', original_amount: '108000' },
        quotedBill,
      ),
    ).toBe(97200n);
  });
  it('does not resurrect a reversed or never-charged dish from an older quote', () => {
    expect(payableItemAmount({ item_id: 'item-a', charge_status: 'REVERSED' }, quotedBill)).toBe(
      0n,
    );
    expect(
      payableItemAmount(
        { item_id: 'item-a', charge_status: 'NONE', unit_price_snapshot: '49000' },
        quotedBill,
      ),
    ).toBe(0n);
  });
  it('preserves legacy amounts and explicitly avoids inventing a VAT rate', () => {
    expect(pricingFacts(undefined, { charge_total: '49000' })).toMatchObject({
      payable: 49000n,
      beforeVat: null,
      vat: null,
      hasTaxDetails: false,
    });
    expect(payableItemAmount({ charge_status: 'ACTIVE', original_amount: '49000' })).toBe(49000n);
    expect(taxLabel('LEGACY', null)).toBe('Chưa có chi tiết VAT');
    expect(taxLabel('EXEMPT', null)).toBe('Không chịu VAT');
    expect(taxLabel('TAXABLE', 0)).toBe('VAT 0%');
  });
});
