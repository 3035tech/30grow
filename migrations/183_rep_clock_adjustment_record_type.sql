-- Allow AFD type 4 records for real, externally verified REP-P clock adjustments.
-- This expands the record domain only; it does not create or rewrite fiscal events.
ALTER TABLE rep_original_records
  DROP CONSTRAINT IF EXISTS rep_original_records_record_type_check;

ALTER TABLE rep_original_records
  ADD CONSTRAINT rep_original_records_record_type_check
  CHECK (record_type IN (2, 4, 5, 6, 7));

INSERT INTO schema_migrations(name)
VALUES('183_rep_clock_adjustment_record_type.sql')
ON CONFLICT(name) DO NOTHING;
