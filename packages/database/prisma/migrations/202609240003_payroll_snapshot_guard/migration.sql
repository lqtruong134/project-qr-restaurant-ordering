-- Correct record-field access for the shared payroll guard.
BEGIN;
CREATE OR REPLACE FUNCTION payroll_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF TG_TABLE_NAME='payroll_line' AND TG_OP='INSERT' THEN
  IF NEW.line_type='WORK' THEN
  SELECT * INTO a FROM attendance_record WHERE id=NEW.attendance_id;
  IF a.status<>'APPROVED' OR a.restaurant_id<>NEW.restaurant_id OR a.approved_minutes<>NEW.minutes OR a.hourly_rate_snapshot<>NEW.hourly_rate_snapshot OR a.amount<>NEW.amount
  OR u IS DISTINCT FROM (SELECT user_id FROM shift_assignment WHERE id=a.assignment_id) THEN
   RAISE EXCEPTION 'Invalid payroll snapshot' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
COMMIT;
