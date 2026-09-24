BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE app_user ADD CONSTRAINT app_user_id_restaurant_key UNIQUE(id,restaurant_id);
ALTER TABLE dining_table ADD CONSTRAINT dining_table_id_restaurant_key UNIQUE(id,restaurant_id);

CREATE TABLE work_shift (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 64), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, break_minutes integer NOT NULL DEFAULT 0 CHECK(break_minutes BETWEEN 0 AND 240),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(restaurant_id,code), UNIQUE(id,restaurant_id),
 FOREIGN KEY(created_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '16 hours'),
 CHECK(break_minutes*interval '1 minute'<ends_at-starts_at)
);
CREATE TABLE shift_assignment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 shift_id uuid NOT NULL, user_id uuid NOT NULL, area_id uuid,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'ASSIGNED' CHECK(status IN ('ASSIGNED','CANCELLED')),
 assigned_by uuid NOT NULL, cancellation_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shift_id,user_id), UNIQUE(id,restaurant_id),
 FOREIGN KEY(shift_id,restaurant_id) REFERENCES work_shift(id,restaurant_id),
 FOREIGN KEY(user_id,restaurant_id) REFERENCES app_user(id,restaurant_id),
 FOREIGN KEY(assigned_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 FOREIGN KEY(area_id,restaurant_id) REFERENCES dining_area(id,restaurant_id),
 CHECK(ends_at>starts_at),
 EXCLUDE USING gist(user_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status='ASSIGNED')
);
CREATE TABLE employee_pay_rate (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id), user_id uuid NOT NULL,
 effective_from timestamptz NOT NULL, hourly_rate bigint NOT NULL CHECK(hourly_rate BETWEEN 1000 AND 10000000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,effective_from),
 FOREIGN KEY(user_id,restaurant_id) REFERENCES app_user(id,restaurant_id),
 FOREIGN KEY(created_by,restaurant_id) REFERENCES app_user(id,restaurant_id)
);
CREATE TABLE attendance_record (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 assignment_id uuid NOT NULL UNIQUE, UNIQUE(assignment_id,restaurant_id), checked_in_at timestamptz, checked_out_at timestamptz,
 status text NOT NULL DEFAULT 'RECORDED' CHECK(status IN ('RECORDED','APPROVED')),
 approved_minutes integer CHECK(approved_minutes BETWEEN 0 AND 960), hourly_rate_snapshot bigint CHECK(hourly_rate_snapshot BETWEEN 1000 AND 10000000),
 amount bigint CHECK(amount>=0), approved_by uuid, approved_at timestamptz, review_note text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(assignment_id,restaurant_id) REFERENCES shift_assignment(id,restaurant_id),
 FOREIGN KEY(approved_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 CHECK(checked_out_at IS NULL OR (checked_in_at IS NOT NULL AND checked_out_at>=checked_in_at)),
 CHECK((status='RECORDED' AND approved_minutes IS NULL AND hourly_rate_snapshot IS NULL AND amount IS NULL AND approved_by IS NULL AND approved_at IS NULL)
 OR (status='APPROVED' AND approved_minutes IS NOT NULL AND hourly_rate_snapshot IS NOT NULL AND amount IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(btrim(COALESCE(review_note,'')))>0)),
 CHECK(amount=(approved_minutes::bigint*hourly_rate_snapshot+30)/60)
);
CREATE TABLE payroll_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 period_start date NOT NULL, period_end date NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FINALIZED','PAID')),
 created_by uuid NOT NULL, finalized_by uuid, finalized_at timestamptz, paid_by uuid, paid_at timestamptz, payment_reference text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,restaurant_id), CHECK(period_end>period_start AND period_end<=period_start+62),
 FOREIGN KEY(created_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 FOREIGN KEY(finalized_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 FOREIGN KEY(paid_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 EXCLUDE USING gist(restaurant_id WITH =,daterange(period_start,period_end,'[)') WITH &&),
 CHECK((status='DRAFT' AND finalized_at IS NULL AND finalized_by IS NULL AND paid_at IS NULL AND paid_by IS NULL AND payment_reference IS NULL)
 OR (status='FINALIZED' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND paid_at IS NULL AND paid_by IS NULL AND payment_reference IS NULL)
 OR (status='PAID' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND paid_at IS NOT NULL AND paid_by IS NOT NULL AND length(btrim(COALESCE(payment_reference,'')))>0))
);
CREATE TABLE payroll_slip (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 payroll_run_id uuid NOT NULL, user_id uuid NOT NULL, employee_name_snapshot text NOT NULL, username_snapshot text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(payroll_run_id,user_id), UNIQUE(id,restaurant_id),
 FOREIGN KEY(payroll_run_id,restaurant_id) REFERENCES payroll_run(id,restaurant_id),
 FOREIGN KEY(user_id,restaurant_id) REFERENCES app_user(id,restaurant_id)
);
CREATE TABLE payroll_line (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id), payroll_slip_id uuid NOT NULL,
 attendance_id uuid UNIQUE REFERENCES attendance_record(id),
 line_type text NOT NULL CHECK(line_type IN ('WORK','BONUS','DEDUCTION')), description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 minutes integer, hourly_rate_snapshot bigint, amount bigint NOT NULL CHECK(amount BETWEEN -100000000000 AND 100000000000),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(payroll_slip_id,restaurant_id) REFERENCES payroll_slip(id,restaurant_id),
 FOREIGN KEY(created_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 CHECK((line_type='WORK' AND attendance_id IS NOT NULL AND minutes>=0 AND minutes IS NOT NULL AND hourly_rate_snapshot IS NOT NULL AND amount>=0)
 OR (line_type='BONUS' AND attendance_id IS NULL AND minutes IS NULL AND hourly_rate_snapshot IS NULL AND amount>0)
 OR (line_type='DEDUCTION' AND attendance_id IS NULL AND minutes IS NULL AND hourly_rate_snapshot IS NULL AND amount<0))
);
CREATE TABLE table_transfer_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 session_id uuid NOT NULL REFERENCES table_session(id), from_table_id uuid NOT NULL, to_table_id uuid NOT NULL,
 transferred_by uuid NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 transferred_at timestamptz NOT NULL DEFAULT now(), CHECK(from_table_id<>to_table_id),
 FOREIGN KEY(from_table_id,restaurant_id) REFERENCES dining_table(id,restaurant_id),
 FOREIGN KEY(to_table_id,restaurant_id) REFERENCES dining_table(id,restaurant_id),
 FOREIGN KEY(transferred_by,restaurant_id) REFERENCES app_user(id,restaurant_id)
);
CREATE INDEX shift_assignment_restaurant_start_idx ON shift_assignment(restaurant_id,starts_at);
CREATE INDEX employee_pay_rate_lookup_idx ON employee_pay_rate(user_id,effective_from DESC);
CREATE INDEX payroll_line_slip_idx ON payroll_line(payroll_slip_id);
CREATE INDEX table_transfer_history_session_idx ON table_transfer_history(session_id,transferred_at);

CREATE FUNCTION workforce_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Historical record is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER workforce_immutable BEFORE UPDATE OR DELETE ON employee_pay_rate FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
CREATE TRIGGER workforce_immutable BEFORE UPDATE OR DELETE ON table_transfer_history FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
CREATE TRIGGER workforce_immutable BEFORE UPDATE OR DELETE ON work_shift FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
CREATE FUNCTION workforce_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s work_shift;
BEGIN
 SELECT * INTO s FROM work_shift WHERE id=NEW.shift_id;
 IF NEW.starts_at IS DISTINCT FROM s.starts_at OR NEW.ends_at IS DISTINCT FROM s.ends_at THEN
 RAISE EXCEPTION 'Assignment times must match shift' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'status'-'cancellation_reason'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'cancellation_reason'-'updated_at')
 OR OLD.status='CANCELLED' OR NEW.status<>'CANCELLED' OR length(btrim(COALESCE(NEW.cancellation_reason,'')))=0
 OR EXISTS(SELECT 1 FROM attendance_record WHERE assignment_id=OLD.id)) THEN
 RAISE EXCEPTION 'Cannot change recorded assignment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workforce_assignment_guard BEFORE INSERT OR UPDATE ON shift_assignment FOR EACH ROW EXECUTE FUNCTION workforce_assignment_guard();
CREATE FUNCTION workforce_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='APPROVED' THEN RAISE EXCEPTION 'Attendance is immutable after approval' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER workforce_attendance_guard BEFORE UPDATE OR DELETE ON attendance_record FOR EACH ROW EXECUTE FUNCTION workforce_attendance_guard();
CREATE FUNCTION payroll_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_id uuid; state text; a attendance_record; u uuid;
BEGIN
 IF TG_TABLE_NAME='payroll_run' THEN
  IF TG_OP='DELETE' THEN
   IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'Finalized payroll is immutable' USING ERRCODE='23514'; END IF;
   RETURN OLD;
  END IF;
  IF OLD.status='PAID' OR (OLD.status='FINALIZED' AND (NEW.status<>'PAID' OR
   (to_jsonb(NEW)-'status'-'paid_by'-'paid_at'-'payment_reference'-'updated_at') IS DISTINCT FROM
   (to_jsonb(OLD)-'status'-'paid_by'-'paid_at'-'payment_reference'-'updated_at'))) THEN
   RAISE EXCEPTION 'Finalized payroll is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Replace draft lines instead of editing' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payroll_slip' THEN run_id:=COALESCE(NEW.payroll_run_id,OLD.payroll_run_id);
 ELSE SELECT payroll_run_id,user_id INTO run_id,u FROM payroll_slip WHERE id=COALESCE(NEW.payroll_slip_id,OLD.payroll_slip_id); END IF;
 SELECT status INTO state FROM payroll_run WHERE id=run_id FOR UPDATE;
 IF state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Finalized payroll is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payroll_line' AND TG_OP='INSERT' AND NEW.line_type='WORK' THEN
  SELECT * INTO a FROM attendance_record WHERE id=NEW.attendance_id;
  IF a.status<>'APPROVED' OR a.restaurant_id<>NEW.restaurant_id OR a.approved_minutes<>NEW.minutes OR a.hourly_rate_snapshot<>NEW.hourly_rate_snapshot OR a.amount<>NEW.amount
  OR u IS DISTINCT FROM (SELECT user_id FROM shift_assignment WHERE id=a.assignment_id) THEN
   RAISE EXCEPTION 'Invalid payroll snapshot' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER payroll_guard BEFORE UPDATE OR DELETE ON payroll_run FOR EACH ROW EXECUTE FUNCTION payroll_guard();
CREATE TRIGGER payroll_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_slip FOR EACH ROW EXECUTE FUNCTION payroll_guard();
CREATE TRIGGER payroll_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_line FOR EACH ROW EXECUTE FUNCTION payroll_guard();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['work_shift','shift_assignment','attendance_record','payroll_run'] LOOP
 EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',t);
END LOOP; END $$;

-- table_id on alerts/cases records where the incident occurred. It remains valid
-- after a session moves, provided it is a table in that session's transfer history.
CREATE FUNCTION table_incident_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM table_session WHERE id=NEW.session_id AND table_id=NEW.table_id)
 AND NOT EXISTS(SELECT 1 FROM table_transfer_history WHERE session_id=NEW.session_id AND (from_table_id=NEW.table_id OR to_table_id=NEW.table_id)) THEN
 RAISE EXCEPTION 'Table is not part of session history' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
DROP TRIGGER core_same_session ON operational_alert;
DROP TRIGGER core_same_session ON outstanding_balance_case;
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON operational_alert FOR EACH ROW EXECUTE FUNCTION table_incident_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON outstanding_balance_case FOR EACH ROW EXECUTE FUNCTION table_incident_guard();
COMMIT;
