BEGIN;
CREATE TABLE shift_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 64), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 start_time time NOT NULL, end_time time NOT NULL, ends_next_day boolean NOT NULL DEFAULT false,
 break_minutes integer NOT NULL DEFAULT 0 CHECK(break_minutes BETWEEN 0 AND 240),
 hourly_rate_override bigint CHECK(hourly_rate_override BETWEEN 1000 AND 10000000),
 is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 10000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(restaurant_id,code), UNIQUE(id,restaurant_id),
 FOREIGN KEY(created_by,restaurant_id) REFERENCES app_user(id,restaurant_id),
 CHECK((end_time-start_time + CASE WHEN ends_next_day THEN interval '24 hours' ELSE interval '0 hours' END)>break_minutes*interval '1 minute'),
 CHECK((end_time-start_time + CASE WHEN ends_next_day THEN interval '24 hours' ELSE interval '0 hours' END)<=interval '16 hours')
);
ALTER TABLE work_shift
 ADD COLUMN template_id uuid, ADD COLUMN scheduled_date date, ADD COLUMN template_version integer,
 ADD COLUMN hourly_rate_override bigint CHECK(hourly_rate_override BETWEEN 1000 AND 10000000),
 ADD COLUMN attendance_grace_minutes integer NOT NULL DEFAULT 15 CHECK(attendance_grace_minutes BETWEEN 0 AND 60),
 ADD COLUMN clock_in_early_minutes integer NOT NULL DEFAULT 15 CHECK(clock_in_early_minutes BETWEEN 0 AND 240),
 ADD COLUMN clock_out_late_minutes integer NOT NULL DEFAULT 120 CHECK(clock_out_late_minutes BETWEEN 0 AND 240),
 ADD CONSTRAINT work_shift_template_tenant FOREIGN KEY(template_id,restaurant_id) REFERENCES shift_template(id,restaurant_id),
 ADD CONSTRAINT work_shift_template_snapshot CHECK((template_id IS NULL AND scheduled_date IS NULL AND template_version IS NULL) OR (template_id IS NOT NULL AND scheduled_date IS NOT NULL AND template_version>0)),
 ADD CONSTRAINT work_shift_template_day UNIQUE(template_id,scheduled_date);
ALTER TABLE attendance_record ADD COLUMN approval_mode text CHECK(approval_mode IN ('FULL','ACTUAL','ZERO','EXCEPTION')),
 ADD COLUMN rate_source text CHECK(rate_source IN ('EMPLOYEE','SHIFT'));
CREATE INDEX shift_template_active_order ON shift_template(restaurant_id,is_active,sort_order,name);
-- Keep policy history. Replace only obsolete clock defaults / oversized self checkout windows.
INSERT INTO risk_policy_config(restaurant_id,config_key,value_type,value_json,version_no,changed_by)
SELECT p.restaurant_id,p.config_key,'NUMBER',to_jsonb(CASE WHEN p.config_key='CLOCK_IN_EARLY_MINUTES' THEN 15 ELSE 120 END),
 (SELECT max(x.version_no)+1 FROM risk_policy_config x WHERE x.restaurant_id=p.restaurant_id),p.changed_by
FROM (SELECT DISTINCT ON(restaurant_id,config_key) * FROM risk_policy_config WHERE effective_from<=now() ORDER BY restaurant_id,config_key,version_no DESC) p
WHERE (p.config_key='CLOCK_IN_EARLY_MINUTES' AND p.value_json='30'::jsonb) OR (p.config_key='CLOCK_OUT_LATE_MINUTES' AND (p.value_json::text)::numeric>240);
CREATE FUNCTION payroll_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='PAID' AND OLD.status<>'PAID' AND EXISTS(
  SELECT 1 FROM payroll_slip s LEFT JOIN payroll_payment p ON p.payroll_slip_id=s.id
  WHERE s.payroll_run_id=NEW.id AND (SELECT COALESCE(sum(l.amount),0) FROM payroll_line l WHERE l.payroll_slip_id=s.id)>0
  AND p.id IS NULL
 ) THEN RAISE EXCEPTION 'Salary slips remain unpaid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_complete_guard BEFORE UPDATE ON payroll_run FOR EACH ROW EXECUTE FUNCTION payroll_complete_guard();
COMMIT;
