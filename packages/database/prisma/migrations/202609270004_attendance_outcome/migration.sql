ALTER TABLE attendance_record ADD COLUMN outcome text NOT NULL DEFAULT 'WORKED';
-- Existing approved records are immutable: classify their historical zero-time records only during migration.
ALTER TABLE attendance_record DISABLE TRIGGER USER;
UPDATE attendance_record SET outcome='ABSENT' WHERE status='APPROVED' AND approved_minutes=0;
ALTER TABLE attendance_record ENABLE TRIGGER USER;
ALTER TABLE attendance_record ADD CONSTRAINT attendance_outcome_allowed CHECK(outcome IN ('WORKED','ABSENT','LEAVE','MISSED_CLOCK'));
ALTER TABLE attendance_record ADD CONSTRAINT attendance_outcome_minutes CHECK(status<>'APPROVED' OR (outcome IN ('ABSENT','LEAVE') AND approved_minutes=0) OR (outcome IN ('WORKED','MISSED_CLOCK') AND approved_minutes>0));
