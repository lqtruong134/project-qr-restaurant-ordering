export type BankEvidenceProof = {
  id: string;
  mime: string;
  sha256: string;
  byteSize: number;
  uploadedAt: string;
  proofUrl: string;
};
export type BankEvidenceFacts = {
  intentId: string;
  sessionId: string;
  sessionCode: string;
  tableCode: string;
  sessionStatus: string;
  intentStatus: string;
  providerStatus: string | null;
  orderCode: string;
  paymentLinkId: string | null;
  quoteAmount: string;
  bankReportedAmount: string;
  recordedAmount: string;
  appliedAmount: string;
  outstandingAmount: string;
  remainingQuoteAmount: string;
  receiverBank: string | null;
  receiverAccountMasked: string | null;
  providerReferences: string[];
  createdAt: string;
  expiresAt: string;
  canVerify: boolean;
  blockers: string[];
};
export type BankEvidenceContext = {
  facts: BankEvidenceFacts;
  proofs: BankEvidenceProof[];
  history: {
    receiptId: string;
    reference: string;
    amount: string;
    confirmedAt: string;
    proofId?: string;
  }[];
};
export type BankEvidenceInput = {
  proofId: string;
  reference: string;
  amount: string;
  bankTransactionAt: string;
  reason: string;
  attested: true;
};
export type BankEvidencePreview = {
  token: string | null;
  expiresAt: string | null;
  canConfirm: boolean;
  blockers: string[];
  facts: BankEvidenceFacts;
  impact: {
    recordedDelta: string;
    allocatedDelta: string;
    unallocatedDelta: string;
    outstandingAfter: string;
  };
};
export type BankEvidenceConfirmation = {
  receiptId: string;
  alreadyProcessed: boolean;
  verificationSource: 'BANK_ADMIN_VERIFIED';
};
