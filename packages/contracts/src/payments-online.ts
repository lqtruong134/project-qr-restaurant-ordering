export type PayosStatus =
  | 'CREATE_PENDING'
  | 'PENDING'
  | 'PROCESSING'
  | 'UNDERPAID'
  | 'PAID'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'
  | 'ERROR'
  | 'REQUIRES_RECONCILIATION';
export type PaymentCapabilities = { online: boolean; reason?: string };
export type OnlinePaymentView = {
  provider: 'PAYOS';
  status: PayosStatus;
  orderCode: string;
  checkoutUrl: string | null;
  qrCode: string | null;
  expiresAt: string;
  lastError: string | null;
  paidAmount: string;
  remainingAmount: string;
};
export type PaymentReconciliationCase = {
  id: string;
  session_id: string;
  table_code: string;
  session_status: string;
  amount: string;
  paid_amount: string;
  quarantined_amount: string;
  provider_status: string;
  last_error: string | null;
  updated_at: string;
  reason: string | null;
  status: 'OPEN' | 'RESOLVED';
};

export type UnmatchedPaymentWebhook = {
  id: string;
  orderCode: string | null;
  amount: string;
  currency: string | null;
  reference: string;
  receivedAt: string;
};

/** A scoped display projection, never a provider payload or a payment mutation credential. */
export type GuestOnlinePayment = {
  id: string;
  scope: 'TABLE' | 'PARTICIPANT';
  amount: string;
  status: PayosStatus;
  /** Successful bank collections already recorded in the restaurant ledger. */
  paidAmount: string;
  /** Provider-confirmed funds can include quarantined amounts requiring staff reconciliation. */
  bankConfirmedAmount: string;
  remainingAmount: string;
  expiresAt: string;
  createdAt: string;
  supportRequestId?: string;
};
