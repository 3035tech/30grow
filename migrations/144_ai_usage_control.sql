-- 144: Controle de custo de IA (B-2701 / B-2702).
--
-- Modelagem:
-- * Cada chamada ao modelo é um evento próprio (quem, empresa, funcionalidade, modelo,
--   tokens, custo estimado). É histórico de consumo: não cabe em coluna agregada da empresa,
--   e a soma do mês sai do índice (company_id, created_at).
-- * feature é domínio fixo (CHECK), espelhado em AI_FEATURE (lib/ai-usage.js).
-- * company_id é opcional: admin sem empresa (ex.: rubrica de cargo global) só conta no
--   teto global. ON DELETE CASCADE porque o evento não tem valor sem a empresa.
-- * cost_micros = custo estimado em micro-dólares (US$ 1 = 1.000.000) pela tabela de preços
--   do código no momento da chamada; preço muda, então o valor é snapshot.
-- * Teto mensal por empresa: companies.ai_monthly_call_limit (quantidade de chamadas no
--   mês). NULL = padrão do sistema (env AI_COMPANY_MONTHLY_CALL_LIMIT); 0 = IA bloqueada.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  feature            TEXT NOT NULL,
  model              TEXT NOT NULL DEFAULT '',
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_micros        BIGINT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_usage_events_feature_chk CHECK (feature IN (
    'rubric_context',
    'rubric_weights',
    'job_role_rubric',
    'vacancy_executive_note',
    'vacancy_shortlist',
    'vacancy_candidate_fields',
    'interview_notes_summary',
    'vacancy_description',
    'people_interpret',
    'help_assistant'
  )),
  CONSTRAINT ai_usage_events_model_len CHECK (char_length(model) <= 120),
  CONSTRAINT ai_usage_events_tokens_chk CHECK (prompt_tokens >= 0 AND completion_tokens >= 0),
  CONSTRAINT ai_usage_events_cost_chk CHECK (cost_micros >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_company_month
  ON ai_usage_events (company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created
  ON ai_usage_events (created_at);

COMMENT ON TABLE ai_usage_events IS
  'Uma linha por chamada ao modelo de IA (consumo e custo estimado). Base do teto mensal por empresa.';
COMMENT ON COLUMN ai_usage_events.cost_micros IS
  'Custo estimado em micro-dólares (US$ 1 = 1.000.000), calculado na hora da chamada.';

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_monthly_call_limit INTEGER;

ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_ai_monthly_call_limit_chk;
ALTER TABLE companies
  ADD CONSTRAINT companies_ai_monthly_call_limit_chk CHECK (
    ai_monthly_call_limit IS NULL OR ai_monthly_call_limit BETWEEN 0 AND 1000000
  );

COMMENT ON COLUMN companies.ai_monthly_call_limit IS
  'Teto de chamadas de IA no mês. NULL = padrão do sistema (AI_COMPANY_MONTHLY_CALL_LIMIT); 0 = IA bloqueada.';
