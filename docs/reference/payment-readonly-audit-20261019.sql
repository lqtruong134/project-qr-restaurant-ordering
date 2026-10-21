-- Operator-only diagnostic. Do not replace this with UPDATE/resolve/seed commands.
-- Run with an authorized read-only PostgreSQL client. No credentials are embedded.
-- Output contains amounts, statuses and equality booleans, not account/reference/customer values.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH target AS (
  SELECT s.*,t.restaurant_id,t.code AS table_code
  FROM table_session s JOIN dining_table t ON t.id=s.table_id
  WHERE t.code='A01' AND upper(left(replace(s.id::text,'-',''),8))='FFC78214'
), inputs AS (
  SELECT p.*,q.id AS provider_request_id,q.order_code,q.payment_link_id,
    q.account_number,q.status AS online_status,q.provider_status,q.paid_amount,
    q.reconciliation_status,q.reconciliation_reason,q.quarantined_transactions,
    q.resolved_at,s.table_code,s.session_status,s.receipt_snapshot IS NOT NULL AS has_frozen_receipt
  FROM target s JOIN payment_intent p ON p.session_id=s.id
  JOIN payos_payment_request q ON q.payment_intent_id=p.id
)
SELECT jsonb_build_object(
  'sessionHint','A01/#FFC78214','sessionStatus',i.session_status,
  'frozenReceiptPresent',i.has_frozen_receipt,'requestedAmount',i.amount::text,
  'intentStatus',i.status,'onlineStatus',i.online_status,'providerStatus',i.provider_status,
  'providerReportedAmount',i.paid_amount::text,
  'hasExpectedCreateRecipient',NULLIF(trim(i.account_number),'') IS NOT NULL,
  'hasStoredProviderLink',i.payment_link_id IS NOT NULL,
  'reconciliationStatus',i.reconciliation_status,
  'hasReason',NULLIF(trim(i.reconciliation_reason),'') IS NOT NULL,
  'recordedAmount',COALESCE((SELECT sum(t.amount) FROM payment_transaction t
    WHERE t.payment_intent_id=i.id AND t.provider='PAYOS' AND t.status='SUCCEEDED'),0)::text,
  'activeAllocatedAmount',COALESCE((SELECT sum(a.allocated_amount-a.reversed_amount)
    FROM payment_allocation a JOIN payment_transaction t ON t.id=a.payment_transaction_id
    JOIN financial_charge c ON c.id=a.financial_charge_id
    WHERE t.payment_intent_id=i.id AND t.status='SUCCEEDED' AND c.status='ACTIVE'),0)::text,
  'actualRefundedAmount',COALESCE((SELECT sum(r.amount) FROM refund_transaction r
    JOIN refund_case f ON f.id=r.refund_case_id JOIN payment_transaction t ON t.id=f.source_payment_transaction_id
    WHERE t.payment_intent_id=i.id AND r.status='SUCCEEDED'),0)::text,
  'quarantinedAmount',COALESCE((SELECT sum((x->>'amount')::bigint)
    FROM jsonb_array_elements(i.quarantined_transactions) x),0)::text,
  'account',(SELECT jsonb_build_object('billTotal',a.charge_total::text,'grossRecorded',a.paid_total::text,
    'outstanding',a.outstanding_amount::text,'reserved',a.reserved_payment_amount::text,
    'refundDue',a.refund_due_amount::text,'actualRefunded',a.refunded_total::text)
    FROM session_financial_account a WHERE a.session_id=i.session_id),
  'webhookEvidence',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'signatureVerified',e.signature_valid,'processingStatus',e.processing_status,
    'amount',e.payload_snapshot->>'amount','currency',e.payload_snapshot->>'currency',
    'matchingOrder',e.payload_snapshot->>'orderCode'=i.order_code::text,
    'matchingLink',e.payload_snapshot->>'paymentLinkId'=i.payment_link_id,
    'recipientEvidenceVersion',e.payload_snapshot->>'recipientEvidenceVersion',
    'hasPrimaryRecipient',NULLIF(e.payload_snapshot->>'recipientAccountNumber','') IS NOT NULL,
    'hasVirtualRecipient',NULLIF(e.payload_snapshot->>'recipientVirtualAccountNumber','') IS NOT NULL,
    'expectedMatchesPrimary',i.account_number=e.payload_snapshot->>'recipientAccountNumber',
    'expectedMatchesVirtual',i.account_number=e.payload_snapshot->>'recipientVirtualAccountNumber'
  ) ORDER BY e.received_at) FROM payment_webhook_event e
    WHERE e.provider='PAYOS' AND e.payload_snapshot->>'orderCode'=i.order_code::text), '[]'::jsonb)
) AS sanitized_payment_audit
FROM inputs i ORDER BY i.created_at;
ROLLBACK;
