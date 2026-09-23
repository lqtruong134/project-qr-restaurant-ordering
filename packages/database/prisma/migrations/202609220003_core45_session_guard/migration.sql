CREATE OR REPLACE FUNCTION core_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a uuid; b uuid;
BEGIN
 IF TG_TABLE_NAME='cart_item' AND (to_jsonb(NEW)->>'owner_participant_id')::uuid IS NOT NULL THEN
 SELECT session_id INTO a FROM session_cart WHERE id=(to_jsonb(NEW)->>'cart_id')::uuid;
 SELECT session_id INTO b FROM session_participant WHERE id=(to_jsonb(NEW)->>'owner_participant_id')::uuid;
 ELSIF TG_TABLE_NAME='order_item' AND (to_jsonb(NEW)->>'owner_participant_id')::uuid IS NOT NULL THEN
 SELECT session_id INTO a FROM order_batch WHERE id=(to_jsonb(NEW)->>'order_batch_id')::uuid;
 SELECT session_id INTO b FROM session_participant WHERE id=(to_jsonb(NEW)->>'owner_participant_id')::uuid;
 ELSIF TG_TABLE_NAME='payment_allocation' THEN
 SELECT session_id INTO a FROM payment_transaction WHERE id=(to_jsonb(NEW)->>'payment_transaction_id')::uuid;
 SELECT session_id INTO b FROM financial_charge WHERE id=(to_jsonb(NEW)->>'financial_charge_id')::uuid;
 ELSIF TG_TABLE_NAME='order_status_history' AND (to_jsonb(NEW)->>'order_item_id')::uuid IS NOT NULL THEN
 a:=(to_jsonb(NEW)->>'order_batch_id')::uuid; SELECT order_batch_id INTO b FROM order_item WHERE id=(to_jsonb(NEW)->>'order_item_id')::uuid;
 ELSIF TG_TABLE_NAME='payment_transaction' AND (to_jsonb(NEW)->>'payment_intent_id')::uuid IS NOT NULL THEN
 a:=(to_jsonb(NEW)->>'session_id')::uuid; SELECT session_id INTO b FROM payment_intent WHERE id=(to_jsonb(NEW)->>'payment_intent_id')::uuid;
 ELSIF TG_TABLE_NAME='financial_charge' AND (to_jsonb(NEW)->>'order_item_id')::uuid IS NOT NULL THEN
 a:=(to_jsonb(NEW)->>'session_id')::uuid; SELECT o.session_id INTO b FROM order_item i JOIN order_batch o ON o.id=i.order_batch_id WHERE i.id=(to_jsonb(NEW)->>'order_item_id')::uuid;
 ELSIF TG_TABLE_NAME='order_batch' AND (to_jsonb(NEW)->>'created_by_participant_id')::uuid IS NOT NULL THEN
 a:=(to_jsonb(NEW)->>'session_id')::uuid; SELECT session_id INTO b FROM session_participant WHERE id=(to_jsonb(NEW)->>'created_by_participant_id')::uuid;
 ELSIF TG_TABLE_NAME='support_request' AND (to_jsonb(NEW)->>'participant_id')::uuid IS NOT NULL THEN
 a:=(to_jsonb(NEW)->>'session_id')::uuid; SELECT session_id INTO b FROM session_participant WHERE id=(to_jsonb(NEW)->>'participant_id')::uuid;
 ELSIF TG_TABLE_NAME='payment_intent' AND (to_jsonb(NEW)->>'payer_participant_id')::uuid IS NOT NULL THEN
 a:=(to_jsonb(NEW)->>'session_id')::uuid; SELECT session_id INTO b FROM session_participant WHERE id=(to_jsonb(NEW)->>'payer_participant_id')::uuid;
 ELSIF TG_TABLE_NAME IN ('operational_alert','outstanding_balance_case') AND (to_jsonb(NEW)->>'session_id')::uuid IS NOT NULL THEN
 a:=(to_jsonb(NEW)->>'table_id')::uuid; SELECT table_id INTO b FROM table_session WHERE id=(to_jsonb(NEW)->>'session_id')::uuid;
 END IF;
 IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'Cross-session reference' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
