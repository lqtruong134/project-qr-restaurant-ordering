BEGIN;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='order_item'::regclass AND contype='c'
 AND (pg_get_constraintdef(oid) LIKE '%SUBMITTED%' OR pg_get_constraintdef(oid) LIKE '%cancel_reason%') LOOP
 EXECUTE format('ALTER TABLE order_item DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE order_item ADD CONSTRAINT order_item_status_check CHECK(status IN ('SUBMITTED','ACCEPTED','IN_PREPARATION','READY','SERVED','UNAVAILABLE','CANCELLED'));
ALTER TABLE order_item ADD CONSTRAINT order_item_cancellation_check CHECK(status NOT IN ('CANCELLED','UNAVAILABLE') OR (cancel_reason IS NOT NULL AND length(btrim(cancel_reason))>0 AND cancelled_by_type IS NOT NULL));
COMMIT;
