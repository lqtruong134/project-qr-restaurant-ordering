BEGIN;

-- Deliberately scoped to the two operator-confirmed tests. Financial rows stay intact.
CREATE TABLE payos_test_case_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES table_session(id) ON DELETE RESTRICT,
  table_id uuid NOT NULL REFERENCES dining_table(id) ON DELETE RESTRICT,
  table_code text NOT NULL,
  payment_intent_id uuid NOT NULL UNIQUE REFERENCES payment_intent(id) ON DELETE RESTRICT,
  payos_request_id uuid NOT NULL UNIQUE REFERENCES payos_payment_request(id) ON DELETE RESTRICT,
  webhook_id uuid NOT NULL UNIQUE REFERENCES payment_webhook_event(id) ON DELETE RESTRICT,
  alert_id uuid NOT NULL UNIQUE REFERENCES operational_alert(id) ON DELETE RESTRICT,
  order_code bigint NOT NULL UNIQUE,
  payment_link_id text NOT NULL UNIQUE,
  bank_reference text NOT NULL UNIQUE CHECK(length(bank_reference) BETWEEN 1 AND 160 AND bank_reference=btrim(bank_reference) AND bank_reference !~ '[[:cntrl:]]'),
  amount bigint NOT NULL CHECK(amount=5000),
  original_audit_count integer NOT NULL,
  plan_hash text NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
  snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
  bundle_hash text NOT NULL CHECK(bundle_hash ~ '^[a-f0-9]{64}$'),
  backup_manifest_hash text NOT NULL CHECK(backup_manifest_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 1000),
  archived_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  visible_in_operations boolean NOT NULL DEFAULT false,
  visibility_restored_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  visibility_restored_at timestamptz,
  visibility_restore_reason text,
  CHECK((table_code='A01' AND left(session_id::text,8)='ffc78214' AND original_audit_count=8789)
     OR (table_code='A02' AND left(session_id::text,8)='300659c7' AND original_audit_count=10284)),
  CHECK((NOT visible_in_operations AND visibility_restored_by IS NULL AND visibility_restored_at IS NULL AND visibility_restore_reason IS NULL)
     OR (visible_in_operations AND visibility_restored_by IS NOT NULL AND visibility_restored_at>=archived_at AND length(btrim(visibility_restore_reason)) BETWEEN 20 AND 1000))
);
CREATE INDEX payos_test_archive_restaurant ON payos_test_case_archive(restaurant_id,archived_at);
CREATE INDEX payos_test_archive_session ON payos_test_case_archive(session_id);

CREATE TABLE payos_test_archive_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES payos_test_case_archive(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK(event_kind IN ('ARCHIVED','WEBHOOK_REPLAY','WEBHOOK_CONFLICT','PROVIDER_RESULT','VISIBILITY_RESTORED')),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  payload_snapshot jsonb NOT NULL CHECK(jsonb_typeof(payload_snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(archive_id,event_kind,payload_hash)
);
CREATE INDEX payos_test_archive_event_case ON payos_test_archive_event(archive_id,created_at);
CREATE TRIGGER core_no_delete BEFORE DELETE ON payos_test_case_archive FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER core_no_delete BEFORE DELETE ON payos_test_archive_event FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER archive_event_fixed BEFORE UPDATE ON payos_test_archive_event FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('id','archive_id','event_kind','payload_hash','payload_snapshot','created_at');

CREATE FUNCTION payos_test_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payment_intent; q payos_payment_request; s table_session; t dining_table; w payment_webhook_event; lock_key text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['visible_in_operations','visibility_restored_by','visibility_restored_at','visibility_restore_reason'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['visible_in_operations','visibility_restored_by','visibility_restored_at','visibility_restore_reason'])
      OR OLD.visible_in_operations OR NOT NEW.visible_in_operations THEN
      RAISE EXCEPTION 'Archive evidence and posting tombstone are immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO p FROM payment_intent WHERE id=NEW.payment_intent_id FOR UPDATE;
    SELECT * INTO q FROM payos_payment_request WHERE id=NEW.payos_request_id FOR UPDATE;
    SELECT * INTO s FROM table_session WHERE id=p.session_id FOR UPDATE;
    SELECT * INTO t FROM dining_table WHERE id=s.table_id;
    SELECT * INTO w FROM payment_webhook_event WHERE id=NEW.webhook_id;
    FOR lock_key IN SELECT key FROM unnest(ARRAY['PAYOS:'||NEW.bank_reference,NEW.restaurant_id::text||':bank:'||NEW.bank_reference]) AS keys(key) ORDER BY key COLLATE "C" LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
    END LOOP;
    IF p.id IS NULL OR p.session_id IS DISTINCT FROM NEW.session_id OR t.id IS DISTINCT FROM NEW.table_id OR
      t.restaurant_id IS DISTINCT FROM NEW.restaurant_id OR t.code IS DISTINCT FROM NEW.table_code OR
      p.provider IS DISTINCT FROM 'PAYOS' OR p.method IS DISTINCT FROM 'ONLINE' OR p.amount<>5000 OR
      p.status IS DISTINCT FROM 'REQUIRES_RECONCILIATION' OR q.payment_intent_id IS DISTINCT FROM p.id OR
      q.provider_status IS DISTINCT FROM 'PAID' OR q.reconciliation_status IS DISTINCT FROM 'OPEN' OR
      q.paid_amount<>5000 OR q.order_code IS DISTINCT FROM NEW.order_code OR
      q.payment_link_id IS DISTINCT FROM NEW.payment_link_id OR q.alert_id IS DISTINCT FROM NEW.alert_id OR
      w.provider IS DISTINCT FROM 'PAYOS' OR NOT w.signature_valid OR w.payment_transaction_id IS NOT NULL OR
      w.provider_event_id IS DISTINCT FROM NEW.bank_reference OR
      w.payload_snapshot->>'restaurantId' IS DISTINCT FROM NEW.restaurant_id::text OR
      w.payload_snapshot->>'orderCode' IS DISTINCT FROM NEW.order_code::text OR
      w.payload_snapshot->>'paymentLinkId' IS DISTINCT FROM NEW.payment_link_id OR
      w.payload_snapshot->>'amount' IS DISTINCT FROM '5000' OR
      w.payload_snapshot->>'currency' IS DISTINCT FROM 'VND' OR w.payload_snapshot->>'code' IS DISTINCT FROM '00' OR
      (q.lease_until IS NOT NULL AND q.lease_until>clock_timestamp()) OR
      (SELECT count(*) FROM idempotency_record WHERE payment_intent_id=p.id)<>1 OR
      (SELECT count(*) FROM business_audit_event WHERE restaurant_id=NEW.restaurant_id AND resource_id=p.id
        AND action NOT IN ('PAYOS_TEST_CASE_ARCHIVED','PAYOS_TEST_VISIBILITY_RESTORED'))<>NEW.original_audit_count OR
      EXISTS(SELECT 1 FROM payment_transaction x WHERE x.payment_intent_id=p.id OR
        (x.provider='PAYOS' AND x.provider_transaction_id=NEW.bank_reference) OR
        (x.method='BANK_TRANSFER' AND core_tenant('table_session',x.session_id)=NEW.restaurant_id AND x.metadata->>'reference'=NEW.bank_reference)) OR
      EXISTS(SELECT 1 FROM bank_receipt_claim WHERE restaurant_id=NEW.restaurant_id AND bank_reference=NEW.bank_reference) THEN
      RAISE EXCEPTION 'Archive scope or financial evidence differs' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
    JOIN role r ON r.id=ur.role_id AND r.code='ADMIN' WHERE u.id=CASE WHEN TG_OP='INSERT' THEN NEW.archived_by ELSE NEW.visibility_restored_by END
    AND u.restaurant_id=NEW.restaurant_id AND u.status='ACTIVE') THEN
    RAISE EXCEPTION 'Active restaurant administrator required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payos_test_archive_scope BEFORE INSERT OR UPDATE ON payos_test_case_archive FOR EACH ROW EXECUTE FUNCTION payos_test_archive_guard();

CREATE FUNCTION payos_test_archived_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blocked boolean;
BEGIN
  IF TG_TABLE_NAME='payment_intent' THEN
    SELECT EXISTS(SELECT 1 FROM payos_test_case_archive WHERE payment_intent_id=OLD.id) INTO blocked;
  ELSIF TG_TABLE_NAME='payos_payment_request' THEN
    SELECT EXISTS(SELECT 1 FROM payos_test_case_archive WHERE payos_request_id=OLD.id) INTO blocked;
  ELSIF TG_TABLE_NAME='operational_alert' THEN
    SELECT EXISTS(SELECT 1 FROM payos_test_case_archive WHERE alert_id=OLD.id) INTO blocked;
  ELSIF TG_TABLE_NAME='payment_webhook_event' THEN
    SELECT EXISTS(SELECT 1 FROM payos_test_case_archive WHERE webhook_id=OLD.id) INTO blocked;
  ELSE
    PERFORM s.id FROM table_session s JOIN payment_intent p ON p.session_id=s.id WHERE p.id=NEW.payment_intent_id FOR UPDATE OF s;
    SELECT EXISTS(SELECT 1 FROM payos_test_case_archive WHERE payment_intent_id=NEW.payment_intent_id) INTO blocked;
  END IF;
  IF blocked THEN RAISE EXCEPTION 'Archived test evidence is frozen; use archive review' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_freeze BEFORE UPDATE ON payment_intent FOR EACH ROW EXECUTE FUNCTION payos_test_archived_row_guard();
CREATE TRIGGER archive_freeze BEFORE UPDATE ON payos_payment_request FOR EACH ROW EXECUTE FUNCTION payos_test_archived_row_guard();
CREATE TRIGGER archive_freeze BEFORE UPDATE ON operational_alert FOR EACH ROW EXECUTE FUNCTION payos_test_archived_row_guard();
CREATE TRIGGER archive_freeze BEFORE UPDATE ON payment_webhook_event FOR EACH ROW EXECUTE FUNCTION payos_test_archived_row_guard();
CREATE TRIGGER archive_freeze BEFORE INSERT OR UPDATE ON payment_bank_proof FOR EACH ROW EXECUTE FUNCTION payos_test_archived_row_guard();
CREATE TRIGGER archive_freeze BEFORE INSERT OR UPDATE ON payment_bank_preview FOR EACH ROW EXECUTE FUNCTION payos_test_archived_row_guard();
CREATE TRIGGER archive_freeze BEFORE INSERT OR UPDATE ON payment_bank_evidence FOR EACH ROW EXECUTE FUNCTION payos_test_archived_row_guard();

CREATE FUNCTION payos_archived_idempotency_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP<>'DELETE' THEN
    PERFORM s.id FROM table_session s JOIN payment_intent p ON p.session_id=s.id
      WHERE p.id=NEW.payment_intent_id FOR UPDATE OF s;
  ELSE
    PERFORM s.id FROM table_session s JOIN payment_intent p ON p.session_id=s.id
      WHERE p.id=OLD.payment_intent_id FOR UPDATE OF s;
  END IF;
  IF TG_OP<>'INSERT' THEN
    IF EXISTS(SELECT 1 FROM payos_test_case_archive WHERE payment_intent_id=OLD.payment_intent_id) THEN
      RAISE EXCEPTION 'Archived test idempotency key is retained' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN
    IF EXISTS(SELECT 1 FROM payos_test_case_archive WHERE payment_intent_id=NEW.payment_intent_id) THEN
      RAISE EXCEPTION 'Archived test idempotency key is retained' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER archive_idempotency_block BEFORE INSERT OR UPDATE OR DELETE ON idempotency_record FOR EACH ROW EXECUTE FUNCTION payos_archived_idempotency_guard();

CREATE FUNCTION payos_archived_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reference_value text; restaurant_value uuid; lock_key text;
BEGIN
  IF TG_TABLE_NAME='payment_transaction' THEN
    PERFORM id FROM table_session WHERE id=NEW.session_id FOR UPDATE;
    reference_value:=CASE WHEN NEW.provider='PAYOS' THEN NEW.provider_transaction_id WHEN NEW.method='BANK_TRANSFER' THEN NEW.metadata->>'reference' END;
    restaurant_value:=core_tenant('table_session',NEW.session_id);
  ELSE
    PERFORM s.id FROM table_session s JOIN payment_intent p ON p.session_id=s.id WHERE p.id=NEW.payment_intent_id FOR UPDATE OF s;
    reference_value:=NEW.bank_reference; restaurant_value:=NEW.restaurant_id;
  END IF;
  IF reference_value IS NOT NULL THEN
    FOR lock_key IN SELECT key FROM unnest(ARRAY['PAYOS:'||reference_value,restaurant_value::text||':bank:'||reference_value]) AS keys(key) ORDER BY key COLLATE "C" LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
    END LOOP;
  END IF;
  IF TG_TABLE_NAME='payment_transaction' THEN
    IF EXISTS(SELECT 1 FROM payos_test_case_archive a WHERE a.payment_intent_id=NEW.payment_intent_id OR
       (NEW.provider='PAYOS' AND a.bank_reference=NEW.provider_transaction_id) OR
       (NEW.method='BANK_TRANSFER' AND a.restaurant_id=core_tenant('table_session',NEW.session_id) AND a.bank_reference=NEW.metadata->>'reference')) THEN
      RAISE EXCEPTION 'Archived test bank receipt cannot be posted' USING ERRCODE='23514';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM payos_test_case_archive a WHERE a.payment_intent_id=NEW.payment_intent_id OR
       (a.restaurant_id=NEW.restaurant_id AND a.bank_reference=NEW.bank_reference)) THEN
      RAISE EXCEPTION 'Archived test reference cannot be claimed' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_receipt_block BEFORE INSERT OR UPDATE ON payment_transaction FOR EACH ROW EXECUTE FUNCTION payos_archived_receipt_guard();
CREATE TRIGGER archive_receipt_block BEFORE INSERT OR UPDATE ON bank_receipt_claim FOR EACH ROW EXECUTE FUNCTION payos_archived_receipt_guard();

CREATE FUNCTION payos_archived_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.resource_type='PAYMENT_INTENT' THEN
    -- Serialize with the archive's session lock, including audit writers already in flight.
    PERFORM s.id FROM table_session s JOIN payment_intent p ON p.session_id=s.id
      WHERE p.id=NEW.resource_id FOR UPDATE OF s;
  END IF;
  IF NEW.resource_type='PAYMENT_INTENT' AND NEW.action NOT IN ('PAYOS_TEST_CASE_ARCHIVED','PAYOS_TEST_VISIBILITY_RESTORED')
    AND EXISTS(SELECT 1 FROM payos_test_case_archive WHERE payment_intent_id=NEW.resource_id) THEN
    RAISE EXCEPTION 'Archived intent audit is retained; append evidence to archive inbox' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_audit_block BEFORE INSERT ON business_audit_event FOR EACH ROW EXECUTE FUNCTION payos_archived_audit_guard();

-- Serialize a late original-inbox insert with archive validation, including old app code.
CREATE FUNCTION payos_archived_webhook_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.provider='PAYOS' THEN
    IF NEW.payload_snapshot->>'orderCode' ~ '^[0-9]{1,16}$' THEN
      PERFORM s.id FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id
        JOIN table_session s ON s.id=p.session_id
        WHERE q.order_code=(NEW.payload_snapshot->>'orderCode')::bigint FOR UPDATE OF s;
    END IF;
    IF EXISTS(SELECT 1 FROM payos_test_case_archive a WHERE a.order_code::text=NEW.payload_snapshot->>'orderCode'
      OR a.bank_reference=NEW.provider_event_id OR a.payment_link_id=NEW.payload_snapshot->>'paymentLinkId') THEN
      RAISE EXCEPTION 'Archived test webhook belongs in archive inbox' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_webhook_insert_block BEFORE INSERT ON payment_webhook_event FOR EACH ROW EXECUTE FUNCTION payos_archived_webhook_insert_guard();

COMMIT;
