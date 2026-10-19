CREATE TABLE IF NOT EXISTS time_clock_push_deliveries (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id),
 candidate_id BIGINT NOT NULL REFERENCES candidates(id), notification_id BIGINT NOT NULL REFERENCES candidate_notifications(id) ON DELETE CASCADE,
 token_id BIGINT NOT NULL REFERENCES mobile_employee_push_tokens(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped')),
 attempts INT NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 locked_at TIMESTAMPTZ, last_error TEXT CHECK(last_error IN ('network','provider','unregistered','context_changed','exhausted') OR last_error IS NULL),
 sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(notification_id,token_id)
);
CREATE INDEX IF NOT EXISTS time_clock_push_due ON time_clock_push_deliveries(next_attempt_at,id) WHERE status IN ('pending','sending');
CREATE OR REPLACE FUNCTION time_clock_enqueue_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type IN ('time_request_decided','time_mirror_available','time_closing_reminder','time_mirror_reopened') THEN
 INSERT INTO time_clock_push_deliveries(company_id,candidate_id,notification_id,token_id)
 SELECT NEW.company_id,NEW.recipient_candidate_id,NEW.id,t.id FROM mobile_employee_push_tokens t
 WHERE t.company_id=NEW.company_id AND t.candidate_id=NEW.recipient_candidate_id AND t.active
 ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_push_enqueue ON candidate_notifications;
CREATE TRIGGER time_clock_push_enqueue AFTER INSERT ON candidate_notifications FOR EACH ROW EXECUTE FUNCTION time_clock_enqueue_push();
CREATE TABLE IF NOT EXISTS time_clock_health_observations (
 id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('clock','signing_failure')),
 company_id BIGINT REFERENCES companies(id), offset_ms BIGINT, observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((kind='clock' AND offset_ms IS NOT NULL) OR kind='signing_failure')
);
CREATE INDEX IF NOT EXISTS time_clock_health_latest ON time_clock_health_observations(kind,observed_at DESC);
ALTER TABLE time_clock_push_deliveries ADD COLUMN IF NOT EXISTS total_attempts INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS time_clock_push_attempts (
 id BIGSERIAL PRIMARY KEY, delivery_id BIGINT NOT NULL REFERENCES time_clock_push_deliveries(id) ON DELETE CASCADE,
 attempt_no INT NOT NULL CHECK(attempt_no>0), started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
 outcome TEXT CHECK(outcome IN ('sent','pending','failed','skipped') OR outcome IS NULL),
 error_code TEXT CHECK(error_code IN ('network','provider','unregistered','context_changed','exhausted') OR error_code IS NULL), UNIQUE(delivery_id,attempt_no)
);

ALTER TABLE time_clock_health_observations ADD COLUMN IF NOT EXISTS source TEXT CHECK(source IS NULL OR char_length(source)<=253);
