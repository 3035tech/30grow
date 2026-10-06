-- 152: B-2714 — NR-1 riscos psicossociais (versão leve).
-- Apoio ao inventário do PGR; não substitui SESMT/laudo técnico.
--
-- Decisões de modelagem:
-- * Fator psicossocial = domínio fixo de 8 valores (CHECK), espelhado em
--   PSYCHOSOCIAL_FACTOR (lib/domain-status.js). Coluna opcional na pergunta de clima:
--   o questionário reaproveita a pesquisa anônima existente (sem candidate_id).
-- * Inventário = tabela relacional por empresa (company_id FK), não JSONB: cada risco
--   tem ciclo próprio (status, responsável, prazo) e é filtrado/ordenado no banco.
-- * Probabilidade e severidade 1–3; risk_score (1–9) gerado para ordenar sem recalcular.
-- * survey_id opcional liga o risco à pesquisa que o evidenciou (SET NULL ao apagar).

ALTER TABLE climate_survey_questions
  ADD COLUMN IF NOT EXISTS psychosocial_factor TEXT;

ALTER TABLE climate_survey_questions
  DROP CONSTRAINT IF EXISTS climate_survey_questions_psychosocial_factor_chk;
ALTER TABLE climate_survey_questions
  ADD CONSTRAINT climate_survey_questions_psychosocial_factor_chk CHECK (
    psychosocial_factor IS NULL OR psychosocial_factor IN (
      'workload', 'autonomy', 'support', 'relationships',
      'role_clarity', 'change', 'recognition', 'work_life'
    )
  );

CREATE TABLE IF NOT EXISTS psychosocial_risks (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  factor               TEXT NOT NULL,
  hazard               TEXT NOT NULL,
  exposed_group        TEXT NOT NULL DEFAULT '',
  probability          SMALLINT NOT NULL DEFAULT 2,
  severity             SMALLINT NOT NULL DEFAULT 2,
  risk_score           SMALLINT GENERATED ALWAYS AS (probability * severity) STORED,
  measures             TEXT NOT NULL DEFAULT '',
  owner_user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  due_date             DATE,
  status               TEXT NOT NULL DEFAULT 'identified',
  survey_id            BIGINT REFERENCES climate_surveys(id) ON DELETE SET NULL,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE psychosocial_risks DROP CONSTRAINT IF EXISTS psychosocial_risks_factor_chk;
ALTER TABLE psychosocial_risks
  ADD CONSTRAINT psychosocial_risks_factor_chk CHECK (factor IN (
    'workload', 'autonomy', 'support', 'relationships',
    'role_clarity', 'change', 'recognition', 'work_life'
  ));

ALTER TABLE psychosocial_risks DROP CONSTRAINT IF EXISTS psychosocial_risks_status_chk;
ALTER TABLE psychosocial_risks
  ADD CONSTRAINT psychosocial_risks_status_chk CHECK (status IN ('identified', 'in_progress', 'controlled'));

ALTER TABLE psychosocial_risks DROP CONSTRAINT IF EXISTS psychosocial_risks_scale_chk;
ALTER TABLE psychosocial_risks
  ADD CONSTRAINT psychosocial_risks_scale_chk CHECK (probability BETWEEN 1 AND 3 AND severity BETWEEN 1 AND 3);

ALTER TABLE psychosocial_risks DROP CONSTRAINT IF EXISTS psychosocial_risks_text_len_chk;
ALTER TABLE psychosocial_risks
  ADD CONSTRAINT psychosocial_risks_text_len_chk CHECK (
    char_length(btrim(hazard)) >= 1 AND char_length(hazard) <= 500
    AND char_length(exposed_group) <= 200
    AND char_length(measures) <= 2000
  );

CREATE INDEX IF NOT EXISTS idx_psychosocial_risks_company
  ON psychosocial_risks (company_id, risk_score DESC, updated_at DESC)
  WHERE deleted = FALSE;

COMMENT ON TABLE psychosocial_risks IS
  'NR-1 (leve): inventário de riscos psicossociais por empresa. Apoio ao PGR; não substitui SESMT.';
COMMENT ON COLUMN climate_survey_questions.psychosocial_factor IS
  'Fator psicossocial (NR-1) avaliado pela pergunta Likert; NULL = pergunta de clima comum.';

INSERT INTO schema_migrations (name) VALUES ('152_psychosocial_risks.sql')
ON CONFLICT (name) DO NOTHING;
