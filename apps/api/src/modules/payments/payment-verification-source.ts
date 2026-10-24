export const paymentVerificationJoin = `LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*)=0 THEN 'UNVERIFIED'
    WHEN count(*) FILTER(WHERE receipt.metadata->>'verificationSource'='BANK_ADMIN_VERIFIED')=0 THEN 'PAYOS_VERIFIED'
    WHEN count(*) FILTER(WHERE receipt.metadata->>'verificationSource'='BANK_ADMIN_VERIFIED')=count(*) THEN 'BANK_ADMIN_VERIFIED'
    ELSE 'MIXED' END AS verification_source,
    COALESCE(bool_or(receipt.metadata ? 'providerVerifiedAt'),false) AS provider_evidence_attached
  FROM payment_transaction receipt WHERE receipt.payment_intent_id=p.id AND receipt.status='SUCCEEDED'
    AND receipt.provider='PAYOS'
) verification ON true`;

/** Immutable bank evidence can settle a case without pretending payOS has verified it. */
export const paymentBankVerificationJoin = `LEFT JOIN LATERAL (
  SELECT max(e.created_at) AS bank_verified_at,
    count(*)>0 AND NOT EXISTS(
      SELECT 1 FROM payment_transaction receipt WHERE receipt.payment_intent_id=p.id
        AND receipt.status='SUCCEEDED' AND receipt.metadata->>'verificationSource'='BANK_ADMIN_VERIFIED'
        AND NOT EXISTS(SELECT 1 FROM payment_bank_evidence proof JOIN bank_receipt_claim claim
          ON claim.receipt_id=proof.receipt_id AND claim.receiver_digest=proof.receiver_digest
          AND claim.bank_reference=proof.bank_reference AND claim.amount=proof.amount
          AND claim.payment_intent_id=proof.payment_intent_id AND claim.restaurant_id=proof.restaurant_id
          WHERE proof.receipt_id=receipt.id AND proof.payment_intent_id=p.id AND proof.amount=receipt.amount)
    ) AS independent_bank_verified,
    EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE((
      SELECT audit.details->'references' FROM business_audit_event audit
      WHERE audit.resource_id=p.id AND audit.action='PAYOS_PROVIDER_REPORTED'
        AND audit.details->>'orderCode'=q.order_code::text
        AND audit.details->>'paymentLinkId'=q.payment_link_id
      ORDER BY audit.created_at DESC,audit.id DESC LIMIT 1),'[]'::jsonb)) known(reference)
      WHERE NOT EXISTS(SELECT 1 FROM payment_transaction receipt
        WHERE receipt.payment_intent_id=p.id AND receipt.provider='PAYOS'
          AND receipt.status='SUCCEEDED' AND receipt.provider_transaction_id=known.reference)
    ) OR EXISTS(SELECT 1 FROM payment_webhook_event incoming WHERE incoming.provider='PAYOS'
      AND incoming.signature_valid AND incoming.payload_snapshot->>'orderCode'=q.order_code::text
      AND incoming.payload_snapshot->>'paymentLinkId'=q.payment_link_id
      AND incoming.payload_snapshot->>'currency'='VND' AND incoming.payload_snapshot->>'code'='00'
      AND incoming.payload_snapshot->>'recipientEvidenceVersion'='2'
      AND NOT EXISTS(SELECT 1 FROM payment_transaction receipt WHERE receipt.payment_intent_id=p.id
        AND receipt.status='SUCCEEDED' AND receipt.provider='PAYOS'
        AND receipt.provider_transaction_id=incoming.provider_event_id
        AND receipt.amount::text=incoming.payload_snapshot->>'amount')) AS unposted_bank_references
  FROM payment_bank_evidence e WHERE e.payment_intent_id=p.id
) bank_verification ON true`;
