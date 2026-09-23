-- CORE C0-C5: additive upgrade from Sprint 1. Preserve existing rows and migration history.

BEGIN;

ALTER TABLE table_session ADD COLUMN financial_status text NOT NULL DEFAULT 'UNPAID', ADD COLUMN risk_status text NOT NULL DEFAULT 'NORMAL';

ALTER TABLE table_session ADD CONSTRAINT core_financial_status CHECK (financial_status IN ('UNPAID','PARTIALLY_PAID','SETTLED','REFUND_DUE','OUTSTANDING_EXCEPTION')), ADD CONSTRAINT core_risk_status CHECK (risk_status IN ('NORMAL','REVIEW_REQUIRED','BLOCKED'));

CREATE TABLE support_request (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  participant_id uuid,
  request_type text NOT NULL,
  content text,
  status text NOT NULL DEFAULT 'NEW',
  acknowledged_by uuid,
  resolved_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  acknowledged_at timestamptz(6),
  resolved_at timestamptz(6),
  PRIMARY KEY (id),
  CHECK (request_type IN ('ASSISTANCE','WATER','UTENSILS','BILL','OTHER')),
  CHECK (status IN ('NEW','ACKNOWLEDGED','RESOLVED','CANCELLED')),
  CHECK (length(btrim(request_type)) > 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (status <> 'RESOLVED' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);

CREATE TABLE operational_alert (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid,
  table_id uuid NOT NULL,
  alert_type text NOT NULL,
  severity text NOT NULL,
  outstanding_amount bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'NEW',
  acknowledged_by uuid,
  escalated_at timestamptz(6),
  resolved_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (alert_type IN ('PAYMENT_SHORTFALL','REFUND_REQUIRED','RISK_REVIEW','OTHER')),
  CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  CHECK (status IN ('NEW','ACKNOWLEDGED','ESCALATED','RESOLVED')),
  CHECK (length(btrim(alert_type)) > 0),
  CHECK (length(btrim(severity)) > 0),
  CHECK (outstanding_amount >= 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (alert_type <> 'PAYMENT_SHORTFALL' OR session_id IS NOT NULL)
);

CREATE TABLE cart_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL,
  owner_participant_id uuid,
  product_id uuid NOT NULL,
  quantity integer NOT NULL,
  note text,
  unit_price_preview bigint NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (quantity > 0),
  CHECK (unit_price_preview >= 0),
  CHECK (version > 0)
);

CREATE TABLE order_batch (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  created_by_type text NOT NULL,
  client_request_id text NOT NULL,
  status text NOT NULL DEFAULT 'SUBMITTED',
  subtotal bigint NOT NULL,
  total_amount bigint NOT NULL,
  risk_decision text,
  config_version integer,
  submitted_at timestamptz(6),
  accepted_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid,
  created_by_participant_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (((created_by_type='USER' AND created_by_user_id IS NOT NULL AND created_by_participant_id IS NULL) OR (created_by_type='GUEST' AND created_by_user_id IS NULL AND created_by_participant_id IS NOT NULL)) IS TRUE),
  CHECK (status IN ('PENDING_REVIEW','SUBMITTED','ACCEPTED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
  CHECK (risk_decision IN ('ALLOW','REVIEW','BLOCK')),
  CHECK (created_by_type IN ('USER','GUEST')),
  CHECK (length(btrim(created_by_type)) > 0),
  CHECK (length(btrim(client_request_id)) > 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (subtotal >= 0),
  CHECK (total_amount >= 0),
  CHECK (config_version >= 0),
  CHECK (version > 0)
);

CREATE TABLE order_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_batch_id uuid NOT NULL,
  owner_participant_id uuid,
  product_id uuid NOT NULL,
  product_name_snapshot text NOT NULL,
  quantity integer NOT NULL,
  unit_price_snapshot bigint NOT NULL,
  line_total bigint NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'SUBMITTED',
  cancel_reason text,
  version integer NOT NULL DEFAULT 1,
  cancelled_by_type text,
  cancelled_by_user_id uuid,
  cancelled_by_participant_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (((cancelled_by_type='USER' AND cancelled_by_user_id IS NOT NULL AND cancelled_by_participant_id IS NULL) OR (cancelled_by_type='GUEST' AND cancelled_by_user_id IS NULL AND cancelled_by_participant_id IS NOT NULL) OR (cancelled_by_type='SYSTEM' AND cancelled_by_user_id IS NULL AND cancelled_by_participant_id IS NULL) OR (cancelled_by_type IS NULL AND cancelled_by_user_id IS NULL AND cancelled_by_participant_id IS NULL)) IS TRUE),
  CHECK (status IN ('SUBMITTED','ACCEPTED','IN_PREPARATION','READY','SERVED','CANCELLED')),
  CHECK (cancelled_by_type IN ('USER','GUEST','SYSTEM')),
  CHECK (length(btrim(product_name_snapshot)) > 0),
  CHECK (quantity > 0),
  CHECK (unit_price_snapshot >= 0),
  CHECK (line_total >= 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (version > 0),
  CHECK (line_total = quantity::numeric * unit_price_snapshot),
  CHECK (status <> 'CANCELLED' OR (cancel_reason IS NOT NULL AND length(btrim(cancel_reason))>0 AND cancelled_by_type IS NOT NULL))
);

CREATE TABLE order_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_batch_id uuid NOT NULL,
  order_item_id uuid,
  old_status text,
  new_status text NOT NULL,
  actor_type text NOT NULL,
  reason text,
  changed_at timestamptz(6) NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_participant_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (((actor_type='USER' AND actor_user_id IS NOT NULL AND actor_participant_id IS NULL) OR (actor_type='GUEST' AND actor_user_id IS NULL AND actor_participant_id IS NOT NULL) OR (actor_type='SYSTEM' AND actor_user_id IS NULL AND actor_participant_id IS NULL)) IS TRUE),
  CHECK (actor_type IN ('USER','GUEST','SYSTEM')),
  CHECK (length(btrim(new_status)) > 0),
  CHECK (length(btrim(actor_type)) > 0)
);

CREATE TABLE idempotency_record (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  resource_type text NOT NULL,
  response_snapshot jsonb,
  expires_at timestamptz(6) NOT NULL,
  actor_type text NOT NULL,
  actor_user_id uuid,
  actor_participant_id uuid,
  order_batch_id uuid,
  payment_intent_id uuid,
  status text NOT NULL DEFAULT 'PROCESSING',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (((actor_type='USER' AND actor_user_id IS NOT NULL AND actor_participant_id IS NULL) OR (actor_type='GUEST' AND actor_user_id IS NULL AND actor_participant_id IS NOT NULL) OR (actor_type='SYSTEM' AND actor_user_id IS NULL AND actor_participant_id IS NULL)) IS TRUE),
  CHECK (((resource_type='ORDER_BATCH' AND payment_intent_id IS NULL) OR (resource_type='PAYMENT_INTENT' AND order_batch_id IS NULL)) IS TRUE),
  CHECK (status <> 'SUCCEEDED' OR (num_nonnulls(order_batch_id,payment_intent_id)=1 AND response_snapshot IS NOT NULL)),
  CHECK (actor_type IN ('USER','GUEST','SYSTEM')),
  CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED')),
  CHECK (resource_type IN ('ORDER_BATCH','PAYMENT_INTENT')),
  CHECK (length(btrim(scope)) > 0),
  CHECK (length(btrim(idempotency_key)) > 0),
  CHECK (length(btrim(request_hash)) > 0),
  CHECK (length(btrim(resource_type)) > 0),
  CHECK (length(btrim(actor_type)) > 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (expires_at > created_at)
);

CREATE TABLE outbox_event (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz(6) NOT NULL DEFAULT now(),
  published_at timestamptz(6),
  order_batch_id uuid,
  payment_transaction_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (((aggregate_type='ORDER_BATCH' AND order_batch_id IS NOT NULL AND payment_transaction_id IS NULL) OR (aggregate_type='PAYMENT_TRANSACTION' AND order_batch_id IS NULL AND payment_transaction_id IS NOT NULL)) IS TRUE),
  CHECK (aggregate_type IN ('ORDER_BATCH','PAYMENT_TRANSACTION')),
  CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
  CHECK (length(btrim(aggregate_type)) > 0),
  CHECK (length(btrim(event_type)) > 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (attempts >= 0),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);

CREATE TABLE session_financial_account (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  charge_total bigint NOT NULL DEFAULT 0,
  paid_total bigint NOT NULL DEFAULT 0,
  refunded_total bigint NOT NULL DEFAULT 0,
  reserved_payment_amount bigint NOT NULL DEFAULT 0,
  outstanding_amount bigint NOT NULL DEFAULT 0,
  refund_due_amount bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (charge_total >= 0),
  CHECK (paid_total >= 0),
  CHECK (refunded_total >= 0),
  CHECK (reserved_payment_amount >= 0),
  CHECK (outstanding_amount >= 0),
  CHECK (refund_due_amount >= 0),
  CHECK (version > 0),
  UNIQUE (session_id)
);

CREATE TABLE financial_charge (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  order_item_id uuid,
  charge_type text NOT NULL,
  amount bigint NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  reversed_at timestamptz(6),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (charge_type IN ('ITEM','ADJUSTMENT')),
  CHECK (status IN ('ACTIVE','REVERSED')),
  CHECK (length(btrim(charge_type)) > 0),
  CHECK (amount >= 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (charge_type <> 'ITEM' OR order_item_id IS NOT NULL),
  CHECK (status <> 'REVERSED' OR reversed_at IS NOT NULL)
);

CREATE TABLE payment_intent (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  payer_participant_id uuid,
  method text NOT NULL,
  amount bigint NOT NULL,
  currency text NOT NULL DEFAULT 'VND',
  status text NOT NULL DEFAULT 'CREATED',
  client_request_id text NOT NULL,
  provider text,
  provider_reference text,
  expires_at timestamptz(6) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (method IN ('CASH','BANK_TRANSFER','ONLINE')),
  CHECK (status IN ('CREATED','PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED','REQUIRES_RECONCILIATION')),
  CHECK (length(btrim(method)) > 0),
  CHECK (amount > 0),
  CHECK (length(btrim(currency)) > 0),
  CHECK (currency = 'VND'),
  CHECK (length(btrim(status)) > 0),
  CHECK (length(btrim(client_request_id)) > 0),
  CHECK (version > 0),
  CHECK (expires_at > created_at),
  UNIQUE (session_id, client_request_id)
);

CREATE TABLE payment_transaction (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_intent_id uuid,
  session_id uuid NOT NULL,
  method text NOT NULL,
  provider text,
  provider_transaction_id text,
  amount bigint NOT NULL,
  currency text NOT NULL DEFAULT 'VND',
  status text NOT NULL DEFAULT 'PENDING',
  confirmed_by uuid,
  confirmed_at timestamptz(6),
  metadata jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (method IN ('CASH','BANK_TRANSFER','ONLINE')),
  CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED')),
  CHECK (length(btrim(method)) > 0),
  CHECK (amount > 0),
  CHECK (length(btrim(currency)) > 0),
  CHECK (currency = 'VND'),
  CHECK (length(btrim(status)) > 0),
  CHECK ((provider IS NULL) = (provider_transaction_id IS NULL))
);

CREATE TABLE payment_allocation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_transaction_id uuid NOT NULL,
  financial_charge_id uuid NOT NULL,
  allocated_amount bigint NOT NULL,
  reversed_amount bigint NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (allocated_amount >= 0),
  CHECK (reversed_amount >= 0),
  CHECK (reversed_amount <= allocated_amount),
  UNIQUE (payment_transaction_id, financial_charge_id)
);

CREATE TABLE payment_webhook_event (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text,
  provider_event_id text NOT NULL,
  provider_transaction_id text,
  payload_hash text NOT NULL,
  payload_snapshot jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  processing_status text NOT NULL DEFAULT 'RECEIVED',
  received_at timestamptz(6) NOT NULL DEFAULT now(),
  processed_at timestamptz(6),
  payment_transaction_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (processing_status IN ('RECEIVED','UNMATCHED','PROCESSED','REJECTED','FAILED')),
  CHECK (length(btrim(provider_event_id)) > 0),
  CHECK (length(btrim(payload_hash)) > 0),
  CHECK (length(btrim(processing_status)) > 0),
  CHECK (processing_status <> 'PROCESSED' OR (signature_valid IS TRUE AND payment_transaction_id IS NOT NULL AND processed_at IS NOT NULL)),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE risk_policy_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  config_key text NOT NULL,
  value_type text NOT NULL,
  value_json jsonb NOT NULL,
  allowed_min numeric(18,6),
  allowed_max numeric(18,6),
  version_no integer NOT NULL DEFAULT 1,
  effective_from timestamptz(6) NOT NULL DEFAULT now(),
  changed_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (value_type IN ('NUMBER','BOOLEAN','STRING','JSON')),
  CHECK (length(btrim(config_key)) > 0),
  CHECK (length(btrim(value_type)) > 0),
  CHECK (version_no > 0),
  CHECK (allowed_min IS NULL OR allowed_max IS NULL OR allowed_min <= allowed_max),
  UNIQUE (restaurant_id, config_key, version_no)
);

CREATE TABLE order_risk_assessment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_batch_id uuid NOT NULL,
  decision text NOT NULL,
  score numeric(18,6),
  metric_snapshot jsonb NOT NULL,
  reason_codes jsonb NOT NULL,
  config_version integer,
  config_snapshot jsonb NOT NULL,
  evaluated_at timestamptz(6) NOT NULL DEFAULT now(),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (decision IN ('ALLOW','REVIEW','BLOCK')),
  CHECK (length(btrim(decision)) > 0),
  CHECK (config_version >= 0)
);

CREATE TABLE order_review (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_batch_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  requested_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  reviewer_id uuid,
  decided_at timestamptz(6),
  decision_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  CHECK (length(btrim(status)) > 0),
  CHECK (version > 0),
  CHECK (expires_at > requested_at),
  CHECK (status NOT IN ('APPROVED','REJECTED') OR (reviewer_id IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE refund_case (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  order_item_id uuid,
  source_payment_transaction_id uuid,
  source_allocation_id uuid,
  amount bigint NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'OPEN',
  resolution_method text,
  assigned_staff_id uuid,
  evidence_ref text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED_CASH','RESOLVED_TRANSFER','CANCELLED')),
  CHECK (resolution_method IN ('CASH','BANK_TRANSFER')),
  CHECK (amount > 0),
  CHECK (length(btrim(status)) > 0)
);

CREATE TABLE refund_transaction (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  refund_case_id uuid NOT NULL,
  method text NOT NULL,
  amount bigint NOT NULL,
  reference text,
  status text NOT NULL DEFAULT 'PENDING',
  processed_by uuid NOT NULL,
  processed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (method IN ('CASH','BANK_TRANSFER')),
  CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED')),
  CHECK (length(btrim(method)) > 0),
  CHECK (amount > 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (status <> 'SUCCEEDED' OR processed_at IS NOT NULL)
);

CREATE TABLE outstanding_balance_case (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  table_id uuid NOT NULL,
  invoice_total bigint NOT NULL,
  paid_total bigint NOT NULL DEFAULT 0,
  outstanding_amount bigint NOT NULL DEFAULT 0,
  reason_code text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_ADMIN_REVIEW',
  reported_by uuid NOT NULL,
  admin_owner uuid,
  evidence_ref text,
  notes text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (status IN ('PENDING_ADMIN_REVIEW','IN_RECOVERY','PARTIALLY_RECOVERED','RECOVERED','WRITTEN_OFF','CANCELLED')),
  CHECK (invoice_total >= 0),
  CHECK (paid_total >= 0),
  CHECK (outstanding_amount >= 0),
  CHECK (length(btrim(reason_code)) > 0),
  CHECK (length(btrim(status)) > 0)
);

CREATE TABLE unit_of_measure (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  dimension text NOT NULL,
  decimal_scale integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (dimension IN ('MASS','VOLUME','COUNT')),
  CHECK (length(btrim(code)) > 0),
  CHECK (length(btrim(name)) > 0),
  CHECK (length(btrim(dimension)) > 0),
  CHECK (decimal_scale >= 0),
  CHECK (decimal_scale <= 6),
  UNIQUE (code)
);

CREATE TABLE ingredient (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  base_unit_id uuid NOT NULL,
  min_stock numeric(18,6) NOT NULL DEFAULT 0,
  current_avg_cost numeric(18,6) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (length(btrim(code)) > 0),
  CHECK (length(btrim(name)) > 0),
  CHECK (min_stock >= 0),
  CHECK (current_avg_cost >= 0),
  CHECK (version > 0),
  UNIQUE (restaurant_id, code)
);

CREATE TABLE stock_location (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (length(btrim(code)) > 0),
  CHECK (length(btrim(name)) > 0),
  UNIQUE (restaurant_id, code)
);

CREATE TABLE recipe_bom (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  version_no integer NOT NULL DEFAULT 1,
  yield_quantity numeric(18,6) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  effective_from timestamptz(6) NOT NULL DEFAULT now(),
  effective_to timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  CHECK (version_no > 0),
  CHECK (yield_quantity > 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (product_id, version_no)
);

CREATE TABLE recipe_bom_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipe_bom_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  quantity numeric(18,6) NOT NULL,
  waste_percent numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (quantity > 0),
  CHECK (waste_percent >= 0),
  CHECK (waste_percent <= 100),
  UNIQUE (recipe_bom_id, ingredient_id)
);

CREATE TABLE inventory_balance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  on_hand_qty numeric(18,6) NOT NULL DEFAULT 0,
  reserved_qty numeric(18,6) NOT NULL DEFAULT 0,
  available_qty numeric(18,6) NOT NULL,
  avg_cost numeric(18,6) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (on_hand_qty >= 0),
  CHECK (reserved_qty >= 0),
  CHECK (available_qty >= 0),
  CHECK (avg_cost >= 0),
  CHECK (version > 0),
  CHECK (available_qty = on_hand_qty - reserved_qty AND reserved_qty <= on_hand_qty),
  UNIQUE (location_id, ingredient_id)
);

CREATE TABLE inventory_reservation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  location_id uuid NOT NULL,
  reservation_type text NOT NULL,
  quantity numeric(18,6) NOT NULL,
  status text NOT NULL DEFAULT 'PROVISIONAL',
  expires_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (reservation_type IN ('PROVISIONAL','CONFIRMED')),
  CHECK (status IN ('PROVISIONAL','ACTIVE','CONSUMED','RELEASED','EXPIRED')),
  CHECK (length(btrim(reservation_type)) > 0),
  CHECK (quantity > 0),
  CHECK (length(btrim(status)) > 0)
);

CREATE TABLE inventory_movement (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  movement_type text NOT NULL,
  quantity numeric(18,6) NOT NULL,
  unit_cost numeric(18,6) NOT NULL,
  value bigint NOT NULL,
  source_type text NOT NULL,
  occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  created_by uuid,
  goods_receipt_id uuid,
  order_item_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (((source_type='GOODS_RECEIPT' AND goods_receipt_id IS NOT NULL AND order_item_id IS NULL) OR (source_type='ORDER_ITEM' AND goods_receipt_id IS NULL AND order_item_id IS NOT NULL) OR (source_type='MANUAL' AND goods_receipt_id IS NULL AND order_item_id IS NULL)) IS TRUE),
  CHECK (movement_type IN ('RECEIPT','CONSUMPTION','WASTE','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT')),
  CHECK (source_type IN ('GOODS_RECEIPT','ORDER_ITEM','MANUAL')),
  CHECK (length(btrim(movement_type)) > 0),
  CHECK (unit_cost >= 0),
  CHECK (length(btrim(source_type)) > 0),
  CHECK (quantity <> 0),
  CHECK ((movement_type IN ('RECEIPT','ADJUSTMENT_IN','TRANSFER_IN') AND quantity>0 AND value>=0) OR (movement_type IN ('CONSUMPTION','WASTE','ADJUSTMENT_OUT','TRANSFER_OUT') AND quantity<0 AND value<=0))
);

CREATE TABLE goods_receipt (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  receipt_no text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  received_at timestamptz(6),
  total_value bigint NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid,
  supplier_name_snapshot text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (status IN ('DRAFT','APPROVED','CANCELLED')),
  CHECK (length(btrim(receipt_no)) > 0),
  CHECK (length(btrim(status)) > 0),
  CHECK (total_value >= 0),
  UNIQUE (location_id, receipt_no),
  CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND received_at IS NOT NULL))
);

CREATE TABLE goods_receipt_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  quantity numeric(18,6) NOT NULL,
  unit_id uuid NOT NULL,
  base_quantity numeric(18,6) NOT NULL,
  unit_cost numeric(18,6) NOT NULL,
  lot_no text,
  expiry_date date,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (quantity > 0),
  CHECK (base_quantity > 0),
  CHECK (unit_cost >= 0)
);

CREATE TABLE order_item_ingredient_snapshot (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL,
  recipe_bom_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  planned_qty numeric(18,6) NOT NULL,
  consumed_qty numeric(18,6) NOT NULL,
  unit_cost_snapshot numeric(18,6) NOT NULL,
  cogs_value bigint NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (planned_qty >= 0),
  CHECK (consumed_qty >= 0),
  CHECK (unit_cost_snapshot >= 0),
  CHECK (cogs_value >= 0),
  UNIQUE (order_item_id, recipe_bom_id, ingredient_id)
);

ALTER TABLE support_request ADD CONSTRAINT core_support_request_f1 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE support_request ADD CONSTRAINT core_support_request_f2 FOREIGN KEY (participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE support_request ADD CONSTRAINT core_support_request_f3 FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE support_request ADD CONSTRAINT core_support_request_f4 FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_support_request_fk1 ON support_request (session_id);

CREATE INDEX core_support_request_fk2 ON support_request (participant_id);

CREATE INDEX core_support_request_fk3 ON support_request (acknowledged_by);

CREATE INDEX core_support_request_fk4 ON support_request (resolved_by);

CREATE TRIGGER core_touch BEFORE UPDATE ON support_request FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE operational_alert ADD CONSTRAINT core_operational_alert_f1 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE operational_alert ADD CONSTRAINT core_operational_alert_f2 FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE operational_alert ADD CONSTRAINT core_operational_alert_f3 FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_alert_shortfall ON operational_alert (session_id) WHERE alert_type='PAYMENT_SHORTFALL' AND status<>'RESOLVED' AND session_id IS NOT NULL;

CREATE INDEX core_operational_alert_fk1 ON operational_alert (session_id);

CREATE INDEX core_operational_alert_fk2 ON operational_alert (table_id);

CREATE INDEX core_operational_alert_fk3 ON operational_alert (acknowledged_by);

CREATE TRIGGER core_touch BEFORE UPDATE ON operational_alert FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE cart_item ADD CONSTRAINT core_cart_item_f1 FOREIGN KEY (cart_id) REFERENCES session_cart(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE cart_item ADD CONSTRAINT core_cart_item_f2 FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE cart_item ADD CONSTRAINT core_cart_item_f3 FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_cart_item_fk1 ON cart_item (cart_id);

CREATE INDEX core_cart_item_fk2 ON cart_item (owner_participant_id);

CREATE INDEX core_cart_item_fk3 ON cart_item (product_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON cart_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE order_batch ADD CONSTRAINT core_order_batch_f1 FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_batch ADD CONSTRAINT core_order_batch_f2 FOREIGN KEY (created_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_batch ADD CONSTRAINT core_order_batch_f4 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_order_guest_request ON order_batch (session_id, created_by_participant_id, client_request_id) WHERE created_by_type='GUEST';

CREATE UNIQUE INDEX pdm_order_user_request ON order_batch (session_id, created_by_user_id, client_request_id) WHERE created_by_type='USER';

CREATE INDEX core_order_batch_fk1 ON order_batch (created_by_user_id);

CREATE INDEX core_order_batch_fk2 ON order_batch (created_by_participant_id);

CREATE INDEX core_order_batch_fk4 ON order_batch (session_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON order_batch FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE order_item ADD CONSTRAINT core_order_item_f1 FOREIGN KEY (cancelled_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_item ADD CONSTRAINT core_order_item_f2 FOREIGN KEY (cancelled_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_item ADD CONSTRAINT core_order_item_f4 FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_item ADD CONSTRAINT core_order_item_f5 FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_item ADD CONSTRAINT core_order_item_f6 FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_order_item_fk1 ON order_item (cancelled_by_user_id);

CREATE INDEX core_order_item_fk2 ON order_item (cancelled_by_participant_id);

CREATE INDEX core_order_item_fk4 ON order_item (order_batch_id);

CREATE INDEX core_order_item_fk5 ON order_item (owner_participant_id);

CREATE INDEX core_order_item_fk6 ON order_item (product_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON order_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE order_status_history ADD CONSTRAINT core_order_status_history_f1 FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_status_history ADD CONSTRAINT core_order_status_history_f2 FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_status_history ADD CONSTRAINT core_order_status_history_f4 FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_status_history ADD CONSTRAINT core_order_status_history_f5 FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_order_status_history_fk1 ON order_status_history (actor_user_id);

CREATE INDEX core_order_status_history_fk2 ON order_status_history (actor_participant_id);

CREATE INDEX core_order_status_history_fk4 ON order_status_history (order_batch_id);

CREATE INDEX core_order_status_history_fk5 ON order_status_history (order_item_id);

ALTER TABLE idempotency_record ADD CONSTRAINT core_idempotency_record_f1 FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE idempotency_record ADD CONSTRAINT core_idempotency_record_f2 FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE idempotency_record ADD CONSTRAINT core_idempotency_record_f4 FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE idempotency_record ADD CONSTRAINT core_idempotency_record_f5 FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_idem_user ON idempotency_record (scope, actor_user_id, idempotency_key) WHERE actor_type='USER';

CREATE UNIQUE INDEX pdm_idem_guest ON idempotency_record (scope, actor_participant_id, idempotency_key) WHERE actor_type='GUEST';

CREATE UNIQUE INDEX pdm_idem_system ON idempotency_record (scope, idempotency_key) WHERE actor_type='SYSTEM';

CREATE INDEX pdm_idem_expiry ON idempotency_record (expires_at);

CREATE INDEX core_idempotency_record_fk1 ON idempotency_record (actor_user_id);

CREATE INDEX core_idempotency_record_fk2 ON idempotency_record (actor_participant_id);

CREATE INDEX core_idempotency_record_fk4 ON idempotency_record (order_batch_id);

CREATE INDEX core_idempotency_record_fk5 ON idempotency_record (payment_intent_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON idempotency_record FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE outbox_event ADD CONSTRAINT core_outbox_event_f1 FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE outbox_event ADD CONSTRAINT core_outbox_event_f2 FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX pdm_outbox_ready ON outbox_event (status, available_at);

CREATE INDEX core_outbox_event_fk1 ON outbox_event (order_batch_id);

CREATE INDEX core_outbox_event_fk2 ON outbox_event (payment_transaction_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON outbox_event FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE session_financial_account ADD CONSTRAINT core_session_financial_account_f1 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_session_financial_account_fk1 ON session_financial_account (session_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON session_financial_account FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE financial_charge ADD CONSTRAINT core_financial_charge_f1 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE financial_charge ADD CONSTRAINT core_financial_charge_f2 FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_item_charge ON financial_charge (order_item_id) WHERE charge_type='ITEM';

CREATE INDEX core_financial_charge_fk1 ON financial_charge (session_id);

CREATE INDEX core_financial_charge_fk2 ON financial_charge (order_item_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON financial_charge FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE payment_intent ADD CONSTRAINT core_payment_intent_f1 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE payment_intent ADD CONSTRAINT core_payment_intent_f2 FOREIGN KEY (payer_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_pending_online ON payment_intent (session_id) WHERE method='ONLINE' AND status IN ('CREATED','PENDING');

CREATE INDEX core_payment_intent_fk1 ON payment_intent (session_id);

CREATE INDEX core_payment_intent_fk2 ON payment_intent (payer_participant_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON payment_intent FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE payment_transaction ADD CONSTRAINT core_payment_transaction_f1 FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE payment_transaction ADD CONSTRAINT core_payment_transaction_f2 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE payment_transaction ADD CONSTRAINT core_payment_transaction_f3 FOREIGN KEY (confirmed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_provider_tx ON payment_transaction (provider, provider_transaction_id) WHERE provider IS NOT NULL;

CREATE INDEX core_payment_transaction_fk1 ON payment_transaction (payment_intent_id);

CREATE INDEX core_payment_transaction_fk2 ON payment_transaction (session_id);

CREATE INDEX core_payment_transaction_fk3 ON payment_transaction (confirmed_by);

CREATE TRIGGER core_touch BEFORE UPDATE ON payment_transaction FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE payment_allocation ADD CONSTRAINT core_payment_allocation_f1 FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE payment_allocation ADD CONSTRAINT core_payment_allocation_f2 FOREIGN KEY (financial_charge_id) REFERENCES financial_charge(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_payment_allocation_fk1 ON payment_allocation (payment_transaction_id);

CREATE INDEX core_payment_allocation_fk2 ON payment_allocation (financial_charge_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE payment_webhook_event ADD CONSTRAINT core_payment_webhook_event_f1 FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_payment_webhook_event_fk1 ON payment_webhook_event (payment_transaction_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON payment_webhook_event FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE risk_policy_config ADD CONSTRAINT core_risk_policy_config_f1 FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE risk_policy_config ADD CONSTRAINT core_risk_policy_config_f2 FOREIGN KEY (changed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_risk_policy_config_fk1 ON risk_policy_config (restaurant_id);

CREATE INDEX core_risk_policy_config_fk2 ON risk_policy_config (changed_by);

ALTER TABLE order_risk_assessment ADD CONSTRAINT core_order_risk_assessment_f1 FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_order_risk_assessment_fk1 ON order_risk_assessment (order_batch_id);

ALTER TABLE order_review ADD CONSTRAINT core_order_review_f1 FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_review ADD CONSTRAINT core_order_review_f2 FOREIGN KEY (reviewer_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_review_pending ON order_review (order_batch_id) WHERE status='PENDING';

CREATE INDEX core_order_review_fk1 ON order_review (order_batch_id);

CREATE INDEX core_order_review_fk2 ON order_review (reviewer_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON order_review FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE refund_case ADD CONSTRAINT core_refund_case_f1 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE refund_case ADD CONSTRAINT core_refund_case_f2 FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE refund_case ADD CONSTRAINT core_refund_case_f3 FOREIGN KEY (source_payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE refund_case ADD CONSTRAINT core_refund_case_f4 FOREIGN KEY (source_allocation_id) REFERENCES payment_allocation(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE refund_case ADD CONSTRAINT core_refund_case_f5 FOREIGN KEY (assigned_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_refund_case_fk1 ON refund_case (session_id);

CREATE INDEX core_refund_case_fk2 ON refund_case (order_item_id);

CREATE INDEX core_refund_case_fk3 ON refund_case (source_payment_transaction_id);

CREATE INDEX core_refund_case_fk4 ON refund_case (source_allocation_id);

CREATE INDEX core_refund_case_fk5 ON refund_case (assigned_staff_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON refund_case FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE refund_transaction ADD CONSTRAINT core_refund_transaction_f1 FOREIGN KEY (refund_case_id) REFERENCES refund_case(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE refund_transaction ADD CONSTRAINT core_refund_transaction_f2 FOREIGN KEY (processed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_refund_transaction_fk1 ON refund_transaction (refund_case_id);

CREATE INDEX core_refund_transaction_fk2 ON refund_transaction (processed_by);

CREATE TRIGGER core_touch BEFORE UPDATE ON refund_transaction FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE outstanding_balance_case ADD CONSTRAINT core_outstanding_balance_case_f1 FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE outstanding_balance_case ADD CONSTRAINT core_outstanding_balance_case_f2 FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE outstanding_balance_case ADD CONSTRAINT core_outstanding_balance_case_f3 FOREIGN KEY (reported_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE outstanding_balance_case ADD CONSTRAINT core_outstanding_balance_case_f4 FOREIGN KEY (admin_owner) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_outstanding_open ON outstanding_balance_case (session_id) WHERE status NOT IN ('RECOVERED','WRITTEN_OFF','CANCELLED');

CREATE INDEX core_outstanding_balance_case_fk1 ON outstanding_balance_case (session_id);

CREATE INDEX core_outstanding_balance_case_fk2 ON outstanding_balance_case (table_id);

CREATE INDEX core_outstanding_balance_case_fk3 ON outstanding_balance_case (reported_by);

CREATE INDEX core_outstanding_balance_case_fk4 ON outstanding_balance_case (admin_owner);

CREATE TRIGGER core_touch BEFORE UPDATE ON outstanding_balance_case FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER core_touch BEFORE UPDATE ON unit_of_measure FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE ingredient ADD CONSTRAINT core_ingredient_f1 FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ingredient ADD CONSTRAINT core_ingredient_f2 FOREIGN KEY (base_unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_ingredient_fk1 ON ingredient (restaurant_id);

CREATE INDEX core_ingredient_fk2 ON ingredient (base_unit_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON ingredient FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE stock_location ADD CONSTRAINT core_stock_location_f1 FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_stock_location_fk1 ON stock_location (restaurant_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON stock_location FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE recipe_bom ADD CONSTRAINT core_recipe_bom_f1 FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX pdm_bom_active ON recipe_bom (product_id) WHERE status='ACTIVE';

CREATE INDEX core_recipe_bom_fk1 ON recipe_bom (product_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON recipe_bom FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE recipe_bom_item ADD CONSTRAINT core_recipe_bom_item_f1 FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE recipe_bom_item ADD CONSTRAINT core_recipe_bom_item_f2 FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_recipe_bom_item_fk1 ON recipe_bom_item (recipe_bom_id);

CREATE INDEX core_recipe_bom_item_fk2 ON recipe_bom_item (ingredient_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON recipe_bom_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE inventory_balance ADD CONSTRAINT core_inventory_balance_f1 FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE inventory_balance ADD CONSTRAINT core_inventory_balance_f2 FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_inventory_balance_fk1 ON inventory_balance (location_id);

CREATE INDEX core_inventory_balance_fk2 ON inventory_balance (ingredient_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON inventory_balance FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE inventory_reservation ADD CONSTRAINT core_inventory_reservation_f1 FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE inventory_reservation ADD CONSTRAINT core_inventory_reservation_f2 FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE inventory_reservation ADD CONSTRAINT core_inventory_reservation_f3 FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_inventory_reservation_fk1 ON inventory_reservation (order_item_id);

CREATE INDEX core_inventory_reservation_fk2 ON inventory_reservation (ingredient_id);

CREATE INDEX core_inventory_reservation_fk3 ON inventory_reservation (location_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON inventory_reservation FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE inventory_movement ADD CONSTRAINT core_inventory_movement_f1 FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE inventory_movement ADD CONSTRAINT core_inventory_movement_f2 FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE inventory_movement ADD CONSTRAINT core_inventory_movement_f4 FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE inventory_movement ADD CONSTRAINT core_inventory_movement_f5 FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE inventory_movement ADD CONSTRAINT core_inventory_movement_f6 FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_inventory_movement_fk1 ON inventory_movement (goods_receipt_id);

CREATE INDEX core_inventory_movement_fk2 ON inventory_movement (order_item_id);

CREATE INDEX core_inventory_movement_fk4 ON inventory_movement (location_id);

CREATE INDEX core_inventory_movement_fk5 ON inventory_movement (ingredient_id);

CREATE INDEX core_inventory_movement_fk6 ON inventory_movement (created_by);

ALTER TABLE goods_receipt ADD CONSTRAINT core_goods_receipt_f1 FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE goods_receipt ADD CONSTRAINT core_goods_receipt_f2 FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE goods_receipt ADD CONSTRAINT core_goods_receipt_f3 FOREIGN KEY (approved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_goods_receipt_fk1 ON goods_receipt (location_id);

CREATE INDEX core_goods_receipt_fk2 ON goods_receipt (created_by);

CREATE INDEX core_goods_receipt_fk3 ON goods_receipt (approved_by);

CREATE TRIGGER core_touch BEFORE UPDATE ON goods_receipt FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE goods_receipt_item ADD CONSTRAINT core_goods_receipt_item_f1 FOREIGN KEY (receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE goods_receipt_item ADD CONSTRAINT core_goods_receipt_item_f2 FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE goods_receipt_item ADD CONSTRAINT core_goods_receipt_item_f3 FOREIGN KEY (unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_goods_receipt_item_fk1 ON goods_receipt_item (receipt_id);

CREATE INDEX core_goods_receipt_item_fk2 ON goods_receipt_item (ingredient_id);

CREATE INDEX core_goods_receipt_item_fk3 ON goods_receipt_item (unit_id);

CREATE TRIGGER core_touch BEFORE UPDATE ON goods_receipt_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE order_item_ingredient_snapshot ADD CONSTRAINT core_order_item_ingredient_snapshot_f1 FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_item_ingredient_snapshot ADD CONSTRAINT core_order_item_ingredient_snapshot_f2 FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE order_item_ingredient_snapshot ADD CONSTRAINT core_order_item_ingredient_snapshot_f3 FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX core_order_item_ingredient_snapshot_fk1 ON order_item_ingredient_snapshot (order_item_id);

CREATE INDEX core_order_item_ingredient_snapshot_fk2 ON order_item_ingredient_snapshot (recipe_bom_id);

CREATE INDEX core_order_item_ingredient_snapshot_fk3 ON order_item_ingredient_snapshot (ingredient_id);


-- One successful capture per intent; retries never create a second receipt.
CREATE UNIQUE INDEX core_intent_capture ON payment_transaction(payment_intent_id)
 WHERE payment_intent_id IS NOT NULL AND status='SUCCEEDED';
CREATE UNIQUE INDEX core_active_bom ON recipe_bom(product_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX core_reservation_line ON inventory_reservation(order_item_id, ingredient_id, location_id);
CREATE UNIQUE INDEX core_consumption_line ON inventory_movement(order_item_id, ingredient_id, location_id)
 WHERE movement_type='CONSUMPTION';
CREATE UNIQUE INDEX core_refund_success ON refund_transaction(refund_case_id) WHERE status='SUCCEEDED';
ALTER TABLE payment_webhook_event ALTER COLUMN provider SET NOT NULL;
ALTER TABLE payment_transaction ADD CONSTRAINT core_success_confirmation
 CHECK (status<>'SUCCEEDED' OR confirmed_at IS NOT NULL);

-- Historical records are not deleted. Ledger snapshots are append-only.
CREATE FUNCTION core_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historical rows cannot be deleted: %',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE FUNCTION core_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only row: %',TG_TABLE_NAME USING ERRCODE='23514'; END $$;


CREATE TRIGGER core_no_delete BEFORE DELETE ON order_batch FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON order_item FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON order_status_history FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON financial_charge FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON payment_intent FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON payment_transaction FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON payment_webhook_event FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON order_risk_assessment FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON order_review FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON refund_case FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON refund_transaction FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON outstanding_balance_case FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON inventory_movement FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON goods_receipt FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON goods_receipt_item FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON order_item_ingredient_snapshot FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_no_delete BEFORE DELETE ON risk_policy_config FOR EACH ROW EXECUTE FUNCTION core_no_delete();

CREATE TRIGGER core_immutable BEFORE UPDATE ON order_status_history FOR EACH ROW EXECUTE FUNCTION core_immutable();

CREATE TRIGGER core_immutable BEFORE UPDATE ON order_risk_assessment FOR EACH ROW EXECUTE FUNCTION core_immutable();

CREATE TRIGGER core_immutable BEFORE UPDATE ON inventory_movement FOR EACH ROW EXECUTE FUNCTION core_immutable();

CREATE TRIGGER core_immutable BEFORE UPDATE ON order_item_ingredient_snapshot FOR EACH ROW EXECUTE FUNCTION core_immutable();

CREATE TRIGGER core_immutable BEFORE UPDATE ON risk_policy_config FOR EACH ROW EXECUTE FUNCTION core_immutable();

COMMIT;
