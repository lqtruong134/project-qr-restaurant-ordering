BEGIN;

-- Operational retirement only. No payment, refund, allocation or write-off is created.
CREATE TABLE payos_test_session_retirement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL UNIQUE REFERENCES table_session(id) ON DELETE RESTRICT,
  archive_id uuid NOT NULL UNIQUE REFERENCES payos_test_case_archive(id) ON DELETE RESTRICT,
  table_id uuid NOT NULL REFERENCES dining_table(id) ON DELETE RESTRICT,
  voided_case_id uuid UNIQUE REFERENCES outstanding_balance_case(id) ON DELETE RESTRICT,
  financial_snapshot jsonb NOT NULL CHECK(jsonb_typeof(financial_snapshot)='object'),
  before_snapshot_hash text NOT NULL CHECK(before_snapshot_hash ~ '^[a-f0-9]{64}$'),
  plan_hash text NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
  bundle_hash text NOT NULL CHECK(bundle_hash ~ '^[a-f0-9]{64}$'),
  backup_manifest_hash text NOT NULL CHECK(backup_manifest_hash ~ '^[a-f0-9]{64}$'),
  retired_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 1000),
  retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(session_id IN ('ffc78214-13d4-4fd3-adae-dd78d01affd5'::uuid,'300659c7-5fea-4a77-a976-94551b078738'::uuid))
);
CREATE INDEX payos_test_retirement_restaurant ON payos_test_session_retirement(restaurant_id,retired_at);
CREATE TRIGGER core_no_delete BEFORE DELETE ON payos_test_session_retirement FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER retirement_immutable BEFORE UPDATE ON payos_test_session_retirement FOR EACH ROW EXECUTE FUNCTION workforce_immutable();

CREATE FUNCTION payos_test_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a payos_test_case_archive; s table_session; t dining_table; p payment_intent; q payos_payment_request;
BEGIN
  SELECT * INTO s FROM table_session WHERE id=NEW.session_id FOR UPDATE;
  SELECT * INTO t FROM dining_table WHERE id=s.table_id FOR UPDATE NOWAIT;
  SELECT * INTO a FROM payos_test_case_archive WHERE id=NEW.archive_id;
  SELECT * INTO p FROM payment_intent WHERE id=a.payment_intent_id;
  SELECT * INTO q FROM payos_payment_request WHERE id=a.payos_request_id;
  IF a.id IS NULL OR a.session_id IS DISTINCT FROM s.id OR a.table_id IS DISTINCT FROM t.id OR
    a.restaurant_id IS DISTINCT FROM NEW.restaurant_id OR t.restaurant_id IS DISTINCT FROM NEW.restaurant_id OR
    NEW.table_id IS DISTINCT FROM t.id OR a.visible_in_operations OR
    NOT ((s.id='ffc78214-13d4-4fd3-adae-dd78d01affd5' AND t.code='A01' AND p.id='f728d24c-6d31-4c07-89a0-d658832ded69' AND NEW.voided_case_id IS NULL)
      OR (s.id='300659c7-5fea-4a77-a976-94551b078738' AND t.code='A02' AND p.id='85f9d699-e6de-48f1-ad0e-d77ada9423d3' AND NEW.voided_case_id IS NOT NULL)) OR
    s.session_status IS DISTINCT FROM 'ACTIVE' OR s.receipt_snapshot IS NOT NULL OR s.receipt_number IS NOT NULL OR
    s.risk_status IS DISTINCT FROM 'NORMAL' OR t.table_status IS DISTINCT FROM 'OCCUPIED' OR NOT t.is_active OR
    p.status IS DISTINCT FROM 'REQUIRES_RECONCILIATION' OR p.amount<>5000 OR p.currency IS DISTINCT FROM 'VND' OR
    q.payment_intent_id IS DISTINCT FROM p.id OR q.provider_status IS DISTINCT FROM 'PAID' OR q.paid_amount<>5000 OR
    q.reconciliation_status IS DISTINCT FROM 'OPEN' OR
    (q.lease_until IS NOT NULL AND q.lease_until>clock_timestamp()) OR
    NEW.financial_snapshot IS DISTINCT FROM (SELECT to_jsonb(f) FROM session_financial_account f WHERE f.session_id=s.id) OR
    EXISTS(SELECT 1 FROM payment_transaction WHERE session_id=s.id) OR
    EXISTS(SELECT 1 FROM refund_case WHERE session_id=s.id) OR
    EXISTS(SELECT 1 FROM payment_intent WHERE session_id=s.id AND id<>p.id) OR
    EXISTS(SELECT 1 FROM order_batch WHERE session_id=s.id AND status NOT IN ('COMPLETED','CANCELLED','REJECTED')) OR
    EXISTS(SELECT 1 FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=s.id AND i.status NOT IN ('SERVED','CANCELLED','REJECTED','UNAVAILABLE')) OR
    EXISTS(SELECT 1 FROM cart_item i JOIN session_cart c ON c.id=i.cart_id WHERE c.session_id=s.id) OR
    EXISTS(SELECT 1 FROM outstanding_balance_case o WHERE o.session_id=s.id AND (o.id IS DISTINCT FROM NEW.voided_case_id OR o.status<>'PENDING_ADMIN_REVIEW')) OR
    (NEW.voided_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outstanding_balance_case WHERE id=NEW.voided_case_id AND session_id=s.id AND status='PENDING_ADMIN_REVIEW' AND paid_total=0)) THEN
    RAISE EXCEPTION 'Exact archived test retirement scope required' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
    JOIN role r ON r.id=ur.role_id AND r.code='ADMIN'
    WHERE u.id=NEW.retired_by AND u.restaurant_id=NEW.restaurant_id AND u.status='ACTIVE') THEN
    RAISE EXCEPTION 'Active restaurant administrator required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retirement_scope BEFORE INSERT ON payos_test_session_retirement FOR EACH ROW EXECUTE FUNCTION payos_test_retirement_guard();

CREATE FUNCTION payos_retired_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r payos_test_session_retirement;
BEGIN
  SELECT * INTO r FROM payos_test_session_retirement WHERE session_id=NEW.id;
  IF r.id IS NOT NULL THEN
    IF OLD.session_status='ACTIVE' THEN
      IF NEW.session_status<>'CLOSED' OR NEW.close_reason IS DISTINCT FROM 'ARCHIVED_TEST_RETIRED' OR
        NEW.closed_by IS DISTINCT FROM r.retired_by OR NEW.closed_at IS DISTINCT FROM r.retired_at OR
        (to_jsonb(NEW)-ARRAY['session_status','close_reason','closed_by','closed_at','version','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['session_status','close_reason','closed_by','closed_at','version','updated_at']) THEN
        RAISE EXCEPTION 'Retirement is not financial settlement' USING ERRCODE='23514';
      END IF;
    ELSIF (to_jsonb(NEW)-ARRAY['version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','updated_at']) THEN
      RAISE EXCEPTION 'Retired test session history is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.close_reason='ARCHIVED_TEST_RETIRED' THEN
    RAISE EXCEPTION 'Retirement marker required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payos_retired_session_scope BEFORE UPDATE ON table_session FOR EACH ROW EXECUTE FUNCTION payos_retired_session_guard();

-- A marker cannot be left on an active session by a partial/manual execution.
CREATE FUNCTION payos_retirement_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM table_session s WHERE s.id=NEW.session_id AND s.session_status='CLOSED'
    AND s.close_reason='ARCHIVED_TEST_RETIRED' AND s.closed_by=NEW.retired_by AND s.closed_at=NEW.retired_at)
    OR (NEW.voided_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outstanding_balance_case o
      WHERE o.id=NEW.voided_case_id AND o.status='CANCELLED' AND o.admin_owner=NEW.retired_by)) THEN
    RAISE EXCEPTION 'Incomplete test session retirement' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER retirement_complete AFTER INSERT ON payos_test_session_retirement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payos_retirement_complete();
-- An older visibility rollback must not re-queue a technically retired session.
CREATE FUNCTION payos_retired_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM payos_test_session_retirement WHERE archive_id=OLD.id) THEN
    RAISE EXCEPTION 'Retired session evidence remains in the historical archive' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retired_archive_history BEFORE UPDATE ON payos_test_case_archive FOR EACH ROW EXECUTE FUNCTION payos_retired_archive_guard();
COMMIT;
