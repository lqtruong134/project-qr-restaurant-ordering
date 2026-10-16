BEGIN;
-- Extend the original two-kind constraints without changing previous migration checksums.
ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_aggregate_type_check;
ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_aggregate_type_check
 CHECK(aggregate_type IN ('ORDER_BATCH','PAYMENT_TRANSACTION','SUPPORT_REQUEST'));
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_check CHECK((
 (aggregate_type='ORDER_BATCH' AND order_batch_id IS NOT NULL AND payment_transaction_id IS NULL AND support_request_id IS NULL)
 OR (aggregate_type='PAYMENT_TRANSACTION' AND order_batch_id IS NULL AND payment_transaction_id IS NOT NULL AND support_request_id IS NULL)
 OR (aggregate_type='SUPPORT_REQUEST' AND order_batch_id IS NULL AND payment_transaction_id IS NULL AND support_request_id IS NOT NULL)) IS TRUE);
CREATE FUNCTION support_handoff_keep_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Handoff history cannot be deleted' USING ERRCODE='23514'; END $$;
CREATE TRIGGER support_handoff_keep_history BEFORE DELETE ON support_request_handoff
 FOR EACH ROW EXECUTE FUNCTION support_handoff_keep_history();
COMMIT;
