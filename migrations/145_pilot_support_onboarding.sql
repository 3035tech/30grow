-- MVP-11: pilot support triage on product_feedback.
-- MVP-08: onboarding wizard funnel (where new managers drop off).
-- Reapplicable: IF NOT EXISTS columns/indexes, constraints dropped and recreated.

-- ---------------------------------------------------------------------------
-- product_feedback: type split (bug / question / commercial / idea / ux),
-- impact, module, owner, first response, duplicate grouping.
-- module_key mirrors COMPANY_MODULE in lib/company-modules.js; a new module
-- needs this CHECK updated in its own migration.
-- ---------------------------------------------------------------------------
ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS module_key TEXT,
  ADD COLUMN IF NOT EXISTS assignee_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duplicate_of_id BIGINT REFERENCES product_feedback(id) ON DELETE SET NULL;

ALTER TABLE product_feedback DROP CONSTRAINT IF EXISTS product_feedback_kind_chk;
ALTER TABLE product_feedback ADD CONSTRAINT product_feedback_kind_chk
  CHECK (kind IN ('bug', 'question', 'commercial', 'idea', 'ux'));

ALTER TABLE product_feedback DROP CONSTRAINT IF EXISTS product_feedback_severity_chk;
ALTER TABLE product_feedback ADD CONSTRAINT product_feedback_severity_chk
  CHECK (severity IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE product_feedback DROP CONSTRAINT IF EXISTS product_feedback_module_chk;
ALTER TABLE product_feedback ADD CONSTRAINT product_feedback_module_chk
  CHECK (module_key IS NULL OR module_key IN (
    'core', 'analysis', 'recruiting', 'motivators', 'climate', 'performance',
    'job_roles', 'succession', 'exit', 'learning', 'benefits', 'compensation',
    'dp', 'company_feed', 'whistleblowing'
  ));

ALTER TABLE product_feedback DROP CONSTRAINT IF EXISTS product_feedback_not_self_duplicate;
ALTER TABLE product_feedback ADD CONSTRAINT product_feedback_not_self_duplicate
  CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id);

CREATE INDEX IF NOT EXISTS idx_product_feedback_duplicate_of
  ON product_feedback (duplicate_of_id)
  WHERE duplicate_of_id IS NOT NULL;

-- Open items still waiting for a first response (SLA queue).
CREATE INDEX IF NOT EXISTS idx_product_feedback_awaiting_response
  ON product_feedback (created_at)
  WHERE first_response_at IS NULL AND status IN ('new', 'reviewing');

COMMENT ON COLUMN product_feedback.severity IS 'Impacto: low | medium | high | critical (quem envia sugere; admin ajusta).';
COMMENT ON COLUMN product_feedback.module_key IS 'Módulo comercial (COMPANY_MODULE) derivado da aba ativa; admin pode corrigir.';
COMMENT ON COLUMN product_feedback.first_response_at IS 'Primeira resposta/triagem do suporte; base do prazo de 1 dia útil.';
COMMENT ON COLUMN product_feedback.duplicate_of_id IS 'Agrupa ocorrências recorrentes sob um item principal.';

-- ---------------------------------------------------------------------------
-- onboarding_events: one row per (user, step, event); dedupe keeps it O(steps).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_events (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step        TEXT NOT NULL,
  event       TEXT NOT NULL,
  objective   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onboarding_events_step_chk
    CHECK (step IN ('welcome', 'objective', 'modules', 'vacancy', 'invite', 'done')),
  CONSTRAINT onboarding_events_event_chk
    CHECK (event IN ('viewed', 'completed', 'skipped')),
  CONSTRAINT onboarding_events_objective_chk
    CHECK (objective IS NULL OR objective IN ('recruiting', 'people', 'complete')),
  CONSTRAINT onboarding_events_once UNIQUE (user_id, step, event)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_created
  ON onboarding_events (created_at);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_company
  ON onboarding_events (company_id, created_at);

COMMENT ON TABLE onboarding_events IS
  'Funil do assistente de primeiro acesso (sem conteúdo sensível): etapa vista, concluída ou pulada.';
