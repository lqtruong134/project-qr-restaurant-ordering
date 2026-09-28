ALTER TABLE inventory_movement ADD COLUMN request_key text, ADD COLUMN reason text;
CREATE UNIQUE INDEX inventory_manual_request_key ON inventory_movement(location_id,request_key) WHERE request_key IS NOT NULL;
