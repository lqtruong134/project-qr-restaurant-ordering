DROP INDEX core_refund_success;
ALTER TABLE refund_transaction ADD COLUMN request_key text;
CREATE UNIQUE INDEX refund_request_once ON refund_transaction(refund_case_id,request_key) WHERE request_key IS NOT NULL;
CREATE FUNCTION refund_amount_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed bigint; used bigint;
BEGIN
 SELECT amount INTO allowed FROM refund_case WHERE id=NEW.refund_case_id FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO used FROM refund_transaction WHERE refund_case_id=NEW.refund_case_id AND status='SUCCEEDED';
 IF NEW.status='SUCCEEDED' AND used+NEW.amount>allowed THEN RAISE EXCEPTION 'Refund exceeds case amount' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refund_amount_guard BEFORE INSERT ON refund_transaction FOR EACH ROW EXECUTE FUNCTION refund_amount_guard();
