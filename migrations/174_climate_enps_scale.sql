-- eNPS is 0–10. Migration 080 introduced the kind but left migration 042's
-- minimum-of-one constraint in place, rejecting every correctly formed eNPS.
-- Expand only: preserve all previously valid rows and allow zero only for eNPS.
ALTER TABLE climate_survey_questions
  DROP CONSTRAINT IF EXISTS climate_survey_questions_scale_chk;
ALTER TABLE climate_survey_questions
  ADD CONSTRAINT climate_survey_questions_scale_chk CHECK (
    (scale_min >= 1 OR (question_kind = 'enps' AND scale_min = 0))
    AND scale_max <= 10 AND scale_min < scale_max
  ) NOT VALID;
ALTER TABLE climate_survey_questions
  VALIDATE CONSTRAINT climate_survey_questions_scale_chk;
