-- Expand the fixed work-format domain with trainee and constrain point
-- eligibility to CLT, interns, and trainees in application code.
-- Apply before deploying code that writes the new work format.
DO $$ BEGIN
  IF to_regclass('candidates') IS NOT NULL THEN
    ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_work_format_check;
    ALTER TABLE candidates ADD CONSTRAINT candidates_work_format_check
      CHECK (work_format IS NULL OR work_format IN ('clt', 'intern', 'trainee', 'cooperative', 'pj')) NOT VALID;
    COMMENT ON COLUMN candidates.work_format IS 'Employment format: clt, intern, trainee, cooperative, or pj.';
    COMMENT ON COLUMN candidates.time_clock_override IS 'Legacy value retained for audit compatibility; time clock eligibility is determined by work_format.';
  END IF;
  IF to_regclass('employee_work_format_history') IS NOT NULL THEN
    ALTER TABLE employee_work_format_history DROP CONSTRAINT IF EXISTS employee_work_format_history_previous_check;
    ALTER TABLE employee_work_format_history ADD CONSTRAINT employee_work_format_history_previous_check
      CHECK (previous_format IS NULL OR previous_format IN ('clt', 'intern', 'trainee', 'cooperative', 'pj'));
    ALTER TABLE employee_work_format_history DROP CONSTRAINT IF EXISTS employee_work_format_history_new_check;
    ALTER TABLE employee_work_format_history ADD CONSTRAINT employee_work_format_history_new_check
      CHECK (new_format IS NULL OR new_format IN ('clt', 'intern', 'trainee', 'cooperative', 'pj'));
  END IF;
END $$;
