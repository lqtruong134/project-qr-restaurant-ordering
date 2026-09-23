BEGIN;
CREATE FUNCTION core_tenant(kind text, entity uuid) RETURNS uuid LANGUAGE plpgsql STABLE AS $$ DECLARE result uuid; BEGIN IF entity IS NULL THEN RETURN NULL; END IF; CASE kind
WHEN 'restaurant' THEN SELECT id FROM restaurant WHERE id=entity INTO result;
WHEN 'app_user' THEN SELECT restaurant_id FROM app_user WHERE id=entity INTO result;
WHEN 'dining_area' THEN SELECT restaurant_id FROM dining_area WHERE id=entity INTO result;
WHEN 'dining_table' THEN SELECT restaurant_id FROM dining_table WHERE id=entity INTO result;
WHEN 'menu_category' THEN SELECT restaurant_id FROM menu_category WHERE id=entity INTO result;
WHEN 'product' THEN SELECT restaurant_id FROM product WHERE id=entity INTO result;
WHEN 'risk_policy_config' THEN SELECT restaurant_id FROM risk_policy_config WHERE id=entity INTO result;
WHEN 'ingredient' THEN SELECT restaurant_id FROM ingredient WHERE id=entity INTO result;
WHEN 'stock_location' THEN SELECT restaurant_id FROM stock_location WHERE id=entity INTO result;
WHEN 'table_qr_token' THEN SELECT core_tenant('dining_table',table_id) FROM table_qr_token WHERE id=entity INTO result;
WHEN 'table_session' THEN SELECT core_tenant('dining_table',table_id) FROM table_session WHERE id=entity INTO result;
WHEN 'session_participant' THEN SELECT core_tenant('table_session',session_id) FROM session_participant WHERE id=entity INTO result;
WHEN 'session_cart' THEN SELECT core_tenant('table_session',session_id) FROM session_cart WHERE id=entity INTO result;
WHEN 'support_request' THEN SELECT core_tenant('table_session',session_id) FROM support_request WHERE id=entity INTO result;
WHEN 'operational_alert' THEN SELECT core_tenant('dining_table',table_id) FROM operational_alert WHERE id=entity INTO result;
WHEN 'cart_item' THEN SELECT core_tenant('session_cart',cart_id) FROM cart_item WHERE id=entity INTO result;
WHEN 'order_batch' THEN SELECT core_tenant('table_session',session_id) FROM order_batch WHERE id=entity INTO result;
WHEN 'order_item' THEN SELECT core_tenant('order_batch',order_batch_id) FROM order_item WHERE id=entity INTO result;
WHEN 'order_status_history' THEN SELECT core_tenant('order_batch',order_batch_id) FROM order_status_history WHERE id=entity INTO result;
WHEN 'session_financial_account' THEN SELECT core_tenant('table_session',session_id) FROM session_financial_account WHERE id=entity INTO result;
WHEN 'financial_charge' THEN SELECT core_tenant('table_session',session_id) FROM financial_charge WHERE id=entity INTO result;
WHEN 'payment_intent' THEN SELECT core_tenant('table_session',session_id) FROM payment_intent WHERE id=entity INTO result;
WHEN 'payment_transaction' THEN SELECT core_tenant('table_session',session_id) FROM payment_transaction WHERE id=entity INTO result;
WHEN 'payment_allocation' THEN SELECT core_tenant('payment_transaction',payment_transaction_id) FROM payment_allocation WHERE id=entity INTO result;
WHEN 'payment_webhook_event' THEN SELECT core_tenant('payment_transaction',payment_transaction_id) FROM payment_webhook_event WHERE id=entity INTO result;
WHEN 'order_risk_assessment' THEN SELECT core_tenant('order_batch',order_batch_id) FROM order_risk_assessment WHERE id=entity INTO result;
WHEN 'order_review' THEN SELECT core_tenant('order_batch',order_batch_id) FROM order_review WHERE id=entity INTO result;
WHEN 'refund_case' THEN SELECT core_tenant('table_session',session_id) FROM refund_case WHERE id=entity INTO result;
WHEN 'refund_transaction' THEN SELECT core_tenant('refund_case',refund_case_id) FROM refund_transaction WHERE id=entity INTO result;
WHEN 'outstanding_balance_case' THEN SELECT core_tenant('table_session',session_id) FROM outstanding_balance_case WHERE id=entity INTO result;
WHEN 'recipe_bom' THEN SELECT core_tenant('product',product_id) FROM recipe_bom WHERE id=entity INTO result;
WHEN 'recipe_bom_item' THEN SELECT core_tenant('recipe_bom',recipe_bom_id) FROM recipe_bom_item WHERE id=entity INTO result;
WHEN 'inventory_balance' THEN SELECT core_tenant('stock_location',location_id) FROM inventory_balance WHERE id=entity INTO result;
WHEN 'inventory_reservation' THEN SELECT core_tenant('order_item',order_item_id) FROM inventory_reservation WHERE id=entity INTO result;
WHEN 'inventory_movement' THEN SELECT core_tenant('stock_location',location_id) FROM inventory_movement WHERE id=entity INTO result;
WHEN 'goods_receipt' THEN SELECT core_tenant('stock_location',location_id) FROM goods_receipt WHERE id=entity INTO result;
WHEN 'goods_receipt_item' THEN SELECT core_tenant('goods_receipt',receipt_id) FROM goods_receipt_item WHERE id=entity INTO result;
WHEN 'order_item_ingredient_snapshot' THEN SELECT core_tenant('order_item',order_item_id) FROM order_item_ingredient_snapshot WHERE id=entity INTO result;
WHEN 'user_role' THEN SELECT core_tenant('app_user',user_id) FROM user_role WHERE id=entity INTO result;
WHEN 'idempotency_record' THEN SELECT COALESCE(core_tenant('app_user',actor_user_id),core_tenant('session_participant',actor_participant_id),core_tenant('order_batch',order_batch_id),core_tenant('payment_intent',payment_intent_id)) FROM idempotency_record WHERE id=entity INTO result;
WHEN 'outbox_event' THEN SELECT COALESCE(core_tenant('order_batch',order_batch_id),core_tenant('payment_transaction',payment_transaction_id)) FROM outbox_event WHERE id=entity INTO result;
ELSE RETURN NULL; END CASE; RETURN result; END $$;
CREATE FUNCTION core_tenant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE own uuid; target uuid; n integer;
BEGIN
 own:=core_tenant(TG_TABLE_NAME,NEW.id);
 IF own IS NULL THEN RETURN NEW; END IF;
 FOR n IN 0..TG_NARGS/2-1 LOOP
  target:=core_tenant(TG_ARGV[n*2],(to_jsonb(NEW)->>TG_ARGV[n*2+1])::uuid);
  IF target IS NOT NULL AND target<>own THEN RAISE EXCEPTION 'Cross-restaurant reference' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON app_user DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant','restaurant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON user_role DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user','user_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON dining_area DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant','restaurant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON dining_table DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('dining_area','area_id','restaurant','restaurant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON table_qr_token DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('dining_table','table_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON table_session DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('dining_table','table_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON session_participant DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON session_cart DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON menu_category DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant','restaurant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON product DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('menu_category','category_id','restaurant','restaurant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON support_request DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id','session_participant','participant_id','app_user','acknowledged_by','app_user','resolved_by');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON operational_alert DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id','dining_table','table_id','app_user','acknowledged_by');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON cart_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('session_cart','cart_id','session_participant','owner_participant_id','product','product_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON order_batch DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user','created_by_user_id','session_participant','created_by_participant_id','table_session','session_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON order_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user','cancelled_by_user_id','session_participant','cancelled_by_participant_id','order_batch','order_batch_id','session_participant','owner_participant_id','product','product_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON order_status_history DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user','actor_user_id','session_participant','actor_participant_id','order_batch','order_batch_id','order_item','order_item_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON idempotency_record DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user','actor_user_id','session_participant','actor_participant_id','order_batch','order_batch_id','payment_intent','payment_intent_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON outbox_event DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_batch','order_batch_id','payment_transaction','payment_transaction_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON session_financial_account DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON financial_charge DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id','order_item','order_item_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON payment_intent DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id','session_participant','payer_participant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON payment_transaction DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('payment_intent','payment_intent_id','table_session','session_id','app_user','confirmed_by');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON payment_allocation DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('payment_transaction','payment_transaction_id','financial_charge','financial_charge_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON payment_webhook_event DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('payment_transaction','payment_transaction_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON risk_policy_config DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant','restaurant_id','app_user','changed_by');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON order_risk_assessment DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_batch','order_batch_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON order_review DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_batch','order_batch_id','app_user','reviewer_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON refund_case DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id','order_item','order_item_id','payment_transaction','source_payment_transaction_id','payment_allocation','source_allocation_id','app_user','assigned_staff_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON refund_transaction DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('refund_case','refund_case_id','app_user','processed_by');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON outstanding_balance_case DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session','session_id','dining_table','table_id','app_user','reported_by','app_user','admin_owner');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON ingredient DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant','restaurant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON stock_location DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant','restaurant_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON recipe_bom DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('product','product_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON recipe_bom_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('recipe_bom','recipe_bom_id','ingredient','ingredient_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON inventory_balance DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('stock_location','location_id','ingredient','ingredient_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON inventory_reservation DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_item','order_item_id','ingredient','ingredient_id','stock_location','location_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON inventory_movement DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('goods_receipt','goods_receipt_id','order_item','order_item_id','stock_location','location_id','ingredient','ingredient_id','app_user','created_by');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON goods_receipt DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('stock_location','location_id','app_user','created_by','app_user','approved_by');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON goods_receipt_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('goods_receipt','receipt_id','ingredient','ingredient_id');
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON order_item_ingredient_snapshot DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_item','order_item_id','recipe_bom','recipe_bom_id','ingredient','ingredient_id');

DROP TRIGGER core_immutable ON order_item_ingredient_snapshot;
CREATE FUNCTION core_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'consumed_qty'-'unit_cost_snapshot'-'cogs_value') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_qty'-'unit_cost_snapshot'-'cogs_value')
 OR OLD.consumed_qty<>0 OR NEW.consumed_qty<>OLD.planned_qty
 OR NEW.cogs_value<>round(NEW.consumed_qty*NEW.unit_cost_snapshot)::bigint
 THEN RAISE EXCEPTION 'Invalid snapshot consumption' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER core_snapshot_guard BEFORE UPDATE ON order_item_ingredient_snapshot FOR EACH ROW EXECUTE FUNCTION core_snapshot_guard();
CREATE FUNCTION core_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a uuid; b uuid;
BEGIN
 IF TG_TABLE_NAME='cart_item' AND NEW.owner_participant_id IS NOT NULL THEN
 SELECT session_id INTO a FROM session_cart WHERE id=NEW.cart_id;
 SELECT session_id INTO b FROM session_participant WHERE id=NEW.owner_participant_id;
 ELSIF TG_TABLE_NAME='order_item' AND NEW.owner_participant_id IS NOT NULL THEN
 SELECT session_id INTO a FROM order_batch WHERE id=NEW.order_batch_id;
 SELECT session_id INTO b FROM session_participant WHERE id=NEW.owner_participant_id;
 ELSIF TG_TABLE_NAME='payment_allocation' THEN
 SELECT session_id INTO a FROM payment_transaction WHERE id=NEW.payment_transaction_id;
 SELECT session_id INTO b FROM financial_charge WHERE id=NEW.financial_charge_id;
 ELSIF TG_TABLE_NAME='order_status_history' AND NEW.order_item_id IS NOT NULL THEN
 a:=NEW.order_batch_id; SELECT order_batch_id INTO b FROM order_item WHERE id=NEW.order_item_id;
 ELSIF TG_TABLE_NAME='payment_transaction' AND NEW.payment_intent_id IS NOT NULL THEN
 a:=NEW.session_id; SELECT session_id INTO b FROM payment_intent WHERE id=NEW.payment_intent_id;
 ELSIF TG_TABLE_NAME='financial_charge' AND NEW.order_item_id IS NOT NULL THEN
 a:=NEW.session_id; SELECT o.session_id INTO b FROM order_item i JOIN order_batch o ON o.id=i.order_batch_id WHERE i.id=NEW.order_item_id;
 ELSIF TG_TABLE_NAME='order_batch' AND NEW.created_by_participant_id IS NOT NULL THEN
 a:=NEW.session_id; SELECT session_id INTO b FROM session_participant WHERE id=NEW.created_by_participant_id;
 ELSIF TG_TABLE_NAME='support_request' AND NEW.participant_id IS NOT NULL THEN
 a:=NEW.session_id; SELECT session_id INTO b FROM session_participant WHERE id=NEW.participant_id;
 ELSIF TG_TABLE_NAME='payment_intent' AND NEW.payer_participant_id IS NOT NULL THEN
 a:=NEW.session_id; SELECT session_id INTO b FROM session_participant WHERE id=NEW.payer_participant_id;
 ELSIF TG_TABLE_NAME IN ('operational_alert','outstanding_balance_case') AND NEW.session_id IS NOT NULL THEN
 a:=NEW.table_id; SELECT table_id INTO b FROM table_session WHERE id=NEW.session_id;
 END IF;
 IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'Cross-session reference' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;

CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON cart_item FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON order_item FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON order_status_history FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON payment_transaction FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON financial_charge FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON order_batch FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON support_request FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON payment_intent FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON operational_alert FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON outstanding_balance_case FOR EACH ROW EXECUTE FUNCTION core_session_guard();
COMMIT;