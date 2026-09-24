BEGIN;
CREATE SEQUENCE receipt_number_seq;
ALTER TABLE table_session ADD COLUMN receipt_number text UNIQUE;
ALTER TABLE table_session ADD COLUMN closed_by uuid REFERENCES app_user(id);
ALTER TABLE table_session ADD COLUMN receipt_snapshot jsonb;
ALTER TABLE table_session ADD CONSTRAINT receipt_snapshot_closed CHECK(receipt_snapshot IS NULL OR (session_status='CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND receipt_number IS NOT NULL));
CREATE FUNCTION receipt_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.receipt_snapshot IS NOT NULL AND (NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.table_id IS DISTINCT FROM OLD.table_id OR NEW.session_status IS DISTINCT FROM OLD.session_status) THEN
 RAISE EXCEPTION 'Closed receipt snapshot is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER receipt_snapshot_guard BEFORE UPDATE ON table_session FOR EACH ROW EXECUTE FUNCTION receipt_snapshot_guard();
COMMIT;
