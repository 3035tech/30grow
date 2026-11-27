-- One optional editable rejection-email template per vacancy.
-- Rollback: drop the two nullable columns and their constraints after application rollback.
BEGIN;

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS rejection_email_subject TEXT,
  ADD COLUMN IF NOT EXISTS rejection_email_body TEXT;

ALTER TABLE vacancies
  DROP CONSTRAINT IF EXISTS vacancies_rejection_email_subject_length_chk,
  DROP CONSTRAINT IF EXISTS vacancies_rejection_email_body_length_chk;

ALTER TABLE vacancies
  ADD CONSTRAINT vacancies_rejection_email_subject_length_chk
    CHECK (rejection_email_subject IS NULL OR char_length(rejection_email_subject) <= 180),
  ADD CONSTRAINT vacancies_rejection_email_body_length_chk
    CHECK (rejection_email_body IS NULL OR char_length(rejection_email_body) <= 12000);

COMMENT ON COLUMN vacancies.rejection_email_subject IS
  'Optional vacancy-specific candidate rejection email subject; NULL uses the localized default.';
COMMENT ON COLUMN vacancies.rejection_email_body IS
  'Optional vacancy-specific candidate rejection email HTML; NULL uses the localized default.';

INSERT INTO schema_migrations(name)
VALUES('189_candidate_rejection_email_template.sql')
ON CONFLICT(name) DO NOTHING;
COMMIT;
