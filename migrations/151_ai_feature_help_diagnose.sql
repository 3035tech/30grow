-- 151: B-2600 — redação por IA do diagnóstico "Por que não aparece?".
-- Acrescenta 'help_diagnose' ao domínio fixo de ai_usage_events.feature
-- (espelhado em AI_FEATURE, lib/ai-usage.js). Idempotente: recria o CHECK.

ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_feature_chk;

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
    'help_diagnose'
  ));

INSERT INTO schema_migrations (name) VALUES ('151_ai_feature_help_diagnose.sql')
ON CONFLICT (name) DO NOTHING;
