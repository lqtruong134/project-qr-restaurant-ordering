BEGIN;

-- The original support-request check predates SYSTEM resolutions. Retain the
-- owner-state check; the replacement below explicitly validates actor presence.
-- Replace only the known redundant legacy predicate; retain the ownership guard.
-- CHECK accepts NULL, so explicit actor/null handling is required for USER too.
DO $$
DECLARE legacy_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO legacy_definition
  FROM pg_constraint
  WHERE conrelid='support_request'::regclass
    AND conname='support_request_check' AND contype='c';
  IF legacy_definition IS DISTINCT FROM
    'CHECK (((status <> ''RESOLVED''::text) OR ((resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL))))'
  THEN
    RAISE EXCEPTION 'Unexpected legacy support-request resolution constraint';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='support_request'::regclass AND conname='support_request_owner_state'
      AND contype='c' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%resolution_actor_type%'
      AND pg_get_constraintdef(oid) LIKE '%SYSTEM%'
  ) THEN
    RAISE EXCEPTION 'System-aware support-request ownership constraint is required';
  END IF;
END $$;
ALTER TABLE support_request DROP CONSTRAINT support_request_check;
ALTER TABLE support_request ADD CONSTRAINT support_request_resolution_actor CHECK (
  status <> 'RESOLVED' OR (
    resolved_at IS NOT NULL AND (
      (resolution_actor_type IS NOT DISTINCT FROM 'SYSTEM' AND resolved_by IS NULL)
      OR (resolution_actor_type IS NOT DISTINCT FROM 'USER' AND resolved_by IS NOT NULL)
    )
  )
);

COMMIT;
