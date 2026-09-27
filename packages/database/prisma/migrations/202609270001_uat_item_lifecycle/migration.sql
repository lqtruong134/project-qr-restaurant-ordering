-- UAT v2: item lifecycle timestamps; actor remains in immutable status history.
ALTER TABLE order_item ADD COLUMN received_at timestamptz,
 ADD COLUMN preparation_started_at timestamptz, ADD COLUMN ready_at timestamptz,
 ADD COLUMN served_at timestamptz;
UPDATE order_item i SET
 received_at=(SELECT min(created_at) FROM order_status_history h WHERE h.order_item_id=i.id AND h.new_status='ACCEPTED'),
 preparation_started_at=(SELECT min(created_at) FROM order_status_history h WHERE h.order_item_id=i.id AND h.new_status='IN_PREPARATION'),
 ready_at=(SELECT min(created_at) FROM order_status_history h WHERE h.order_item_id=i.id AND h.new_status='READY'),
 served_at=(SELECT min(created_at) FROM order_status_history h WHERE h.order_item_id=i.id AND h.new_status='SERVED');
