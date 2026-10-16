-- Nullable on existing participants: do not fabricate historical consent.
ALTER TABLE session_participant ADD COLUMN accepted_policy_version text, ADD COLUMN accepted_policy_at timestamptz;
ALTER TABLE session_participant ADD CONSTRAINT participant_policy_ack_pair CHECK (
  (accepted_policy_version IS NULL AND accepted_policy_at IS NULL) OR
  (accepted_policy_version IS NOT NULL AND accepted_policy_version ~ '^[0-9]{4}-[0-9]{2}-v[0-9]+$' AND accepted_policy_at IS NOT NULL)
);
CREATE FUNCTION guard_participant_policy_ack() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accepted_policy_version IS DISTINCT FROM OLD.accepted_policy_version OR NEW.accepted_policy_at IS DISTINCT FROM OLD.accepted_policy_at THEN
    RAISE EXCEPTION 'Guest policy acknowledgement is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participant_policy_ack_immutable BEFORE UPDATE OF accepted_policy_version,accepted_policy_at ON session_participant FOR EACH ROW EXECUTE FUNCTION guard_participant_policy_ack();
ALTER TABLE order_item ADD COLUMN cancel_reason_code text;
ALTER TABLE order_item ADD CONSTRAINT order_item_reason_code CHECK (cancel_reason_code IS NULL OR cancel_reason_code IN ('CUSTOMER_CHANGED_MIND','OUT_OF_STOCK','KITCHEN_ERROR','QUALITY_ISSUE','WRONG_ITEM','CUSTOMER_COMPLAINT','OTHER'));
