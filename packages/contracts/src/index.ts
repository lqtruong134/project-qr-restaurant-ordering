export { tableTransferPolicy, type TableTransferReason } from './table-transfer-policy';
export { supportTypes, supportStatuses, supportPolicy } from './support-policy';
export type ServiceHealth = {
  status: 'ok' | 'unavailable';
  service: 'api';
  database?: 'connected' | 'unavailable';
};

export { restaurantPolicy, staffProcedure } from './restaurant-policy';
export {
  orderReasons,
  reasonsByScope,
  reasonOptions,
  reasonLabel,
  type OrderReasonCode,
  type ReasonScope,
} from './order-reasons';

export {
  matchesMenuPromotion,
  type MenuPromotion,
  type MenuPromotionComponent,
} from './menu-promotions';

export type {
  VatTreatment,
  DiscountProgram,
  DiscountOffer,
  BillingLine,
  BillingSummary,
  PromotionView,
  TaxPolicy,
  TaxSettings,
} from './billing';

export type {
  PayosStatus,
  PaymentCapabilities,
  OnlinePaymentView,
  GuestOnlinePayment,
  PaymentReconciliationCase,
  UnmatchedPaymentWebhook,
} from './payments-online';

export * from './menu-assistant';

export type { CollectionAvailability, PaymentFinancialSummary } from './payments-online';
