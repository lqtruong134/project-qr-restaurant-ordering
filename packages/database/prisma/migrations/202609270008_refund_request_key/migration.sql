ALTER TABLE refund_case ADD COLUMN request_key text;
CREATE UNIQUE INDEX refund_case_request_key ON refund_case(session_id,request_key) WHERE request_key IS NOT NULL;
