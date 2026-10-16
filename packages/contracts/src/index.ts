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
  PaymentReconciliationCase,
  UnmatchedPaymentWebhook,
} from './payments-online';

export {
  MENU_ASSISTANT_CONTRACT_VERSION,
  assistantIncludes,
  assistantReasonCodes,
  assistantClarificationFields,
  assistantRequestSchema,
  assistantDecisionSchema,
  AssistantContractError,
  parseAssistantRequest,
  parseAssistantDecision,
  assistantNeedsStaff,
  assistantCategoryIncludes,
  assistantSystemPolicy,
  type AssistantInclude,
  type AssistantReasonCode,
  type AssistantClarificationField,
  type AssistantRequest,
  type AssistantDecision,
  type AssistantMenuProduct,
  type AssistantContext,
  type AssistantProviderInput,
  type AssistantMode,
  type AssistantResponse,
  type AssistantCapabilities,
} from './menu-assistant';
