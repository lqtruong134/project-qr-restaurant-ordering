BEGIN;
-- Cost belongs to the ingredient/location balance. This unused column was never maintained.
ALTER TABLE ingredient DROP COLUMN current_avg_cost;
COMMENT ON TABLE session_cart IS 'One shared cart per table session; owned lines live in cart_item.';
COMMENT ON TABLE session_participant IS 'Guest identity scoped to a table session; credential_hash stores only a hash.';
COMMENT ON TABLE inventory_balance IS 'Per-location stock aggregate. available_qty=on_hand_qty-reserved_qty; reconcile against movements and active reservations.';
COMMENT ON COLUMN inventory_balance.avg_cost IS 'Moving weighted average VND per base unit for this location; snapshotted when consumed.';
COMMENT ON TABLE session_financial_account IS 'Rebuildable aggregate of charges, successful payments, refunds and live payment reservations.';
COMMENT ON TABLE payment_webhook_event IS 'Idempotent receipt log for the internal payment connector; not a deployed online gateway.';

-- Child tenant checks alone cannot stop a parent being moved to a different restaurant.
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON dining_area FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON dining_table FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON menu_category FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON product FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON ingredient FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id','base_unit_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON stock_location FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
CREATE TRIGGER review_guest_session_fixed BEFORE UPDATE ON session_participant FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id','credential_hash');
CREATE TRIGGER review_cart_session_fixed BEFORE UPDATE ON session_cart FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id');

CREATE FUNCTION review_refund_relationships() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item_session uuid; allocation_payment uuid; allocation_item uuid;
BEGIN
 IF NEW.order_item_id IS NOT NULL THEN
  SELECT b.session_id INTO item_session FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=NEW.order_item_id;
  IF item_session IS DISTINCT FROM NEW.session_id THEN RAISE EXCEPTION 'Refund item belongs to another session' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.source_allocation_id IS NOT NULL THEN
  SELECT a.payment_transaction_id,f.order_item_id INTO allocation_payment,allocation_item FROM payment_allocation a JOIN financial_charge f ON f.id=a.financial_charge_id WHERE a.id=NEW.source_allocation_id;
  IF allocation_payment IS DISTINCT FROM NEW.source_payment_transaction_id OR (NEW.order_item_id IS NOT NULL AND allocation_item IS DISTINCT FROM NEW.order_item_id) THEN
   RAISE EXCEPTION 'Refund allocation does not match its source' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_refund_relationships BEFORE INSERT OR UPDATE ON refund_case FOR EACH ROW EXECUTE FUNCTION review_refund_relationships();
CREATE TRIGGER review_refund_source_fixed BEFORE UPDATE ON refund_case FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('order_item_id','source_allocation_id','request_key');

-- References are immutable so one outgoing bank transfer cannot be claimed twice.
CREATE FUNCTION review_refund_bank_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid;
BEGIN
 IF NEW.method='BANK_TRANSFER' AND NEW.status='SUCCEEDED' THEN
  IF NEW.reference IS NULL OR btrim(NEW.reference)='' THEN RAISE EXCEPTION 'Bank refund needs reference' USING ERRCODE='23514'; END IF;
  NEW.reference := btrim(NEW.reference);
  SELECT core_tenant('refund_case',NEW.refund_case_id) INTO tenant;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text||':refund-bank:'||btrim(NEW.reference),0));
  IF EXISTS(SELECT 1 FROM refund_transaction t WHERE t.method='BANK_TRANSFER' AND t.status='SUCCEEDED' AND t.reference=NEW.reference AND core_tenant('refund_case',t.refund_case_id)=tenant) THEN
   RAISE EXCEPTION 'Bank refund reference already recorded' USING ERRCODE='23505';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_refund_bank_reference BEFORE INSERT ON refund_transaction FOR EACH ROW EXECUTE FUNCTION review_refund_bank_reference();
CREATE INDEX refund_bank_reference_lookup ON refund_transaction(reference) WHERE method='BANK_TRANSFER' AND status='SUCCEEDED';
CREATE INDEX session_closed_by_lookup ON table_session(closed_by) WHERE closed_by IS NOT NULL;
CREATE INDEX session_verified_by_lookup ON table_session(verified_by) WHERE verified_by IS NOT NULL;
CREATE INDEX alert_resolved_by_lookup ON operational_alert(resolved_by) WHERE resolved_by IS NOT NULL;
COMMIT;
