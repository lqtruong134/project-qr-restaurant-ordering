-- A retry key identifies a submission, not its message or payment method.
-- Multiple submissions may reuse one active support request without losing replay identity.
CREATE TABLE payment_assistance_submission (
  participant_id uuid NOT NULL REFERENCES session_participant(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  support_request_id uuid NOT NULL REFERENCES support_request(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, request_id)
);
CREATE INDEX payment_assistance_submission_request ON payment_assistance_submission(support_request_id);
