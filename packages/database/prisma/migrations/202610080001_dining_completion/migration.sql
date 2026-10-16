-- Expand quick kitchen reasons; preserve all historical codes and monetary records.
ALTER TABLE order_item DROP CONSTRAINT order_item_reason_code;
ALTER TABLE order_item ADD CONSTRAINT order_item_reason_code CHECK (cancel_reason_code IS NULL OR cancel_reason_code IN ('CUSTOMER_CHANGED_MIND','OUT_OF_STOCK','INGREDIENT_QUALITY','EQUIPMENT_FAILURE','KITCHEN_ERROR','QUALITY_ISSUE','WRONG_ITEM','CUSTOMER_COMPLAINT','OTHER'));
CREATE INDEX business_audit_dining_completion ON business_audit_event(resource_id, action, created_at) WHERE action IN ('CASH_CHANGE_RETURNED','RECEIPT_PROVIDED','KITCHEN_UNAVAILABLE_REPORTED');
