export type VatTreatment = 'TAXABLE' | 'EXEMPT' | 'LEGACY';
export type DiscountProgram = {
  id: string;
  name: string;
  description: string;
  mode: 'AUTO' | 'CODE';
  code: string | null;
  type: 'PERCENT' | 'FIXED';
  percent: number | null;
  fixedAmount: string | null;
  minEligibleAmount: string;
  maxDiscountAmount: string | null;
  startsAt: string;
  endsAt: string;
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  scope: 'ALL' | 'PRODUCTS' | 'CATEGORIES';
  productNames?: string[];
  categoryNames?: string[];
  productIds: string[];
  categoryIds: string[];
  excludeCombos: boolean;
  usageLimit: number | null;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  version: number;
  usedCount: number;
  reservedCount: number;
  createdAt: string;
};
export type DiscountOffer = DiscountProgram & {
  eligible: boolean;
  eligibleAmount: string;
  discountAmount: string;
  reason: string | null;
};
export type BillingLine = {
  chargeId: string;
  orderItemId: string | null;
  grossAmount: string;
  discountAmount: string;
  payableAmount: string;
  beforeVatAmount: string;
  vatAmount: string;
  taxTreatment: VatTreatment;
  vatRatePercent: number | null;
  promotionId: string | null;
};
export type BillingSummary = {
  version: 1;
  priceIncludesVat: true;
  subtotalAmount: string;
  discountAmount: string;
  payableAmount: string;
  beforeVatAmount: string;
  vatAmount: string;
  vatGroups: {
    treatment: VatTreatment;
    ratePercent: number | null;
    beforeVatAmount: string;
    vatAmount: string;
    totalAmount: string;
  }[];
  promotion: {
    id: string;
    name: string;
    code: string | null;
    status: 'SELECTED' | 'RESERVED' | 'USED';
    locked: boolean;
    eligibleAmount: string;
    discountAmount: string;
    reason: string | null;
  } | null;
  lines: BillingLine[];
  legacyTaxUnavailable: boolean;
};
export type PromotionView = {
  billing: BillingSummary;
  programs: DiscountOffer[];
  locked: boolean;
};
export type TaxPolicy = {
  id: string;
  effectiveAt: string;
  defaultRatePercent: 0 | 5 | 8 | 10;
  version: number;
  reason: string;
  createdAt: string;
};
export type TaxSettings = {
  priceIncludesVat: true;
  policies: TaxPolicy[];
  current: TaxPolicy | null;
  products: {
    id: string;
    code: string;
    name: string;
    treatment: 'DEFAULT' | 'TAXABLE' | 'EXEMPT';
    ratePercent: 0 | 5 | 8 | 10 | null;
    version: number;
  }[];
};
