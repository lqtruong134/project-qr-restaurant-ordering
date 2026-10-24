export type PaymentVerificationSource =
  'UNVERIFIED' | 'PAYOS_VERIFIED' | 'BANK_ADMIN_VERIFIED' | 'MIXED';
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
  verificationSource?: PaymentVerificationSource;
  providerEvidenceAttached?: boolean;
  status: PayosStatus;
  orderCode: string;
  checkoutUrl: string | null;
  qrCode: string | null;
  expiresAt: string;
  lastError: string | null;
  paidAmount: string;
  bankReportedAmount?: string;
  recordedAmount?: string;
  appliedAmount?: string;
  refundedAmount?: string;
  unallocatedAmount?: string;
  remainingAmount: string;
};
export type PaymentReconciliationCase = {
  verification_source?: PaymentVerificationSource;
  provider_evidence_attached?: boolean;
  id: string;
  session_id: string;
  table_code: string;
  session_status: string;
  amount: string;
  paid_amount: string;
  quarantined_amount: string;
  recorded_amount?: string;
  allocated_amount?: string;
  refunded_amount?: string;
  unapplied_amount?: string;
  provider_status: string;
  last_error: string | null;
  updated_at: string;
  reason: string | null;
  status: 'OPEN' | 'RESOLVED';
  provider_references?: string[];
  verified_at?: string | null;
  bank_verified_at?: string | null;
  acknowledged_at?: string | null;
  acknowledged_by_name?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  refund_due_amount?: string;
  can_resolve?: boolean;
  resolution_blockers?: string[];
  can_return_externally?: boolean;
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
  verificationSource?: PaymentVerificationSource;
  providerEvidenceAttached?: boolean;
  id: string;
  scope: 'TABLE' | 'PARTICIPANT';
  amount: string;
  status: PayosStatus;
  /** Successful bank collections already recorded in the restaurant ledger. */
  paidAmount: string;
  /** Provider-confirmed funds can include quarantined amounts requiring staff reconciliation. */
  bankConfirmedAmount: string;
  /** Active bill allocations. Gross received money can also contain a refundable balance. */
  appliedAmount?: string;
  /** Successful actual returns, never just an approved refund document. */
  refundedAmount?: string;
  /** Ledger money not assigned to active charges and still owed back to the guest. */
  refundableAmount?: string;
  remainingAmount: string;
  expiresAt: string;
  createdAt: string;
  supportRequestId?: string;
};

/** Backend projection: a reservation never counts as a payment. All money is integer VND. */
export type CollectionAvailability = {
  outstandingAmount: string;
  reservedAmount: string;
  availableAmount: string;
  blockedReason: string | null;
  participants: {
    participantId: string;
    outstandingAmount: string;
    reservedAmount: string;
    availableAmount: string;
  }[];
};
export type PaymentFinancialSummary = {
  billTotal: string;
  bankReportedAmount: string;
  recordedAmount: string;
  appliedAmount: string;
  outstandingAmount: string;
  pendingOnlineAmount: string;
  reservedAmount: string;
  availableToCollect: string;
  unallocatedAmount: string;
  refundDueAmount: string;
  refundedAmount: string;
  reviewRequired: boolean;
};
