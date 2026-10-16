BEGIN;
ALTER TABLE goods_receipt ADD COLUMN external_reference text
  CHECK (external_reference IS NULL OR length(external_reference) BETWEEN 1 AND 120);
-- Preserve every existing code. Start above any legacy code in the generated namespace.
CREATE SEQUENCE goods_receipt_number_seq;
SELECT setval('goods_receipt_number_seq',
  GREATEST(COALESCE(MAX(substring(receipt_no FROM 4)::bigint),0),1),
  COALESCE(MAX(substring(receipt_no FROM 4)::bigint),0)>0)
FROM goods_receipt WHERE receipt_no ~ '^PN-[0-9]{1,18}$';
CREATE INDEX goods_receipt_history_idx ON goods_receipt(location_id,created_at DESC,id);
CREATE INDEX inventory_movement_history_idx ON inventory_movement(location_id,occurred_at DESC,id);
COMMIT;
