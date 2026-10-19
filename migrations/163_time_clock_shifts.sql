ALTER TABLE employee_time_schedules ADD COLUMN IF NOT EXISTS shift_pattern TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE employee_time_schedules ADD COLUMN IF NOT EXISTS cycle_anchor DATE;
ALTER TABLE employee_time_schedules ADD COLUMN IF NOT EXISTS night_rule TEXT NOT NULL DEFAULT 'none';
ALTER TABLE employee_time_schedules DROP CONSTRAINT IF EXISTS employee_time_schedules_shift_chk;
ALTER TABLE employee_time_schedules ADD CONSTRAINT employee_time_schedules_shift_chk CHECK (shift_pattern IN ('weekly','12x36') AND night_rule IN ('none','urban_clt') AND (shift_pattern<>'12x36' OR (cycle_anchor IS NOT NULL AND NOT follows_company AND mod((extract(epoch FROM(workday_end-workday_start))+86400)::bigint,86400)=43200)));
ALTER TABLE employee_time_schedules DROP CONSTRAINT IF EXISTS employee_time_schedules_shape_chk;
ALTER TABLE employee_time_schedules ADD CONSTRAINT employee_time_schedules_shape_chk CHECK (
 (follows_company AND workday_start IS NULL AND workday_end IS NULL AND break_start IS NULL AND break_end IS NULL AND weekdays IS NULL)
 OR (NOT follows_company AND workday_start IS NOT NULL AND workday_end IS NOT NULL AND workday_end<>workday_start
 AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
 AND ((break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL
 AND ((extract(epoch FROM (break_start-workday_start))+86400)::bigint % 86400) < ((extract(epoch FROM (break_end-workday_start))+86400)::bigint % 86400)
 AND ((extract(epoch FROM (break_end-workday_start))+86400)::bigint % 86400) <= ((extract(epoch FROM (workday_end-workday_start))+86400)::bigint % 86400))))) ;
-- Logical day depends on the schedule of the preceding day, never the device clock.
CREATE OR REPLACE FUNCTION time_clock_work_day(cid BIGINT, person BIGINT, ts TIMESTAMPTZ) RETURNS DATE LANGUAGE plpgsql STABLE AS $$
DECLARE d DATE; local_time TIME; z TEXT; s RECORD;
BEGIN
 SELECT timezone INTO z FROM time_clock_company_history WHERE company_id=cid AND effective_on<=(ts AT TIME ZONE timezone)::date ORDER BY effective_on DESC,id DESC LIMIT 1;
 IF z IS NULL THEN SELECT timezone INTO z FROM company_time_schedules WHERE company_id=cid; END IF;
 z:=COALESCE(z,'America/Sao_Paulo'); d:=(ts AT TIME ZONE z)::date; local_time:=(ts AT TIME ZONE z)::time;
 SELECT * INTO s FROM employee_time_schedules WHERE company_id=cid AND candidate_id=person AND valid_from<=d-1 ORDER BY valid_from DESC LIMIT 1;
 IF FOUND AND NOT s.follows_company AND s.workday_end<s.workday_start AND extract(epoch FROM local_time)<(extract(epoch FROM s.workday_end)+extract(epoch FROM s.workday_start))/2
 AND (s.shift_pattern='weekly' AND extract(dow FROM d-1)::smallint=ANY(s.weekdays) OR s.shift_pattern='12x36' AND mod((d-1-s.cycle_anchor),2)=0) THEN RETURN d-1; END IF;
 RETURN d;
END $$;
ALTER TABLE time_clock_closure_people ADD COLUMN IF NOT EXISTS night_minutes INT NOT NULL DEFAULT 0;
ALTER TABLE time_clock_closure_people ADD COLUMN IF NOT EXISTS night_equivalent_minutes INT NOT NULL DEFAULT 0;
ALTER TABLE time_clock_closure_people ADD COLUMN IF NOT EXISTS calculation_version INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION time_clock_guard_closed_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data RECORD; v_day DATE; v_old_day DATE; v_tz TEXT; v_closed BOOLEAN;
BEGIN
  IF TG_OP='DELETE' THEN row_data:=OLD; ELSE row_data:=NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id) THEN
    RAISE EXCEPTION 'TIME_CLOCK_IDENTITY_IMMUTABLE' USING ERRCODE='P0001';
  END IF;
  PERFORM id FROM candidates WHERE company_id=row_data.company_id AND id=row_data.candidate_id FOR NO KEY UPDATE;
  -- New original markings must remain possible, even when their logical night
  -- shift was already closed. Reconciliation detects the new original; only HR
  -- corrections/voids are blocked. The public punch API supplies the server time.
  IF TG_TABLE_NAME='employee_time_punches' AND TG_OP='INSERT' THEN
    IF NEW.source='web' THEN RETURN NEW; END IF;
  END IF;
  -- Rejections/cancellations do not alter computed time and may clear legacy pending rows.
  IF TG_TABLE_NAME IN ('employee_time_requests','employee_hour_bank_entries') THEN
    IF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status IN ('rejected','cancelled') THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='employee_time_punches' THEN
    SELECT COALESCE(timezone,'America/Sao_Paulo') INTO v_tz FROM company_time_schedules WHERE company_id=row_data.company_id;
    v_day:=time_clock_work_day(row_data.company_id,row_data.candidate_id,row_data.punched_at);
  ELSE v_day:=row_data.work_on; END IF;
  v_old_day:=v_day;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='employee_time_punches' THEN v_old_day:=time_clock_work_day(OLD.company_id,OLD.candidate_id,OLD.punched_at);
    ELSE v_old_day:=OLD.work_on; END IF;
  END IF;
  WITH RECURSIVE anc AS (
    SELECT u.id,u.parent_id,1 AS depth FROM candidates c JOIN org_units u ON u.id=c.org_unit_id AND u.company_id=c.company_id
    WHERE c.company_id=row_data.company_id AND c.id=row_data.candidate_id
    UNION ALL SELECT p.id,p.parent_id,anc.depth+1 FROM org_units p JOIN anc ON p.id=anc.parent_id WHERE p.company_id=row_data.company_id AND anc.depth<20
  ) SELECT EXISTS(
    SELECT 1 FROM time_clock_closures k WHERE k.company_id=row_data.company_id AND k.status='closed'
      AND (v_day BETWEEN k.period_start AND k.period_end OR v_old_day BETWEEN k.period_start AND k.period_end)
      AND (k.org_unit_id IS NULL OR k.org_unit_id IN (SELECT id FROM anc) OR EXISTS(
        SELECT 1 FROM time_clock_closure_people p WHERE p.closure_id=k.id AND p.company_id=k.company_id AND p.candidate_id=row_data.candidate_id
      ))
  ) INTO v_closed;
  IF v_closed THEN RAISE EXCEPTION 'TIME_CLOCK_PERIOD_CLOSED' USING ERRCODE='P0001'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
-- Prevent configuration writes racing a closed snapshot (also covers direct SQL).
CREATE OR REPLACE FUNCTION time_clock_guard_schedule_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; d DATE;
BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
 PERFORM id FROM candidates WHERE company_id=r.company_id AND id=r.candidate_id FOR NO KEY UPDATE;
 d:=r.valid_from;
 IF TG_OP='UPDATE' THEN
  IF NEW.company_id<>OLD.company_id OR NEW.candidate_id<>OLD.candidate_id THEN RAISE EXCEPTION 'TIME_CLOCK_IDENTITY_IMMUTABLE' USING ERRCODE='P0001'; END IF;
  d:=LEAST(d,OLD.valid_from);
 END IF;
 IF EXISTS(SELECT 1 FROM time_clock_closures k WHERE k.company_id=r.company_id AND k.status='closed' AND k.period_end>=d AND (k.org_unit_id IS NULL OR EXISTS(SELECT 1 FROM time_clock_closure_people p WHERE p.closure_id=k.id AND p.candidate_id=r.candidate_id))) THEN RAISE EXCEPTION 'TIME_CLOCK_PERIOD_CLOSED' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS time_clock_schedule_closed ON employee_time_schedules;
CREATE TRIGGER time_clock_schedule_closed BEFORE INSERT OR UPDATE OR DELETE ON employee_time_schedules FOR EACH ROW EXECUTE FUNCTION time_clock_guard_schedule_version();
CREATE OR REPLACE FUNCTION time_clock_preserve_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TIME_CLOCK_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_TABLE_NAME='time_clock_closure_people' THEN
 IF ROW(NEW.closure_id,NEW.company_id,NEW.candidate_id,NEW.expected_minutes,NEW.worked_minutes,NEW.extra_minutes,NEW.missing_minutes,NEW.workdays,NEW.absence_days,NEW.justified_days,NEW.incomplete_days,NEW.snapshot_hash,NEW.night_minutes,NEW.night_equivalent_minutes,NEW.calculation_version) IS DISTINCT FROM ROW(OLD.closure_id,OLD.company_id,OLD.candidate_id,OLD.expected_minutes,OLD.worked_minutes,OLD.extra_minutes,OLD.missing_minutes,OLD.workdays,OLD.absence_days,OLD.justified_days,OLD.incomplete_days,OLD.snapshot_hash,OLD.night_minutes,OLD.night_equivalent_minutes,OLD.calculation_version) THEN RAISE EXCEPTION 'TIME_CLOCK_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 ELSE RAISE EXCEPTION 'TIME_CLOCK_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_snapshot_preserve ON time_clock_closure_people;
CREATE TRIGGER time_clock_snapshot_preserve BEFORE UPDATE OR DELETE ON time_clock_closure_people FOR EACH ROW EXECUTE FUNCTION time_clock_preserve_snapshot();
DROP TRIGGER IF EXISTS time_clock_balance_preserve ON time_clock_closure_balances;
CREATE TRIGGER time_clock_balance_preserve BEFORE UPDATE OR DELETE ON time_clock_closure_balances FOR EACH ROW EXECUTE FUNCTION time_clock_preserve_snapshot();
-- An exit/rehire changes attendance expectations; preserve already closed intervals.
CREATE OR REPLACE FUNCTION time_clock_guard_exit_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; first_day DATE; last_day DATE;
BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; first_day:=OLD.exit_date+1; last_day:=COALESCE(OLD.rehired_at,'9999-12-31'::date);
 ELSIF TG_OP='INSERT' THEN r:=NEW; first_day:=NEW.exit_date+1; last_day:=COALESCE(NEW.rehired_at,'9999-12-31'::date);
 ELSE
 r:=NEW;
 IF NEW.company_id<>OLD.company_id OR NEW.candidate_id<>OLD.candidate_id THEN RAISE EXCEPTION 'TIME_CLOCK_IDENTITY_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.exit_date=OLD.exit_date AND NEW.rehired_at IS NOT DISTINCT FROM OLD.rehired_at THEN RETURN NEW; END IF;
 IF NEW.exit_date=OLD.exit_date THEN
 first_day:=LEAST(COALESCE(OLD.rehired_at,'9999-12-31'::date),COALESCE(NEW.rehired_at,'9999-12-31'::date));
 last_day:=GREATEST(COALESCE(OLD.rehired_at,'9999-12-31'::date),COALESCE(NEW.rehired_at,'9999-12-31'::date));
 ELSE first_day:=LEAST(OLD.exit_date,NEW.exit_date)+1; last_day:=GREATEST(COALESCE(OLD.rehired_at,'9999-12-31'::date),COALESCE(NEW.rehired_at,'9999-12-31'::date)); END IF;
 END IF;
 PERFORM id FROM candidates WHERE company_id=r.company_id AND id=r.candidate_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM time_clock_closures k WHERE k.company_id=r.company_id AND k.status='closed' AND k.period_end>=first_day AND k.period_start<last_day AND (k.org_unit_id IS NULL OR EXISTS(SELECT 1 FROM time_clock_closure_people p WHERE p.closure_id=k.id AND p.candidate_id=r.candidate_id))) THEN RAISE EXCEPTION 'TIME_CLOCK_PERIOD_CLOSED' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS time_clock_exit_closed ON exit_records;
CREATE TRIGGER time_clock_exit_closed BEFORE INSERT OR UPDATE OR DELETE ON exit_records FOR EACH ROW EXECUTE FUNCTION time_clock_guard_exit_dates();
