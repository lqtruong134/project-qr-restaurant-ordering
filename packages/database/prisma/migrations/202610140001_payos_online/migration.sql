BEGIN;
CREATE SEQUENCE payos_order_code_seq AS bigint MINVALUE 100000000000 MAXVALUE 9007199254740991 START 100000000000;
CREATE TABLE payos_payment_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL UNIQUE REFERENCES payment_intent(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  order_code bigint NOT NULL UNIQUE DEFAULT nextval('payos_order_code_seq'),
  payment_link_id text UNIQUE,
  status text NOT NULL DEFAULT 'CREATE_PENDING' CHECK(status IN ('CREATE_PENDING','PENDING','PROCESSING','UNDERPAID','PAID','CANCEL_PENDING','CANCELLED','EXPIRED','FAILED','ERROR','REQUIRES_RECONCILIATION')),
  provider_status text,
  request_payload jsonb NOT NULL,
  account_number text,
  checkout_url text,
  qr_code text,
  paid_amount bigint NOT NULL DEFAULT 0 CHECK(paid_amount>=0),
  quarantined_transactions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(quarantined_transactions)='array'),
  last_error text,
  lease_until timestamptz,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  cancel_requested boolean NOT NULL DEFAULT false,
  reconciliation_status text CHECK(reconciliation_status IN ('OPEN','RESOLVED')),
  reconciliation_reason text,
  resolved_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  alert_id uuid REFERENCES operational_alert(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(order_code BETWEEN 1 AND 9007199254740991),

  CHECK(reconciliation_status IS DISTINCT FROM 'RESOLVED' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX payos_request_poll ON payos_payment_request(next_poll_at) WHERE status NOT IN ('PAID','CANCELLED','EXPIRED','FAILED');
CREATE INDEX payos_request_created_by ON payos_payment_request(created_by);
CREATE INDEX payos_request_alert ON payos_payment_request(alert_id);
CREATE INDEX payos_request_resolved_by ON payos_payment_request(resolved_by);
CREATE TRIGGER core_touch BEFORE UPDATE ON payos_payment_request FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON payos_payment_request FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER payos_request_snapshot BEFORE UPDATE ON payos_payment_request FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('payment_intent_id','created_by','order_code','request_payload');
CREATE FUNCTION payos_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_intent p WHERE p.id=NEW.payment_intent_id AND p.method='ONLINE' AND p.provider='PAYOS') OR
 core_tenant('payment_intent',NEW.payment_intent_id) IS DISTINCT FROM core_tenant('app_user',NEW.created_by) OR
 (NEW.resolved_by IS NOT NULL AND core_tenant('payment_intent',NEW.payment_intent_id) IS DISTINCT FROM core_tenant('app_user',NEW.resolved_by)) OR
 (NEW.alert_id IS NOT NULL AND core_tenant('payment_intent',NEW.payment_intent_id) IS DISTINCT FROM core_tenant('operational_alert',NEW.alert_id)) THEN
 RAISE EXCEPTION 'Invalid payOS request scope' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payos_request_scope BEFORE INSERT OR UPDATE ON payos_payment_request FOR EACH ROW EXECUTE FUNCTION payos_request_guard();
DROP INDEX core_intent_capture;
CREATE UNIQUE INDEX core_intent_capture ON payment_transaction(payment_intent_id)
 WHERE payment_intent_id IS NOT NULL AND status='SUCCEEDED' AND provider IS DISTINCT FROM 'PAYOS';
ALTER TABLE support_request DROP CONSTRAINT support_payment_method;
ALTER TABLE support_request ADD CONSTRAINT support_payment_method CHECK(payment_method IS NULL OR (request_type='BILL' AND payment_method IN ('CASH','BANK_TRANSFER','ONLINE')));
ALTER TABLE business_audit_event ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE business_audit_event ADD COLUMN actor_type text CHECK(actor_type IN ('USER','SYSTEM'));
ALTER TABLE business_audit_event ADD CONSTRAINT business_audit_actor CHECK(actor_type IS NULL OR (actor_type='USER' AND actor_id IS NOT NULL) OR (actor_type='SYSTEM' AND actor_id IS NULL));
ALTER TABLE support_request ADD COLUMN resolution_actor_type text NOT NULL DEFAULT 'USER' CHECK(resolution_actor_type IN ('USER','SYSTEM'));
ALTER TABLE support_request DROP CONSTRAINT support_request_owner_state;
ALTER TABLE support_request ADD CONSTRAINT support_request_owner_state CHECK (
 (status='NEW' AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
 OR (status='ACKNOWLEDGED' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND resolved_by IS NULL AND resolved_at IS NULL)
 OR (status='RESOLVED' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND resolved_at IS NOT NULL AND ((resolution_actor_type='USER' AND resolved_by=acknowledged_by) OR (resolution_actor_type='SYSTEM' AND resolved_by IS NULL))) OR status='CANCELLED');
ALTER TABLE support_request_handoff ADD COLUMN response_actor_type text NOT NULL DEFAULT 'USER' CHECK(response_actor_type IN ('USER','SYSTEM'));
DO $$ DECLARE name text; BEGIN
 FOR name IN SELECT conname FROM pg_constraint WHERE conrelid='support_request_handoff'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%responded_by%' OR pg_get_constraintdef(oid) LIKE '%responded_at%') LOOP EXECUTE format('ALTER TABLE support_request_handoff DROP CONSTRAINT %I',name);END LOOP;
END $$;
ALTER TABLE support_request_handoff ADD CONSTRAINT support_handoff_response CHECK(
 (status='PENDING' AND responded_at IS NULL AND responded_by IS NULL AND response_reason IS NULL)
 OR (status<>'PENDING' AND responded_at IS NOT NULL AND responded_at>=requested_at AND length(btrim(response_reason)) BETWEEN 1 AND 500 AND
 ((response_actor_type='SYSTEM' AND status='CANCELLED' AND responded_by IS NULL) OR (response_actor_type='USER' AND responded_by IS NOT NULL AND ((status IN ('ACCEPTED','DECLINED') AND responded_by=to_staff_id) OR (status='CANCELLED' AND responded_by=from_staff_id))))));
CREATE FUNCTION payos_provider_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.payment_link_id IS NOT NULL AND NEW.payment_link_id IS DISTINCT FROM OLD.payment_link_id OR NEW.paid_amount<OLD.paid_amount THEN RAISE EXCEPTION 'Provider snapshot cannot change' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER payos_provider_snapshot BEFORE UPDATE ON payos_payment_request FOR EACH ROW EXECUTE FUNCTION payos_provider_snapshot_guard();
CREATE FUNCTION payos_unsettled_collection(sid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id WHERE p.session_id=sid AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED') AND (p.status IN ('CREATED','PENDING','REQUIRES_RECONCILIATION','CANCELLED','EXPIRED') OR q.status IN ('CREATE_PENDING','ERROR','CANCEL_PENDING')));
$$;
CREATE FUNCTION payos_billing_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT payos_unsettled_collection(NEW.session_id) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='financial_charge' AND TG_OP='UPDATE' THEN
  IF (NEW.discount_amount,NEW.promotion_snapshot,NEW.tax_amount,NEW.tax_snapshot) IS DISTINCT FROM (OLD.discount_amount,OLD.promotion_snapshot,OLD.tax_amount,OLD.tax_snapshot) THEN RAISE EXCEPTION 'PayOS collection keeps billing frozen until reconciled' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='session_promotion' THEN
  IF TG_OP='INSERT' OR (NEW.program_id,NEW.program_snapshot,NEW.eligible_amount,NEW.discount_amount,NEW.explicit_selection) IS DISTINCT FROM (OLD.program_id,OLD.program_snapshot,OLD.eligible_amount,OLD.discount_amount,OLD.explicit_selection) OR (NEW.status IS DISTINCT FROM OLD.status AND NOT(OLD.status='RESERVED' AND NEW.status='USED')) THEN RAISE EXCEPTION 'PayOS promotion stays frozen until reconciled' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payos_billing_lock BEFORE UPDATE ON financial_charge FOR EACH ROW EXECUTE FUNCTION payos_billing_lock_guard();
CREATE TRIGGER payos_promotion_lock BEFORE INSERT OR UPDATE ON session_promotion FOR EACH ROW EXECUTE FUNCTION payos_billing_lock_guard();

COMMIT;
