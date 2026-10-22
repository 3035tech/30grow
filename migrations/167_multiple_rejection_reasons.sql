-- 167: multiple fixed rejection reasons; additive, legacy first-reason fields retained.

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS rejection_reasons TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_rejection_reasons_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_rejection_reasons_check CHECK (
  cardinality(rejection_reasons) <= 18 AND COALESCE(array_ndims(rejection_reasons), 1) = 1
  AND array_position(rejection_reasons, NULL) IS NULL
  AND rejection_reasons <@ ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]
);
UPDATE assessments SET rejection_reasons = ARRAY[rejection_reason]
WHERE cardinality(rejection_reasons) = 0 AND rejection_reason = ANY(ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]);
COMMENT ON COLUMN assessments.rejection_reasons IS 'Fixed rejection reason codes selected for this record; first item mirrors legacy rejection_reason.';


ALTER TABLE vacancy_candidates ADD COLUMN IF NOT EXISTS rejection_reasons TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vacancy_candidates DROP CONSTRAINT IF EXISTS vacancy_candidates_rejection_reasons_check;
ALTER TABLE vacancy_candidates ADD CONSTRAINT vacancy_candidates_rejection_reasons_check CHECK (
  cardinality(rejection_reasons) <= 18 AND COALESCE(array_ndims(rejection_reasons), 1) = 1
  AND array_position(rejection_reasons, NULL) IS NULL
  AND rejection_reasons <@ ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]
);
UPDATE vacancy_candidates SET rejection_reasons = ARRAY[rejection_reason]
WHERE cardinality(rejection_reasons) = 0 AND rejection_reason = ANY(ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]);
COMMENT ON COLUMN vacancy_candidates.rejection_reasons IS 'Fixed rejection reason codes selected for this record; first item mirrors legacy rejection_reason.';


ALTER TABLE assessment_pipeline_history ADD COLUMN IF NOT EXISTS rejection_reasons TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE assessment_pipeline_history DROP CONSTRAINT IF EXISTS assessment_pipeline_history_rejection_reasons_check;
ALTER TABLE assessment_pipeline_history ADD CONSTRAINT assessment_pipeline_history_rejection_reasons_check CHECK (
  cardinality(rejection_reasons) <= 18 AND COALESCE(array_ndims(rejection_reasons), 1) = 1
  AND array_position(rejection_reasons, NULL) IS NULL
  AND rejection_reasons <@ ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]
);
UPDATE assessment_pipeline_history SET rejection_reasons = ARRAY[reason]
WHERE cardinality(rejection_reasons) = 0 AND reason = ANY(ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]);
COMMENT ON COLUMN assessment_pipeline_history.rejection_reasons IS 'Fixed rejection reason codes selected for this record; first item mirrors legacy reason.';


ALTER TABLE vacancy_candidate_pipeline_history ADD COLUMN IF NOT EXISTS rejection_reasons TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vacancy_candidate_pipeline_history DROP CONSTRAINT IF EXISTS vacancy_candidate_pipeline_history_rejection_reasons_check;
ALTER TABLE vacancy_candidate_pipeline_history ADD CONSTRAINT vacancy_candidate_pipeline_history_rejection_reasons_check CHECK (
  cardinality(rejection_reasons) <= 18 AND COALESCE(array_ndims(rejection_reasons), 1) = 1
  AND array_position(rejection_reasons, NULL) IS NULL
  AND rejection_reasons <@ ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]
);
UPDATE vacancy_candidate_pipeline_history SET rejection_reasons = ARRAY[reason]
WHERE cardinality(rejection_reasons) = 0 AND reason = ANY(ARRAY['salary', 'profile_fit', 'experience', 'skill_gap', 'seniority', 'overqualified', 'culture', 'communication', 'timing', 'availability', 'location', 'competition', 'role_filled', 'no_show', 'withdrew', 'incomplete', 'references', 'other']::text[]);
COMMENT ON COLUMN vacancy_candidate_pipeline_history.rejection_reasons IS 'Fixed rejection reason codes selected for this record; first item mirrors legacy reason.';

