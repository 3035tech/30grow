-- Keep recipient mapping only while a climate invite is unanswered and valid.
-- The mapping is removed after a response, invite expiry, or campaign closure.
BEGIN;
CREATE TABLE IF NOT EXISTS climate_survey_invite_recipients (
  invite_id BIGINT PRIMARY KEY
    REFERENCES climate_survey_invites(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT climate_survey_invite_recipients_email_chk
    CHECK (char_length(recipient_email) <= 254
      AND recipient_email = lower(btrim(recipient_email))
      AND recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

COMMENT ON TABLE climate_survey_invite_recipients IS
  'Temporary recipient mapping for unanswered climate survey invites; deleted on response, expiry, or campaign closure so answers remain unidentifiable.';

INSERT INTO schema_migrations(name)
VALUES('188_climate_invite_reminder_recipients.sql')
ON CONFLICT(name) DO NOTHING;
COMMIT;
