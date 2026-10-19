-- Captures configuration changes prospectively; baseline is the known current state.
CREATE TABLE IF NOT EXISTS time_clock_person_history (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id),
 candidate_id BIGINT NOT NULL REFERENCES candidates(id), effective_on DATE NOT NULL,
 org_unit_id BIGINT REFERENCES org_units(id), work_format TEXT, time_clock_override BOOLEAN,
 start_date DATE, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,candidate_id,effective_on)
);
CREATE INDEX IF NOT EXISTS time_clock_person_history_lookup ON time_clock_person_history(company_id,candidate_id,effective_on DESC);
INSERT INTO time_clock_person_history(company_id,candidate_id,effective_on,org_unit_id,work_format,time_clock_override,start_date)
 SELECT company_id,id,'0001-01-01',org_unit_id,work_format,time_clock_override,COALESCE(start_date,hired_at::date)
 FROM candidates WHERE employment_status IN ('employee','alumni') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION time_clock_capture_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d DATE;
BEGIN
 IF NEW.company_id IS NULL OR NEW.employment_status NOT IN ('employee','alumni') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.org_unit_id,NEW.work_format,NEW.time_clock_override,NEW.start_date,NEW.hired_at,NEW.employment_status) IS NOT DISTINCT FROM ROW(OLD.org_unit_id,OLD.work_format,OLD.time_clock_override,OLD.start_date,OLD.hired_at,OLD.employment_status) THEN RETURN NEW; END IF;
 SELECT (clock_timestamp() AT TIME ZONE COALESCE((SELECT timezone FROM company_time_schedules WHERE company_id=NEW.company_id),'America/Sao_Paulo'))::date INTO d;
 IF TG_OP='INSERT' OR NOT EXISTS(SELECT 1 FROM time_clock_person_history WHERE company_id=NEW.company_id AND candidate_id=NEW.id) THEN d:='0001-01-01'::date; END IF;
 INSERT INTO time_clock_person_history(company_id,candidate_id,effective_on,org_unit_id,work_format,time_clock_override,start_date)
 VALUES(NEW.company_id,NEW.id,d,NEW.org_unit_id,NEW.work_format,NEW.time_clock_override,COALESCE(NEW.start_date,NEW.hired_at::date))
 ON CONFLICT(company_id,candidate_id,effective_on) DO UPDATE SET org_unit_id=EXCLUDED.org_unit_id,work_format=EXCLUDED.work_format,time_clock_override=EXCLUDED.time_clock_override,start_date=EXCLUDED.start_date,recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_person_history_capture ON candidates;
CREATE TRIGGER time_clock_person_history_capture AFTER INSERT OR UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION time_clock_capture_person();
CREATE TABLE IF NOT EXISTS time_clock_company_history (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id), effective_on DATE NOT NULL,
 workday_start TIME NOT NULL, workday_end TIME NOT NULL, break_minutes INT NOT NULL,
 late_grace_minutes INT NOT NULL, timezone TEXT NOT NULL, hour_bank_enabled BOOLEAN NOT NULL DEFAULT FALSE, hour_bank_max_minutes INT NOT NULL DEFAULT 2400, hour_bank_started_on DATE, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,effective_on)
);
INSERT INTO time_clock_company_history(company_id,effective_on,workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on)
 SELECT company_id,'0001-01-01',workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on FROM company_time_schedules ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION time_clock_capture_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO time_clock_company_history(company_id,effective_on,workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on)
 VALUES(NEW.company_id,CASE WHEN TG_OP='INSERT' THEN '0001-01-01'::date ELSE (clock_timestamp() AT TIME ZONE NEW.timezone)::date END,NEW.workday_start,NEW.workday_end,NEW.break_minutes,NEW.late_grace_minutes,NEW.timezone,NEW.hour_bank_enabled,NEW.hour_bank_max_minutes,NEW.hour_bank_started_on)
 ON CONFLICT(company_id,effective_on) DO UPDATE SET workday_start=EXCLUDED.workday_start,workday_end=EXCLUDED.workday_end,break_minutes=EXCLUDED.break_minutes,late_grace_minutes=EXCLUDED.late_grace_minutes,timezone=EXCLUDED.timezone,hour_bank_enabled=EXCLUDED.hour_bank_enabled,hour_bank_max_minutes=EXCLUDED.hour_bank_max_minutes,hour_bank_started_on=EXCLUDED.hour_bank_started_on,recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_company_history_capture ON company_time_schedules;
CREATE TRIGGER time_clock_company_history_capture AFTER INSERT OR UPDATE ON company_time_schedules FOR EACH ROW EXECUTE FUNCTION time_clock_capture_company();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='time_clock_history_person_tenant') THEN
 ALTER TABLE time_clock_person_history ADD CONSTRAINT time_clock_history_person_tenant FOREIGN KEY(candidate_id,company_id) REFERENCES candidates(id,company_id);
 ALTER TABLE time_clock_person_history ADD CONSTRAINT time_clock_history_unit_tenant FOREIGN KEY(org_unit_id,company_id) REFERENCES org_units(id,company_id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS time_clock_unit_history (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id), unit_id BIGINT NOT NULL,
 parent_id BIGINT, effective_on DATE NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,unit_id,effective_on),
 FOREIGN KEY(unit_id,company_id) REFERENCES org_units(id,company_id),
 FOREIGN KEY(parent_id,company_id) REFERENCES org_units(id,company_id)
);
INSERT INTO time_clock_unit_history(company_id,unit_id,parent_id,effective_on) SELECT company_id,id,parent_id,'0001-01-01' FROM org_units ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION time_clock_capture_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW; END IF;
 INSERT INTO time_clock_unit_history(company_id,unit_id,parent_id,effective_on) VALUES(NEW.company_id,NEW.id,NEW.parent_id,CASE WHEN TG_OP='INSERT' THEN '0001-01-01'::date ELSE (clock_timestamp() AT TIME ZONE COALESCE((SELECT timezone FROM company_time_schedules WHERE company_id=NEW.company_id),'America/Sao_Paulo'))::date END)
 ON CONFLICT(company_id,unit_id,effective_on) DO UPDATE SET parent_id=EXCLUDED.parent_id,recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_unit_history_capture ON org_units;
CREATE TRIGGER time_clock_unit_history_capture AFTER INSERT OR UPDATE ON org_units FOR EACH ROW EXECUTE FUNCTION time_clock_capture_unit();
