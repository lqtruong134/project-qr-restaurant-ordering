BEGIN;
CREATE FUNCTION core_fixed_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE column_name text;
BEGIN
 FOREACH column_name IN ARRAY TG_ARGV LOOP
  IF to_jsonb(NEW)->column_name IS DISTINCT FROM to_jsonb(OLD)->column_name THEN
   RAISE EXCEPTION 'Historical value cannot change: %.%',TG_TABLE_NAME,column_name USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER core_order_snapshot BEFORE UPDATE ON order_item FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('order_batch_id','owner_participant_id','product_id','product_name_snapshot','quantity','unit_price_snapshot','line_total');
CREATE TRIGGER core_batch_snapshot BEFORE UPDATE ON order_batch FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id','created_by_type','created_by_user_id','created_by_participant_id','client_request_id','subtotal','total_amount','config_version','risk_decision');
CREATE TRIGGER core_charge_snapshot BEFORE UPDATE ON financial_charge FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id','order_item_id','charge_type','amount');
CREATE TRIGGER core_intent_snapshot BEFORE UPDATE ON payment_intent FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id','payer_participant_id','method','amount','currency','client_request_id');
CREATE TRIGGER core_payment_snapshot BEFORE UPDATE ON payment_transaction FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('payment_intent_id','session_id','method','amount','currency','provider','provider_transaction_id');
CREATE TRIGGER core_allocation_snapshot BEFORE UPDATE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('payment_transaction_id','financial_charge_id','allocated_amount');
CREATE TRIGGER core_refund_snapshot BEFORE UPDATE ON refund_case FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id','source_payment_transaction_id','amount');
CREATE TRIGGER core_refund_immutable BEFORE UPDATE ON refund_transaction FOR EACH ROW EXECUTE FUNCTION core_immutable();

CREATE FUNCTION core_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_amount bigint; charge_amount bigint; total numeric;
BEGIN
 SELECT amount INTO payment_amount FROM payment_transaction WHERE id=NEW.payment_transaction_id AND status='SUCCEEDED' FOR UPDATE;
 SELECT amount INTO charge_amount FROM financial_charge WHERE id=NEW.financial_charge_id FOR UPDATE;
 IF payment_amount IS NULL OR charge_amount IS NULL THEN RAISE EXCEPTION 'Allocation needs successful payment and charge' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(allocated_amount),0) INTO total FROM payment_allocation WHERE payment_transaction_id=NEW.payment_transaction_id AND id<>NEW.id;
 IF total+NEW.allocated_amount>payment_amount THEN RAISE EXCEPTION 'Payment overallocated' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(allocated_amount-reversed_amount),0) INTO total FROM payment_allocation WHERE financial_charge_id=NEW.financial_charge_id AND id<>NEW.id;
 IF total+NEW.allocated_amount-NEW.reversed_amount>charge_amount THEN RAISE EXCEPTION 'Charge overallocated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER core_allocation_guard BEFORE INSERT OR UPDATE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION core_allocation_guard();
CREATE FUNCTION core_refund_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; source_amount bigint; total numeric;
BEGIN
 IF NEW.source_payment_transaction_id IS NULL THEN RETURN NEW; END IF;
 SELECT session_id,amount INTO sid,source_amount FROM payment_transaction WHERE id=NEW.source_payment_transaction_id AND status='SUCCEEDED' FOR UPDATE;
 IF sid IS DISTINCT FROM NEW.session_id THEN RAISE EXCEPTION 'Refund source belongs to another session or is not successful' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(amount),0) INTO total FROM refund_case WHERE source_payment_transaction_id=NEW.source_payment_transaction_id AND status<>'CANCELLED' AND id<>NEW.id;
 IF NEW.status<>'CANCELLED' AND total+NEW.amount>source_amount THEN RAISE EXCEPTION 'Refund exceeds original payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER core_refund_source_guard BEFORE INSERT OR UPDATE ON refund_case FOR EACH ROW EXECUTE FUNCTION core_refund_source_guard();
COMMIT;
