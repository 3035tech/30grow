-- Reviewed, current professional profile snapshot; no separate managed entity.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS professional_summary TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS professional_summary_updated_at TIMESTAMPTZ;
COMMENT ON COLUMN candidates.professional_summary IS 'Professional CV/LinkedIn summary reviewed by HR; retained when source PDF is removed.';
ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_feature_chk;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_feature_chk CHECK (feature IN (
 'rubric_context', 'rubric_weights', 'job_role_rubric', 'vacancy_executive_note',
 'vacancy_shortlist', 'vacancy_candidate_fields', 'interview_notes_summary',
 'vacancy_description', 'people_interpret', 'help_assistant', 'help_diagnose',
 'people_copilot', 'cv_profile_import'
));
INSERT INTO schema_migrations (name) VALUES ('158_candidate_profile_import.sql') ON CONFLICT (name) DO NOTHING;
