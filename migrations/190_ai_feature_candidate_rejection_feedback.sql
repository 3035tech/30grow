-- Track optional AI wording suggestions as a distinct recruiting feature.
-- Rollback: application code can be reverted while retaining this enum value
-- in the CHECK so any recorded usage events remain valid and auditable.
BEGIN;

ALTER TABLE ai_usage_events
  DROP CONSTRAINT IF EXISTS ai_usage_events_feature_chk;

ALTER TABLE ai_usage_events
  ADD CONSTRAINT ai_usage_events_feature_chk CHECK (feature IN (
    'rubric_context',
    'rubric_weights',
    'job_role_rubric',
    'vacancy_executive_note',
    'vacancy_shortlist',
    'vacancy_candidate_fields',
    'interview_notes_summary',
    'vacancy_description',
    'people_interpret',
    'help_assistant',
    'help_diagnose',
    'people_copilot',
    'cv_profile_import',
    'candidate_rejection_feedback'
  ));

INSERT INTO schema_migrations(name)
VALUES('190_ai_feature_candidate_rejection_feedback.sql')
ON CONFLICT(name) DO NOTHING;
COMMIT;
