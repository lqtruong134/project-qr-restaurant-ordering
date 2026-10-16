BEGIN;
-- Refuse incompatible legacy data rather than silently dropping customer requests.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM support_request WHERE participant_id IS NOT NULL AND status IN ('NEW','ACKNOWLEDGED')
   GROUP BY session_id,participant_id,request_type HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Duplicate active support requests: reconcile before deploying migration';
 END IF;
END $$;
CREATE UNIQUE INDEX support_request_active_participant ON support_request(session_id,participant_id,request_type)
 WHERE participant_id IS NOT NULL AND status IN ('NEW','ACKNOWLEDGED');
CREATE INDEX support_request_queue ON support_request(status,created_at);
ALTER TABLE support_request ADD CONSTRAINT support_request_owner_state CHECK (
 (status='NEW' AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
 OR (status='ACKNOWLEDGED' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND resolved_by IS NULL AND resolved_at IS NULL)
 OR (status='RESOLVED' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND resolved_by=acknowledged_by AND resolved_at IS NOT NULL)
 OR status='CANCELLED');
CREATE TABLE support_request_handoff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 support_request_id uuid NOT NULL REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 from_staff_id uuid NOT NULL REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 to_staff_id uuid NOT NULL REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')),
 requested_at timestamptz(6) NOT NULL DEFAULT now(),
 responded_at timestamptz(6),
 responded_by uuid REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 response_reason text,
 CHECK(from_staff_id<>to_staff_id),
 CHECK((status='PENDING' AND responded_at IS NULL AND responded_by IS NULL AND response_reason IS NULL)
   OR (status<>'PENDING' AND responded_at IS NOT NULL AND responded_at>=requested_at
       AND responded_by IS NOT NULL AND length(btrim(response_reason)) BETWEEN 1 AND 500)),
 CHECK(status NOT IN ('ACCEPTED','DECLINED') OR responded_by=to_staff_id),
 CHECK(status<>'CANCELLED' OR responded_by=from_staff_id)
);
CREATE UNIQUE INDEX support_handoff_one_pending ON support_request_handoff(support_request_id) WHERE status='PENDING';
CREATE INDEX support_handoff_request_history ON support_request_handoff(support_request_id,requested_at);
CREATE INDEX support_handoff_incoming ON support_request_handoff(to_staff_id,status);
CREATE INDEX support_handoff_from ON support_request_handoff(from_staff_id);
CREATE INDEX support_handoff_responder ON support_request_handoff(responded_by);
ALTER TABLE outbox_event ADD COLUMN support_request_id uuid REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE INDEX outbox_support_request ON outbox_event(support_request_id);
ALTER TABLE outbox_event ADD CONSTRAINT outbox_support_aggregate CHECK (
 (aggregate_type='SUPPORT_REQUEST' AND support_request_id IS NOT NULL AND order_batch_id IS NULL AND payment_transaction_id IS NULL)
 OR (aggregate_type<>'SUPPORT_REQUEST' AND support_request_id IS NULL));

CREATE OR REPLACE FUNCTION core_tenant(kind text, entity uuid) RETURNS uuid LANGUAGE plpgsql STABLE AS $$ DECLARE result uuid; BEGIN IF entity IS NULL THEN RETURN NULL; END IF; CASE kind
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
WHEN 'support_request_handoff' THEN SELECT core_tenant('support_request',support_request_id) FROM support_request_handoff WHERE id=entity INTO result;
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
WHEN 'outbox_event' THEN SELECT COALESCE(core_tenant('order_batch',order_batch_id),core_tenant('payment_transaction',payment_transaction_id),core_tenant('support_request',support_request_id)) FROM outbox_event WHERE id=entity INTO result;
ELSE RETURN NULL; END CASE; RETURN result; END $$;


CREATE CONSTRAINT TRIGGER support_handoff_tenant AFTER INSERT OR UPDATE ON support_request_handoff
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard(
 'support_request','support_request_id','app_user','from_staff_id','app_user','to_staff_id','app_user','responded_by');
CREATE CONSTRAINT TRIGGER outbox_support_tenant AFTER INSERT OR UPDATE ON outbox_event
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('support_request','support_request_id');

CREATE FUNCTION support_handoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x support_request; h support_request_handoff; request_id uuid;
BEGIN
 IF TG_TABLE_NAME='support_request' THEN request_id=NEW.id; ELSE request_id=NEW.support_request_id; END IF;
 SELECT * INTO x FROM support_request WHERE id=request_id;
 SELECT * INTO h FROM support_request_handoff WHERE support_request_id=request_id AND status='PENDING';
 IF h.id IS NOT NULL AND (x.status<>'ACKNOWLEDGED' OR x.acknowledged_by<>h.from_staff_id) THEN
   RAISE EXCEPTION 'Pending handoff must retain its current owner' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER support_pending_owner AFTER INSERT OR UPDATE ON support_request
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION support_handoff_guard();
CREATE CONSTRAINT TRIGGER support_pending_owner AFTER INSERT OR UPDATE ON support_request_handoff
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION support_handoff_guard();

CREATE FUNCTION support_handoff_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'PENDING' OR NEW.id<>OLD.id OR NEW.support_request_id<>OLD.support_request_id
   OR NEW.from_staff_id<>OLD.from_staff_id OR NEW.to_staff_id<>OLD.to_staff_id
   OR NEW.reason<>OLD.reason OR NEW.requested_at<>OLD.requested_at THEN
   RAISE EXCEPTION 'Handoff history is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER support_handoff_history BEFORE UPDATE ON support_request_handoff
 FOR EACH ROW EXECUTE FUNCTION support_handoff_immutable();
COMMENT ON TABLE support_request_handoff IS 'Recipient-confirmed handoff history. Current owner remains responsible while PENDING.';
COMMENT ON COLUMN support_request.acknowledged_at IS 'First claim time; preserved across accepted handoffs. Each transfer time is in handoff history.';
COMMENT ON COLUMN outbox_event.support_request_id IS 'Support aggregate FK used by the existing outbox publisher and tenant resolver.';
COMMIT;
