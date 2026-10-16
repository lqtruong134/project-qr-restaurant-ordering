ALTER TABLE support_request ADD COLUMN payment_method text;
ALTER TABLE support_request ADD CONSTRAINT support_payment_method CHECK (
  payment_method IS NULL OR (request_type='BILL' AND payment_method IN ('CASH','BANK_TRANSFER'))
);
ALTER TABLE payment_intent
  ADD COLUMN collection_scope text NOT NULL DEFAULT 'TABLE',
  ADD COLUMN support_request_id uuid REFERENCES support_request(id) ON DELETE RESTRICT,
  ADD COLUMN proof jsonb;
ALTER TABLE payment_intent ADD CONSTRAINT payment_collection_scope CHECK (
  collection_scope IN ('TABLE','PARTICIPANT') AND (collection_scope<>'PARTICIPANT' OR payer_participant_id IS NOT NULL)
);
CREATE INDEX payment_intent_support_request ON payment_intent(support_request_id);
