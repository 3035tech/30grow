-- Serialize original time inputs with closure snapshots; retain all existing rows.
-- Closing locks company candidates in id order using FOR NO KEY UPDATE. Each writer
-- uses the same lock before rechecking the closed period, including direct SQL writes.
CREATE OR REPLACE FUNCTION time_clock_guard_closed_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data RECORD; v_day DATE; v_old_day DATE; v_tz TEXT; v_closed BOOLEAN;
BEGIN
  IF TG_OP='DELETE' THEN row_data:=OLD; ELSE row_data:=NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id) THEN
    RAISE EXCEPTION 'TIME_CLOCK_IDENTITY_IMMUTABLE' USING ERRCODE='P0001';
  END IF;
  PERFORM id FROM candidates WHERE company_id=row_data.company_id AND id=row_data.candidate_id FOR NO KEY UPDATE;
  -- Rejections/cancellations do not alter computed time and may clear legacy pending rows.
  IF TG_TABLE_NAME IN ('employee_time_requests','employee_hour_bank_entries') THEN
    IF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status IN ('rejected','cancelled') THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='employee_time_punches' THEN
    SELECT COALESCE(timezone,'America/Sao_Paulo') INTO v_tz FROM company_time_schedules WHERE company_id=row_data.company_id;
    v_day:=(row_data.punched_at AT TIME ZONE COALESCE(v_tz,'America/Sao_Paulo'))::date;
  ELSE v_day:=row_data.work_on; END IF;
  v_old_day:=v_day;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='employee_time_punches' THEN v_old_day:=(OLD.punched_at AT TIME ZONE COALESCE(v_tz,'America/Sao_Paulo'))::date;
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
DROP TRIGGER IF EXISTS time_clock_closed_day ON employee_time_punches;
CREATE TRIGGER time_clock_closed_day BEFORE INSERT OR UPDATE OR DELETE ON employee_time_punches FOR EACH ROW EXECUTE FUNCTION time_clock_guard_closed_day();
DROP TRIGGER IF EXISTS time_clock_closed_day ON employee_time_day_justifications;
CREATE TRIGGER time_clock_closed_day BEFORE INSERT OR UPDATE OR DELETE ON employee_time_day_justifications FOR EACH ROW EXECUTE FUNCTION time_clock_guard_closed_day();
DROP TRIGGER IF EXISTS time_clock_closed_day ON employee_time_requests;
CREATE TRIGGER time_clock_closed_day BEFORE INSERT OR UPDATE OR DELETE ON employee_time_requests FOR EACH ROW EXECUTE FUNCTION time_clock_guard_closed_day();
DROP TRIGGER IF EXISTS time_clock_closed_day ON employee_hour_bank_entries;
CREATE TRIGGER time_clock_closed_day BEFORE INSERT OR UPDATE OR DELETE ON employee_hour_bank_entries FOR EACH ROW EXECUTE FUNCTION time_clock_guard_closed_day();
