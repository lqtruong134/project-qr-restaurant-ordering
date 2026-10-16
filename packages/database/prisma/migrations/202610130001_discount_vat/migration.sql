BEGIN;
ALTER TABLE product ADD COLUMN tax_treatment text NOT NULL DEFAULT 'DEFAULT', ADD COLUMN vat_rate_percent integer;
ALTER TABLE product ADD CONSTRAINT product_tax_classification CHECK (
  (tax_treatment='DEFAULT' AND vat_rate_percent IS NULL) OR
  (tax_treatment='EXEMPT' AND vat_rate_percent IS NULL) OR
  (tax_treatment='TAXABLE' AND vat_rate_percent IS NOT NULL AND vat_rate_percent IN (0,5,8,10))
);
ALTER TABLE order_item ADD COLUMN tax_snapshot jsonb;
ALTER TABLE financial_charge ADD COLUMN discount_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN promotion_snapshot jsonb, ADD COLUMN tax_snapshot jsonb, ADD COLUMN tax_amount bigint;
ALTER TABLE financial_charge ADD CONSTRAINT charge_discount_valid CHECK (discount_amount>=0 AND discount_amount*2<=amount);
ALTER TABLE financial_charge ADD CONSTRAINT charge_tax_valid CHECK ((tax_amount IS NULL AND tax_snapshot IS NULL) OR (tax_amount IS NOT NULL AND tax_amount>=0 AND tax_amount<=amount-discount_amount AND tax_snapshot IS NOT NULL));

CREATE TABLE restaurant_tax_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  effective_at timestamptz(6) NOT NULL,
  default_rate_percent integer NOT NULL CHECK (default_rate_percent IN (0,5,8,10)),
  price_includes_vat boolean NOT NULL DEFAULT true CHECK (price_includes_vat),
  version integer NOT NULL CHECK (version>0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  created_by uuid REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id,version)
);
CREATE INDEX tax_policy_effective ON restaurant_tax_policy(restaurant_id,effective_at,version);
CREATE TRIGGER tax_policy_immutable BEFORE UPDATE OR DELETE ON restaurant_tax_policy FOR EACH ROW EXECUTE FUNCTION core_immutable();
INSERT INTO restaurant_tax_policy(restaurant_id,effective_at,default_rate_percent,version,reason)
SELECT id,now(),CASE WHEN now()<'2027-01-01T00:00:00+07'::timestamptz THEN 8 ELSE 10 END,1,
  'Giá thực đơn đã gồm VAT; áp dụng cho món mới kể từ thời điểm nâng cấp, giữ nguyên phiếu cũ.' FROM restaurant;
INSERT INTO restaurant_tax_policy(restaurant_id,effective_at,default_rate_percent,version,reason)
SELECT id,'2027-01-01T00:00:00+07'::timestamptz,10,2,
  'Kết thúc thời hạn giảm VAT 8%; quay về mức thông thường 10% từ ngày 01/01/2027.' FROM restaurant WHERE now()<'2027-01-01T00:00:00+07'::timestamptz;

CREATE TABLE discount_program (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description)<=500),
  mode text NOT NULL CHECK (mode IN ('AUTO','CODE')),
  code text,
  discount_type text NOT NULL CHECK (discount_type IN ('PERCENT','FIXED')),
  percent integer,
  fixed_amount bigint,
  min_eligible_amount bigint NOT NULL DEFAULT 0 CHECK (min_eligible_amount>=0),
  max_discount_amount bigint CHECK (max_discount_amount>0),
  starts_at timestamptz(6) NOT NULL, ends_at timestamptz(6) NOT NULL,
  weekdays integer[] NOT NULL DEFAULT '{}',
  start_time text, end_time text,
  scope text NOT NULL DEFAULT 'ALL' CHECK (scope IN ('ALL','PRODUCTS','CATEGORIES')),
  product_ids uuid[] NOT NULL DEFAULT '{}', category_ids uuid[] NOT NULL DEFAULT '{}',
  exclude_combos boolean NOT NULL DEFAULT true CHECK(exclude_combos),
  usage_limit integer CHECK (usage_limit>0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (ends_at>starts_at),
  CHECK (discount_type<>'FIXED' OR (min_eligible_amount>0 AND fixed_amount*2<=min_eligible_amount)),
  CHECK ((mode='AUTO' AND code IS NULL) OR (mode='CODE' AND code IS NOT NULL AND code~'^[A-Z0-9][A-Z0-9_-]{2,31}$')),
  CHECK ((discount_type='PERCENT' AND percent IS NOT NULL AND percent BETWEEN 1 AND 50 AND fixed_amount IS NULL) OR (discount_type='FIXED' AND fixed_amount IS NOT NULL AND fixed_amount>0 AND percent IS NULL)),
  CHECK (weekdays<@ARRAY[0,1,2,3,4,5,6] AND array_position(weekdays,NULL) IS NULL),
  CHECK ((start_time IS NULL AND end_time IS NULL) OR (start_time~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND end_time~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND end_time>start_time)),
  CHECK ((scope='ALL' AND cardinality(product_ids)=0 AND cardinality(category_ids)=0) OR
    (scope='PRODUCTS' AND cardinality(product_ids)>0 AND cardinality(category_ids)=0) OR
    (scope='CATEGORIES' AND cardinality(category_ids)>0 AND cardinality(product_ids)=0))
);
CREATE UNIQUE INDEX discount_code_unique ON discount_program(restaurant_id,code) WHERE code IS NOT NULL;
CREATE INDEX discount_program_restaurant ON discount_program(restaurant_id,status,starts_at,ends_at);
CREATE TRIGGER discount_no_delete BEFORE DELETE ON discount_program FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER discount_touch BEFORE UPDATE ON discount_program FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE session_promotion (
  session_id uuid PRIMARY KEY REFERENCES table_session(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  program_id uuid REFERENCES discount_program(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status text NOT NULL CHECK (status IN ('SELECTED','RESERVED','USED','REMOVED')),
  explicit_selection boolean NOT NULL DEFAULT false,
  program_snapshot jsonb,
  eligible_amount bigint NOT NULL DEFAULT 0 CHECK (eligible_amount>=0),
  discount_amount bigint NOT NULL DEFAULT 0 CHECK (discount_amount>=0 AND discount_amount<=eligible_amount),
  expires_at timestamptz(6), locked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((status='REMOVED' AND program_id IS NULL AND program_snapshot IS NULL) OR (status<>'REMOVED' AND program_id IS NOT NULL AND program_snapshot IS NOT NULL)),
  CHECK (status<>'RESERVED' OR expires_at IS NOT NULL),
  CHECK (status<>'USED' OR locked_at IS NOT NULL)
);
CREATE INDEX session_promotion_quota ON session_promotion(program_id,status,expires_at);
CREATE TRIGGER session_promotion_touch BEFORE UPDATE ON session_promotion FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER session_promotion_no_delete BEFORE DELETE ON session_promotion FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE FUNCTION promotion_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; sid_state text; limit_n integer; occupied integer;
BEGIN
 IF TG_TABLE_NAME='discount_program' THEN
   IF EXISTS(SELECT 1 FROM unnest(NEW.product_ids) x LEFT JOIN product p ON p.id=x WHERE p.restaurant_id IS DISTINCT FROM NEW.restaurant_id) OR
      EXISTS(SELECT 1 FROM unnest(NEW.category_ids) x LEFT JOIN menu_category c ON c.id=x WHERE c.restaurant_id IS DISTINCT FROM NEW.restaurant_id) THEN
     RAISE EXCEPTION 'Promotion scope belongs to another restaurant' USING ERRCODE='23514';
   END IF;
   SELECT restaurant_id INTO rid FROM app_user WHERE id=NEW.created_by;
   IF rid IS DISTINCT FROM NEW.restaurant_id THEN RAISE EXCEPTION 'Promotion creator tenant mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='restaurant_tax_policy' THEN
   IF NEW.created_by IS NOT NULL THEN
    SELECT restaurant_id INTO rid FROM app_user WHERE id=NEW.created_by;
    IF rid IS DISTINCT FROM NEW.restaurant_id THEN RAISE EXCEPTION 'Tax creator tenant mismatch' USING ERRCODE='23514'; END IF;
   END IF;
 ELSIF TG_TABLE_NAME='session_promotion' THEN
   SELECT session_status INTO sid_state FROM table_session WHERE id=NEW.session_id FOR UPDATE;
   IF (TG_OP='INSERT' OR (NEW.program_id,NEW.program_snapshot,NEW.eligible_amount,NEW.discount_amount,NEW.explicit_selection) IS DISTINCT FROM (OLD.program_id,OLD.program_snapshot,OLD.eligible_amount,OLD.discount_amount,OLD.explicit_selection) OR
      (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='RESERVED' AND NEW.status='USED'))) AND
      (sid_state<>'ACTIVE' OR EXISTS(SELECT 1 FROM payment_transaction WHERE session_id=NEW.session_id AND status='SUCCEEDED') OR EXISTS(SELECT 1 FROM payment_intent WHERE session_id=NEW.session_id AND status IN ('CREATED','PENDING') AND expires_at>now())) THEN
     RAISE EXCEPTION 'Promotion cannot change after collection starts' USING ERRCODE='23514';
   END IF;
   IF NEW.status IN ('RESERVED','USED') THEN
     SELECT usage_limit INTO limit_n FROM discount_program WHERE id=NEW.program_id FOR UPDATE;
     SELECT count(*) INTO occupied FROM session_promotion WHERE program_id=NEW.program_id AND session_id<>NEW.session_id AND
       (status='USED' OR (status='RESERVED' AND expires_at>now()));
     IF limit_n IS NOT NULL AND occupied>=limit_n THEN RAISE EXCEPTION 'Promotion quota exhausted' USING ERRCODE='23514'; END IF;
   END IF;
   SELECT t.restaurant_id INTO rid FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=NEW.session_id;
   IF NEW.program_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM discount_program WHERE id=NEW.program_id AND restaurant_id=rid) THEN
     RAISE EXCEPTION 'Promotion session tenant mismatch' USING ERRCODE='23514';
   END IF;
   IF TG_OP='UPDATE' AND OLD.status='USED' AND (NEW.program_id,NEW.status,NEW.program_snapshot,NEW.eligible_amount,NEW.discount_amount,NEW.locked_at) IS DISTINCT FROM (OLD.program_id,OLD.status,OLD.program_snapshot,OLD.eligible_amount,OLD.discount_amount,OLD.locked_at) THEN
     RAISE EXCEPTION 'Applied promotion is immutable' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER discount_scope_guard BEFORE INSERT OR UPDATE ON discount_program FOR EACH ROW EXECUTE FUNCTION promotion_scope_guard();
CREATE TRIGGER tax_creator_guard BEFORE INSERT ON restaurant_tax_policy FOR EACH ROW EXECUTE FUNCTION promotion_scope_guard();
CREATE TRIGGER session_promotion_scope_guard BEFORE INSERT OR UPDATE ON session_promotion FOR EACH ROW EXECUTE FUNCTION promotion_scope_guard();

CREATE FUNCTION charge_billing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; locked boolean;
BEGIN
 sid:=NEW.session_id;
 IF TG_OP='UPDATE' AND (NEW.discount_amount,NEW.promotion_snapshot,NEW.tax_amount,NEW.tax_snapshot) IS DISTINCT FROM (OLD.discount_amount,OLD.promotion_snapshot,OLD.tax_amount,OLD.tax_snapshot) THEN
   SELECT session_status<>'ACTIVE' INTO locked FROM table_session WHERE id=sid FOR UPDATE;
   IF locked OR EXISTS(SELECT 1 FROM payment_transaction WHERE session_id=sid AND status='SUCCEEDED') OR EXISTS(SELECT 1 FROM payment_intent WHERE session_id=sid AND status IN ('CREATED','PENDING') AND expires_at>now()) THEN
     RAISE EXCEPTION 'Billing amounts are locked after collection starts' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='INSERT' AND NEW.discount_amount<>0 AND EXISTS(SELECT 1 FROM payment_transaction WHERE session_id=sid AND status='SUCCEEDED') THEN
   RAISE EXCEPTION 'New lines after payment do not receive an earlier promotion' USING ERRCODE='23514';
 END IF;
 IF NEW.tax_snapshot IS NOT NULL THEN
   IF jsonb_typeof(NEW.tax_snapshot) IS DISTINCT FROM 'object' OR
      NOT NEW.tax_snapshot ?& ARRAY['version','priceIncludesVat','treatment','ratePercent','policyId','policyVersion'] OR
      NEW.tax_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR
      NEW.tax_snapshot->'priceIncludesVat' IS DISTINCT FROM 'true'::jsonb OR
      NEW.tax_snapshot->>'treatment' IS NULL OR NEW.tax_snapshot->>'treatment' NOT IN ('TAXABLE','EXEMPT') OR
      (NEW.tax_snapshot->>'treatment'='TAXABLE' AND (jsonb_typeof(NEW.tax_snapshot->'ratePercent') IS DISTINCT FROM 'number' OR COALESCE(NEW.tax_snapshot->>'ratePercent','') NOT IN ('0','5','8','10'))) OR
      (NEW.tax_snapshot->>'treatment'='EXEMPT' AND NEW.tax_snapshot->'ratePercent' IS DISTINCT FROM 'null'::jsonb) OR
      COALESCE(NEW.tax_snapshot->>'policyId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      jsonb_typeof(NEW.tax_snapshot->'policyVersion') IS DISTINCT FROM 'number' OR COALESCE(NEW.tax_snapshot->>'policyVersion','') !~ '^[1-9][0-9]*$' THEN
     RAISE EXCEPTION 'Invalid inclusive VAT snapshot' USING ERRCODE='23514';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM restaurant_tax_policy p JOIN table_session s ON s.id=NEW.session_id JOIN dining_table t ON t.id=s.table_id
     WHERE p.id=(NEW.tax_snapshot->>'policyId')::uuid AND p.restaurant_id=t.restaurant_id AND p.version::text=NEW.tax_snapshot->>'policyVersion') THEN
     RAISE EXCEPTION 'VAT policy snapshot tenant or version mismatch' USING ERRCODE='23514';
   END IF;
   IF NEW.order_item_id IS NOT NULL AND (SELECT i.tax_snapshot FROM order_item i WHERE i.id=NEW.order_item_id) IS DISTINCT FROM NEW.tax_snapshot THEN
     RAISE EXCEPTION 'Charge VAT must match ordered VAT snapshot' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER charge_tax_fixed BEFORE UPDATE ON financial_charge FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('tax_snapshot');
CREATE TRIGGER charge_billing_guard BEFORE INSERT OR UPDATE ON financial_charge FOR EACH ROW EXECUTE FUNCTION charge_billing_guard();
CREATE TRIGGER order_tax_fixed BEFORE UPDATE ON order_item FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('tax_snapshot');

CREATE OR REPLACE FUNCTION core_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_amount bigint; charge_amount bigint; total numeric;
BEGIN
 SELECT amount INTO payment_amount FROM payment_transaction WHERE id=NEW.payment_transaction_id AND status='SUCCEEDED' FOR UPDATE;
 SELECT amount-discount_amount INTO charge_amount FROM financial_charge WHERE id=NEW.financial_charge_id FOR UPDATE;
 IF payment_amount IS NULL OR charge_amount IS NULL THEN RAISE EXCEPTION 'Allocation needs successful payment and charge' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(allocated_amount),0) INTO total FROM payment_allocation WHERE payment_transaction_id=NEW.payment_transaction_id AND id<>NEW.id;
 IF total+NEW.allocated_amount>payment_amount THEN RAISE EXCEPTION 'Payment overallocated' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(allocated_amount-reversed_amount),0) INTO total FROM payment_allocation WHERE financial_charge_id=NEW.financial_charge_id AND id<>NEW.id;
 IF total+NEW.allocated_amount-NEW.reversed_amount>charge_amount THEN RAISE EXCEPTION 'Charge overallocated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TABLE promotion_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES table_session(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('USER','GUEST')), actor_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 100), request_hash text NOT NULL,
  response_snapshot jsonb NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE(session_id,actor_type,actor_id,request_key)
);
CREATE TRIGGER promotion_request_immutable BEFORE UPDATE OR DELETE ON promotion_request FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE FUNCTION promotion_request_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 SELECT t.restaurant_id INTO rid FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=NEW.session_id;
 IF (NEW.actor_type='USER' AND NOT EXISTS(SELECT 1 FROM app_user WHERE id=NEW.actor_id AND restaurant_id=rid)) OR
    (NEW.actor_type='GUEST' AND NOT EXISTS(SELECT 1 FROM session_participant WHERE id=NEW.actor_id AND session_id=NEW.session_id)) THEN
   RAISE EXCEPTION 'Promotion request actor session or tenant mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER promotion_request_actor_guard BEFORE INSERT ON promotion_request FOR EACH ROW EXECUTE FUNCTION promotion_request_actor_guard();
COMMIT;
