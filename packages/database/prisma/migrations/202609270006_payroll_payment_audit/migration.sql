CREATE TABLE payroll_payment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 payroll_slip_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount>0), reference text NOT NULL CHECK(length(btrim(reference))>0),
 paid_by uuid NOT NULL, paid_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(payroll_slip_id),
 FOREIGN KEY(payroll_slip_id,restaurant_id) REFERENCES payroll_slip(id,restaurant_id),
 FOREIGN KEY(paid_by,restaurant_id) REFERENCES app_user(id,restaurant_id)
);
-- Preserve previously recorded salary payments as explicit historical transactions.
INSERT INTO payroll_payment(restaurant_id,payroll_slip_id,amount,reference,paid_by,paid_at)
SELECT s.restaurant_id,s.id,sum(l.amount),p.payment_reference,p.paid_by,p.paid_at FROM payroll_slip s JOIN payroll_run p ON p.id=s.payroll_run_id JOIN payroll_line l ON l.payroll_slip_id=s.id WHERE p.status='PAID' GROUP BY s.id,p.id HAVING sum(l.amount)>0;
CREATE FUNCTION payroll_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE due bigint; state text;
BEGIN
 SELECT p.status INTO state FROM payroll_run p JOIN payroll_slip s ON s.payroll_run_id=p.id WHERE s.id=NEW.payroll_slip_id FOR UPDATE OF p;
 SELECT COALESCE(sum(amount),0) INTO due FROM payroll_line WHERE payroll_slip_id=NEW.payroll_slip_id;
 IF state<>'FINALIZED' OR NEW.amount<>due THEN RAISE EXCEPTION 'Invalid salary payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_payment_guard BEFORE INSERT ON payroll_payment FOR EACH ROW EXECUTE FUNCTION payroll_payment_guard();
CREATE TRIGGER payroll_payment_immutable BEFORE UPDATE OR DELETE ON payroll_payment FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE TABLE business_audit_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL REFERENCES restaurant(id),
 actor_id uuid NOT NULL, action text NOT NULL,resource_type text NOT NULL,resource_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>0),details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(actor_id,restaurant_id) REFERENCES app_user(id,restaurant_id)
);
CREATE INDEX business_audit_resource ON business_audit_event(resource_type,resource_id,created_at);
CREATE TRIGGER business_audit_immutable BEFORE UPDATE OR DELETE ON business_audit_event FOR EACH ROW EXECUTE FUNCTION core_immutable();
