BEGIN;

-- A receiver is the SHA-256 identity of trusted bank BIN + full primary account.
-- Neither account numbers nor client-entered mappings are stored in this registry.
CREATE TABLE bank_receipt_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receiver_digest text NOT NULL CHECK(receiver_digest ~ '^[a-f0-9]{64}$'),
  bank_reference text NOT NULL CHECK(length(bank_reference) BETWEEN 1 AND 160 AND bank_reference=btrim(bank_reference) AND bank_reference !~ '[[:cntrl:]]'),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  payment_intent_id uuid NOT NULL REFERENCES payment_intent(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL UNIQUE REFERENCES payment_transaction(id) ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 100000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(receiver_digest,bank_reference)
);
CREATE INDEX bank_receipt_claim_intent ON bank_receipt_claim(payment_intent_id);
CREATE INDEX bank_receipt_claim_restaurant ON bank_receipt_claim(restaurant_id);

CREATE TABLE payment_bank_proof (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  payment_intent_id uuid NOT NULL REFERENCES payment_intent(id) ON DELETE RESTRICT,
  uploaded_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  filename text NOT NULL UNIQUE CHECK(filename ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg|webp)$'),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 2097152),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_bank_proof_intent ON payment_bank_proof(payment_intent_id);
CREATE INDEX payment_bank_proof_hash ON payment_bank_proof(restaurant_id,sha256);
CREATE INDEX payment_bank_proof_uploader ON payment_bank_proof(uploaded_by);

CREATE TABLE payment_bank_preview (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  payment_intent_id uuid NOT NULL REFERENCES payment_intent(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  proof_id uuid NOT NULL REFERENCES payment_bank_proof(id) ON DELETE RESTRICT,
  bank_reference text NOT NULL CHECK(length(bank_reference) BETWEEN 1 AND 160 AND bank_reference=btrim(bank_reference) AND bank_reference !~ '[[:cntrl:]]'),
  amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 100000000000),
  bank_transaction_at timestamptz NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  receipt_id uuid REFERENCES payment_transaction(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
  CHECK((confirmed_at IS NULL AND receipt_id IS NULL) OR (confirmed_at IS NOT NULL AND receipt_id IS NOT NULL AND confirmed_at>=created_at))
);
CREATE INDEX payment_bank_preview_intent ON payment_bank_preview(payment_intent_id);
CREATE INDEX payment_bank_preview_actor ON payment_bank_preview(actor_id);
CREATE INDEX payment_bank_preview_proof ON payment_bank_preview(proof_id);
CREATE INDEX payment_bank_preview_receipt ON payment_bank_preview(receipt_id);

CREATE TABLE payment_bank_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_id uuid NOT NULL UNIQUE REFERENCES payment_bank_preview(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES payment_transaction(id) ON DELETE RESTRICT,
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  payment_intent_id uuid NOT NULL REFERENCES payment_intent(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  proof_id uuid NOT NULL REFERENCES payment_bank_proof(id) ON DELETE RESTRICT,
  bank_reference text NOT NULL CHECK(length(bank_reference) BETWEEN 1 AND 160 AND bank_reference=btrim(bank_reference) AND bank_reference !~ '[[:cntrl:]]'),
  amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 100000000000),
  bank_transaction_at timestamptz NOT NULL,
  receiver_digest text NOT NULL CHECK(receiver_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_bank_evidence_intent ON payment_bank_evidence(payment_intent_id);
CREATE INDEX payment_bank_evidence_receipt ON payment_bank_evidence(receipt_id);
CREATE INDEX payment_bank_evidence_actor ON payment_bank_evidence(actor_id);
CREATE INDEX payment_bank_evidence_proof ON payment_bank_evidence(proof_id);

CREATE FUNCTION bank_payment_evidence_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof_row payment_bank_proof; preview_row payment_bank_preview; receipt_row payment_transaction;
BEGIN
  IF core_tenant('payment_intent',NEW.payment_intent_id) IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION 'Bank evidence intent outside restaurant' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='payment_bank_proof' THEN
    IF core_tenant('app_user',NEW.uploaded_by) IS DISTINCT FROM NEW.restaurant_id THEN
      RAISE EXCEPTION 'Bank proof uploader outside restaurant' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME IN ('payment_bank_preview','payment_bank_evidence') THEN
    SELECT * INTO proof_row FROM payment_bank_proof WHERE id=NEW.proof_id;
    IF core_tenant('app_user',NEW.actor_id) IS DISTINCT FROM NEW.restaurant_id OR
       proof_row.restaurant_id IS DISTINCT FROM NEW.restaurant_id OR
       proof_row.payment_intent_id IS DISTINCT FROM NEW.payment_intent_id OR
       proof_row.uploaded_by IS DISTINCT FROM NEW.actor_id THEN
      RAISE EXCEPTION 'Bank proof does not belong to actor and intent' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='payment_bank_evidence' THEN
    SELECT * INTO preview_row FROM payment_bank_preview WHERE id=NEW.preview_id;
    IF preview_row.restaurant_id IS DISTINCT FROM NEW.restaurant_id OR
       preview_row.payment_intent_id IS DISTINCT FROM NEW.payment_intent_id OR
       preview_row.actor_id IS DISTINCT FROM NEW.actor_id OR
       preview_row.proof_id IS DISTINCT FROM NEW.proof_id OR
       preview_row.bank_reference IS DISTINCT FROM NEW.bank_reference OR
       preview_row.amount IS DISTINCT FROM NEW.amount OR
       preview_row.bank_transaction_at IS DISTINCT FROM NEW.bank_transaction_at OR
       preview_row.receipt_id IS DISTINCT FROM NEW.receipt_id OR preview_row.confirmed_at IS NULL THEN
      RAISE EXCEPTION 'Bank evidence does not match confirmed preview' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM bank_receipt_claim r WHERE r.receipt_id=NEW.receipt_id
      AND r.receiver_digest=NEW.receiver_digest AND r.bank_reference=NEW.bank_reference
      AND r.restaurant_id=NEW.restaurant_id AND r.payment_intent_id=NEW.payment_intent_id
      AND r.amount=NEW.amount) THEN
      RAISE EXCEPTION 'Bank evidence requires canonical receipt identity' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='bank_receipt_claim' OR NEW.receipt_id IS NOT NULL THEN
    SELECT * INTO receipt_row FROM payment_transaction WHERE id=NEW.receipt_id;
    IF receipt_row.payment_intent_id IS DISTINCT FROM NEW.payment_intent_id OR
       receipt_row.amount IS DISTINCT FROM NEW.amount OR receipt_row.status IS DISTINCT FROM 'SUCCEEDED' OR
       core_tenant('payment_transaction',NEW.receipt_id) IS DISTINCT FROM NEW.restaurant_id THEN
      RAISE EXCEPTION 'Bank receipt does not match evidence scope or amount' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_receipt_claim_scope BEFORE INSERT OR UPDATE ON bank_receipt_claim FOR EACH ROW EXECUTE FUNCTION bank_payment_evidence_scope_guard();
CREATE TRIGGER payment_bank_proof_scope BEFORE INSERT OR UPDATE ON payment_bank_proof FOR EACH ROW EXECUTE FUNCTION bank_payment_evidence_scope_guard();
CREATE TRIGGER payment_bank_preview_scope BEFORE INSERT OR UPDATE ON payment_bank_preview FOR EACH ROW EXECUTE FUNCTION bank_payment_evidence_scope_guard();
CREATE TRIGGER payment_bank_evidence_scope BEFORE INSERT OR UPDATE ON payment_bank_evidence FOR EACH ROW EXECUTE FUNCTION bank_payment_evidence_scope_guard();

CREATE TRIGGER bank_receipt_claim_fixed BEFORE UPDATE ON bank_receipt_claim FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE TRIGGER bank_receipt_claim_no_delete BEFORE DELETE ON bank_receipt_claim FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER payment_bank_proof_fixed BEFORE UPDATE ON payment_bank_proof FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE TRIGGER payment_bank_proof_no_delete BEFORE DELETE ON payment_bank_proof FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER payment_bank_evidence_fixed BEFORE UPDATE ON payment_bank_evidence FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE TRIGGER payment_bank_evidence_no_delete BEFORE DELETE ON payment_bank_evidence FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER payment_bank_preview_fixed BEFORE UPDATE ON payment_bank_preview FOR EACH ROW EXECUTE FUNCTION core_fixed_columns(
  'id','token_hash','restaurant_id','payment_intent_id','actor_id','proof_id','bank_reference','amount',
  'bank_transaction_at','reason','snapshot','expires_at','created_at');
CREATE FUNCTION bank_payment_preview_confirm_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.confirmed_at IS NOT NULL AND (NEW.confirmed_at,NEW.receipt_id) IS DISTINCT FROM (OLD.confirmed_at,OLD.receipt_id) THEN
    RAISE EXCEPTION 'Confirmed bank preview is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL AND now()>OLD.expires_at THEN
    RAISE EXCEPTION 'Bank preview expired' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_bank_preview_confirm_once BEFORE UPDATE ON payment_bank_preview FOR EACH ROW EXECUTE FUNCTION bank_payment_preview_confirm_once();
CREATE TRIGGER payment_bank_preview_no_delete BEFORE DELETE ON payment_bank_preview FOR EACH ROW EXECUTE FUNCTION core_no_delete();

COMMIT;