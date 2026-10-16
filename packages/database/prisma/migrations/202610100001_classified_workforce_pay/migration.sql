BEGIN;
CREATE TABLE workforce_pay_policy (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 effective_from date NOT NULL,
 night_premium_percent integer NOT NULL DEFAULT 30 CHECK(night_premium_percent BETWEEN 30 AND 300),
 overtime_weekday_percent integer NOT NULL DEFAULT 150 CHECK(overtime_weekday_percent BETWEEN 150 AND 1000),
 rest_day_percent integer NOT NULL DEFAULT 200 CHECK(rest_day_percent BETWEEN 200 AND 1000),
 holiday_percent integer NOT NULL DEFAULT 300 CHECK(holiday_percent BETWEEN 300 AND 1000),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(restaurant_id,effective_from), FOREIGN KEY(created_by,restaurant_id) REFERENCES app_user(id,restaurant_id)
);
CREATE TRIGGER workforce_policy_immutable BEFORE UPDATE OR DELETE ON workforce_pay_policy FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
-- Activate the new calculation for unapproved shifts starting today; earlier dates and all approved records keep their existing snapshots.
INSERT INTO workforce_pay_policy(restaurant_id,effective_from,created_by)
SELECT r.id,(now() AT TIME ZONE r.timezone)::date,u.id
FROM restaurant r JOIN LATERAL (
 SELECT a.id FROM app_user a JOIN user_role ur ON ur.user_id=a.id AND ur.revoked_at IS NULL JOIN role ro ON ro.id=ur.role_id
 WHERE a.restaurant_id=r.id AND a.status='ACTIVE' AND ro.code='ADMIN' ORDER BY a.created_at,a.id LIMIT 1
) u ON true WHERE NOT EXISTS(SELECT 1 FROM workforce_pay_policy p WHERE p.restaurant_id=r.id)
ON CONFLICT(restaurant_id,effective_from) DO NOTHING;
CREATE TABLE workforce_calendar_day (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 date date NOT NULL, kind text NOT NULL CHECK(kind IN ('HOLIDAY','WEEKLY_REST')), user_id uuid,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='HOLIDAY' AND user_id IS NULL) OR (kind='WEEKLY_REST' AND user_id IS NOT NULL)),
 FOREIGN KEY(user_id,restaurant_id) REFERENCES app_user(id,restaurant_id), FOREIGN KEY(created_by,restaurant_id) REFERENCES app_user(id,restaurant_id)
);
CREATE UNIQUE INDEX workforce_calendar_holiday_unique ON workforce_calendar_day(restaurant_id,date) WHERE kind='HOLIDAY';
CREATE UNIQUE INDEX workforce_calendar_rest_unique ON workforce_calendar_day(restaurant_id,date,user_id) WHERE kind='WEEKLY_REST';
CREATE INDEX workforce_calendar_lookup ON workforce_calendar_day(restaurant_id,date,user_id);
CREATE TRIGGER workforce_calendar_fixed BEFORE UPDATE ON workforce_calendar_day FOR EACH ROW EXECUTE FUNCTION workforce_immutable();

ALTER TABLE attendance_record ADD COLUMN pay_components jsonb, ADD COLUMN pay_snapshot jsonb, ADD COLUMN paid_periods jsonb;
ALTER TABLE payroll_line ADD COLUMN pay_components jsonb, ADD COLUMN pay_snapshot jsonb, ADD COLUMN paid_periods jsonb;
-- Retain the old formula for legacy records. Classified records reconcile against an immutable breakdown.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='attendance_record'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%amount =%approved_minutes%hourly_rate_snapshot%' LOOP
  EXECUTE format('ALTER TABLE attendance_record DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE attendance_record DROP CONSTRAINT attendance_outcome_allowed;
ALTER TABLE attendance_record DROP CONSTRAINT attendance_outcome_minutes;
ALTER TABLE attendance_record ADD CONSTRAINT attendance_outcome_allowed CHECK(outcome IN ('WORKED','ABSENT','LEAVE','MISSED_CLOCK','PAID_HOLIDAY'));
ALTER TABLE attendance_record ADD CONSTRAINT attendance_outcome_minutes CHECK(status<>'APPROVED' OR (outcome IN ('ABSENT','LEAVE') AND approved_minutes=0) OR (outcome IN ('WORKED','MISSED_CLOCK','PAID_HOLIDAY') AND approved_minutes>0));
ALTER TABLE attendance_record ADD CONSTRAINT attendance_pay_snapshot_shape CHECK((
 (pay_snapshot IS NULL AND pay_components IS NULL AND paid_periods IS NULL AND outcome<>'PAID_HOLIDAY' AND (amount IS NULL OR amount=(approved_minutes::bigint*hourly_rate_snapshot+30)/60))
 OR (status='APPROVED' AND rate_source='EMPLOYEE' AND jsonb_typeof(pay_snapshot)='object' AND jsonb_typeof(pay_components)='object' AND jsonb_typeof(paid_periods)='array' AND (pay_snapshot->>'version')::integer=1 AND pay_snapshot->'components'=pay_components AND pay_snapshot->'periods'=paid_periods AND amount=(pay_components->>'totalAmount')::bigint AND amount=(pay_components->>'baseAmount')::bigint+(pay_components->>'nightAmount')::bigint+(pay_components->>'overtimeAmount')::bigint+(pay_components->>'restDayAmount')::bigint+(pay_components->>'holidayAmount')::bigint+(pay_components->>'paidHolidayAmount')::bigint)
) IS TRUE);
CREATE FUNCTION workforce_classified_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minutes numeric; component text; value numeric;
BEGIN
 IF NEW.pay_snapshot IS NOT NULL THEN
  IF (jsonb_typeof(NEW.pay_snapshot)='object' AND NEW.pay_snapshot->>'version'='1' AND length(NEW.pay_snapshot->>'timezone')>0 AND jsonb_typeof(NEW.pay_snapshot->'segments')='array' AND jsonb_typeof(NEW.pay_snapshot->'policies')='array' AND jsonb_typeof(NEW.pay_snapshot->'rates')='array' AND jsonb_typeof(NEW.pay_snapshot->'calendar')='array' AND jsonb_typeof(NEW.paid_periods)='array') IS NOT TRUE THEN
   RAISE EXCEPTION 'Incomplete classified pay snapshot' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.paid_periods) p WHERE (jsonb_typeof(p)='object' AND p->>'kind' IN ('REGULAR','OVERTIME','PAID_HOLIDAY') AND p->>'startsAt' IS NOT NULL AND p->>'endsAt' IS NOT NULL AND (p->>'endsAt')::timestamptz>(p->>'startsAt')::timestamptz AND extract(second FROM (p->>'startsAt')::timestamptz)=0 AND extract(second FROM (p->>'endsAt')::timestamptz)=0) IS NOT TRUE) THEN
   RAISE EXCEPTION 'Invalid classified paid period' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(extract(epoch FROM ((p->>'endsAt')::timestamptz-(p->>'startsAt')::timestamptz))/60),0) INTO minutes FROM jsonb_array_elements(NEW.paid_periods) p;
  IF minutes<>NEW.approved_minutes THEN
   RAISE EXCEPTION 'Classified periods do not match approved minutes' USING ERRCODE='23514';
  END IF;
  FOREACH component IN ARRAY ARRAY['baseAmount','nightAmount','overtimeAmount','restDayAmount','holidayAmount','paidHolidayAmount','totalAmount'] LOOP
   value:=(NEW.pay_components->>component)::numeric;
   IF value IS NULL OR value<0 OR value<>trunc(value) THEN RAISE EXCEPTION 'Invalid pay component' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.pay_snapshot->'segments') s WHERE (jsonb_typeof(s)='object' AND s->>'kind' IN ('REGULAR','OVERTIME','PAID_HOLIDAY') AND s->>'dayKind' IN ('WEEKDAY','WEEKLY_REST','HOLIDAY') AND jsonb_typeof(s->'isNight')='boolean' AND s->>'startsAt' IS NOT NULL AND s->>'endsAt' IS NOT NULL AND (s->>'endsAt')::timestamptz>(s->>'startsAt')::timestamptz AND (s->>'minutes')::numeric>0 AND (s->>'minutes')::numeric=extract(epoch FROM ((s->>'endsAt')::timestamptz-(s->>'startsAt')::timestamptz))/60 AND (s->>'hourlyRate')::numeric BETWEEN 1000 AND 10000000 AND (s->>'totalPercent')::numeric>=100 AND (s->>'amount')::numeric>=0 AND (s->>'amount')::numeric=trunc((s->>'amount')::numeric) AND s->>'policyId' IS NOT NULL AND s->>'rateId' IS NOT NULL) IS NOT TRUE) THEN
   RAISE EXCEPTION 'Invalid classified pay segment' USING ERRCODE='23514';
  END IF;
  IF (SELECT COALESCE(sum((s->>'minutes')::numeric),0) FROM jsonb_array_elements(NEW.pay_snapshot->'segments') s)<>NEW.approved_minutes THEN
   RAISE EXCEPTION 'Classified segment minutes do not reconcile' USING ERRCODE='23514';
  END IF;
  IF (SELECT COALESCE(sum((s->>'amount')::bigint),0) FROM jsonb_array_elements(NEW.pay_snapshot->'segments') s)<>NEW.amount THEN
   RAISE EXCEPTION 'Classified segments do not reconcile' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workforce_classified_attendance_guard BEFORE INSERT OR UPDATE ON attendance_record FOR EACH ROW EXECUTE FUNCTION workforce_classified_attendance_guard();

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
    OR a.pay_components IS DISTINCT FROM NEW.pay_components OR a.pay_snapshot IS DISTINCT FROM NEW.pay_snapshot OR a.paid_periods IS DISTINCT FROM NEW.paid_periods
    OR u IS DISTINCT FROM (SELECT user_id FROM shift_assignment WHERE id=a.assignment_id) THEN
    RAISE EXCEPTION 'Invalid payroll snapshot' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.pay_components IS NOT NULL OR NEW.pay_snapshot IS NOT NULL OR NEW.paid_periods IS NOT NULL THEN
   RAISE EXCEPTION 'Only approved work carries classified pay' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
COMMENT ON TABLE workforce_pay_policy IS 'Effective-dated append-only hourly pay rules. No historical approvals are recomputed.';
COMMENT ON TABLE workforce_calendar_day IS 'Declared public holidays and employee-specific weekly rest dates; Sunday is not assumed to be a rest day.';
COMMENT ON COLUMN attendance_record.pay_snapshot IS 'Immutable calculation evidence: approved paid periods, calendar, policy versions, personal rates and reconciled VND components.';
COMMIT;
