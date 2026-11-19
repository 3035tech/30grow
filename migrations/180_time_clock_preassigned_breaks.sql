-- Explicit interval pre-assignment configuration for company and employee schedules.
-- Existing rows default to false, preserving current time calculations and exports.
ALTER TABLE company_time_schedules
  ADD COLUMN IF NOT EXISTS break_start TIME,
  ADD COLUMN IF NOT EXISTS break_end TIME,
  ADD COLUMN IF NOT EXISTS break_preassigned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE employee_time_schedules
  ADD COLUMN IF NOT EXISTS break_preassigned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE time_clock_company_history
  ADD COLUMN IF NOT EXISTS break_start TIME,
  ADD COLUMN IF NOT EXISTS break_end TIME,
  ADD COLUMN IF NOT EXISTS break_preassigned BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_time_schedules_preassigned_break_chk') THEN
    ALTER TABLE company_time_schedules ADD CONSTRAINT company_time_schedules_preassigned_break_chk CHECK (
      (NOT break_preassigned AND ((break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_end > break_start)))
      OR (break_preassigned AND break_minutes > 0 AND break_start > workday_start AND break_end < workday_end
        AND break_end > break_start AND extract(epoch FROM (break_end-break_start))::int / 60 = break_minutes)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_time_schedules_preassigned_break_chk') THEN
    ALTER TABLE employee_time_schedules ADD CONSTRAINT employee_time_schedules_preassigned_break_chk CHECK (
      NOT break_preassigned OR (NOT follows_company AND break_start IS NOT NULL AND break_end IS NOT NULL)
    );
  END IF;
END $$;

COMMENT ON COLUMN company_time_schedules.break_preassigned IS
  'When true, the configured interval is treated and exported as pre-assigned out/return markings.';
COMMENT ON COLUMN employee_time_schedules.break_preassigned IS
  'When true, the configured interval is treated and exported as pre-assigned out/return markings.';

CREATE OR REPLACE FUNCTION time_clock_capture_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO time_clock_company_history(company_id,effective_on,workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on,break_start,break_end,break_preassigned)
 VALUES(NEW.company_id,CASE WHEN TG_OP='INSERT' THEN '0001-01-01'::date ELSE (clock_timestamp() AT TIME ZONE NEW.timezone)::date END,NEW.workday_start,NEW.workday_end,NEW.break_minutes,NEW.late_grace_minutes,NEW.timezone,NEW.hour_bank_enabled,NEW.hour_bank_max_minutes,NEW.hour_bank_started_on,NEW.break_start,NEW.break_end,NEW.break_preassigned)
 ON CONFLICT(company_id,effective_on) DO UPDATE SET workday_start=EXCLUDED.workday_start,workday_end=EXCLUDED.workday_end,break_minutes=EXCLUDED.break_minutes,late_grace_minutes=EXCLUDED.late_grace_minutes,timezone=EXCLUDED.timezone,hour_bank_enabled=EXCLUDED.hour_bank_enabled,hour_bank_max_minutes=EXCLUDED.hour_bank_max_minutes,hour_bank_started_on=EXCLUDED.hour_bank_started_on,break_start=EXCLUDED.break_start,break_end=EXCLUDED.break_end,break_preassigned=EXCLUDED.break_preassigned,recorded_at=clock_timestamp();
 RETURN NEW;
END $$;

INSERT INTO schema_migrations (name) VALUES ('180_time_clock_preassigned_breaks.sql')
ON CONFLICT (name) DO NOTHING;
