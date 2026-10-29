-- Pendências de banco (execute no pgAdmin / psql)
-- Fonte canônica: migrations/*.sql
-- 015 — perfil ampliado do candidato
-- 016 — descrição e faixa salarial da vaga
-- 017 — rejeição, contratação, timeline
-- 018 — índices overview / funil por vaga / busca por nome (pg_trgm)
-- 019 — notas de RH no candidato
-- 020 — posições e data-alvo da vaga
-- 021 — relatório público por vaga (link temporário)
-- 022 — registro de 1:1 (People)
-- 023 — notificações in-app + display_name
-- 024 — tipos genéricos de notificação + dedupe por time RH
-- 025 — índice unique e-mail candidatos + índices fan-out / prazo vaga
-- 026 — overrides de capability por usuário (visões do painel)

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS salary_expectation TEXT,
  ADD COLUMN IF NOT EXISTS availability TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS salary_min TEXT,
  ADD COLUMN IF NOT EXISTS salary_max TEXT;

-- 017
CREATE TABLE IF NOT EXISTS assessment_pipeline_history (
  id BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT,
  start_date DATE,
  changed_by_user_id BIGINT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE assessment_pipeline_history
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS start_date DATE;

CREATE TABLE IF NOT EXISTS vacancy_candidate_pipeline_history (
  id BIGSERIAL PRIMARY KEY,
  vacancy_candidate_id BIGINT NOT NULL REFERENCES vacancy_candidates(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT,
  start_date DATE,
  changed_by_user_id BIGINT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_pipeline_stage_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_pipeline_stage_check CHECK (
  pipeline_stage IN (
    'new', 'test_completed', 'screening', 'interview',
    'approved', 'hired', 'rejected', 'archived'
  )
);

ALTER TABLE vacancy_candidates DROP CONSTRAINT IF EXISTS vacancy_candidates_pipeline_stage_check;
ALTER TABLE vacancy_candidates ADD CONSTRAINT vacancy_candidates_pipeline_stage_check CHECK (
  pipeline_stage IS NULL OR pipeline_stage IN (
    'new', 'test_completed', 'screening', 'interview',
    'approved', 'hired', 'rejected', 'archived'
  )
);

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date DATE;

ALTER TABLE vacancy_candidates
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date DATE;

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS employment_status TEXT NOT NULL DEFAULT 'candidate',
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS hired_vacancy_id BIGINT REFERENCES vacancies(id) ON DELETE SET NULL;

ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_employment_status_check;
ALTER TABLE candidates ADD CONSTRAINT candidates_employment_status_check
  CHECK (employment_status IN ('candidate', 'employee', 'alumni'));

-- =============================================================================
-- 018 — performance indexes (safe to re-run)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_assessments_vacancy_created
  ON assessments (vacancy_id, created_at DESC)
  WHERE vacancy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_vacancy_pipeline
  ON assessments (vacancy_id, pipeline_stage)
  WHERE vacancy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_invites_company_status_sent
  ON candidate_invites (company_id, status, sent_at)
  WHERE status IN ('sent', 'opened');

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_candidates_fullname_trgm
  ON candidates USING gin (full_name gin_trgm_ops);

-- =============================================================================
-- 019 — HR notes on candidates
-- =============================================================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS hr_notes TEXT;

-- =============================================================================
-- 020 — vacancy planning (positions + target date)
-- =============================================================================

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS positions_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS target_date DATE;

-- =============================================================================
-- 021 — vacancy client report shares (public /r/<token>)
-- =============================================================================

CREATE TABLE IF NOT EXISTS vacancy_report_shares (
  id BIGSERIAL PRIMARY KEY,
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  title TEXT,
  executive_note TEXT,
  snapshot JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vacancy_report_shares_token
  ON vacancy_report_shares (token);

CREATE INDEX IF NOT EXISTS idx_vacancy_report_shares_vacancy_created
  ON vacancy_report_shares (vacancy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vacancy_report_shares_active
  ON vacancy_report_shares (vacancy_id, active)
  WHERE active = TRUE;

-- 022 — registro de 1:1 (People)
CREATE TABLE IF NOT EXISTS one_on_ones (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  meeting_date        DATE NOT NULL DEFAULT (CURRENT_DATE),
  notes               TEXT NOT NULL DEFAULT '',
  next_steps          TEXT,
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT one_on_ones_notes_len CHECK (char_length(notes) <= 8000),
  CONSTRAINT one_on_ones_next_steps_len CHECK (next_steps IS NULL OR char_length(next_steps) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_one_on_ones_candidate_date
  ON one_on_ones (candidate_id, meeting_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_one_on_ones_company_date
  ON one_on_ones (company_id, meeting_date DESC);

-- 023 — notificações de gestores + display_name
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE TABLE IF NOT EXISTS manager_notifications (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL
    CHECK (type IN ('enneagram_completed', 'motivators_completed')),
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manager_notifications_recipient_created
  ON manager_notifications (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manager_notifications_recipient_unread
  ON manager_notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_manager_notifications_company_created
  ON manager_notifications (company_id, created_at DESC);

-- 024 — notificações genéricas + dedupe (time RH)
ALTER TABLE manager_notifications
  DROP CONSTRAINT IF EXISTS manager_notifications_type_check;

ALTER TABLE manager_notifications
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id BIGINT,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_notifications_dedupe
  ON manager_notifications (recipient_user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manager_notifications_entity
  ON manager_notifications (company_id, entity_type, entity_id)
  WHERE entity_type IS NOT NULL;

-- 025 — unique e-mail candidatos + índices fan-out / prazo
UPDATE candidates SET email = NULL WHERE email = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_company_email_lower_unique
  ON candidates (company_id, LOWER(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_open_target_date
  ON vacancies (target_date)
  WHERE deleted = FALSE AND status = 'open' AND target_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_company_active_managers
  ON users (company_id)
  WHERE deleted = FALSE AND active = TRUE AND role IN ('hr', 'direction', 'admin');

-- 026 — overrides de capability por usuário (módulos do painel)
CREATE TABLE IF NOT EXISTS user_capability_overrides (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  granted    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_user_capability_overrides_user
  ON user_capability_overrides (user_id);

-- 027 — retenção de notificações in-app
CREATE INDEX IF NOT EXISTS idx_manager_notifications_created_at
  ON manager_notifications (created_at ASC);

-- 028 — pretensão no relatório do cliente (flag por vaga)
ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS client_report_show_salary BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN vacancies.client_report_show_salary IS
  'Se TRUE, o relatório público /r inclui pretensão salarial do candidato. FALSE = omitir (padrão).';

-- 029 — formato de contratação + troca de senha no 1º acesso
ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS employment_type TEXT;

COMMENT ON COLUMN vacancies.employment_type IS
  'internship | clt | pj | cooperative | NULL';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.must_change_password IS
  'TRUE após criação com senha temporária — obriga troca no próximo login.';

-- 030 — perfil empresa + página pública indexável da vaga
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS about_html TEXT;

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS public_page_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_allow_index BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS public_show_company_info BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_show_salary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vacancies_company_slug_public
  ON vacancies (company_id, LOWER(slug))
  WHERE deleted = FALSE AND public_page_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_vacancies_public_open_created
  ON vacancies (created_at DESC)
  WHERE deleted = FALSE
    AND public_page_enabled = TRUE
    AND public_allow_index = TRUE
    AND status = 'open';

-- 031 — indexação ligada por padrão (novas vagas)
ALTER TABLE vacancies
  ALTER COLUMN public_allow_index SET DEFAULT TRUE;

-- 032 — atribuição UTM + funil de vagas públicas
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS attr_source TEXT,
  ADD COLUMN IF NOT EXISTS attr_medium TEXT,
  ADD COLUMN IF NOT EXISTS attr_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attr_content TEXT,
  ADD COLUMN IF NOT EXISTS attr_term TEXT,
  ADD COLUMN IF NOT EXISTS attr_ref TEXT,
  ADD COLUMN IF NOT EXISTS attr_landing TEXT,
  ADD COLUMN IF NOT EXISTS attr_session_id TEXT;

CREATE TABLE IF NOT EXISTS job_funnel_events (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id),
  candidate_id BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  session_id TEXT,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  referral_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_funnel_events_type_check CHECK (
    event_type IN (
      'job_view',
      'apply_start',
      'apply_complete',
      'screening',
      'interview',
      'hired',
      'rejected'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_job_funnel_vacancy_created
  ON job_funnel_events (vacancy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_funnel_company_type_created
  ON job_funnel_events (company_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_funnel_source
  ON job_funnel_events (vacancy_id, source)
  WHERE source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_funnel_session_view
  ON job_funnel_events (vacancy_id, session_id, event_type)
  WHERE event_type = 'job_view';

-- 033 — códigos referral (?ref=)
CREATE TABLE IF NOT EXISTS referral_codes (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  vacancy_id BIGINT REFERENCES vacancies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  owner_candidate_id BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_codes_code_format CHECK (
    char_length(code) BETWEEN 2 AND 64
    AND code ~ '^[A-Z0-9][A-Z0-9_-]*$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_codes_code_lower
  ON referral_codes (LOWER(code));

CREATE INDEX IF NOT EXISTS idx_referral_codes_company_active
  ON referral_codes (company_id, active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_codes_vacancy
  ON referral_codes (vacancy_id)
  WHERE vacancy_id IS NOT NULL;

-- 034 — sessão revogável + expiração de convite Enneagrama
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE candidate_invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE candidate_invites
SET expires_at = COALESCE(sent_at, NOW()) + INTERVAL '30 days'
WHERE expires_at IS NULL;

ALTER TABLE candidate_invites
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE candidate_invites
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days');

CREATE INDEX IF NOT EXISTS idx_candidate_invites_expires
  ON candidate_invites (expires_at)
  WHERE status IN ('sent', 'opened');

-- 035 — job alerts (avisos de novas vagas por e-mail)
CREATE TABLE IF NOT EXISTS job_alerts (
  id                  BIGSERIAL PRIMARY KEY,
  email               TEXT NOT NULL,
  name                TEXT,
  filters             JSONB NOT NULL DEFAULT '{}'::jsonb,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  unsubscribe_token   TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_alerts_email_lower
  ON job_alerts (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_alerts_unsubscribe_token
  ON job_alerts (unsubscribe_token);

CREATE INDEX IF NOT EXISTS idx_job_alerts_active_created
  ON job_alerts (active, created_at DESC)
  WHERE active = TRUE;

-- 036 — perfil público da empresa (opt-in; URL neutra /c/{slug})
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_companies_public_profile_slug
  ON companies (LOWER(slug))
  WHERE deleted = FALSE AND active = TRUE AND public_profile_enabled = TRUE;

-- 037 — local / modalidade da vaga (IBGE cidade+UF; base para agregadores)
ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS workplace_modality TEXT,
  ADD COLUMN IF NOT EXISTS workplace_city TEXT,
  ADD COLUMN IF NOT EXISTS workplace_state TEXT;

COMMENT ON COLUMN vacancies.workplace_modality IS
  'onsite | hybrid | remote | NULL';
COMMENT ON COLUMN vacancies.workplace_city IS
  'Cidade do local de trabalho (texto livre; opcional se remote)';
COMMENT ON COLUMN vacancies.workplace_state IS
  'UF brasileira (2 letras) do local; opcional';

CREATE INDEX IF NOT EXISTS idx_vacancies_public_workplace_modality
  ON vacancies (workplace_modality)
  WHERE deleted = FALSE
    AND public_page_enabled = TRUE
    AND status = 'open'
    AND workplace_modality IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_public_workplace_city
  ON vacancies (LOWER(workplace_city))
  WHERE deleted = FALSE
    AND public_page_enabled = TRUE
    AND status = 'open'
    AND workplace_city IS NOT NULL
    AND btrim(workplace_city) <> '';

-- 038 — convite para definir senha (sem senha temporária no e-mail)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_setup_token TEXT,
  ADD COLUMN IF NOT EXISTS password_setup_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN users.password_setup_token IS
  'Token de uso único para /a/set-password; NULL = senha já definida';
COMMENT ON COLUMN users.password_setup_expires_at IS
  'Validade do token de convite de senha (padrão 72h)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_password_setup_token
  ON users (password_setup_token)
  WHERE password_setup_token IS NOT NULL;

-- 039 — logo da empresa (URL + key S3; arquivo fora do Postgres)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_key TEXT;

COMMENT ON COLUMN companies.logo_url IS
  'URL pública https do logo (CDN/S3). Usado em /c, /j e JobPosting.hiringOrganization.logo.';
COMMENT ON COLUMN companies.logo_key IS
  'Object key no bucket S3 (companies/{id}/{uuid}.ext ou com S3_KEY_PREFIX). NULL se sem logo.';


-- 040 — grupos salvos (squads)
-- 040: grupos salvos (squads) na aba Grupos — núcleo por empresa.

CREATE TABLE IF NOT EXISTS team_groups (
  id                     BIGSERIAL PRIMARY KEY,
  company_id             BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  base_assessment_id     BIGINT REFERENCES assessments(id) ON DELETE SET NULL,
  member_assessment_ids  BIGINT[] NOT NULL DEFAULT '{}',
  created_by_user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_groups_name_len CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 120),
  CONSTRAINT team_groups_members_cap CHECK (cardinality(member_assessment_ids) <= 40)
);

CREATE INDEX IF NOT EXISTS idx_team_groups_company_updated
  ON team_groups (company_id, updated_at DESC)
  WHERE deleted = FALSE;

COMMENT ON TABLE team_groups IS
  'Saved Group tab squads (base + members by assessment_id). Soft-deleted via deleted=TRUE.';

INSERT INTO schema_migrations (name) VALUES ('040_team_groups.sql')
ON CONFLICT (name) DO NOTHING;


-- 041 — interview scorecards (B-407)

CREATE TABLE IF NOT EXISTS interview_scorecards (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id),
  candidate_id BIGINT NOT NULL REFERENCES candidates(id),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vacancy_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_scorecards_company
  ON interview_scorecards (company_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_interview_scorecards_candidate
  ON interview_scorecards (candidate_id, vacancy_id);

INSERT INTO schema_migrations (name) VALUES ('041_interview_scorecards.sql')
ON CONFLICT (name) DO NOTHING;
-- 042 — PDI (development plans) + pesquisa de clima (estrutura inicial, epic B-500)
-- Pessoa = candidates (company_id + e-mail). Respostas de clima são anônimas (sem candidate_id).

CREATE TABLE IF NOT EXISTS development_plans (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  objective            TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'draft',
  period_start         DATE,
  period_end           DATE,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT development_plans_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  CONSTRAINT development_plans_objective_len CHECK (char_length(objective) <= 4000),
  CONSTRAINT development_plans_status_chk CHECK (status IN ('draft', 'active', 'completed', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_development_plans_candidate
  ON development_plans (candidate_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_development_plans_company
  ON development_plans (company_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS development_plan_items (
  id                   BIGSERIAL PRIMARY KEY,
  plan_id              BIGINT NOT NULL REFERENCES development_plans(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  notes                TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'todo',
  source               TEXT NOT NULL DEFAULT 'manual',
  sort_order           INT NOT NULL DEFAULT 0,
  due_date             DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT development_plan_items_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 300),
  CONSTRAINT development_plan_items_notes_len CHECK (char_length(notes) <= 4000),
  CONSTRAINT development_plan_items_status_chk CHECK (status IN ('todo', 'doing', 'done')),
  CONSTRAINT development_plan_items_source_chk CHECK (source IN (
    'manual', 'synthesis', 'one_on_one', 'retention', 'onboarding', 'performance_review'
  ))
);

CREATE INDEX IF NOT EXISTS idx_development_plan_items_plan
  ON development_plan_items (plan_id, sort_order ASC, id ASC);

-- Campanhas de clima (empresa). Respostas anônimas via token de convite.
CREATE TABLE IF NOT EXISTS climate_surveys (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'draft',
  opens_at             TIMESTAMPTZ,
  closes_at            TIMESTAMPTZ,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT climate_surveys_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  CONSTRAINT climate_surveys_description_len CHECK (char_length(description) <= 4000),
  CONSTRAINT climate_surveys_status_chk CHECK (status IN ('draft', 'open', 'closed', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_climate_surveys_company
  ON climate_surveys (company_id, updated_at DESC)
  WHERE deleted = FALSE;

CREATE TABLE IF NOT EXISTS climate_survey_questions (
  id                   BIGSERIAL PRIMARY KEY,
  survey_id            BIGINT NOT NULL REFERENCES climate_surveys(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prompt               TEXT NOT NULL,
  sort_order           INT NOT NULL DEFAULT 0,
  scale_min            SMALLINT NOT NULL DEFAULT 1,
  scale_max            SMALLINT NOT NULL DEFAULT 5,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT climate_survey_questions_prompt_len CHECK (char_length(btrim(prompt)) >= 1 AND char_length(prompt) <= 500),
  CONSTRAINT climate_survey_questions_scale_chk CHECK (scale_min >= 1 AND scale_max <= 10 AND scale_min < scale_max)
);

CREATE INDEX IF NOT EXISTS idx_climate_survey_questions_survey
  ON climate_survey_questions (survey_id, sort_order ASC, id ASC)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS climate_survey_invites (
  id                   BIGSERIAL PRIMARY KEY,
  survey_id            BIGINT NOT NULL REFERENCES climate_surveys(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token                TEXT NOT NULL UNIQUE,
  expires_at           TIMESTAMPTZ NOT NULL,
  used_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT climate_survey_invites_token_len CHECK (char_length(token) >= 16 AND char_length(token) <= 128)
);

CREATE INDEX IF NOT EXISTS idx_climate_survey_invites_survey
  ON climate_survey_invites (survey_id, created_at DESC);

CREATE TABLE IF NOT EXISTS climate_survey_responses (
  id                   BIGSERIAL PRIMARY KEY,
  survey_id            BIGINT NOT NULL REFERENCES climate_surveys(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invite_id            BIGINT REFERENCES climate_survey_invites(id) ON DELETE SET NULL,
  answers              JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT climate_survey_responses_invite_unique UNIQUE (invite_id)
);

CREATE INDEX IF NOT EXISTS idx_climate_survey_responses_survey
  ON climate_survey_responses (survey_id, submitted_at DESC);

COMMENT ON TABLE development_plans IS
  'PDI — plano de desenvolvimento por pessoa (candidate_id).';
COMMENT ON TABLE climate_surveys IS
  'Pesquisa de clima — campanha por empresa; respostas anônimas (sem candidate_id).';

INSERT INTO schema_migrations (name) VALUES ('042_pdi_and_climate.sql')
ON CONFLICT (name) DO NOTHING;


-- 043 — B-502: PDI item may link to a 1:1 (same candidate/company).
ALTER TABLE development_plan_items
  ADD COLUMN IF NOT EXISTS one_on_one_id BIGINT REFERENCES one_on_ones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_development_plan_items_oo
  ON development_plan_items (one_on_one_id)
  WHERE one_on_one_id IS NOT NULL;

COMMENT ON COLUMN development_plan_items.one_on_one_id IS
  'Optional link to a 1:1 record for follow-up (B-502).';

INSERT INTO schema_migrations (name) VALUES ('043_pdi_item_one_on_one.sql')
ON CONFLICT (name) DO NOTHING;

-- 044 — B-600 A/B: PDI ciclo (owner) + fontes one_on_one/retention; follow-up de retenção

ALTER TABLE development_plan_items
  ADD COLUMN IF NOT EXISTS owner_label TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'development_plan_items_owner_label_len'
  ) THEN
    ALTER TABLE development_plan_items DROP CONSTRAINT development_plan_items_owner_label_len;
  END IF;
END $$;

ALTER TABLE development_plan_items
  ADD CONSTRAINT development_plan_items_owner_label_len
  CHECK (char_length(owner_label) <= 120);

-- Always apply the *final* source set (056). Intermediate lists break prod rows
-- that already use onboarding / performance_review when re-running this bundle.
ALTER TABLE development_plan_items
  DROP CONSTRAINT IF EXISTS development_plan_items_source_chk;

ALTER TABLE development_plan_items
  ADD CONSTRAINT development_plan_items_source_chk
  CHECK (source IN (
    'manual', 'synthesis', 'one_on_one', 'retention', 'onboarding', 'performance_review'
  ));

COMMENT ON COLUMN development_plan_items.owner_label IS
  'Free-text owner / responsible for the item (B-601).';
COMMENT ON COLUMN development_plan_items.source IS
  'manual | synthesis | one_on_one | retention | onboarding | performance_review.';

CREATE TABLE IF NOT EXISTS retention_followups (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  plan_id              BIGINT REFERENCES development_plans(id) ON DELETE SET NULL,
  signal_keys          TEXT[] NOT NULL DEFAULT '{}',
  explanation          TEXT NOT NULL DEFAULT '',
  suggested_question   TEXT NOT NULL DEFAULT '',
  review_due           DATE,
  reviewed_at          TIMESTAMPTZ,
  review_notes         TEXT NOT NULL DEFAULT '',
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_followups_explanation_len CHECK (char_length(explanation) <= 2000),
  CONSTRAINT retention_followups_question_len CHECK (char_length(suggested_question) <= 1000),
  CONSTRAINT retention_followups_notes_len CHECK (char_length(review_notes) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_retention_followups_candidate
  ON retention_followups (candidate_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_retention_followups_company_review
  ON retention_followups (company_id, review_due ASC NULLS LAST)
  WHERE reviewed_at IS NULL;

COMMENT ON TABLE retention_followups IS
  'Retention watch → actionable follow-up (signal + question + plan + review). B-602.';

INSERT INTO schema_migrations (name) VALUES ('044_pdi_cycle_and_retention_action.sql')
ON CONFLICT (name) DO NOTHING;
-- 045 — B-600 C: short contextual team pulse (scoped to saved team group)

CREATE TABLE IF NOT EXISTS team_pulses (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  team_group_id        BIGINT NOT NULL REFERENCES team_groups(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft',
  opens_at             TIMESTAMPTZ,
  closes_at            TIMESTAMPTZ,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_pulses_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  CONSTRAINT team_pulses_status_chk CHECK (status IN ('draft', 'open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_team_pulses_group
  ON team_pulses (team_group_id, updated_at DESC)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_team_pulses_company
  ON team_pulses (company_id, updated_at DESC)
  WHERE deleted = FALSE;

CREATE TABLE IF NOT EXISTS team_pulse_questions (
  id                   BIGSERIAL PRIMARY KEY,
  pulse_id             BIGINT NOT NULL REFERENCES team_pulses(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prompt_key           TEXT NOT NULL,
  prompt               TEXT NOT NULL,
  sort_order           INT NOT NULL DEFAULT 0,
  scale_min            SMALLINT NOT NULL DEFAULT 1,
  scale_max            SMALLINT NOT NULL DEFAULT 5,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_pulse_questions_prompt_len CHECK (char_length(btrim(prompt)) >= 1 AND char_length(prompt) <= 500),
  CONSTRAINT team_pulse_questions_scale_chk CHECK (scale_min >= 1 AND scale_max <= 10 AND scale_min < scale_max)
);

CREATE INDEX IF NOT EXISTS idx_team_pulse_questions_pulse
  ON team_pulse_questions (pulse_id, sort_order ASC, id ASC)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS team_pulse_invites (
  id                   BIGSERIAL PRIMARY KEY,
  pulse_id             BIGINT NOT NULL REFERENCES team_pulses(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token                TEXT NOT NULL UNIQUE,
  expires_at           TIMESTAMPTZ NOT NULL,
  used_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_pulse_invites_token_len CHECK (char_length(token) >= 16 AND char_length(token) <= 128)
);

CREATE INDEX IF NOT EXISTS idx_team_pulse_invites_pulse
  ON team_pulse_invites (pulse_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_pulse_responses (
  id                   BIGSERIAL PRIMARY KEY,
  pulse_id             BIGINT NOT NULL REFERENCES team_pulses(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invite_id            BIGINT REFERENCES team_pulse_invites(id) ON DELETE SET NULL,
  answers              JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_pulse_responses_invite_unique UNIQUE (invite_id)
);

CREATE INDEX IF NOT EXISTS idx_team_pulse_responses_pulse
  ON team_pulse_responses (pulse_id, submitted_at DESC);

COMMENT ON TABLE team_pulses IS
  'Short anonymous pulse scoped to a saved team group (B-603).';

INSERT INTO schema_migrations (name) VALUES ('045_team_pulse.sql')
ON CONFLICT (name) DO NOTHING;
-- 046 — B-600 D: minimal employee view via token (no candidate account)

CREATE TABLE IF NOT EXISTS employee_portal_tokens (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token                TEXT NOT NULL UNIQUE,
  expires_at           TIMESTAMPTZ NOT NULL,
  revoked_at           TIMESTAMPTZ,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at         TIMESTAMPTZ,
  CONSTRAINT employee_portal_tokens_token_len CHECK (char_length(token) >= 16 AND char_length(token) <= 128)
);

CREATE INDEX IF NOT EXISTS idx_employee_portal_candidate
  ON employee_portal_tokens (candidate_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_portal_token_active
  ON employee_portal_tokens (token)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE employee_portal_tokens IS
  'Token link /e/{token} for hired people: PDI + 1:1 prep (no login). B-604.';

INSERT INTO schema_migrations (name) VALUES ('046_employee_portal.sql')
ON CONFLICT (name) DO NOTHING;
-- 047 — B-600 polish: employee portal prep flag + note to manager

ALTER TABLE employee_portal_tokens
  ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS note_to_manager TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_portal_tokens_note_len'
  ) THEN
    ALTER TABLE employee_portal_tokens DROP CONSTRAINT employee_portal_tokens_note_len;
  END IF;
END $$;

ALTER TABLE employee_portal_tokens
  ADD CONSTRAINT employee_portal_tokens_note_len
  CHECK (char_length(note_to_manager) <= 2000);

COMMENT ON COLUMN employee_portal_tokens.prepared_at IS
  'Employee marked 1:1 prep done on /e/{token} (B-604 polish).';
COMMENT ON COLUMN employee_portal_tokens.note_to_manager IS
  'Optional short note from employee to manager via token link.';

INSERT INTO schema_migrations (name) VALUES ('047_employee_portal_prep.sql')
ON CONFLICT (name) DO NOTHING;

-- 048 — Overview PDI work-queue indexes
CREATE INDEX IF NOT EXISTS idx_development_plan_items_company_due
  ON development_plan_items (company_id, due_date ASC, id ASC)
  WHERE status <> 'done' AND due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_development_plan_items_company_unlinked
  ON development_plan_items (company_id, updated_at DESC, id DESC)
  WHERE status <> 'done' AND one_on_one_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_company_employee
  ON candidates (company_id, full_name ASC NULLS LAST, id ASC)
  WHERE employment_status = 'employee';

INSERT INTO schema_migrations (name) VALUES ('048_pdi_overview_queue_indexes.sql')
ON CONFLICT (name) DO NOTHING;

-- 049 — B-701 onboarding check-ins D30/D60/D90
CREATE TABLE IF NOT EXISTS employee_onboarding_checkins (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  milestone_days       INT NOT NULL,
  due_date             DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  outcome              TEXT NOT NULL DEFAULT '',
  notes                TEXT NOT NULL DEFAULT '',
  completed_at         TIMESTAMPTZ,
  completed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_onboarding_checkins_milestone_chk
    CHECK (milestone_days IN (30, 60, 90)),
  CONSTRAINT employee_onboarding_checkins_status_chk
    CHECK (status IN ('pending', 'done', 'skipped')),
  CONSTRAINT employee_onboarding_checkins_outcome_chk
    CHECK (outcome IN ('', 'continue', 'develop', 'concern')),
  CONSTRAINT employee_onboarding_checkins_notes_len
    CHECK (char_length(notes) <= 4000),
  CONSTRAINT employee_onboarding_checkins_unique
    UNIQUE (candidate_id, milestone_days)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_checkins_company_due
  ON employee_onboarding_checkins (company_id, due_date ASC, id ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_onboarding_checkins_candidate
  ON employee_onboarding_checkins (candidate_id, milestone_days ASC);

ALTER TABLE development_plan_items
  DROP CONSTRAINT IF EXISTS development_plan_items_source_chk;

ALTER TABLE development_plan_items
  ADD CONSTRAINT development_plan_items_source_chk
  CHECK (source IN (
    'manual', 'synthesis', 'one_on_one', 'retention', 'onboarding', 'performance_review'
  ));

INSERT INTO schema_migrations (name) VALUES ('049_onboarding_checkins.sql')
ON CONFLICT (name) DO NOTHING;

-- 050 — Climate open-text questions
ALTER TABLE climate_survey_questions
  ADD COLUMN IF NOT EXISTS question_kind TEXT NOT NULL DEFAULT 'likert';

-- Always apply the *final* kind set (080 includes enps). Narrower lists break
-- prod rows when re-running this bundle.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'climate_survey_questions_kind_chk'
  ) THEN
    ALTER TABLE climate_survey_questions DROP CONSTRAINT climate_survey_questions_kind_chk;
  END IF;
END $$;

ALTER TABLE climate_survey_questions
  ADD CONSTRAINT climate_survey_questions_kind_chk
  CHECK (question_kind IN ('likert', 'text', 'enps'));

INSERT INTO schema_migrations (name) VALUES ('050_climate_text_questions.sql')
ON CONFLICT (name) DO NOTHING;


-- 051 — Pre-onboarding D1 + minimal offer/acceptance
CREATE TABLE IF NOT EXISTS employee_pre_onboarding_items (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  item_key             TEXT NOT NULL,
  due_date             DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  notes                TEXT NOT NULL DEFAULT '',
  completed_at         TIMESTAMPTZ,
  completed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_pre_onboarding_item_key_chk
    CHECK (item_key IN ('welcome_kit', 'rh_onboarding_call', 'manager_onboarding')),
  CONSTRAINT employee_pre_onboarding_status_chk
    CHECK (status IN ('pending', 'done', 'skipped')),
  CONSTRAINT employee_pre_onboarding_notes_len
    CHECK (char_length(notes) <= 2000),
  CONSTRAINT employee_pre_onboarding_unique
    UNIQUE (candidate_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_pre_onboarding_company_due
  ON employee_pre_onboarding_items (company_id, due_date ASC, id ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pre_onboarding_candidate
  ON employee_pre_onboarding_items (candidate_id, item_key ASC);

ALTER TABLE vacancy_candidates
  ADD COLUMN IF NOT EXISTS offer_salary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS offer_start_date DATE,
  ADD COLUMN IF NOT EXISTS offer_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS offer_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS offer_salary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS offer_start_date DATE,
  ADD COLUMN IF NOT EXISTS offer_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS offer_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_notes TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_candidates_offer_status_chk') THEN
    ALTER TABLE vacancy_candidates DROP CONSTRAINT vacancy_candidates_offer_status_chk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessments_offer_status_chk') THEN
    ALTER TABLE assessments DROP CONSTRAINT assessments_offer_status_chk;
  END IF;
END $$;

ALTER TABLE vacancy_candidates
  ADD CONSTRAINT vacancy_candidates_offer_status_chk
  CHECK (offer_status IN ('none', 'proposed', 'accepted', 'declined'));

ALTER TABLE assessments
  ADD CONSTRAINT assessments_offer_status_chk
  CHECK (offer_status IN ('none', 'proposed', 'accepted', 'declined'));

INSERT INTO schema_migrations (name) VALUES ('051_pre_onboarding_and_offer.sql')
ON CONFLICT (name) DO NOTHING;

-- 052 — Motivadores dimension colors (align to lib/ae/motivators-dimensions.js)
UPDATE ae_dimensions d
SET color = v.color
FROM (
  VALUES
    ('reconhecimento', '#9D174D'),
    ('financeiro', '#059669'),
    ('crescimento', '#2563eb'),
    ('desenvolvimento', '#0891b2'),
    ('autonomia', '#d97706'),
    ('flexibilidade', '#65a30d'),
    ('proposito', '#db2777'),
    ('relacionamentos', '#e11d48'),
    ('seguranca', '#4b5563'),
    ('lideranca', '#7c2d12'),
    ('desafio', '#ea580c'),
    ('criatividade', '#0e7490'),
    ('equilibrio', '#0d9488')
) AS v(key, color)
WHERE d.definition_id = (SELECT id FROM ae_definitions WHERE LOWER(slug) = 'motivators' LIMIT 1)
  AND LOWER(d.key) = LOWER(v.key)
  AND (d.color IS DISTINCT FROM v.color);

INSERT INTO schema_migrations (name) VALUES ('052_motivators_dimension_colors.sql')
ON CONFLICT (name) DO NOTHING;

-- 054 — Align pre-onboarding item_key CHECK.
-- Final form is a slug regex (company templates). Do NOT re-apply the old
-- three-key list or DELETE legacy rows when re-running this bundle.
ALTER TABLE employee_pre_onboarding_items
  DROP CONSTRAINT IF EXISTS employee_pre_onboarding_item_key_chk;

ALTER TABLE employee_pre_onboarding_items
  ADD CONSTRAINT employee_pre_onboarding_item_key_chk
  CHECK (item_key ~ '^[a-z][a-z0-9_]{1,40}$');

INSERT INTO schema_migrations (name) VALUES ('054_pre_onboarding_item_keys_align.sql')
ON CONFLICT (name) DO NOTHING;

-- 055 — Wizard early access só para /signup; painel/legado = completed
UPDATE users
SET
  onboarding_completed = TRUE,
  onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
WHERE deleted = FALSE
  AND onboarding_completed = FALSE
  AND signup_source IS NULL
  AND signup_metadata IS NULL
  AND signup_pending = FALSE;

INSERT INTO schema_migrations (name) VALUES ('055_onboarding_wizard_panel_users.sql')
ON CONFLICT (name) DO NOTHING;

-- 055 — Job roles (B-1003). Soft delete = `active`; this table has no `deleted`.
CREATE TABLE IF NOT EXISTS job_roles (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rubric JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE(company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_job_roles_company
  ON job_roles (company_id, active)
  WHERE active = TRUE;

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS job_role_id BIGINT REFERENCES job_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_job_role
  ON vacancies (job_role_id)
  WHERE job_role_id IS NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('055_job_roles.sql')
ON CONFLICT (name) DO NOTHING;

-- 062 — Benefit categories catalog
CREATE TABLE IF NOT EXISTS benefit_categories (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT benefit_categories_name_len
    CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_benefit_categories_company_name_lower
  ON benefit_categories (company_id, LOWER(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_benefit_categories_company_active
  ON benefit_categories (company_id, active, updated_at DESC)
  WHERE active = TRUE;

ALTER TABLE company_benefits
  ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES benefit_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_company_benefits_category_id
  ON company_benefits (company_id, category_id)
  WHERE category_id IS NOT NULL AND active = TRUE;

INSERT INTO benefit_categories (company_id, name, active)
SELECT DISTINCT b.company_id, btrim(b.category), TRUE
FROM company_benefits b
WHERE b.category IS NOT NULL
  AND btrim(b.category) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM benefit_categories c
    WHERE c.company_id = b.company_id
      AND LOWER(btrim(c.name)) = LOWER(btrim(b.category))
  );

UPDATE company_benefits b
SET category_id = c.id
FROM benefit_categories c
WHERE b.category_id IS NULL
  AND b.category IS NOT NULL
  AND btrim(b.category) <> ''
  AND c.company_id = b.company_id
  AND LOWER(btrim(c.name)) = LOWER(btrim(b.category));

INSERT INTO schema_migrations (name) VALUES ('062_benefit_categories.sql')
ON CONFLICT (name) DO NOTHING;

-- 063 — learning theme tags length
ALTER TABLE learning_resources DROP CONSTRAINT IF EXISTS learning_resources_theme_len;
ALTER TABLE learning_resources
  ADD CONSTRAINT learning_resources_theme_len
  CHECK (theme IS NULL OR char_length(theme) <= 400);

INSERT INTO schema_migrations (name) VALUES ('063_learning_theme_tags.sql')
ON CONFLICT (name) DO NOTHING;

-- 064 — analytics report prefs (B-1107)
CREATE TABLE IF NOT EXISTS company_analytics_report_prefs (
  company_id BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('weekly', 'monthly', 'off')),
  recipient_user_ids BIGINT[] NOT NULL DEFAULT '{}',
  attach_pdf BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (name) VALUES ('064_analytics_report_prefs.sql')
ON CONFLICT (name) DO NOTHING;

-- 065 — expand exit reasons + benefit types (multi-segment enums)
ALTER TABLE exit_records DROP CONSTRAINT IF EXISTS exit_records_reason_chk;
ALTER TABLE exit_records ADD CONSTRAINT exit_records_reason_chk CHECK (
  exit_reason IN (
    'better_offer', 'career_growth', 'compensation', 'benefits',
    'work_life_balance', 'burnout', 'workload',
    'relocation', 'commute', 'schedule',
    'personal', 'family_care', 'health',
    'study', 'public_exam', 'entrepreneurship',
    'performance', 'conduct', 'harassment',
    'restructuring', 'layoff', 'position_eliminated',
    'contract_end', 'seasonal_end', 'retirement',
    'culture_fit', 'manager_relationship', 'recognition',
    'lack_of_challenge', 'targets_pressure', 'client_pressure',
    'tools_process', 'other'
  )
);

ALTER TABLE company_benefits DROP CONSTRAINT IF EXISTS company_benefits_type_chk;
ALTER TABLE company_benefits ADD CONSTRAINT company_benefits_type_chk CHECK (
  benefit_type IN (
    'health', 'dental', 'vision', 'mental_health', 'life_insurance',
    'retirement', 'profit_sharing', 'equity',
    'vacation', 'parental_leave', 'sabbatical',
    'flexible_hours', 'remote_work', 'home_office_allowance',
    'gym', 'wellness',
    'meal_voucher', 'food_basket', 'transport_voucher', 'parking', 'mobility', 'phone',
    'education', 'language', 'daycare', 'legal_aid', 'uniform', 'pet',
    'other'
  )
);

INSERT INTO schema_migrations (name) VALUES ('065_expand_exit_benefit_enums.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 066_birth_and_company_anniversary.sql
-- =============================================================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS birth_date DATE;

COMMENT ON COLUMN candidates.birth_date IS
  'Date of birth (nullable). Day/month used for Overview birthday card. Not hire/start date.';

CREATE INDEX IF NOT EXISTS idx_candidates_company_birth_md
  ON candidates (
    company_id,
    (EXTRACT(MONTH FROM birth_date)::smallint),
    (EXTRACT(DAY FROM birth_date)::smallint)
  )
  WHERE birth_date IS NOT NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS anniversary_date DATE;

COMMENT ON COLUMN companies.anniversary_date IS
  'Company founding / institutional anniversary (nullable). Day/month for Overview chip.';

INSERT INTO schema_migrations (name) VALUES ('066_birth_and_company_anniversary.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 067_lms_basic.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS lms_courses (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  completion_pct       SMALLINT NOT NULL DEFAULT 100,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lms_courses_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 300),
  CONSTRAINT lms_courses_description_len CHECK (char_length(description) <= 8000),
  CONSTRAINT lms_courses_completion_pct_chk CHECK (completion_pct >= 1 AND completion_pct <= 100)
);

CREATE INDEX IF NOT EXISTS idx_lms_courses_company
  ON lms_courses (company_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS lms_lessons (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  course_id            BIGINT NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  content_url          TEXT NOT NULL,
  content_kind         TEXT NOT NULL DEFAULT 'link',
  sort_order           INT NOT NULL DEFAULT 0,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lms_lessons_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 300),
  CONSTRAINT lms_lessons_url_len CHECK (char_length(btrim(content_url)) >= 1 AND char_length(content_url) <= 2000),
  CONSTRAINT lms_lessons_kind_chk CHECK (content_kind IN ('link', 'youtube', 'vimeo', 'pdf')),
  CONSTRAINT lms_lessons_sort_chk CHECK (sort_order >= 0 AND sort_order <= 10000)
);

CREATE INDEX IF NOT EXISTS idx_lms_lessons_course
  ON lms_lessons (course_id, active, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_lms_lessons_company
  ON lms_lessons (company_id, course_id);

CREATE TABLE IF NOT EXISTS lms_enrollments (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  course_id            BIGINT NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  enrolled_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  enrolled_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  UNIQUE (course_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_enrollments_company_course
  ON lms_enrollments (company_id, course_id, enrolled_at DESC);

CREATE INDEX IF NOT EXISTS idx_lms_enrollments_candidate
  ON lms_enrollments (company_id, candidate_id, enrolled_at DESC);

CREATE TABLE IF NOT EXISTS lms_lesson_completions (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enrollment_id        BIGINT NOT NULL REFERENCES lms_enrollments(id) ON DELETE CASCADE,
  lesson_id            BIGINT NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  completed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enrollment_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_lesson_completions_enrollment
  ON lms_lesson_completions (enrollment_id);

CREATE INDEX IF NOT EXISTS idx_lms_lesson_completions_company
  ON lms_lesson_completions (company_id, lesson_id);

INSERT INTO schema_migrations (name) VALUES ('067_lms_basic.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 068_lms_cohorts_due_pdi.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS lms_cohorts (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  course_id            BIGINT NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  due_date             DATE,
  mandatory            BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lms_cohorts_name_len CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_lms_cohorts_course
  ON lms_cohorts (company_id, course_id, created_at DESC);

ALTER TABLE lms_enrollments
  ADD COLUMN IF NOT EXISTS cohort_id BIGINT REFERENCES lms_cohorts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS mandatory BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_lms_enrollments_due
  ON lms_enrollments (company_id, due_date)
  WHERE due_date IS NOT NULL AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lms_enrollments_cohort
  ON lms_enrollments (cohort_id)
  WHERE cohort_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS development_plan_lms_links (
  id                   BIGSERIAL PRIMARY KEY,
  plan_item_id         BIGINT NOT NULL REFERENCES development_plan_items(id) ON DELETE CASCADE,
  course_id            BIGINT NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_item_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_plan_lms_links_item
  ON development_plan_lms_links (plan_item_id);

CREATE INDEX IF NOT EXISTS idx_dev_plan_lms_links_course
  ON development_plan_lms_links (course_id);

INSERT INTO schema_migrations (name) VALUES ('068_lms_cohorts_due_pdi.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 069_employee_login.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS employee_login_tokens (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token                TEXT NOT NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  used_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT employee_login_tokens_token_len CHECK (char_length(token) >= 20 AND char_length(token) <= 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_login_tokens_token
  ON employee_login_tokens (token)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_login_tokens_candidate
  ON employee_login_tokens (company_id, candidate_id, created_at DESC);

COMMENT ON TABLE employee_login_tokens IS
  'One-time magic links for employee session (/employee). Not manager JWT.';

INSERT INTO schema_migrations (name) VALUES ('069_employee_login.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 070_employee_password.sql
-- =============================================================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_setup_token TEXT,
  ADD COLUMN IF NOT EXISTS password_setup_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_invited_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_password_setup_token
  ON candidates (password_setup_token)
  WHERE password_setup_token IS NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('070_employee_password.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 071_candidate_notifications.sql
-- =============================================================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT;

CREATE TABLE IF NOT EXISTS candidate_notifications (
  id                       BIGSERIAL PRIMARY KEY,
  company_id               BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_candidate_id   BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type                     TEXT NOT NULL,
  payload                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  entity_type              TEXT,
  entity_id                BIGINT,
  dedupe_key               TEXT,
  read_at                  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_recipient_created
  ON candidate_notifications (recipient_candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_recipient_unread
  ON candidate_notifications (recipient_candidate_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_notifications_dedupe
  ON candidate_notifications (recipient_candidate_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_company_created
  ON candidate_notifications (company_id, created_at DESC);

INSERT INTO schema_migrations (name) VALUES ('071_candidate_notifications.sql')
ON CONFLICT (name) DO NOTHING;

-- 072_employee_compensation.sql
CREATE TABLE IF NOT EXISTS employee_compensation_events (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_type           TEXT NOT NULL,
  amount               TEXT NOT NULL,
  effective_date       DATE NOT NULL,
  notes                TEXT NOT NULL DEFAULT '',
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_compensation_events_type_chk
    CHECK (event_type IN ('hire', 'raise', 'adjustment', 'bonus', 'other')),
  CONSTRAINT employee_compensation_events_amount_len
    CHECK (char_length(amount) <= 80),
  CONSTRAINT employee_compensation_events_notes_len
    CHECK (char_length(notes) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_compensation_company_candidate_date
  ON employee_compensation_events (company_id, candidate_id, effective_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_compensation_candidate_date
  ON employee_compensation_events (candidate_id, effective_date DESC, id DESC);

INSERT INTO schema_migrations (name) VALUES ('072_employee_compensation.sql')
ON CONFLICT (name) DO NOTHING;

-- 077_employee_prep_surveys.sql
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS one_on_one_prep_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS one_on_one_prep_note TEXT NOT NULL DEFAULT '';

ALTER TABLE candidates
  DROP CONSTRAINT IF EXISTS candidates_one_on_one_prep_note_len;
ALTER TABLE candidates
  ADD CONSTRAINT candidates_one_on_one_prep_note_len
  CHECK (char_length(one_on_one_prep_note) <= 2000);

ALTER TABLE climate_survey_invites
  ADD COLUMN IF NOT EXISTS candidate_id BIGINT REFERENCES candidates(id) ON DELETE SET NULL;

ALTER TABLE team_pulse_invites
  ADD COLUMN IF NOT EXISTS candidate_id BIGINT REFERENCES candidates(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_climate_invites_survey_candidate
  ON climate_survey_invites (survey_id, candidate_id)
  WHERE candidate_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_pulse_invites_pulse_candidate
  ON team_pulse_invites (pulse_id, candidate_id)
  WHERE candidate_id IS NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('077_employee_prep_surveys.sql')
ON CONFLICT (name) DO NOTHING;

-- 078_compensation_notes_rich.sql
ALTER TABLE employee_compensation_events
  DROP CONSTRAINT IF EXISTS employee_compensation_events_notes_len;

ALTER TABLE employee_compensation_events
  ADD CONSTRAINT employee_compensation_events_notes_len
    CHECK (char_length(notes) <= 4000);

INSERT INTO schema_migrations (name) VALUES ('078_compensation_notes_rich.sql')
ON CONFLICT (name) DO NOTHING;

-- 079_candidates_name_trgm.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_candidates_full_name_trgm
  ON candidates USING gin (full_name gin_trgm_ops);

INSERT INTO schema_migrations (name) VALUES ('079_candidates_name_trgm.sql')
ON CONFLICT (name) DO NOTHING;

-- 080_solides_gaps_2702_2707.sql (eNPS, 180/360 side reviews, experience outcomes, CV, interview slots)
-- Full DDL lives in migrations/080_solides_gaps_2702_2707.sql — apply via npm run db:migrate.
-- Idempotent excerpts for pgAdmin:

ALTER TABLE climate_survey_questions DROP CONSTRAINT IF EXISTS climate_survey_questions_kind_chk;
ALTER TABLE climate_survey_questions
  ADD CONSTRAINT climate_survey_questions_kind_chk
  CHECK (question_kind IN ('likert', 'text', 'enps'));

ALTER TABLE performance_cycles
  ADD COLUMN IF NOT EXISTS allow_self_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS allow_peer_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS performance_side_reviews (
  id                   BIGSERIAL PRIMARY KEY,
  cycle_id             BIGINT NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL,
  reviewer_label       TEXT NOT NULL DEFAULT '',
  token                TEXT NOT NULL,
  outcomes             JSONB NOT NULL DEFAULT '{}'::jsonb,
  overall_notes        TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'pending',
  submitted_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_side_reviews_role_chk CHECK (role IN ('self', 'peer')),
  CONSTRAINT performance_side_reviews_status_chk CHECK (status IN ('pending', 'submitted', 'expired')),
  CONSTRAINT performance_side_reviews_token_len CHECK (char_length(token) >= 16 AND char_length(token) <= 128),
  CONSTRAINT performance_side_reviews_notes_len CHECK (char_length(overall_notes) <= 4000),
  CONSTRAINT performance_side_reviews_label_len CHECK (char_length(reviewer_label) <= 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_performance_side_reviews_token ON performance_side_reviews (token);
CREATE INDEX IF NOT EXISTS idx_performance_side_reviews_cycle_candidate ON performance_side_reviews (cycle_id, candidate_id, role);

ALTER TABLE employee_onboarding_checkins DROP CONSTRAINT IF EXISTS employee_onboarding_checkins_outcome_chk;
ALTER TABLE employee_onboarding_checkins
  ADD CONSTRAINT employee_onboarding_checkins_outcome_chk
  CHECK (outcome IN (
    '', 'continue', 'develop', 'concern', 'pass', 'fail', 'extend', 'terminate'
  ));

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS cv_url TEXT,
  ADD COLUMN IF NOT EXISTS cv_key TEXT,
  ADD COLUMN IF NOT EXISTS cv_extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS cv_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS interview_slots (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vacancy_id           BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  starts_at            TIMESTAMPTZ NOT NULL,
  ends_at              TIMESTAMPTZ,
  meet_url             TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'scheduled',
  notes                TEXT NOT NULL DEFAULT '',
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT interview_slots_status_chk CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  CONSTRAINT interview_slots_meet_url_len CHECK (char_length(meet_url) <= 500),
  CONSTRAINT interview_slots_notes_len CHECK (char_length(notes) <= 2000)
);
CREATE INDEX IF NOT EXISTS idx_interview_slots_vacancy_starts ON interview_slots (vacancy_id, starts_at ASC) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_interview_slots_company_starts ON interview_slots (company_id, starts_at ASC);

INSERT INTO schema_migrations (name) VALUES ('080_solides_gaps_2702_2707.sql')
ON CONFLICT (name) DO NOTHING;

-- 081 — candidate session_version (colaborador JWT revocation)
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN candidates.session_version IS
  'Bumped on password change/reset/disable-2FA; JWT claim sv must match.';

INSERT INTO schema_migrations (name) VALUES ('081_candidate_session_version.sql')
ON CONFLICT (name) DO NOTHING;

-- 082 — product feedback inbox (manager → super-admin)
CREATE TABLE IF NOT EXISTS product_feedback (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT REFERENCES companies(id) ON DELETE SET NULL,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'new',
  message           TEXT NOT NULL,
  active_tab        TEXT NOT NULL DEFAULT '',
  active_section    TEXT NOT NULL DEFAULT '',
  contact_ok        BOOLEAN NOT NULL DEFAULT TRUE,
  admin_notes       TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_feedback_kind_chk CHECK (kind IN ('idea', 'bug', 'ux')),
  CONSTRAINT product_feedback_status_chk CHECK (status IN ('new', 'reviewing', 'done', 'dismissed')),
  CONSTRAINT product_feedback_message_len CHECK (char_length(message) BETWEEN 10 AND 4000),
  CONSTRAINT product_feedback_admin_notes_len CHECK (char_length(admin_notes) <= 4000),
  CONSTRAINT product_feedback_tab_len CHECK (char_length(active_tab) <= 80),
  CONSTRAINT product_feedback_section_len CHECK (char_length(active_section) <= 80)
);

CREATE INDEX IF NOT EXISTS idx_product_feedback_status_created
  ON product_feedback (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_feedback_company_created
  ON product_feedback (company_id, created_at DESC);

COMMENT ON TABLE product_feedback IS
  'Manager-submitted product ideas/bugs/UX notes; inbox is super-admin only.';

INSERT INTO schema_migrations (name) VALUES ('082_product_feedback.sql')
ON CONFLICT (name) DO NOTHING;

-- 083 — DP leve (perfil, checklist documental, férias/afastamentos)
CREATE TABLE IF NOT EXISTS candidate_dp_profiles (
  candidate_id         BIGINT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  emergency_name       TEXT NOT NULL DEFAULT '',
  emergency_phone      TEXT NOT NULL DEFAULT '',
  emergency_relation   TEXT NOT NULL DEFAULT '',
  address_line         TEXT NOT NULL DEFAULT '',
  address_city         TEXT NOT NULL DEFAULT '',
  address_state        TEXT NOT NULL DEFAULT '',
  address_postal       TEXT NOT NULL DEFAULT '',
  internal_notes       TEXT NOT NULL DEFAULT '',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT candidate_dp_profiles_emergency_name_len CHECK (char_length(emergency_name) <= 120),
  CONSTRAINT candidate_dp_profiles_emergency_phone_len CHECK (char_length(emergency_phone) <= 40),
  CONSTRAINT candidate_dp_profiles_emergency_relation_len CHECK (char_length(emergency_relation) <= 80),
  CONSTRAINT candidate_dp_profiles_address_line_len CHECK (char_length(address_line) <= 240),
  CONSTRAINT candidate_dp_profiles_address_city_len CHECK (char_length(address_city) <= 120),
  CONSTRAINT candidate_dp_profiles_address_state_len CHECK (char_length(address_state) <= 2),
  CONSTRAINT candidate_dp_profiles_address_postal_len CHECK (char_length(address_postal) <= 16),
  CONSTRAINT candidate_dp_profiles_notes_len CHECK (char_length(internal_notes) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_candidate_dp_profiles_company
  ON candidate_dp_profiles (company_id);

CREATE TABLE IF NOT EXISTS employee_dp_documents (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  doc_key              TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  notes                TEXT NOT NULL DEFAULT '',
  file_url             TEXT,
  file_key             TEXT,
  file_name            TEXT NOT NULL DEFAULT '',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT employee_dp_documents_key_chk
    CHECK (doc_key IN ('id_document', 'contract', 'aso', 'address_proof', 'bank_data', 'dependents', 'other')),
  CONSTRAINT employee_dp_documents_status_chk
    CHECK (status IN ('pending', 'received', 'waived')),
  CONSTRAINT employee_dp_documents_notes_len CHECK (char_length(notes) <= 2000),
  CONSTRAINT employee_dp_documents_file_name_len CHECK (char_length(file_name) <= 200),
  CONSTRAINT employee_dp_documents_candidate_key_uq UNIQUE (candidate_id, doc_key)
);

CREATE INDEX IF NOT EXISTS idx_employee_dp_documents_company_status
  ON employee_dp_documents (company_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_dp_documents_candidate
  ON employee_dp_documents (candidate_id, doc_key);

CREATE TABLE IF NOT EXISTS employee_leave_requests (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  leave_type           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'requested',
  starts_on            DATE NOT NULL,
  ends_on              DATE NOT NULL,
  reason               TEXT NOT NULL DEFAULT '',
  manager_notes        TEXT NOT NULL DEFAULT '',
  requested_by         TEXT NOT NULL DEFAULT 'manager',
  decided_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at           TIMESTAMPTZ,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_leave_type_chk
    CHECK (leave_type IN ('vacation', 'sick', 'parental', 'unpaid', 'other')),
  CONSTRAINT employee_leave_status_chk
    CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled', 'taken')),
  CONSTRAINT employee_leave_requested_by_chk
    CHECK (requested_by IN ('manager', 'employee')),
  CONSTRAINT employee_leave_dates_chk CHECK (ends_on >= starts_on),
  CONSTRAINT employee_leave_reason_len CHECK (char_length(reason) <= 2000),
  CONSTRAINT employee_leave_manager_notes_len CHECK (char_length(manager_notes) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_employee_leave_company_status_dates
  ON employee_leave_requests (company_id, status, starts_on ASC);

CREATE INDEX IF NOT EXISTS idx_employee_leave_candidate_dates
  ON employee_leave_requests (candidate_id, starts_on DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_employee_leave_company_range
  ON employee_leave_requests (company_id, starts_on, ends_on)
  WHERE status IN ('approved', 'taken', 'requested');

COMMENT ON TABLE candidate_dp_profiles IS
  'Light DP profile (emergency contact + address). Not eSocial.';
COMMENT ON TABLE employee_dp_documents IS
  'Admission document checklist with optional S3 attachment. Not legal GED.';
COMMENT ON TABLE employee_leave_requests IS
  'Vacation / leave requests for light DP. Not payroll time-off engine.';

INSERT INTO schema_migrations (name) VALUES ('083_employee_dp_light.sql')
ON CONFLICT (name) DO NOTHING;

-- 084 — Faixa de mercado no cargo + vínculo no colaborador (B-2711)
-- Migration 084: Market salary bands on job roles + employee role link (B-2711)
-- Manual market min/max on cargo; candidates.job_role_id for compare vs current pay.
-- Not payroll / eSocial / marketplace.

ALTER TABLE job_roles
  ADD COLUMN IF NOT EXISTS market_salary_min TEXT,
  ADD COLUMN IF NOT EXISTS market_salary_max TEXT;

COMMENT ON COLUMN job_roles.market_salary_min IS
  'Optional market floor (same TEXT salary shape as vacancies/compensation). Manual entry; not live survey.';
COMMENT ON COLUMN job_roles.market_salary_max IS
  'Optional market ceiling (same TEXT salary shape). Manual entry; not live survey.';

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS job_role_id BIGINT REFERENCES job_roles(id) ON DELETE SET NULL;

COMMENT ON COLUMN candidates.job_role_id IS
  'Optional job role for the person (employees). Used to compare current pay to role market band.';

CREATE INDEX IF NOT EXISTS idx_candidates_company_job_role
  ON candidates (company_id, job_role_id)
  WHERE job_role_id IS NOT NULL;


INSERT INTO schema_migrations (name) VALUES ('084_market_salary_bands.sql')
ON CONFLICT (name) DO NOTHING;

-- 085 — Mural da empresa + kudos (B-2712 / B-2716)
-- Migration 085: company feed posts + peer kudos

CREATE TABLE IF NOT EXISTS company_posts (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  body_html           TEXT NOT NULL DEFAULT '',
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_posts_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT company_posts_body_len CHECK (char_length(body_html) <= 20000)
);

CREATE INDEX IF NOT EXISTS idx_company_posts_company_created
  ON company_posts (company_id, created_at DESC)
  WHERE deleted = FALSE;

CREATE TABLE IF NOT EXISTS company_kudos (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  to_candidate_id      BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  message              TEXT NOT NULL,
  deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_kudos_message_len CHECK (char_length(message) BETWEEN 1 AND 280),
  CONSTRAINT company_kudos_not_self CHECK (from_candidate_id <> to_candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_company_kudos_company_created
  ON company_kudos (company_id, created_at DESC)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_company_kudos_to_created
  ON company_kudos (to_candidate_id, created_at DESC)
  WHERE deleted = FALSE;

INSERT INTO schema_migrations (name) VALUES ('085_company_feed_kudos.sql')
ON CONFLICT (name) DO NOTHING;

-- 086_interview_prep.sql
CREATE TABLE IF NOT EXISTS interview_prep_links (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vacancy_id           BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token                TEXT NOT NULL,
  prepared_at          TIMESTAMPTZ,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  CONSTRAINT interview_prep_links_token_len CHECK (char_length(token) BETWEEN 16 AND 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_prep_links_token
  ON interview_prep_links (token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_prep_links_vacancy_candidate
  ON interview_prep_links (vacancy_id, candidate_id);

CREATE INDEX IF NOT EXISTS idx_interview_prep_links_company
  ON interview_prep_links (company_id, created_at DESC);

INSERT INTO schema_migrations (name) VALUES ('086_interview_prep.sql')
ON CONFLICT (name) DO NOTHING;

-- 087_leave_balance.sql
CREATE TABLE IF NOT EXISTS employee_leave_balances (
  candidate_id         BIGINT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entitlement_days     NUMERIC(6,1) NOT NULL DEFAULT 30,
  adjustment_days      NUMERIC(6,1) NOT NULL DEFAULT 0,
  notes                TEXT NOT NULL DEFAULT '',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT employee_leave_balances_entitlement_chk
    CHECK (entitlement_days >= 0 AND entitlement_days <= 365),
  CONSTRAINT employee_leave_balances_adjustment_chk
    CHECK (adjustment_days >= -365 AND adjustment_days <= 365),
  CONSTRAINT employee_leave_balances_notes_len CHECK (char_length(notes) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_employee_leave_balances_company
  ON employee_leave_balances (company_id);

COMMENT ON TABLE employee_leave_balances IS
  'Manual vacation entitlement + adjustment; used/pending derived from employee_leave_requests. Not payroll.';

INSERT INTO schema_migrations (name) VALUES ('087_leave_balance.sql')
ON CONFLICT (name) DO NOTHING;

-- 088_dp_leave_polish.sql
ALTER TABLE employee_leave_balances
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE;

ALTER TABLE employee_leave_requests
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS file_key TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';

INSERT INTO schema_migrations (name) VALUES ('088_dp_leave_polish.sql')
ON CONFLICT (name) DO NOTHING;
-- 089 — Epic B-3000 pack (B-3001 calibration, B-3003 variable pay status, B-3004 light OKRs)
-- Idempotent. Salary map (B-3002) is read-only over existing job_roles + compensation.

-- B-3001: calibration fields on submitted reviews (overall + exploratory 9Box cell)
ALTER TABLE performance_reviews
  ADD COLUMN IF NOT EXISTS overall_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS nine_box_cell SMALLINT,
  ADD COLUMN IF NOT EXISTS calibrated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS calibrated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calibration_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE performance_reviews
  DROP CONSTRAINT IF EXISTS performance_reviews_overall_score_chk;
ALTER TABLE performance_reviews
  ADD CONSTRAINT performance_reviews_overall_score_chk
  CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100));

ALTER TABLE performance_reviews
  DROP CONSTRAINT IF EXISTS performance_reviews_nine_box_cell_chk;
ALTER TABLE performance_reviews
  ADD CONSTRAINT performance_reviews_nine_box_cell_chk
  CHECK (nine_box_cell IS NULL OR (nine_box_cell >= 1 AND nine_box_cell <= 9));

ALTER TABLE performance_reviews
  DROP CONSTRAINT IF EXISTS performance_reviews_calibration_notes_len;
ALTER TABLE performance_reviews
  ADD CONSTRAINT performance_reviews_calibration_notes_len
  CHECK (char_length(calibration_notes) <= 2000);

COMMENT ON COLUMN performance_reviews.overall_score IS
  'B-3001: overall 0–100 (derived on submit; RH may calibrate with audit).';
COMMENT ON COLUMN performance_reviews.nine_box_cell IS
  'B-3001: optional exploratory 9Box cell 1–9 from calibration (not a promotion label).';

-- B-3003: proposed/approved variable pay on compensation events
ALTER TABLE employee_compensation_events
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS source_review_id BIGINT REFERENCES performance_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_cycle_id BIGINT REFERENCES performance_cycles(id) ON DELETE SET NULL;

ALTER TABLE employee_compensation_events
  DROP CONSTRAINT IF EXISTS employee_compensation_events_approval_chk;
ALTER TABLE employee_compensation_events
  ADD CONSTRAINT employee_compensation_events_approval_chk
  CHECK (approval_status IN ('proposed', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_compensation_approval_company
  ON employee_compensation_events (company_id, approval_status, effective_date DESC)
  WHERE approval_status = 'proposed';

COMMENT ON COLUMN employee_compensation_events.approval_status IS
  'B-3003: proposed (from review) | approved | rejected. Legacy rows default approved.';

-- B-3004: light OKR tree (company → team group → person)
CREATE TABLE IF NOT EXISTS okr_objectives (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_id            BIGINT REFERENCES okr_objectives(id) ON DELETE CASCADE,
  level                TEXT NOT NULL DEFAULT 'company',
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  team_group_id        BIGINT REFERENCES team_groups(id) ON DELETE SET NULL,
  candidate_id         BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
  period_start         DATE,
  period_end           DATE,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT okr_objectives_level_chk CHECK (level IN ('company', 'team', 'person')),
  CONSTRAINT okr_objectives_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 300),
  CONSTRAINT okr_objectives_description_len CHECK (char_length(description) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_okr_objectives_company
  ON okr_objectives (company_id, level, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_okr_objectives_parent
  ON okr_objectives (company_id, parent_id)
  WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS okr_key_results (
  id                      BIGSERIAL PRIMARY KEY,
  company_id              BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  objective_id            BIGINT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  unit                    TEXT NOT NULL DEFAULT '',
  target_value            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  current_value           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  performance_goal_id     BIGINT REFERENCES performance_goals(id) ON DELETE SET NULL,
  sort_order              INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT okr_key_results_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 300),
  CONSTRAINT okr_key_results_unit_len CHECK (char_length(unit) <= 40)
);

CREATE INDEX IF NOT EXISTS idx_okr_key_results_objective
  ON okr_key_results (objective_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_okr_key_results_company
  ON okr_key_results (company_id, objective_id);

COMMENT ON TABLE okr_objectives IS
  'B-3004 light OKRs: company / team (saved group) / person. Cap enforced in lib.';
COMMENT ON TABLE okr_key_results IS
  'B-3004 numeric key results; optional link to performance_goals.';

INSERT INTO schema_migrations (name) VALUES ('089_b3000_pack.sql')
ON CONFLICT (name) DO NOTHING;

-- 090 — B-3005 ouvidoria, B-3006 organograma (manager), B-3010 feedback contínuo
-- Idempotent. Not climate, not kudos, not drag-drop reorg.

-- B-3006: reporting line on candidates (same-company + cycle checks in lib)
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS manager_candidate_id BIGINT REFERENCES candidates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_manager_company
  ON candidates (company_id, manager_candidate_id)
  WHERE manager_candidate_id IS NOT NULL;

COMMENT ON COLUMN candidates.manager_candidate_id IS
  'B-3006: direct manager (employee candidate in same company). Org chart reads this.';

-- B-3005: whistleblowing channel + reports (anonymous-capable; not climate)
CREATE TABLE IF NOT EXISTS whistleblowing_channels (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  token                TEXT NOT NULL,
  due_days             INT NOT NULL DEFAULT 15,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT whistleblowing_channels_title_len
    CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  CONSTRAINT whistleblowing_channels_due_days_chk
    CHECK (due_days >= 1 AND due_days <= 90),
  CONSTRAINT whistleblowing_channels_token_len
    CHECK (char_length(token) >= 24 AND char_length(token) <= 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whistleblowing_channels_token
  ON whistleblowing_channels (token)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_whistleblowing_channels_company
  ON whistleblowing_channels (company_id, created_at DESC)
  WHERE deleted = FALSE;

CREATE TABLE IF NOT EXISTS whistleblowing_reports (
  id                      BIGSERIAL PRIMARY KEY,
  company_id              BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_id              BIGINT NOT NULL REFERENCES whistleblowing_channels(id) ON DELETE CASCADE,
  category                TEXT NOT NULL,
  body                    TEXT NOT NULL,
  anonymous               BOOLEAN NOT NULL DEFAULT TRUE,
  reporter_candidate_id   BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'new',
  due_at                  TIMESTAMPTZ,
  triage_notes            TEXT NOT NULL DEFAULT '',
  response_notes          TEXT NOT NULL DEFAULT '',
  responded_at            TIMESTAMPTZ,
  responded_by_user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whistleblowing_reports_category_chk
    CHECK (category IN (
      'harassment', 'ethics', 'safety', 'discrimination', 'fraud', 'other'
    )),
  CONSTRAINT whistleblowing_reports_status_chk
    CHECK (status IN ('new', 'triaging', 'responded', 'closed')),
  CONSTRAINT whistleblowing_reports_body_len
    CHECK (char_length(btrim(body)) >= 20 AND char_length(body) <= 4000),
  CONSTRAINT whistleblowing_reports_triage_len
    CHECK (char_length(triage_notes) <= 2000),
  CONSTRAINT whistleblowing_reports_response_len
    CHECK (char_length(response_notes) <= 4000),
  CONSTRAINT whistleblowing_reports_anon_reporter_chk
    CHECK (
      (anonymous = TRUE AND reporter_candidate_id IS NULL)
      OR (anonymous = FALSE)
    )
);

CREATE INDEX IF NOT EXISTS idx_whistleblowing_reports_inbox
  ON whistleblowing_reports (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whistleblowing_reports_due
  ON whistleblowing_reports (company_id, due_at ASC)
  WHERE status IN ('new', 'triaging');

COMMENT ON TABLE whistleblowing_channels IS
  'B-3005: public token channel for reports. Not climate survey.';
COMMENT ON TABLE whistleblowing_reports IS
  'B-3005: reports. Anonymous = no reporter PII. RH triage with audit.';

-- B-3010: structured continuous feedback (ask / give) — not kudos / feed
CREATE TABLE IF NOT EXISTS feedback_requests (
  id                      BIGSERIAL PRIMARY KEY,
  company_id              BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject_candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  from_candidate_id       BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  to_candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  prompt                  TEXT NOT NULL DEFAULT '',
  token                   TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  response_text           TEXT NOT NULL DEFAULT '',
  answered_at             TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feedback_requests_status_chk
    CHECK (status IN ('pending', 'answered', 'cancelled', 'expired')),
  CONSTRAINT feedback_requests_prompt_len
    CHECK (char_length(prompt) <= 500),
  CONSTRAINT feedback_requests_response_len
    CHECK (char_length(response_text) <= 1000),
  CONSTRAINT feedback_requests_token_len
    CHECK (char_length(token) >= 24 AND char_length(token) <= 128),
  CONSTRAINT feedback_requests_not_self
    CHECK (from_candidate_id <> to_candidate_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_requests_token
  ON feedback_requests (token);

CREATE INDEX IF NOT EXISTS idx_feedback_requests_subject
  ON feedback_requests (company_id, subject_candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_requests_to_pending
  ON feedback_requests (company_id, to_candidate_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_requests_from_month
  ON feedback_requests (company_id, from_candidate_id, created_at DESC);

COMMENT ON TABLE feedback_requests IS
  'B-3010: request feedback about subject from to_candidate. Cap/month in lib. Not social feed.';

INSERT INTO schema_migrations (name) VALUES ('090_b3005_3006_3010.sql')
ON CONFLICT (name) DO NOTHING;

-- 091 time clock
-- 091: B-2721 digital time clock MVP (web punches + day mirror). Not payroll / eSocial / facial.

CREATE TABLE IF NOT EXISTS company_time_schedules (
  company_id           BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  workday_start        TIME NOT NULL DEFAULT '09:00',
  workday_end          TIME NOT NULL DEFAULT '18:00',
  break_minutes        INT NOT NULL DEFAULT 60,
  timezone             TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  late_grace_minutes   INT NOT NULL DEFAULT 10,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT company_time_schedules_break_chk
    CHECK (break_minutes >= 0 AND break_minutes <= 240),
  CONSTRAINT company_time_schedules_grace_chk
    CHECK (late_grace_minutes >= 0 AND late_grace_minutes <= 120),
  CONSTRAINT company_time_schedules_tz_len
    CHECK (char_length(timezone) >= 3 AND char_length(timezone) <= 64)
);

COMMENT ON TABLE company_time_schedules IS
  'B-2721: simple fixed shift per company for late/missing hints. Not a full rota engine.';

CREATE TABLE IF NOT EXISTS employee_time_punches (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  punched_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  punch_kind           TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'web',
  latitude             NUMERIC(9, 6),
  longitude            NUMERIC(9, 6),
  notes                TEXT NOT NULL DEFAULT '',
  flag                 TEXT,
  review_status        TEXT NOT NULL DEFAULT 'none',
  reviewed_at          TIMESTAMPTZ,
  reviewed_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_time_punches_kind_chk
    CHECK (punch_kind IN ('in', 'out')),
  CONSTRAINT employee_time_punches_source_chk
    CHECK (source IN ('web', 'manager')),
  CONSTRAINT employee_time_punches_flag_chk
    CHECK (flag IS NULL OR flag IN ('late', 'early_out', 'odd_pair', 'manual')),
  CONSTRAINT employee_time_punches_review_chk
    CHECK (review_status IN ('none', 'ok', 'flagged', 'adjusted')),
  CONSTRAINT employee_time_punches_notes_len
    CHECK (char_length(notes) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_time_punches_company_day
  ON employee_time_punches (company_id, punched_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_punches_candidate_day
  ON employee_time_punches (candidate_id, punched_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_punches_company_review
  ON employee_time_punches (company_id, review_status, punched_at DESC)
  WHERE review_status IN ('flagged', 'none');

COMMENT ON TABLE employee_time_punches IS
  'B-2721 MVP web/manager punches. Not facial, offline, or WhatsApp time clock.';

INSERT INTO schema_migrations (name) VALUES ('091_time_clock.sql')
ON CONFLICT (name) DO NOTHING;

-- 092 leave types
-- 092: Expand DP leave types (registrar ausência) — keep existing values valid.

ALTER TABLE employee_leave_requests
  DROP CONSTRAINT IF EXISTS employee_leave_type_chk;

ALTER TABLE employee_leave_requests
  ADD CONSTRAINT employee_leave_type_chk
  CHECK (leave_type IN (
    'vacation',
    'sick',
    'parental',
    'bereavement',
    'marriage',
    'medical_appointment',
    'compensatory',
    'unpaid',
    'other'
  ));

COMMENT ON COLUMN employee_leave_requests.leave_type IS
  'Closed taxonomy: vacation/sick/parental/bereavement/marriage/medical_appointment/compensatory/unpaid/other.';

INSERT INTO schema_migrations (name) VALUES ('092_dp_leave_types_expand.sql')
ON CONFLICT (name) DO NOTHING;

-- 093 cpf
-- 093: DP profile CPF (digits only; UI mask in PromptFormDialog).

ALTER TABLE candidate_dp_profiles
  ADD COLUMN IF NOT EXISTS cpf TEXT NOT NULL DEFAULT '';

ALTER TABLE candidate_dp_profiles
  DROP CONSTRAINT IF EXISTS candidate_dp_profiles_cpf_len;
ALTER TABLE candidate_dp_profiles
  ADD CONSTRAINT candidate_dp_profiles_cpf_len
  CHECK (char_length(cpf) <= 11);

COMMENT ON COLUMN candidate_dp_profiles.cpf IS
  'Optional CPF digits only (11). Not an identity proof / eSocial field.';

INSERT INTO schema_migrations (name) VALUES ('093_dp_profile_cpf.sql')
ON CONFLICT (name) DO NOTHING;

-- 094 lms quiz
-- 094: LMS depth (B-2713) — light quiz per lesson + cohort report support.
-- Certificate is print HTML (no blob storage). Not SCORM.

CREATE TABLE IF NOT EXISTS lms_lesson_quiz_questions (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lesson_id            BIGINT NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  prompt               TEXT NOT NULL,
  choices              JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_choice_id    TEXT NOT NULL,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lms_quiz_prompt_len CHECK (char_length(btrim(prompt)) >= 1 AND char_length(prompt) <= 500),
  CONSTRAINT lms_quiz_correct_len CHECK (char_length(correct_choice_id) >= 1 AND char_length(correct_choice_id) <= 40),
  CONSTRAINT lms_quiz_sort_chk CHECK (sort_order >= 0 AND sort_order <= 20)
);

CREATE INDEX IF NOT EXISTS idx_lms_quiz_questions_lesson
  ON lms_lesson_quiz_questions (lesson_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_lms_quiz_questions_company
  ON lms_lesson_quiz_questions (company_id, lesson_id);

COMMENT ON TABLE lms_lesson_quiz_questions IS
  'B-2713: 1–5 MC questions per lesson. choices JSON [{id,text}].';

CREATE TABLE IF NOT EXISTS lms_lesson_quiz_attempts (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enrollment_id        BIGINT NOT NULL REFERENCES lms_enrollments(id) ON DELETE CASCADE,
  lesson_id            BIGINT NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  answers              JSONB NOT NULL DEFAULT '{}'::jsonb,
  correct_count        INT NOT NULL DEFAULT 0,
  total_count          INT NOT NULL DEFAULT 0,
  passed               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lms_quiz_attempt_counts_chk
    CHECK (correct_count >= 0 AND total_count >= 0 AND correct_count <= total_count AND total_count <= 5)
);

CREATE INDEX IF NOT EXISTS idx_lms_quiz_attempts_enroll_lesson
  ON lms_lesson_quiz_attempts (enrollment_id, lesson_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lms_quiz_attempts_pass_once
  ON lms_lesson_quiz_attempts (enrollment_id, lesson_id)
  WHERE passed = TRUE;

COMMENT ON TABLE lms_lesson_quiz_attempts IS
  'B-2713: quiz attempts. Passed row unique per enrollment+lesson (gate complete lesson).';

INSERT INTO schema_migrations (name) VALUES ('094_lms_quiz_cert.sql')
ON CONFLICT (name) DO NOTHING;

-- 095 lms watch
-- 095: LMS watch progress (B-2717) — resume YouTube/Vimeo position per enrollment+lesson.
-- Not SCORM; no auto-complete by % watched.

CREATE TABLE IF NOT EXISTS lms_lesson_watch_progress (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enrollment_id        BIGINT NOT NULL REFERENCES lms_enrollments(id) ON DELETE CASCADE,
  lesson_id            BIGINT NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  position_sec         INT NOT NULL DEFAULT 0,
  duration_sec         INT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lms_watch_position_chk CHECK (position_sec >= 0 AND position_sec <= 172800),
  CONSTRAINT lms_watch_duration_chk CHECK (duration_sec >= 0 AND duration_sec <= 172800),
  CONSTRAINT lms_watch_enroll_lesson_uq UNIQUE (enrollment_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_watch_progress_enrollment
  ON lms_lesson_watch_progress (enrollment_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lms_watch_progress_company
  ON lms_lesson_watch_progress (company_id, lesson_id);

COMMENT ON TABLE lms_lesson_watch_progress IS
  'B-2717: resume position (seconds) for youtube/vimeo lessons. PDF/link ignored.';

INSERT INTO schema_migrations (name) VALUES ('095_lms_watch_progress.sql')
ON CONFLICT (name) DO NOTHING;

-- 096: OKR cycles → areas → activities (phase 1)
-- Named cycle with start/end; areas under cycle; activities with progress % + deadline.
-- Does not remove light OKR tables; UI prefers this model.

CREATE TABLE IF NOT EXISTS okr_cycles (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  starts_on            DATE NOT NULL,
  ends_on              DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT okr_cycles_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  CONSTRAINT okr_cycles_dates_chk CHECK (ends_on >= starts_on),
  CONSTRAINT okr_cycles_status_chk CHECK (status IN ('active', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_okr_cycles_company
  ON okr_cycles (company_id, status, starts_on DESC, id DESC);

CREATE TABLE IF NOT EXISTS okr_areas (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cycle_id             BIGINT NOT NULL REFERENCES okr_cycles(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  sort_order           INT NOT NULL DEFAULT 0,
  team_group_id        BIGINT REFERENCES team_groups(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT okr_areas_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_okr_areas_cycle
  ON okr_areas (cycle_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_okr_areas_company
  ON okr_areas (company_id, cycle_id);

CREATE TABLE IF NOT EXISTS okr_activities (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  area_id              BIGINT NOT NULL REFERENCES okr_areas(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  progress_pct         INT NOT NULL DEFAULT 0,
  deadline             DATE,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT okr_activities_title_len CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 300),
  CONSTRAINT okr_activities_pct_chk CHECK (progress_pct >= 0 AND progress_pct <= 100)
);

CREATE INDEX IF NOT EXISTS idx_okr_activities_area
  ON okr_activities (area_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_okr_activities_company
  ON okr_activities (company_id, area_id);

CREATE INDEX IF NOT EXISTS idx_okr_activities_deadline
  ON okr_activities (company_id, deadline)
  WHERE deadline IS NOT NULL;

COMMENT ON TABLE okr_cycles IS
  'OKR phase 1: named cycle (e.g. 2026 H1) with start/end. Areas+activities roll up progress.';
COMMENT ON TABLE okr_areas IS
  'OKR phase 1: area under a cycle. Progress = mean of activity progress_pct.';
COMMENT ON TABLE okr_activities IS
  'OKR phase 1: activity with 0–100% and optional deadline (urgency in UI).';

INSERT INTO schema_migrations (name) VALUES ('096_okr_cycles.sql')
ON CONFLICT (name) DO NOTHING;

-- 097: OKR activity assignees
CREATE TABLE IF NOT EXISTS okr_activity_assignees (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  activity_id          BIGINT NOT NULL REFERENCES okr_activities(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  assigned_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT okr_activity_assignees_uq UNIQUE (activity_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_okr_assignees_candidate
  ON okr_activity_assignees (company_id, candidate_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_okr_assignees_activity
  ON okr_activity_assignees (activity_id, candidate_id);

COMMENT ON TABLE okr_activity_assignees IS
  'OKR: people linked to an activity. Employee hub lists by candidate_id; notify on insert.';

INSERT INTO schema_migrations (name) VALUES ('097_okr_activity_assignees.sql')
ON CONFLICT (name) DO NOTHING;

-- 098: OKR activity weight + check-ins
ALTER TABLE okr_activities
  ADD COLUMN IF NOT EXISTS weight INT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'okr_activities_weight_chk'
  ) THEN
    ALTER TABLE okr_activities
      ADD CONSTRAINT okr_activities_weight_chk
      CHECK (weight >= 1 AND weight <= 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS okr_activity_checkins (
  id                         BIGSERIAL PRIMARY KEY,
  company_id                 BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  activity_id                BIGINT NOT NULL REFERENCES okr_activities(id) ON DELETE CASCADE,
  progress_pct               INT NOT NULL,
  note                       TEXT NOT NULL DEFAULT '',
  created_by_user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_candidate_id    BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT okr_activity_checkins_pct_chk
    CHECK (progress_pct >= 0 AND progress_pct <= 100),
  CONSTRAINT okr_activity_checkins_note_len
    CHECK (char_length(note) <= 500),
  CONSTRAINT okr_activity_checkins_actor_chk
    CHECK (
      created_by_user_id IS NOT NULL
      OR created_by_candidate_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_okr_checkins_activity
  ON okr_activity_checkins (activity_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_okr_checkins_company
  ON okr_activity_checkins (company_id, created_at DESC);

INSERT INTO schema_migrations (name) VALUES ('098_okr_weights_checkins.sql')
ON CONFLICT (name) DO NOTHING;
-- 099: B-2722 hour bank / compensatory time on top of digital time clock.
-- Company toggle + ledger (manual + derived from punches). Not payroll / eSocial.

ALTER TABLE company_time_schedules
  ADD COLUMN IF NOT EXISTS hour_bank_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE company_time_schedules
  ADD COLUMN IF NOT EXISTS hour_bank_max_minutes INT NOT NULL DEFAULT 2400;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_time_schedules_bank_max_chk'
  ) THEN
    ALTER TABLE company_time_schedules
      ADD CONSTRAINT company_time_schedules_bank_max_chk
      CHECK (hour_bank_max_minutes >= 0 AND hour_bank_max_minutes <= 20000);
  END IF;
END $$;

COMMENT ON COLUMN company_time_schedules.hour_bank_enabled IS
  'B-2722: when true, RH can post hour-bank entries and generate overtime from punches.';
COMMENT ON COLUMN company_time_schedules.hour_bank_max_minutes IS
  'Soft cap on approved balance minutes (default 2400 = 40h). Block credits that would exceed.';

CREATE TABLE IF NOT EXISTS employee_hour_bank_entries (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  entry_kind           TEXT NOT NULL,
  minutes              INT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  source               TEXT NOT NULL DEFAULT 'manual',
  work_on              DATE NOT NULL,
  note                 TEXT NOT NULL DEFAULT '',
  dedupe_key           TEXT,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_candidate_id BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
  decided_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_hour_bank_kind_chk
    CHECK (entry_kind IN ('credit', 'debit')),
  CONSTRAINT employee_hour_bank_minutes_chk
    CHECK (minutes >= 1 AND minutes <= 1440),
  CONSTRAINT employee_hour_bank_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT employee_hour_bank_source_chk
    CHECK (source IN ('manual', 'time_clock', 'employee')),
  CONSTRAINT employee_hour_bank_note_len
    CHECK (char_length(note) <= 500),
  CONSTRAINT employee_hour_bank_actor_chk
    CHECK (
      created_by_user_id IS NOT NULL
      OR created_by_candidate_id IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hour_bank_dedupe
  ON employee_hour_bank_entries (company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hour_bank_company_status
  ON employee_hour_bank_entries (company_id, status, work_on DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_hour_bank_candidate
  ON employee_hour_bank_entries (company_id, candidate_id, work_on DESC, id DESC);

COMMENT ON TABLE employee_hour_bank_entries IS
  'B-2722: hour-bank ledger. Balance = approved credits − approved debits. Not payslip.';

INSERT INTO schema_migrations (name) VALUES ('099_hour_bank.sql')
ON CONFLICT (name) DO NOTHING;
-- 100: B-2724 admission document acknowledgment / internal e-sign (not ICP / provider GED).
-- Typed-name consent + audit fields on employee_dp_documents.

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signature_status TEXT NOT NULL DEFAULT 'none';

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signature_requested_at TIMESTAMPTZ;

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signature_requested_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signer_name TEXT NOT NULL DEFAULT '';

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signer_ip TEXT;

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signer_user_agent TEXT;

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signature_consent_version TEXT NOT NULL DEFAULT '';

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signature_file_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_dp_documents_sig_status_chk'
  ) THEN
    ALTER TABLE employee_dp_documents
      ADD CONSTRAINT employee_dp_documents_sig_status_chk
      CHECK (signature_status IN ('none', 'requested', 'signed', 'waived'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_dp_documents_signer_name_len'
  ) THEN
    ALTER TABLE employee_dp_documents
      ADD CONSTRAINT employee_dp_documents_signer_name_len
      CHECK (char_length(signer_name) <= 120);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_dp_documents_sig_consent_len'
  ) THEN
    ALTER TABLE employee_dp_documents
      ADD CONSTRAINT employee_dp_documents_sig_consent_len
      CHECK (char_length(signature_consent_version) <= 40);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_dp_docs_sig_pending
  ON employee_dp_documents (company_id, signature_status, updated_at DESC)
  WHERE signature_status = 'requested';

COMMENT ON COLUMN employee_dp_documents.signature_status IS
  'B-2724: none|requested|signed|waived. Internal typed-name acknowledgment — not ICP-Brasil / partner e-sign.';

INSERT INTO schema_migrations (name) VALUES ('100_dp_document_signature.sql')
ON CONFLICT (name) DO NOTHING;

-- 101: B-2724 store drawn signature stroke (PNG data URL) with typed-name ack.
-- Still internal acknowledgment — not ICP-Brasil / partner e-sign.

ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS signer_stroke_png TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_dp_documents_stroke_png_len'
  ) THEN
    ALTER TABLE employee_dp_documents
      ADD CONSTRAINT employee_dp_documents_stroke_png_len
      CHECK (char_length(signer_stroke_png) <= 200000);
  END IF;
END $$;

COMMENT ON COLUMN employee_dp_documents.signer_stroke_png IS
  'B-2724: PNG data URL of drawn stroke (mouse/touch). Cap 200k chars. Not ICP.';

INSERT INTO schema_migrations (name) VALUES ('101_dp_signature_stroke.sql')
ON CONFLICT (name) DO NOTHING;
-- 102: P0 jornada gaps — LMS trail by job role, experience decision fields,
-- configurable pre-onboarding template.

-- ── LMS: cargo → cursos (trilha) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_job_role_courses (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_role_id     BIGINT NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
  course_id       BIGINT NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  sort_order      INT NOT NULL DEFAULT 0,
  mandatory       BOOLEAN NOT NULL DEFAULT TRUE,
  due_offset_days INT NOT NULL DEFAULT 30
    CHECK (due_offset_days BETWEEN 1 AND 365),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lms_job_role_courses_unique UNIQUE (job_role_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_job_role_courses_co
  ON lms_job_role_courses (company_id, job_role_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_lms_job_role_courses_course
  ON lms_job_role_courses (company_id, course_id);

COMMENT ON TABLE lms_job_role_courses IS
  'P0: ordered LMS trail per job role (mandatory/recommended + due offset days).';

-- ── Experiência: prorrogação tipada + outcome terminate ────────────────────
ALTER TABLE employee_onboarding_checkins
  ADD COLUMN IF NOT EXISTS extend_days INT;

ALTER TABLE employee_onboarding_checkins
  DROP CONSTRAINT IF EXISTS employee_onboarding_checkins_outcome_chk;

ALTER TABLE employee_onboarding_checkins
  ADD CONSTRAINT employee_onboarding_checkins_outcome_chk
  CHECK (outcome IN (
    '', 'continue', 'develop', 'concern', 'pass', 'fail', 'extend', 'terminate'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_onboarding_checkins_extend_days_chk'
  ) THEN
    ALTER TABLE employee_onboarding_checkins
      ADD CONSTRAINT employee_onboarding_checkins_extend_days_chk
      CHECK (extend_days IS NULL OR (extend_days BETWEEN 1 AND 180));
  END IF;
END $$;

COMMENT ON COLUMN employee_onboarding_checkins.extend_days IS
  'P0: when outcome=extend, days added to later pending milestones.';
COMMENT ON COLUMN employee_onboarding_checkins.outcome IS
  'B-2705+P0: continue|develop|concern|pass|fail|extend|terminate (empty ok).';

-- ── Pré-onboarding: template por empresa ───────────────────────────────────
CREATE TABLE IF NOT EXISTS company_pre_onboarding_templates (
  id               BIGSERIAL PRIMARY KEY,
  company_id       BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_key         TEXT NOT NULL,
  label_pt         TEXT NOT NULL DEFAULT '',
  label_en         TEXT NOT NULL DEFAULT '',
  owner_role       TEXT NOT NULL DEFAULT 'rh',
  sort_order       INT NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  due_offset_days  INT NOT NULL DEFAULT 0
    CHECK (due_offset_days BETWEEN 0 AND 90),
  require_meet     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_pre_onboarding_templates_key_fmt
    CHECK (item_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  CONSTRAINT company_pre_onboarding_templates_owner_chk
    CHECK (owner_role IN ('rh', 'manager', 'it', 'security', 'employee')),
  CONSTRAINT company_pre_onboarding_templates_unique
    UNIQUE (company_id, item_key),
  CONSTRAINT company_pre_onboarding_templates_label_pt_len
    CHECK (char_length(label_pt) <= 120),
  CONSTRAINT company_pre_onboarding_templates_label_en_len
    CHECK (char_length(label_en) <= 120)
);

CREATE INDEX IF NOT EXISTS idx_company_pre_onboarding_tpl_co
  ON company_pre_onboarding_templates (company_id, active, sort_order ASC, id ASC);

COMMENT ON TABLE company_pre_onboarding_templates IS
  'P0: company D1 checklist template (owner role + labels). Seeds employee_pre_onboarding_items.';

ALTER TABLE employee_pre_onboarding_items
  DROP CONSTRAINT IF EXISTS employee_pre_onboarding_item_key_chk;

ALTER TABLE employee_pre_onboarding_items
  ADD CONSTRAINT employee_pre_onboarding_item_key_chk
  CHECK (item_key ~ '^[a-z][a-z0-9_]{1,40}$');

ALTER TABLE employee_pre_onboarding_items
  ADD COLUMN IF NOT EXISTS owner_role TEXT NOT NULL DEFAULT 'rh';

ALTER TABLE employee_pre_onboarding_items
  ADD COLUMN IF NOT EXISTS label_snapshot TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_pre_onboarding_owner_chk'
  ) THEN
    ALTER TABLE employee_pre_onboarding_items
      ADD CONSTRAINT employee_pre_onboarding_owner_chk
      CHECK (owner_role IN ('rh', 'manager', 'it', 'security', 'employee'));
  END IF;
END $$;

INSERT INTO schema_migrations (name) VALUES ('102_journey_p0_trail_experience_onboarding.sql')
ON CONFLICT (name) DO NOTHING;

-- ── 103: require_meet on D1 instances ─────────────────────────────────────
ALTER TABLE employee_pre_onboarding_items
  ADD COLUMN IF NOT EXISTS require_meet BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO schema_migrations (name) VALUES ('103_pre_onboarding_require_meet.sql')
ON CONFLICT (name) DO NOTHING;

-- ── 104: OKR weight 0–10 ──────────────────────────────────────────────────
UPDATE okr_activities
   SET weight = LEAST(10, GREATEST(0, COALESCE(weight, 5)))
 WHERE weight < 0 OR weight > 10;

ALTER TABLE okr_activities DROP CONSTRAINT IF EXISTS okr_activities_weight_chk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'okr_activities_weight_chk'
  ) THEN
    ALTER TABLE okr_activities
      ADD CONSTRAINT okr_activities_weight_chk
      CHECK (weight >= 0 AND weight <= 10);
  END IF;
END $$;

ALTER TABLE okr_activities ALTER COLUMN weight SET DEFAULT 5;

COMMENT ON COLUMN okr_activities.weight IS
  'Relative weight 0–10 for area/cycle rollup (0 skipped; 10 most important; default 5).';

INSERT INTO schema_migrations (name) VALUES ('104_okr_weight_0_10.sql')
ON CONFLICT (name) DO NOTHING;


-- 105: candidates.created_by_user_id
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_created_by
  ON candidates (company_id, created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('105_candidates_created_by.sql')
ON CONFLICT (name) DO NOTHING;

-- 106: Climate survey archive + version lineage (B-RH2-16)
ALTER TABLE climate_surveys
  DROP CONSTRAINT IF EXISTS climate_surveys_status_chk;

ALTER TABLE climate_surveys
  ADD CONSTRAINT climate_surveys_status_chk
  CHECK (status IN ('draft', 'open', 'closed', 'archived'));

ALTER TABLE climate_surveys
  ADD COLUMN IF NOT EXISTS source_survey_id BIGINT REFERENCES climate_surveys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_climate_surveys_company_status
  ON climate_surveys (company_id, status, updated_at DESC)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_climate_surveys_source
  ON climate_surveys (company_id, source_survey_id)
  WHERE source_survey_id IS NOT NULL AND deleted = FALSE;

INSERT INTO schema_migrations (name) VALUES ('106_climate_survey_archive.sql')
ON CONFLICT (name) DO NOTHING;

-- 107: Employee benefit assignments (B-RH2-14)
CREATE TABLE IF NOT EXISTS employee_benefit_assignments (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  benefit_id           BIGINT NOT NULL REFERENCES company_benefits(id) ON DELETE RESTRICT,
  value_note           TEXT NOT NULL DEFAULT '',
  starts_on            DATE NOT NULL DEFAULT (CURRENT_DATE),
  ends_on              DATE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_benefit_assignments_value_note_len
    CHECK (char_length(value_note) <= 500),
  CONSTRAINT employee_benefit_assignments_dates_chk
    CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_benefit_active
  ON employee_benefit_assignments (company_id, candidate_id, benefit_id)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_employee_benefit_candidate
  ON employee_benefit_assignments (company_id, candidate_id, active, starts_on DESC);

CREATE INDEX IF NOT EXISTS idx_employee_benefit_benefit
  ON employee_benefit_assignments (company_id, benefit_id, active)
  WHERE active = TRUE;

INSERT INTO schema_migrations (name) VALUES ('107_employee_benefit_assignments.sql')
ON CONFLICT (name) DO NOTHING;

-- 108: Formal competency reviews (B-RH2-15)
-- 108: Formal competency reviews (B-RH2-15)
-- Separate from light performance_cycles (goals → PDI). Likert 1–5 by competency.
-- Models: 90 (manager), 180 (+ upward), 360 (+ external). Optional self on any model.

CREATE TABLE IF NOT EXISTS company_competencies (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_competencies_name_len
    CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 200),
  CONSTRAINT company_competencies_description_len
    CHECK (char_length(description) <= 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_competencies_name_lower
  ON company_competencies (company_id, LOWER(btrim(name)))
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_company_competencies_company
  ON company_competencies (company_id, active, name ASC);

COMMENT ON TABLE company_competencies IS
  'B-RH2-15: company competency catalog for formal reviews (Likert).';

CREATE TABLE IF NOT EXISTS job_role_competencies (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_role_id          BIGINT NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
  competency_id        BIGINT NOT NULL REFERENCES company_competencies(id) ON DELETE CASCADE,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_role_id, competency_id)
);

CREATE INDEX IF NOT EXISTS idx_job_role_competencies_role
  ON job_role_competencies (job_role_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_job_role_competencies_company
  ON job_role_competencies (company_id, job_role_id);

COMMENT ON TABLE job_role_competencies IS
  'B-RH2-15: default competencies suggested from a job role into a formal review.';

CREATE TABLE IF NOT EXISTS formal_review_cycles (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  model                TEXT NOT NULL DEFAULT '90',
  include_self         BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL DEFAULT 'draft',
  period_start         DATE,
  period_end           DATE,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT formal_review_cycles_title_len
    CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  CONSTRAINT formal_review_cycles_description_len
    CHECK (char_length(description) <= 4000),
  CONSTRAINT formal_review_cycles_model_chk
    CHECK (model IN ('90', '180', '360')),
  CONSTRAINT formal_review_cycles_status_chk
    CHECK (status IN ('draft', 'open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_formal_review_cycles_company
  ON formal_review_cycles (company_id, status, updated_at DESC);

COMMENT ON TABLE formal_review_cycles IS
  'B-RH2-15: formal competency review cycle. model 90/180/360; include_self optional.';

CREATE TABLE IF NOT EXISTS formal_reviews (
  id                     BIGSERIAL PRIMARY KEY,
  cycle_id               BIGINT NOT NULL REFERENCES formal_review_cycles(id) ON DELETE CASCADE,
  company_id             BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject_candidate_id   BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  manager_user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  job_role_id            BIGINT REFERENCES job_roles(id) ON DELETE SET NULL,
  status                 TEXT NOT NULL DEFAULT 'draft',
  finalized_at           TIMESTAMPTZ,
  sent_at                TIMESTAMPTZ,
  archived_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, subject_candidate_id),
  CONSTRAINT formal_reviews_status_chk
    CHECK (status IN ('draft', 'collecting', 'finalized', 'sent', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_formal_reviews_cycle
  ON formal_reviews (cycle_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_formal_reviews_subject
  ON formal_reviews (company_id, subject_candidate_id, status);

COMMENT ON TABLE formal_reviews IS
  'B-RH2-15: one formal package per subject in a cycle. After finalized: send or archive; no edit.';

CREATE TABLE IF NOT EXISTS formal_review_items (
  id                   BIGSERIAL PRIMARY KEY,
  review_id            BIGINT NOT NULL REFERENCES formal_reviews(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  competency_id        BIGINT REFERENCES company_competencies(id) ON DELETE SET NULL,
  label                TEXT NOT NULL,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT formal_review_items_label_len
    CHECK (char_length(btrim(label)) >= 1 AND char_length(label) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_formal_review_items_review
  ON formal_review_items (review_id, sort_order ASC, id ASC);

COMMENT ON TABLE formal_review_items IS
  'B-RH2-15: competency rows on a review (label snapshot; optional catalog link).';

CREATE TABLE IF NOT EXISTS formal_review_raters (
  id                   BIGSERIAL PRIMARY KEY,
  review_id            BIGINT NOT NULL REFERENCES formal_reviews(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL,
  user_id              BIGINT REFERENCES users(id) ON DELETE SET NULL,
  candidate_id         BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
  external_name        TEXT NOT NULL DEFAULT '',
  external_email       TEXT NOT NULL DEFAULT '',
  external_title       TEXT NOT NULL DEFAULT '',
  token                TEXT,
  token_expires_at     TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'pending',
  submitted_at         TIMESTAMPTZ,
  overall_notes        TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT formal_review_raters_role_chk
    CHECK (role IN ('manager', 'upward', 'self', 'external')),
  CONSTRAINT formal_review_raters_status_chk
    CHECK (status IN ('pending', 'submitted', 'expired')),
  CONSTRAINT formal_review_raters_external_name_len
    CHECK (char_length(external_name) <= 200),
  CONSTRAINT formal_review_raters_external_email_len
    CHECK (char_length(external_email) <= 320),
  CONSTRAINT formal_review_raters_external_title_len
    CHECK (char_length(external_title) <= 200),
  CONSTRAINT formal_review_raters_notes_len
    CHECK (char_length(overall_notes) <= 4000),
  CONSTRAINT formal_review_raters_token_len
    CHECK (token IS NULL OR (char_length(token) >= 16 AND char_length(token) <= 128))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_formal_review_raters_token
  ON formal_review_raters (token)
  WHERE token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_formal_review_raters_role
  ON formal_review_raters (review_id, role);

CREATE INDEX IF NOT EXISTS idx_formal_review_raters_review
  ON formal_review_raters (review_id, role, status);

COMMENT ON TABLE formal_review_raters IS
  'B-RH2-15: manager (dashboard), upward/self/external (token). Always nominal.';

CREATE TABLE IF NOT EXISTS formal_review_scores (
  id                   BIGSERIAL PRIMARY KEY,
  rater_id             BIGINT NOT NULL REFERENCES formal_review_raters(id) ON DELETE CASCADE,
  item_id              BIGINT NOT NULL REFERENCES formal_review_items(id) ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  score                SMALLINT NOT NULL,
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rater_id, item_id),
  CONSTRAINT formal_review_scores_score_chk
    CHECK (score >= 1 AND score <= 5),
  CONSTRAINT formal_review_scores_notes_len
    CHECK (char_length(notes) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_formal_review_scores_rater
  ON formal_review_scores (rater_id);

CREATE INDEX IF NOT EXISTS idx_formal_review_scores_item
  ON formal_review_scores (item_id);

COMMENT ON TABLE formal_review_scores IS
  'B-RH2-15: Likert 1–5 per rater × competency item.';

INSERT INTO schema_migrations (name) VALUES ('108_formal_competency_reviews.sql')
ON CONFLICT (name) DO NOTHING;
-- 109: Company module entitlements (commercial packs / early-adopter onboarding)
-- NULL enabled_modules = all modules (legacy tenants). Non-null = only listed keys (+ core forced in app).

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[];

COMMENT ON COLUMN companies.enabled_modules IS
  'B-modules: nullable = all modules enabled (legacy). Non-null = allow-list of module keys (core always implied in app).';

CREATE INDEX IF NOT EXISTS idx_companies_enabled_modules_gin
  ON companies USING GIN (enabled_modules)
  WHERE enabled_modules IS NOT NULL AND deleted = FALSE;

INSERT INTO schema_migrations (name) VALUES ('109_company_module_entitlements.sql')
ON CONFLICT (name) DO NOTHING;

-- 111: modelos de funil e snapshot por vaga. Fonte canônica:
-- migrations/111_vacancy_pipeline_templates.sql
CREATE TABLE IF NOT EXISTS pipeline_templates (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pipeline_templates_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_templates_company_name
  ON pipeline_templates (company_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_templates_company_default
  ON pipeline_templates (company_id) WHERE is_default = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pipeline_templates_company
  ON pipeline_templates (company_id, created_at ASC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS pipeline_template_stages (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES pipeline_templates(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  label_pt TEXT NOT NULL,
  label_en TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  sort_order INT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (template_id, stage_key),
  CONSTRAINT pipeline_template_stages_key_fmt CHECK (stage_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT pipeline_template_stages_canonical_check CHECK (canonical_key IN ('new','interview','test_completed','screening','approved','hired','rejected','archived')),
  CONSTRAINT pipeline_template_stages_label_pt_len CHECK (char_length(btrim(label_pt)) BETWEEN 1 AND 60),
  CONSTRAINT pipeline_template_stages_label_en_len CHECK (char_length(btrim(label_en)) BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_template_stages_order
  ON pipeline_template_stages (template_id, sort_order ASC, id ASC);
CREATE TABLE IF NOT EXISTS vacancy_pipeline_stages (
  id BIGSERIAL PRIMARY KEY,
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  label_pt TEXT NOT NULL,
  label_en TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  sort_order INT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vacancy_id, stage_key),
  CONSTRAINT vacancy_pipeline_stages_key_fmt CHECK (stage_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT vacancy_pipeline_stages_canonical_check CHECK (canonical_key IN ('new','interview','test_completed','screening','approved','hired','rejected','archived')),
  CONSTRAINT vacancy_pipeline_stages_label_pt_len CHECK (char_length(btrim(label_pt)) BETWEEN 1 AND 60),
  CONSTRAINT vacancy_pipeline_stages_label_en_len CHECK (char_length(btrim(label_en)) BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS idx_vacancy_pipeline_stages_order
  ON vacancy_pipeline_stages (vacancy_id, sort_order ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_vacancy_pipeline_stages_tenant
  ON vacancy_pipeline_stages (company_id, vacancy_id);
ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS pipeline_template_id BIGINT REFERENCES pipeline_templates(id) ON DELETE SET NULL;
INSERT INTO schema_migrations (name) VALUES ('111_vacancy_pipeline_templates.sql')
ON CONFLICT (name) DO NOTHING;

-- 112: remuneração como módulo sensível próprio; preserva acesso dos tenants já restritos.
UPDATE companies
SET enabled_modules = array_append(enabled_modules, 'compensation')
WHERE enabled_modules IS NOT NULL
  AND 'core' = ANY(enabled_modules)
  AND NOT ('compensation' = ANY(enabled_modules));
COMMENT ON COLUMN companies.enabled_modules IS
  'Nullable legacy unrestricted marker. Non-null is an explicit module allow-list; empty input normalizes to core-only.';
INSERT INTO schema_migrations (name) VALUES ('112_compensation_module_entitlement.sql')
ON CONFLICT (name) DO NOTHING;
-- 113: Recruiting workspace ownership and saved views
ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vacancies_company_owner_active
  ON vacancies (company_id, owner_user_id, status, created_at DESC) WHERE deleted = FALSE;
CREATE TABLE IF NOT EXISTS recruiting_candidate_assignments (
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vacancy_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_recruiting_candidate_assignments_owner
  ON recruiting_candidate_assignments (company_id, owner_user_id, vacancy_id)
  WHERE owner_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS recruiting_saved_views (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacancy_id BIGINT REFERENCES vacancies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recruiting_saved_views_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiting_saved_views_scope_name
  ON recruiting_saved_views (company_id, user_id, COALESCE(vacancy_id, 0), lower(name));
CREATE INDEX IF NOT EXISTS idx_recruiting_saved_views_user
  ON recruiting_saved_views (company_id, user_id, updated_at DESC);
INSERT INTO schema_migrations (name) VALUES ('113_recruiting_workspace.sql')
ON CONFLICT (name) DO NOTHING;

-- 114: descrição opcional unificada para aulas LMS por vídeo/link ou PDF.
ALTER TABLE lms_lessons
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
COMMENT ON COLUMN lms_lessons.description IS
  'Optional sanitized lesson description shown with the lesson content.';
INSERT INTO schema_migrations (name) VALUES ('114_lms_lesson_description.sql')
ON CONFLICT (name) DO NOTHING;

-- 115: associações employer multiempresa (fase expand-only).
CREATE TABLE IF NOT EXISTS user_company_memberships (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_company_memberships_user_company_unique UNIQUE (user_id, company_id),
  CONSTRAINT user_company_memberships_role_check
    CHECK (role IN ('admin', 'direction', 'hr')),
  CONSTRAINT user_company_memberships_lifecycle_check
    CHECK (deleted = FALSE OR active = FALSE)
);
COMMENT ON TABLE user_company_memberships IS
  'Expand-only manager-to-company associations. Legacy users.company_id/role remain authoritative until a later gated migration.';
COMMENT ON COLUMN user_company_memberships.role IS
  'Manager role inside this company; may differ across memberships for the same identity.';
CREATE INDEX IF NOT EXISTS idx_user_company_memberships_company_active
  ON user_company_memberships (company_id, role, user_id)
  WHERE active = TRUE AND deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_user_company_memberships_user_active
  ON user_company_memberships (user_id, company_id)
  WHERE active = TRUE AND deleted = FALSE;
INSERT INTO user_company_memberships (
  user_id,
  company_id,
  role,
  active,
  deleted
)
SELECT
  u.id,
  u.company_id,
  u.role,
  (u.active = TRUE AND u.deleted = FALSE),
  u.deleted
FROM users u
WHERE u.company_id IS NOT NULL
ON CONFLICT (user_id, company_id) DO NOTHING;
INSERT INTO schema_migrations (name) VALUES ('115_user_company_memberships.sql')
ON CONFLICT (name) DO NOTHING;

-- 116: sessões mobile revogáveis com refresh token rotativo e hash persistido.
CREATE TABLE IF NOT EXISTS mobile_refresh_sessions (
  id BIGSERIAL PRIMARY KEY,
  family_id UUID NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id BIGINT NOT NULL REFERENCES user_company_memberships(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  session_version INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  replaced_by_id BIGINT REFERENCES mobile_refresh_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT mobile_refresh_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT mobile_refresh_sessions_lifecycle_check
    CHECK (NOT (rotated_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_mobile_refresh_sessions_family_active
  ON mobile_refresh_sessions (family_id, id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mobile_refresh_sessions_user_active
  ON mobile_refresh_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL AND rotated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mobile_refresh_sessions_expiry
  ON mobile_refresh_sessions (expires_at) WHERE revoked_at IS NULL;
INSERT INTO schema_migrations (name) VALUES ('116_mobile_refresh_sessions.sql')
ON CONFLICT (name) DO NOTHING;

-- 117: sessões mobile rotativas para empregados e contextos comprovados no login.
CREATE TABLE IF NOT EXISTS mobile_employee_refresh_sessions (
  id BIGSERIAL PRIMARY KEY,
  family_id UUID NOT NULL,
  candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  session_version INTEGER NOT NULL,
  allowed_contexts JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  replaced_by_id BIGINT REFERENCES mobile_employee_refresh_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT mobile_employee_refresh_lifecycle_check
    CHECK (NOT (rotated_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CONSTRAINT mobile_employee_refresh_contexts_check
    CHECK (jsonb_typeof(allowed_contexts) = 'array' AND jsonb_array_length(allowed_contexts) BETWEEN 1 AND 10)
);
COMMENT ON TABLE mobile_employee_refresh_sessions IS
  'Hashed rotating refresh tokens for native employee sessions; allowed contexts were password-proven at login.';
CREATE INDEX IF NOT EXISTS idx_mobile_employee_refresh_family_active
  ON mobile_employee_refresh_sessions (family_id, id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mobile_employee_refresh_candidate_active
  ON mobile_employee_refresh_sessions (candidate_id, expires_at)
  WHERE revoked_at IS NULL AND rotated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mobile_employee_refresh_expiry
  ON mobile_employee_refresh_sessions (expires_at)
  WHERE revoked_at IS NULL;
INSERT INTO schema_migrations (name) VALUES ('117_mobile_employee_refresh_sessions.sql')
ON CONFLICT (name) DO NOTHING;

-- 118: Expo push tokens scoped to an active employee/company context.
CREATE TABLE IF NOT EXISTS mobile_employee_push_tokens (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  CONSTRAINT mobile_employee_push_tokens_token_unique UNIQUE (expo_push_token)
);
CREATE INDEX IF NOT EXISTS idx_mobile_employee_push_tokens_recipient
  ON mobile_employee_push_tokens (company_id, candidate_id)
  WHERE active = TRUE;
INSERT INTO schema_migrations (name) VALUES ('118_mobile_employee_push_tokens.sql')
ON CONFLICT (name) DO NOTHING;

-- 119: índices canônicos dos hot paths de Analytics.
CREATE INDEX IF NOT EXISTS idx_candidates_company_hired_at
  ON candidates (company_id, hired_at DESC)
  WHERE hired_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_company_hired_vacancy
  ON candidates (company_id, hired_vacancy_id, hired_at DESC)
  WHERE hired_vacancy_id IS NOT NULL AND hired_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_scores_company_calculated
  ON hr_scores (company_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_company_created_vacancy
  ON assessments (company_id, created_at DESC, vacancy_id)
  WHERE vacancy_id IS NOT NULL;
INSERT INTO schema_migrations (name) VALUES ('119_analytics_canonical_indexes.sql')
ON CONFLICT (name) DO NOTHING;

-- 120: replay protection for critical employee mobile mutations.
ALTER TABLE employee_time_punches ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE company_kudos ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_punches_mobile_idempotency
  ON employee_time_punches (company_id, candidate_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_kudos_mobile_idempotency
  ON company_kudos (company_id, from_candidate_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
COMMENT ON COLUMN employee_time_punches.idempotency_key IS
  'Opaque client mutation key; prevents duplicate mobile punches after ambiguous network failures.';
COMMENT ON COLUMN company_kudos.idempotency_key IS
  'Opaque client mutation key; prevents duplicate mobile kudos after ambiguous network failures.';
INSERT INTO schema_migrations (name) VALUES ('120_mobile_employee_mutation_idempotency.sql')
ON CONFLICT (name) DO NOTHING;

-- Additive: existing employees remain unassigned; managers and roles are unchanged.
CREATE TABLE IF NOT EXISTS org_units (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  parent_id INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (parent_id, company_id) REFERENCES org_units(id, company_id),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_units_active_name_idx
  ON org_units(company_id, COALESCE(parent_id, 0), lower(btrim(name))) WHERE active;
CREATE INDEX IF NOT EXISTS org_units_parent_idx ON org_units(company_id, parent_id) WHERE active;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS org_unit_id INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_org_unit_tenant_fk') THEN
    ALTER TABLE candidates ADD CONSTRAINT candidates_org_unit_tenant_fk
      FOREIGN KEY (org_unit_id, company_id) REFERENCES org_units(id, company_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS candidates_org_unit_idx ON candidates(company_id, org_unit_id);
INSERT INTO schema_migrations(name) VALUES ('121_organization_units.sql') ON CONFLICT (name) DO NOTHING;

-- Informational only: no authentication, module or employee access gates.
CREATE TABLE IF NOT EXISTS company_licenses (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id),
  license_number BIGSERIAL NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'early_access' CHECK (plan = 'early_access'),
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);

-- Database-owned issuance also covers old application instances during rollout.
-- UNIQUE company_id makes concurrent registrations safe; sequence gaps are normal.
CREATE OR REPLACE FUNCTION issue_company_early_access_license() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.signup_source = 'early_access' AND NEW.company_id IS NOT NULL THEN
    INSERT INTO company_licenses(company_id, starts_at, expires_at)
    VALUES (NEW.company_id, NEW.created_at,
      ((NEW.created_at AT TIME ZONE 'UTC') + interval '1 year') AT TIME ZONE 'UTC')
    ON CONFLICT (company_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS users_issue_early_access_license ON users;
CREATE TRIGGER users_issue_early_access_license
AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION issue_company_early_access_license();

-- Preserve the original first registration, even if that manager was deactivated.
-- Never extend or overwrite a license on migration retries.
INSERT INTO company_licenses(company_id, starts_at, expires_at)
SELECT company_id, min(created_at),
       ((min(created_at) AT TIME ZONE 'UTC') + interval '1 year') AT TIME ZONE 'UTC'
FROM users
WHERE signup_source = 'early_access' AND company_id IS NOT NULL
GROUP BY company_id
ORDER BY min(created_at), company_id
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO schema_migrations(name) VALUES ('122_company_early_access_license.sql') ON CONFLICT (name) DO NOTHING;

-- Additive: do not parse or overwrite existing free-text addresses.
ALTER TABLE candidate_dp_profiles ADD COLUMN IF NOT EXISTS address_number VARCHAR(20) NOT NULL DEFAULT '';
INSERT INTO schema_migrations(name) VALUES ('123_dp_address_number.sql') ON CONFLICT (name) DO NOTHING;

-- Security: durable single-use second-factor challenges (150).
-- Pending, single-use authentication challenges. No existing account data changes.
CREATE UNIQUE INDEX IF NOT EXISTS candidates_okr_tenant_identity ON candidates(id, company_id);
CREATE TABLE IF NOT EXISTS second_factor_challenges (
  id UUID PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('manager', 'employee', 'mobile_employee')),
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  candidate_id BIGINT,
  company_id BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  session_version BIGINT NOT NULL CHECK (session_version > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (candidate_id, company_id) REFERENCES candidates(id, company_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK ((purpose = 'manager' AND user_id IS NOT NULL AND candidate_id IS NULL AND company_id IS NULL)
      OR (purpose IN ('employee', 'mobile_employee') AND user_id IS NULL AND candidate_id IS NOT NULL AND company_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_second_factor_challenges_expiry ON second_factor_challenges(expires_at);

INSERT INTO schema_migrations(name) VALUES ('150_second_factor_challenges.sql') ON CONFLICT (name) DO NOTHING;

-- B-2600: IA redige o diagnóstico "Por que não aparece?" (151).

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

-- B-2714: NR-1 riscos psicossociais, versão leve (152).

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

-- =============================================================================
-- 153_mobile_push_destinations.sql
-- =============================================================================

-- 153: B-2721 — destino de push declarado pelo aparelho (Ponto / Campo no app).
--
-- Decisões de modelagem:
-- * O app mobile não está neste repositório e versões antigas não têm as telas novas.
--   Em vez de comparar versão no servidor, cada aparelho declara as telas opcionais que
--   sabe abrir (`push_destinations`). Push para tela não declarada cai em `today`.
-- * TEXT[] com CHECK de subconjunto: domínio fixo pequeno (espelho de
--   MOBILE_PUSH_OPT_IN_DESTINATIONS em lib/mobile-employee-push.js), lido junto com o token
--   (sem join extra no envio). Cardinalidade mínima, sem histórico: tabela própria seria excesso.
-- * app_version só para suporte/diagnóstico; não decide nada (formato curto validado).

ALTER TABLE mobile_employee_push_tokens
  ADD COLUMN IF NOT EXISTS app_version TEXT;

ALTER TABLE mobile_employee_push_tokens
  ADD COLUMN IF NOT EXISTS push_destinations TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE mobile_employee_push_tokens
  DROP CONSTRAINT IF EXISTS mobile_employee_push_tokens_app_version_chk;
ALTER TABLE mobile_employee_push_tokens
  ADD CONSTRAINT mobile_employee_push_tokens_app_version_chk
  CHECK (app_version IS NULL OR char_length(app_version) <= 32);

ALTER TABLE mobile_employee_push_tokens
  DROP CONSTRAINT IF EXISTS mobile_employee_push_tokens_destinations_chk;
ALTER TABLE mobile_employee_push_tokens
  ADD CONSTRAINT mobile_employee_push_tokens_destinations_chk
  CHECK (push_destinations <@ ARRAY['time_clock', 'field']::TEXT[]);

INSERT INTO schema_migrations (name) VALUES ('153_mobile_push_destinations.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 154_field_team.sql
-- =============================================================================

-- 154: B-2725 — equipe de campo: visitas (rota do dia + check-in) e reembolsos.
-- Módulo DP; acesso do colaborador pelo portal /employee e pelo app (Bearer).
--
-- Decisões de modelagem:
-- * Visita e reembolso são entidades próprias (ciclo de status, responsável, arquivo),
--   por empresa (company_id FK) e pessoa (candidate_id FK), não JSONB no colaborador.
-- * Status e categoria = domínios fixos (CHECK), espelhados em FIELD_VISIT_STATUS,
--   FIELD_EXPENSE_STATUS e FIELD_EXPENSE_CATEGORY (lib/domain-status.js).
-- * Check-in guarda a posição do aparelho no momento (NUMERIC(9,6) como o ponto) e a
--   precisão informada; não há cerca virtual nem rastreio contínuo.
-- * Valor em centavos (INTEGER) + moeda ISO de 3 letras; teto evita digitação errada.
-- * Reembolso pode citar a visita (SET NULL se a visita sumir), mas não depende dela.
-- * idempotency_key: reenvio do app não duplica o pedido (índice único parcial).
-- * Comprovante/foto ficam no S3 (chave com prefixo da empresa); a linha guarda só a chave.

CREATE TABLE IF NOT EXISTS field_visits (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  visit_date          DATE NOT NULL,
  planned_time        TIME,
  title               TEXT NOT NULL,
  address             TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'planned',
  checkin_at          TIMESTAMPTZ,
  checkin_latitude    NUMERIC(9, 6),
  checkin_longitude   NUMERIC(9, 6),
  checkin_accuracy_m  INTEGER,
  checkout_at         TIMESTAMPTZ,
  outcome_note        TEXT NOT NULL DEFAULT '',
  photo_file_key      TEXT,
  photo_file_name     TEXT NOT NULL DEFAULT '',
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS field_visits_status_chk;
ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_status_chk CHECK (status IN ('planned', 'checked_in', 'done', 'cancelled'));

ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS field_visits_text_chk;
ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_text_chk CHECK (
    char_length(title) BETWEEN 1 AND 200
    AND char_length(address) <= 300
    AND char_length(notes) <= 1000
    AND char_length(outcome_note) <= 1000
    AND char_length(photo_file_name) <= 200
  );

ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS field_visits_checkin_chk;
ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_checkin_chk CHECK (
    (checkin_latitude IS NULL) = (checkin_longitude IS NULL)
    AND (checkin_latitude IS NULL OR checkin_latitude BETWEEN -90 AND 90)
    AND (checkin_longitude IS NULL OR checkin_longitude BETWEEN -180 AND 180)
    AND (checkin_accuracy_m IS NULL OR checkin_accuracy_m BETWEEN 0 AND 100000)
    AND (status NOT IN ('checked_in', 'done') OR checkin_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_field_visits_person_day
  ON field_visits (company_id, candidate_id, visit_date);

CREATE INDEX IF NOT EXISTS idx_field_visits_company_day
  ON field_visits (company_id, visit_date);

CREATE TABLE IF NOT EXISTS field_expenses (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  visit_id            BIGINT REFERENCES field_visits(id) ON DELETE SET NULL,
  expense_date        DATE NOT NULL,
  category            TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            CHAR(3) NOT NULL DEFAULT 'BRL',
  description         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  receipt_file_key    TEXT,
  receipt_file_name   TEXT NOT NULL DEFAULT '',
  decided_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  decision_note       TEXT NOT NULL DEFAULT '',
  idempotency_key     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_status_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_category_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_category_chk CHECK (category IN (
    'mileage', 'fuel', 'meal', 'parking', 'toll', 'transport', 'lodging', 'other'
  ));

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_amount_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_amount_chk CHECK (amount_cents > 0 AND amount_cents <= 10000000);

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_text_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_text_chk CHECK (
    char_length(description) BETWEEN 3 AND 500
    AND char_length(decision_note) <= 500
    AND char_length(receipt_file_name) <= 200
    AND currency ~ '^[A-Z]{3}$'
    AND (idempotency_key IS NULL OR char_length(idempotency_key) <= 128)
  );

CREATE INDEX IF NOT EXISTS idx_field_expenses_queue
  ON field_expenses (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_expenses_person
  ON field_expenses (company_id, candidate_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_field_expenses_idempotency
  ON field_expenses (company_id, candidate_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('154_field_team.sql')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 155_ai_feature_people_copilot.sql
-- =============================================================================

-- 155: B-3011 — copiloto de pessoas (Visão geral).
-- Acrescenta 'people_copilot' ao domínio fixo de ai_usage_events.feature
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
    'help_diagnose',
    'people_copilot'
  ));

INSERT INTO schema_migrations (name) VALUES ('155_ai_feature_people_copilot.sql')
ON CONFLICT (name) DO NOTHING;

-- 156_audit_retention_policies.sql
-- One approved retention policy per company. No policies are seeded; existing events remain intact.
CREATE TABLE IF NOT EXISTS audit_retention_policies (
  company_id BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  security_retention_days INTEGER NOT NULL CHECK (security_retention_days BETWEEN 1 AND 36500 AND security_retention_days >= retention_days),
  approval_reference TEXT NOT NULL CHECK (char_length(approval_reference) BETWEEN 1 AND 200),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  hold_reference TEXT CHECK (hold_reference IS NULL OR char_length(hold_reference) BETWEEN 1 AND 200),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT legal_hold OR hold_reference IS NOT NULL)
);
COMMENT ON TABLE audit_retention_policies IS 'Approved company-specific audit retention; legal_hold prevents all automated deletion. No default legal term.';

INSERT INTO schema_migrations (name) VALUES ('156_audit_retention_policies.sql') ON CONFLICT (name) DO NOTHING;

-- 157_candidate_tags.sql — company-managed candidate labels.
-- Managed company vocabulary; candidate-level tags are shared across vacancies.
CREATE UNIQUE INDEX IF NOT EXISTS candidates_okr_tenant_identity
  ON candidates (id, company_id);

CREATE TABLE IF NOT EXISTS candidate_tags (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40 AND name = btrim(name)),
  normalized_name TEXT GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
  color TEXT NOT NULL DEFAULT '#6366f1'
    CHECK (color IN ('#6366f1', '#a855f7', '#16a34a', '#0284c7', '#d97706', '#dc2626', '#64748b')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, normalized_name),
  UNIQUE (id, company_id)
);

CREATE TABLE IF NOT EXISTS candidate_tag_assignments (
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  assigned_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, candidate_id, tag_id),
  FOREIGN KEY (candidate_id, company_id) REFERENCES candidates(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, company_id) REFERENCES candidate_tags(id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS candidate_tag_assignments_filter
  ON candidate_tag_assignments (company_id, tag_id, candidate_id);

COMMENT ON TABLE candidate_tags IS 'Company-managed recruitment tags; deactivate to preserve existing assignments.';
COMMENT ON TABLE candidate_tag_assignments IS 'Candidate-level labels shared across vacancies; composite foreign keys enforce tenant isolation.';

INSERT INTO schema_migrations (name) VALUES ('157_candidate_tags.sql') ON CONFLICT (name) DO NOTHING;

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

-- Additive headcount: legacy people keep their existing role/unit until explicitly allocated.
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS unit_type TEXT;
ALTER TABLE org_units ALTER COLUMN unit_type DROP NOT NULL;
ALTER TABLE org_units ALTER COLUMN unit_type DROP DEFAULT;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='org_units_type_chk') THEN
  ALTER TABLE org_units ADD CONSTRAINT org_units_type_chk CHECK(unit_type IN ('directorate','area','department','sector','team','nucleus'));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS job_roles_tenant_identity ON job_roles(id,company_id);
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS headcount_managed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS vacancies_tenant_identity ON vacancies(id,company_id);
CREATE TABLE IF NOT EXISTS org_positions (
 id BIGSERIAL PRIMARY KEY,
 company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 code VARCHAR(60) NOT NULL CHECK(length(btrim(code))>0),
 title VARCHAR(160) NOT NULL CHECK(length(btrim(title))>0),
 org_unit_id INTEGER NOT NULL,
 job_role_id BIGINT NOT NULL,
 fte NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK(fte>0 AND fte<=1),
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','approved','frozen','closed')),
 effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
 effective_to DATE CHECK(effective_to IS NULL OR effective_to>=effective_from),
 approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 approved_at TIMESTAMPTZ,
 created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(id,company_id),
 FOREIGN KEY(org_unit_id,company_id) REFERENCES org_units(id,company_id),
 FOREIGN KEY(job_role_id,company_id) REFERENCES job_roles(id,company_id),
 CHECK(status NOT IN ('approved','frozen') OR approved_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_positions_code_idx ON org_positions(company_id,lower(btrim(code)));
CREATE INDEX IF NOT EXISTS org_positions_list_idx ON org_positions(company_id,status,org_unit_id,id);
CREATE TABLE IF NOT EXISTS org_position_assignments (
 id BIGSERIAL PRIMARY KEY,
 company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 position_id BIGINT NOT NULL,
 candidate_id BIGINT NOT NULL,
 started_on DATE NOT NULL,
 ended_on DATE CHECK(ended_on IS NULL OR ended_on>=started_on),
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 ended_reason TEXT,
 actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 ended_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,company_id),
 FOREIGN KEY(position_id,company_id) REFERENCES org_positions(id,company_id),
 FOREIGN KEY(candidate_id,company_id) REFERENCES candidates(id,company_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS org_position_current_occupant ON org_position_assignments(company_id,position_id) WHERE ended_on IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_candidate_current_position ON org_position_assignments(company_id,candidate_id) WHERE ended_on IS NULL;
CREATE INDEX IF NOT EXISTS org_position_history_idx ON org_position_assignments(company_id,position_id,started_on DESC,id DESC);
CREATE TABLE IF NOT EXISTS org_position_recruitments (
 id BIGSERIAL PRIMARY KEY,
 company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 position_id BIGINT NOT NULL,
 vacancy_id BIGINT NOT NULL,
 linked_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 ended_at TIMESTAMPTZ,
 filled_assignment_id BIGINT,
 FOREIGN KEY(filled_assignment_id,company_id) REFERENCES org_position_assignments(id,company_id) ON DELETE CASCADE,
 FOREIGN KEY(position_id,company_id) REFERENCES org_positions(id,company_id),
 FOREIGN KEY(vacancy_id,company_id) REFERENCES vacancies(id,company_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_position_current_recruitment ON org_position_recruitments(company_id,position_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS org_recruitment_vacancy_idx ON org_position_recruitments(company_id,vacancy_id,position_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS org_recruitment_position_history_idx ON org_position_recruitments(company_id,position_id,linked_at DESC);
CREATE INDEX IF NOT EXISTS org_recruitment_vacancy_history_idx ON org_position_recruitments(company_id,vacancy_id,position_id);
-- Release every current occupation when a person exits, including legacy writers.
CREATE OR REPLACE FUNCTION org_release_position_on_exit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.employment_status='employee' AND NEW.employment_status<>'employee' THEN
  UPDATE org_position_assignments SET ended_on=GREATEST(started_on,
    COALESCE((SELECT exit_date FROM exit_records WHERE candidate_id=NEW.id AND company_id=NEW.company_id AND rehired_at IS NULL ORDER BY exit_date DESC,id DESC LIMIT 1),CURRENT_DATE)),
    ended_reason='employment_exit',
    ended_by_user_id=(SELECT created_by_user_id FROM exit_records WHERE candidate_id=NEW.id AND company_id=NEW.company_id AND rehired_at IS NULL ORDER BY exit_date DESC,id DESC LIMIT 1)
   WHERE company_id=NEW.company_id AND candidate_id=NEW.id AND ended_on IS NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS org_release_position_on_exit ON candidates;
CREATE TRIGGER org_release_position_on_exit AFTER UPDATE OF employment_status ON candidates FOR EACH ROW EXECUTE FUNCTION org_release_position_on_exit();
COMMENT ON TABLE org_positions IS 'Approved structural headcount, separate from job roles, people and vacancy positions_count. No automatic allocation of legacy employees.';
COMMENT ON TABLE org_position_assignments IS 'Primary occupation history; one current person per position and one primary position per person.';
INSERT INTO schema_migrations(name) VALUES ('159_organizational_positions.sql') ON CONFLICT(name) DO NOTHING;
-- All legacy unit/role writers must respect a current structural occupation.
CREATE OR REPLACE FUNCTION org_check_candidate_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM org_position_assignments a JOIN org_positions p ON p.id=a.position_id AND p.company_id=a.company_id
 WHERE a.candidate_id=NEW.id AND a.company_id=NEW.company_id AND a.ended_on IS NULL
 AND (p.org_unit_id IS DISTINCT FROM NEW.org_unit_id OR p.job_role_id IS DISTINCT FROM NEW.job_role_id)) THEN
  RAISE EXCEPTION 'POSITION_IN_USE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS org_check_candidate_position ON candidates;
CREATE TRIGGER org_check_candidate_position BEFORE UPDATE OF org_unit_id,job_role_id ON candidates FOR EACH ROW EXECUTE FUNCTION org_check_candidate_position();


-- 160: REP-P original records (expand only).
-- Expand only. Historical punches are not assigned retrospective fiscal numbers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE employee_time_punches ADD COLUMN IF NOT EXISTS rep_collector CHAR(2) NOT NULL DEFAULT '02' CHECK(rep_collector IN ('01','02'));
CREATE TABLE IF NOT EXISTS rep_establishments (
 id BIGSERIAL PRIMARY KEY,
 company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 employer_document VARCHAR(14) NOT NULL UNIQUE CHECK (employer_document ~ '^([0-9]{11}|[A-Z0-9]{12}[0-9]{2})$'),
 employer_name VARCHAR(150) NOT NULL CHECK (length(trim(employer_name))>0),
 workplace VARCHAR(100) NOT NULL CHECK (length(trim(workplace))>0),
 registration VARCHAR(17) NOT NULL CHECK (registration ~ '^[0-9]{17}$'),
 timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
 complementary_document VARCHAR(14) NOT NULL DEFAULT '' CHECK (complementary_document ~ '^([0-9]{12}|[0-9]{14})?$'),
 responsible_cpf VARCHAR(11) NOT NULL CHECK (responsible_cpf ~ '^[0-9]{11}$'),
 last_nsr BIGINT NOT NULL DEFAULT 0 CHECK (last_nsr BETWEEN 0 AND 999999999),
 last_punch_hash VARCHAR(64) NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,company_id)
);
CREATE TABLE IF NOT EXISTS rep_workers (
 id BIGSERIAL PRIMARY KEY,
 company_id BIGINT NOT NULL,
 establishment_id BIGINT NOT NULL,
 candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
 cpf VARCHAR(11) NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
 weekly_rest_day SMALLINT NOT NULL DEFAULT 0 CHECK(weekly_rest_day BETWEEN 0 AND 6),
 worker_name VARCHAR(52) NOT NULL CHECK(length(trim(worker_name))>0),
 responsible_cpf VARCHAR(11) NOT NULL CHECK (responsible_cpf ~ '^[0-9]{11}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(establishment_id,company_id) REFERENCES rep_establishments(id,company_id) ON DELETE RESTRICT,
 UNIQUE(company_id,candidate_id), UNIQUE(establishment_id,cpf)
);
CREATE TABLE IF NOT EXISTS rep_original_records (
 establishment_id BIGINT NOT NULL REFERENCES rep_establishments(id) ON DELETE RESTRICT,
 nsr BIGINT NOT NULL CHECK (nsr BETWEEN 1 AND 999999999),
 record_type SMALLINT NOT NULL CHECK(record_type IN (2,5,6,7)),
 recorded_at TIMESTAMPTZ NOT NULL,
 punch_id BIGINT UNIQUE REFERENCES employee_time_punches(id) ON DELETE RESTRICT,
 worker_id BIGINT REFERENCES rep_workers(id) ON DELETE RESTRICT,
 record_text TEXT NOT NULL CHECK(record_text !~ E'[\r\n]'),
 record_hash VARCHAR(64), previous_hash VARCHAR(64),
 PRIMARY KEY(establishment_id,nsr),
 CHECK ((record_type=7)=(punch_id IS NOT NULL)),
 CHECK(record_type<>7 OR (record_hash ~ '^[a-f0-9]{64}$' AND worker_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS rep_original_records_period ON rep_original_records(establishment_id,recorded_at,nsr);
CREATE TABLE IF NOT EXISTS rep_signed_documents (
 establishment_id BIGINT NOT NULL,
 nsr BIGINT NOT NULL,
 pdf BYTEA NOT NULL,
 sha256 VARCHAR(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 certificate_fingerprint VARCHAR(64) NOT NULL,
 signed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(establishment_id,nsr),
 FOREIGN KEY(establishment_id,nsr) REFERENCES rep_original_records(establishment_id,nsr) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION rep_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REP_IMMUTABLE_RECORD' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS rep_original_immutable ON rep_original_records;
CREATE TRIGGER rep_original_immutable BEFORE UPDATE OR DELETE ON rep_original_records FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_original_no_truncate ON rep_original_records;
CREATE TRIGGER rep_original_no_truncate BEFORE TRUNCATE ON rep_original_records FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_document_immutable ON rep_signed_documents;
CREATE TRIGGER rep_document_immutable BEFORE UPDATE OR DELETE ON rep_signed_documents FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_document_no_truncate ON rep_signed_documents;
CREATE TRIGGER rep_document_no_truncate BEFORE TRUNCATE ON rep_signed_documents FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
-- Fixed fields reject overflow and unrepresentable characters instead of corrupting exports.
CREATE OR REPLACE FUNCTION rep_field(v text,n integer) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF v IS NULL OR char_length(v)>n OR v ~ E'[\r\n]' THEN RAISE EXCEPTION 'REP_INVALID_FIELD'; END IF;
 PERFORM convert_to(v,'LATIN1'); RETURN rpad(v,n,' ');
END $$;
CREATE OR REPLACE FUNCTION rep_stamp(t timestamptz,z text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT to_char(t AT TIME ZONE z,'YYYY-MM-DD"T"HH24:MI:00') ||
 CASE WHEN extract(epoch FROM ((t AT TIME ZONE z)-(t AT TIME ZONE 'UTC'))) < 0 THEN '-' ELSE '+' END ||
 to_char(make_interval(secs=>abs(extract(epoch FROM ((t AT TIME ZONE z)-(t AT TIME ZONE 'UTC'))))) ,'HH24MI')
$$;
CREATE OR REPLACE FUNCTION rep_crc(v text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE b bytea:=convert_to(v,'LATIN1'); crc integer:=0; i integer;j integer;
BEGIN
 FOR i IN 0..length(b)-1 LOOP
 crc:=crc # get_byte(b,i);
 FOR j IN 1..8 LOOP crc:=CASE WHEN (crc & 1)=1 THEN (crc>>1)#33800 ELSE crc>>1 END; END LOOP;
 END LOOP; RETURN lpad(to_hex(crc),4,'0');
END $$;
CREATE OR REPLACE FUNCTION rep_guard_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND (NEW.last_nsr<>0 OR NEW.last_punch_hash<>'') THEN RAISE EXCEPTION 'REP_COUNTER_MANAGED'; END IF;
 IF TG_OP='UPDATE' AND (NEW.last_nsr,NEW.last_punch_hash) IS DISTINCT FROM (OLD.last_nsr,OLD.last_punch_hash) AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'REP_COUNTER_MANAGED'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_guard_counter ON rep_establishments;
CREATE TRIGGER rep_guard_counter BEFORE INSERT OR UPDATE ON rep_establishments FOR EACH ROW EXECUTE FUNCTION rep_guard_counter();
CREATE OR REPLACE FUNCTION rep_guard_append() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'REP_APPEND_INTERNAL_ONLY'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS rep_guard_append ON rep_original_records;
CREATE TRIGGER rep_guard_append BEFORE INSERT ON rep_original_records FOR EACH ROW EXECUTE FUNCTION rep_guard_append();
CREATE OR REPLACE FUNCTION rep_configuration_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; typ integer;
BEGIN
 IF TG_TABLE_NAME='rep_establishments' THEN
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.employer_document,NEW.registration,NEW.timezone) IS DISTINCT FROM (OLD.company_id,OLD.employer_document,OLD.registration,OLD.timezone) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.id FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.employer_name,NEW.workplace,NEW.responsible_cpf,NEW.complementary_document) IS NOT DISTINCT FROM (OLD.employer_name,OLD.workplace,OLD.responsible_cpf,OLD.complementary_document) THEN RETURN NEW; END IF;
  typ:=2;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.candidates WHERE id=NEW.candidate_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'REP_WORKER_TENANT'; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.establishment_id,NEW.candidate_id,NEW.cpf,NEW.weekly_rest_day) IS DISTINCT FROM (OLD.company_id,OLD.establishment_id,OLD.candidate_id,OLD.cpf,OLD.weekly_rest_day) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  IF TG_OP='UPDATE' AND (NEW.worker_name,NEW.responsible_cpf) IS NOT DISTINCT FROM (OLD.worker_name,OLD.responsible_cpf) THEN RETURN NEW; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.establishment_id FOR UPDATE;
  typ:=5;
 END IF;
 PERFORM public.rep_stamp(at,e.timezone);
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 IF typ=2 THEN raw:=lpad(n::text,9,'0')||'2'||public.rep_stamp(at,e.timezone)||lpad(NEW.responsible_cpf,14,'0')||CASE WHEN length(e.employer_document)=14 THEN '1' ELSE '2' END||public.rep_field(e.employer_document,14)||lpad(e.complementary_document,14,'0')||public.rep_field(e.employer_name,150)||public.rep_field(e.workplace,100);
 ELSE raw:=lpad(n::text,9,'0')||'5'||public.rep_stamp(at,e.timezone)||CASE WHEN TG_OP='INSERT' THEN 'I' ELSE 'A' END||lpad(NEW.cpf,12,'0')||public.rep_field(NEW.worker_name,52)||'    '||NEW.responsible_cpf;
 END IF;
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text)
 VALUES(e.id,n,typ,at,raw||public.rep_crc(raw)); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_establishment_events ON rep_establishments;
CREATE TRIGGER rep_establishment_events AFTER INSERT OR UPDATE ON rep_establishments FOR EACH ROW EXECUTE FUNCTION rep_configuration_event();
DROP TRIGGER IF EXISTS rep_worker_events ON rep_workers;
CREATE TRIGGER rep_worker_events AFTER INSERT OR UPDATE ON rep_workers FOR EACH ROW EXECUTE FUNCTION rep_configuration_event();
DROP TRIGGER IF EXISTS rep_establishment_delete ON rep_establishments;
CREATE TRIGGER rep_establishment_delete BEFORE DELETE ON rep_establishments FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_worker_delete ON rep_workers;
CREATE TRIGGER rep_worker_delete BEFORE DELETE ON rep_workers FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
CREATE OR REPLACE FUNCTION rep_capture_punch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE w public.rep_workers%ROWTYPE; e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; h text; collector text;
BEGIN
 IF NEW.source='manager' THEN RETURN NEW; END IF;
 SELECT * INTO w FROM public.rep_workers WHERE company_id=NEW.company_id AND candidate_id=NEW.candidate_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO e FROM public.rep_establishments WHERE id=w.establishment_id FOR UPDATE;
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 collector:=NEW.rep_collector;
 raw:=lpad(n::text,9,'0')||'7'||public.rep_stamp(NEW.punched_at,e.timezone)||lpad(w.cpf,12,'0')||public.rep_stamp(at,e.timezone)||collector||'0';
 h:=encode(public.digest(convert_to(raw||e.last_punch_hash,'LATIN1'),'sha256'),'hex');
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,punch_id,worker_id,record_text,record_hash,previous_hash)
 VALUES(e.id,n,7,at,NEW.id,w.id,raw||h,h,e.last_punch_hash);
 UPDATE public.rep_establishments SET last_punch_hash=h WHERE id=e.id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_capture_punch ON employee_time_punches;
CREATE TRIGGER rep_capture_punch AFTER INSERT ON employee_time_punches FOR EACH ROW EXECUTE FUNCTION rep_capture_punch();
CREATE OR REPLACE FUNCTION rep_protect_punch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REP_PUNCH_DELETE_FORBIDDEN' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.company_id,NEW.candidate_id,NEW.punched_at,NEW.punch_kind,NEW.source,NEW.latitude,NEW.longitude,NEW.notes,NEW.created_at,NEW.created_by_user_id,NEW.idempotency_key,NEW.rep_collector) IS DISTINCT FROM
 (OLD.id,OLD.company_id,OLD.candidate_id,OLD.punched_at,OLD.punch_kind,OLD.source,OLD.latitude,OLD.longitude,OLD.notes,OLD.created_at,OLD.created_by_user_id,OLD.idempotency_key,OLD.rep_collector) THEN
 RAISE EXCEPTION 'REP_PUNCH_ORIGINAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_protect_punch ON employee_time_punches;
CREATE TRIGGER rep_protect_punch BEFORE UPDATE OR DELETE ON employee_time_punches FOR EACH ROW EXECUTE FUNCTION rep_protect_punch();
DROP TRIGGER IF EXISTS rep_punch_no_truncate ON employee_time_punches;
CREATE TRIGGER rep_punch_no_truncate BEFORE TRUNCATE ON employee_time_punches FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
CREATE TABLE IF NOT EXISTS rep_service_observations (
 id BIGSERIAL PRIMARY KEY,
 establishment_id BIGINT NOT NULL REFERENCES rep_establishments(id) ON DELETE RESTRICT,
 available BOOLEAN NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS rep_service_observations_last ON rep_service_observations(establishment_id,id DESC);
DROP TRIGGER IF EXISTS rep_service_immutable ON rep_service_observations;
CREATE TRIGGER rep_service_immutable BEFORE UPDATE OR DELETE ON rep_service_observations FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_service_no_truncate ON rep_service_observations;
CREATE TRIGGER rep_service_no_truncate BEFORE TRUNCATE ON rep_service_observations FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
CREATE OR REPLACE FUNCTION rep_capture_service_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.rep_establishments%ROWTYPE; prior boolean; n bigint;
BEGIN
 SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.establishment_id FOR UPDATE;
 SELECT right(record_text,2)='07' INTO prior FROM public.rep_original_records WHERE establishment_id=NEW.establishment_id AND record_type=6 ORDER BY nsr DESC LIMIT 1;
 IF prior IS NOT DISTINCT FROM NEW.available THEN RETURN NEW; END IF;
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text)
 VALUES(e.id,n,6,NEW.recorded_at,lpad(n::text,9,'0')||'6'||public.rep_stamp(NEW.recorded_at,e.timezone)||CASE WHEN NEW.available THEN '07' ELSE '08' END);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_capture_service_state ON rep_service_observations;
CREATE TRIGGER rep_capture_service_state AFTER INSERT ON rep_service_observations FOR EACH ROW EXECUTE FUNCTION rep_capture_service_state();
INSERT INTO schema_migrations(name) VALUES('160_rep_original_records.sql') ON CONFLICT(name) DO NOTHING;


-- 161_time_clock_closed_day_guards.sql
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

INSERT INTO schema_migrations(name) VALUES('161_time_clock_closed_day_guards.sql') ON CONFLICT(name) DO NOTHING;

-- 162: time clock historical rules
-- Captures configuration changes prospectively; baseline is the known current state.
CREATE TABLE IF NOT EXISTS time_clock_person_history (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id),
 candidate_id BIGINT NOT NULL REFERENCES candidates(id), effective_on DATE NOT NULL,
 org_unit_id BIGINT REFERENCES org_units(id), work_format TEXT, time_clock_override BOOLEAN,
 start_date DATE, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,candidate_id,effective_on)
);
CREATE INDEX IF NOT EXISTS time_clock_person_history_lookup ON time_clock_person_history(company_id,candidate_id,effective_on DESC);
INSERT INTO time_clock_person_history(company_id,candidate_id,effective_on,org_unit_id,work_format,time_clock_override,start_date)
 SELECT company_id,id,'0001-01-01',org_unit_id,work_format,time_clock_override,COALESCE(start_date,hired_at::date)
 FROM candidates WHERE employment_status IN ('employee','alumni') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION time_clock_capture_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d DATE;
BEGIN
 IF NEW.company_id IS NULL OR NEW.employment_status NOT IN ('employee','alumni') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.org_unit_id,NEW.work_format,NEW.time_clock_override,NEW.start_date,NEW.hired_at,NEW.employment_status) IS NOT DISTINCT FROM ROW(OLD.org_unit_id,OLD.work_format,OLD.time_clock_override,OLD.start_date,OLD.hired_at,OLD.employment_status) THEN RETURN NEW; END IF;
 SELECT (clock_timestamp() AT TIME ZONE COALESCE((SELECT timezone FROM company_time_schedules WHERE company_id=NEW.company_id),'America/Sao_Paulo'))::date INTO d;
 IF TG_OP='INSERT' OR NOT EXISTS(SELECT 1 FROM time_clock_person_history WHERE company_id=NEW.company_id AND candidate_id=NEW.id) THEN d:='0001-01-01'::date; END IF;
 INSERT INTO time_clock_person_history(company_id,candidate_id,effective_on,org_unit_id,work_format,time_clock_override,start_date)
 VALUES(NEW.company_id,NEW.id,d,NEW.org_unit_id,NEW.work_format,NEW.time_clock_override,COALESCE(NEW.start_date,NEW.hired_at::date))
 ON CONFLICT(company_id,candidate_id,effective_on) DO UPDATE SET org_unit_id=EXCLUDED.org_unit_id,work_format=EXCLUDED.work_format,time_clock_override=EXCLUDED.time_clock_override,start_date=EXCLUDED.start_date,recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_person_history_capture ON candidates;
CREATE TRIGGER time_clock_person_history_capture AFTER INSERT OR UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION time_clock_capture_person();
CREATE TABLE IF NOT EXISTS time_clock_company_history (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id), effective_on DATE NOT NULL,
 workday_start TIME NOT NULL, workday_end TIME NOT NULL, break_minutes INT NOT NULL,
 late_grace_minutes INT NOT NULL, timezone TEXT NOT NULL, hour_bank_enabled BOOLEAN NOT NULL DEFAULT FALSE, hour_bank_max_minutes INT NOT NULL DEFAULT 2400, hour_bank_started_on DATE, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,effective_on)
);
INSERT INTO time_clock_company_history(company_id,effective_on,workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on)
 SELECT company_id,'0001-01-01',workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on FROM company_time_schedules ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION time_clock_capture_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO time_clock_company_history(company_id,effective_on,workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on)
 VALUES(NEW.company_id,CASE WHEN TG_OP='INSERT' THEN '0001-01-01'::date ELSE (clock_timestamp() AT TIME ZONE NEW.timezone)::date END,NEW.workday_start,NEW.workday_end,NEW.break_minutes,NEW.late_grace_minutes,NEW.timezone,NEW.hour_bank_enabled,NEW.hour_bank_max_minutes,NEW.hour_bank_started_on)
 ON CONFLICT(company_id,effective_on) DO UPDATE SET workday_start=EXCLUDED.workday_start,workday_end=EXCLUDED.workday_end,break_minutes=EXCLUDED.break_minutes,late_grace_minutes=EXCLUDED.late_grace_minutes,timezone=EXCLUDED.timezone,hour_bank_enabled=EXCLUDED.hour_bank_enabled,hour_bank_max_minutes=EXCLUDED.hour_bank_max_minutes,hour_bank_started_on=EXCLUDED.hour_bank_started_on,recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_company_history_capture ON company_time_schedules;
CREATE TRIGGER time_clock_company_history_capture AFTER INSERT OR UPDATE ON company_time_schedules FOR EACH ROW EXECUTE FUNCTION time_clock_capture_company();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='time_clock_history_person_tenant') THEN
 ALTER TABLE time_clock_person_history ADD CONSTRAINT time_clock_history_person_tenant FOREIGN KEY(candidate_id,company_id) REFERENCES candidates(id,company_id);
 ALTER TABLE time_clock_person_history ADD CONSTRAINT time_clock_history_unit_tenant FOREIGN KEY(org_unit_id,company_id) REFERENCES org_units(id,company_id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS time_clock_unit_history (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id), unit_id BIGINT NOT NULL,
 parent_id BIGINT, effective_on DATE NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,unit_id,effective_on),
 FOREIGN KEY(unit_id,company_id) REFERENCES org_units(id,company_id),
 FOREIGN KEY(parent_id,company_id) REFERENCES org_units(id,company_id)
);
INSERT INTO time_clock_unit_history(company_id,unit_id,parent_id,effective_on) SELECT company_id,id,parent_id,'0001-01-01' FROM org_units ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION time_clock_capture_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW; END IF;
 INSERT INTO time_clock_unit_history(company_id,unit_id,parent_id,effective_on) VALUES(NEW.company_id,NEW.id,NEW.parent_id,CASE WHEN TG_OP='INSERT' THEN '0001-01-01'::date ELSE (clock_timestamp() AT TIME ZONE COALESCE((SELECT timezone FROM company_time_schedules WHERE company_id=NEW.company_id),'America/Sao_Paulo'))::date END)
 ON CONFLICT(company_id,unit_id,effective_on) DO UPDATE SET parent_id=EXCLUDED.parent_id,recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_unit_history_capture ON org_units;
CREATE TRIGGER time_clock_unit_history_capture AFTER INSERT OR UPDATE ON org_units FOR EACH ROW EXECUTE FUNCTION time_clock_capture_unit();

INSERT INTO schema_migrations(name) VALUES('162_time_clock_history.sql') ON CONFLICT(name) DO NOTHING;
ALTER TABLE employee_time_schedules ADD COLUMN IF NOT EXISTS shift_pattern TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE employee_time_schedules ADD COLUMN IF NOT EXISTS cycle_anchor DATE;
ALTER TABLE employee_time_schedules ADD COLUMN IF NOT EXISTS night_rule TEXT NOT NULL DEFAULT 'none';
ALTER TABLE employee_time_schedules DROP CONSTRAINT IF EXISTS employee_time_schedules_shift_chk;
ALTER TABLE employee_time_schedules ADD CONSTRAINT employee_time_schedules_shift_chk CHECK (shift_pattern IN ('weekly','12x36') AND night_rule IN ('none','urban_clt') AND (shift_pattern<>'12x36' OR (cycle_anchor IS NOT NULL AND NOT follows_company AND mod((extract(epoch FROM(workday_end-workday_start))+86400)::bigint,86400)=43200)));
ALTER TABLE employee_time_schedules DROP CONSTRAINT IF EXISTS employee_time_schedules_shape_chk;
ALTER TABLE employee_time_schedules ADD CONSTRAINT employee_time_schedules_shape_chk CHECK (
 (follows_company AND workday_start IS NULL AND workday_end IS NULL AND break_start IS NULL AND break_end IS NULL AND weekdays IS NULL)
 OR (NOT follows_company AND workday_start IS NOT NULL AND workday_end IS NOT NULL AND workday_end<>workday_start
 AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
 AND ((break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL
 AND ((extract(epoch FROM (break_start-workday_start))+86400)::bigint % 86400) < ((extract(epoch FROM (break_end-workday_start))+86400)::bigint % 86400)
 AND ((extract(epoch FROM (break_end-workday_start))+86400)::bigint % 86400) <= ((extract(epoch FROM (workday_end-workday_start))+86400)::bigint % 86400))))) ;
-- Logical day depends on the schedule of the preceding day, never the device clock.
CREATE OR REPLACE FUNCTION time_clock_work_day(cid BIGINT, person BIGINT, ts TIMESTAMPTZ) RETURNS DATE LANGUAGE plpgsql STABLE AS $$
DECLARE d DATE; local_time TIME; z TEXT; s RECORD;
BEGIN
 SELECT timezone INTO z FROM time_clock_company_history WHERE company_id=cid AND effective_on<=(ts AT TIME ZONE timezone)::date ORDER BY effective_on DESC,id DESC LIMIT 1;
 IF z IS NULL THEN SELECT timezone INTO z FROM company_time_schedules WHERE company_id=cid; END IF;
 z:=COALESCE(z,'America/Sao_Paulo'); d:=(ts AT TIME ZONE z)::date; local_time:=(ts AT TIME ZONE z)::time;
 SELECT * INTO s FROM employee_time_schedules WHERE company_id=cid AND candidate_id=person AND valid_from<=d-1 ORDER BY valid_from DESC LIMIT 1;
 IF FOUND AND NOT s.follows_company AND s.workday_end<s.workday_start AND extract(epoch FROM local_time)<(extract(epoch FROM s.workday_end)+extract(epoch FROM s.workday_start))/2
 AND (s.shift_pattern='weekly' AND extract(dow FROM d-1)::smallint=ANY(s.weekdays) OR s.shift_pattern='12x36' AND mod((d-1-s.cycle_anchor),2)=0) THEN RETURN d-1; END IF;
 RETURN d;
END $$;
ALTER TABLE time_clock_closure_people ADD COLUMN IF NOT EXISTS night_minutes INT NOT NULL DEFAULT 0;
ALTER TABLE time_clock_closure_people ADD COLUMN IF NOT EXISTS night_equivalent_minutes INT NOT NULL DEFAULT 0;
ALTER TABLE time_clock_closure_people ADD COLUMN IF NOT EXISTS calculation_version INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION time_clock_guard_closed_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data RECORD; v_day DATE; v_old_day DATE; v_tz TEXT; v_closed BOOLEAN;
BEGIN
  IF TG_OP='DELETE' THEN row_data:=OLD; ELSE row_data:=NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id) THEN
    RAISE EXCEPTION 'TIME_CLOCK_IDENTITY_IMMUTABLE' USING ERRCODE='P0001';
  END IF;
  PERFORM id FROM candidates WHERE company_id=row_data.company_id AND id=row_data.candidate_id FOR NO KEY UPDATE;
  -- New original markings must remain possible, even when their logical night
  -- shift was already closed. Reconciliation detects the new original; only HR
  -- corrections/voids are blocked. The public punch API supplies the server time.
  IF TG_TABLE_NAME='employee_time_punches' AND TG_OP='INSERT' THEN
    IF NEW.source='web' THEN RETURN NEW; END IF;
  END IF;
  -- Rejections/cancellations do not alter computed time and may clear legacy pending rows.
  IF TG_TABLE_NAME IN ('employee_time_requests','employee_hour_bank_entries') THEN
    IF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status IN ('rejected','cancelled') THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='employee_time_punches' THEN
    SELECT COALESCE(timezone,'America/Sao_Paulo') INTO v_tz FROM company_time_schedules WHERE company_id=row_data.company_id;
    v_day:=time_clock_work_day(row_data.company_id,row_data.candidate_id,row_data.punched_at);
  ELSE v_day:=row_data.work_on; END IF;
  v_old_day:=v_day;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='employee_time_punches' THEN v_old_day:=time_clock_work_day(OLD.company_id,OLD.candidate_id,OLD.punched_at);
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
-- Prevent configuration writes racing a closed snapshot (also covers direct SQL).
CREATE OR REPLACE FUNCTION time_clock_guard_schedule_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; d DATE;
BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
 PERFORM id FROM candidates WHERE company_id=r.company_id AND id=r.candidate_id FOR NO KEY UPDATE;
 d:=r.valid_from;
 IF TG_OP='UPDATE' THEN
  IF NEW.company_id<>OLD.company_id OR NEW.candidate_id<>OLD.candidate_id THEN RAISE EXCEPTION 'TIME_CLOCK_IDENTITY_IMMUTABLE' USING ERRCODE='P0001'; END IF;
  d:=LEAST(d,OLD.valid_from);
 END IF;
 IF EXISTS(SELECT 1 FROM time_clock_closures k WHERE k.company_id=r.company_id AND k.status='closed' AND k.period_end>=d AND (k.org_unit_id IS NULL OR EXISTS(SELECT 1 FROM time_clock_closure_people p WHERE p.closure_id=k.id AND p.candidate_id=r.candidate_id))) THEN RAISE EXCEPTION 'TIME_CLOCK_PERIOD_CLOSED' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS time_clock_schedule_closed ON employee_time_schedules;
CREATE TRIGGER time_clock_schedule_closed BEFORE INSERT OR UPDATE OR DELETE ON employee_time_schedules FOR EACH ROW EXECUTE FUNCTION time_clock_guard_schedule_version();
CREATE OR REPLACE FUNCTION time_clock_preserve_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TIME_CLOCK_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_TABLE_NAME='time_clock_closure_people' THEN
 IF ROW(NEW.closure_id,NEW.company_id,NEW.candidate_id,NEW.expected_minutes,NEW.worked_minutes,NEW.extra_minutes,NEW.missing_minutes,NEW.workdays,NEW.absence_days,NEW.justified_days,NEW.incomplete_days,NEW.snapshot_hash,NEW.night_minutes,NEW.night_equivalent_minutes,NEW.calculation_version) IS DISTINCT FROM ROW(OLD.closure_id,OLD.company_id,OLD.candidate_id,OLD.expected_minutes,OLD.worked_minutes,OLD.extra_minutes,OLD.missing_minutes,OLD.workdays,OLD.absence_days,OLD.justified_days,OLD.incomplete_days,OLD.snapshot_hash,OLD.night_minutes,OLD.night_equivalent_minutes,OLD.calculation_version) THEN RAISE EXCEPTION 'TIME_CLOCK_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 ELSE RAISE EXCEPTION 'TIME_CLOCK_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_snapshot_preserve ON time_clock_closure_people;
CREATE TRIGGER time_clock_snapshot_preserve BEFORE UPDATE OR DELETE ON time_clock_closure_people FOR EACH ROW EXECUTE FUNCTION time_clock_preserve_snapshot();
DROP TRIGGER IF EXISTS time_clock_balance_preserve ON time_clock_closure_balances;
CREATE TRIGGER time_clock_balance_preserve BEFORE UPDATE OR DELETE ON time_clock_closure_balances FOR EACH ROW EXECUTE FUNCTION time_clock_preserve_snapshot();
-- An exit/rehire changes attendance expectations; preserve already closed intervals.
CREATE OR REPLACE FUNCTION time_clock_guard_exit_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; first_day DATE; last_day DATE;
BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; first_day:=OLD.exit_date+1; last_day:=COALESCE(OLD.rehired_at,'9999-12-31'::date);
 ELSIF TG_OP='INSERT' THEN r:=NEW; first_day:=NEW.exit_date+1; last_day:=COALESCE(NEW.rehired_at,'9999-12-31'::date);
 ELSE
 r:=NEW;
 IF NEW.company_id<>OLD.company_id OR NEW.candidate_id<>OLD.candidate_id THEN RAISE EXCEPTION 'TIME_CLOCK_IDENTITY_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.exit_date=OLD.exit_date AND NEW.rehired_at IS NOT DISTINCT FROM OLD.rehired_at THEN RETURN NEW; END IF;
 IF NEW.exit_date=OLD.exit_date THEN
 first_day:=LEAST(COALESCE(OLD.rehired_at,'9999-12-31'::date),COALESCE(NEW.rehired_at,'9999-12-31'::date));
 last_day:=GREATEST(COALESCE(OLD.rehired_at,'9999-12-31'::date),COALESCE(NEW.rehired_at,'9999-12-31'::date));
 ELSE first_day:=LEAST(OLD.exit_date,NEW.exit_date)+1; last_day:=GREATEST(COALESCE(OLD.rehired_at,'9999-12-31'::date),COALESCE(NEW.rehired_at,'9999-12-31'::date)); END IF;
 END IF;
 PERFORM id FROM candidates WHERE company_id=r.company_id AND id=r.candidate_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM time_clock_closures k WHERE k.company_id=r.company_id AND k.status='closed' AND k.period_end>=first_day AND k.period_start<last_day AND (k.org_unit_id IS NULL OR EXISTS(SELECT 1 FROM time_clock_closure_people p WHERE p.closure_id=k.id AND p.candidate_id=r.candidate_id))) THEN RAISE EXCEPTION 'TIME_CLOCK_PERIOD_CLOSED' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS time_clock_exit_closed ON exit_records;
CREATE TRIGGER time_clock_exit_closed BEFORE INSERT OR UPDATE OR DELETE ON exit_records FOR EACH ROW EXECUTE FUNCTION time_clock_guard_exit_dates();

INSERT INTO schema_migrations(name) VALUES('163_time_clock_shifts.sql') ON CONFLICT(name) DO NOTHING;
CREATE TABLE IF NOT EXISTS time_clock_push_deliveries (
 id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES companies(id),
 candidate_id BIGINT NOT NULL REFERENCES candidates(id), notification_id BIGINT NOT NULL REFERENCES candidate_notifications(id) ON DELETE CASCADE,
 token_id BIGINT NOT NULL REFERENCES mobile_employee_push_tokens(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped')),
 attempts INT NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 locked_at TIMESTAMPTZ, last_error TEXT CHECK(last_error IN ('network','provider','unregistered','context_changed','exhausted') OR last_error IS NULL),
 sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(notification_id,token_id)
);
CREATE INDEX IF NOT EXISTS time_clock_push_due ON time_clock_push_deliveries(next_attempt_at,id) WHERE status IN ('pending','sending');
CREATE OR REPLACE FUNCTION time_clock_enqueue_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type IN ('time_request_decided','time_mirror_available','time_closing_reminder','time_mirror_reopened') THEN
 INSERT INTO time_clock_push_deliveries(company_id,candidate_id,notification_id,token_id)
 SELECT NEW.company_id,NEW.recipient_candidate_id,NEW.id,t.id FROM mobile_employee_push_tokens t
 WHERE t.company_id=NEW.company_id AND t.candidate_id=NEW.recipient_candidate_id AND t.active
 ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS time_clock_push_enqueue ON candidate_notifications;
CREATE TRIGGER time_clock_push_enqueue AFTER INSERT ON candidate_notifications FOR EACH ROW EXECUTE FUNCTION time_clock_enqueue_push();
CREATE TABLE IF NOT EXISTS time_clock_health_observations (
 id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('clock','signing_failure')),
 company_id BIGINT REFERENCES companies(id), offset_ms BIGINT, observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((kind='clock' AND offset_ms IS NOT NULL) OR kind='signing_failure')
);
CREATE INDEX IF NOT EXISTS time_clock_health_latest ON time_clock_health_observations(kind,observed_at DESC);
ALTER TABLE time_clock_push_deliveries ADD COLUMN IF NOT EXISTS total_attempts INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS time_clock_push_attempts (
 id BIGSERIAL PRIMARY KEY, delivery_id BIGINT NOT NULL REFERENCES time_clock_push_deliveries(id) ON DELETE CASCADE,
 attempt_no INT NOT NULL CHECK(attempt_no>0), started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
 outcome TEXT CHECK(outcome IN ('sent','pending','failed','skipped') OR outcome IS NULL),
 error_code TEXT CHECK(error_code IN ('network','provider','unregistered','context_changed','exhausted') OR error_code IS NULL), UNIQUE(delivery_id,attempt_no)
);

ALTER TABLE time_clock_health_observations ADD COLUMN IF NOT EXISTS source TEXT CHECK(source IS NULL OR char_length(source)<=253);

INSERT INTO schema_migrations(name) VALUES('164_time_clock_operations.sql') ON CONFLICT(name) DO NOTHING;

-- REP fiscal layout corrections
BEGIN;
-- Forward-only formatting fix: do not modify any historical fiscal record or hash.
-- Accept the real numeric INPI identifier; field width belongs to the serializer.
ALTER TABLE rep_establishments DROP CONSTRAINT IF EXISTS rep_establishments_registration_check;
ALTER TABLE rep_establishments ADD CONSTRAINT rep_establishments_registration_check CHECK (registration ~ '^[0-9]{1,17}$');
-- Explicit removal of legacy left zero padding is permitted, never automatic.
-- All other identity changes remain forbidden. The correction appends an event.
CREATE OR REPLACE FUNCTION rep_configuration_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; typ integer;
BEGIN
 IF TG_TABLE_NAME='rep_establishments' THEN
  IF TG_OP='UPDATE' AND ((NEW.company_id,NEW.employer_document,NEW.timezone) IS DISTINCT FROM (OLD.company_id,OLD.employer_document,OLD.timezone) OR (NEW.registration IS DISTINCT FROM OLD.registration AND NOT (length(OLD.registration)=17 AND length(NEW.registration)<17 AND OLD.registration=lpad(NEW.registration,17,'0')))) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.id FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.employer_name,NEW.workplace,NEW.responsible_cpf,NEW.complementary_document,NEW.registration) IS NOT DISTINCT FROM (OLD.employer_name,OLD.workplace,OLD.responsible_cpf,OLD.complementary_document,OLD.registration) THEN RETURN NEW; END IF;
  typ:=2;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.candidates WHERE id=NEW.candidate_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'REP_WORKER_TENANT'; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.establishment_id,NEW.candidate_id,NEW.cpf,NEW.weekly_rest_day) IS DISTINCT FROM (OLD.company_id,OLD.establishment_id,OLD.candidate_id,OLD.cpf,OLD.weekly_rest_day) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  IF TG_OP='UPDATE' AND (NEW.worker_name,NEW.responsible_cpf) IS NOT DISTINCT FROM (OLD.worker_name,OLD.responsible_cpf) THEN RETURN NEW; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.establishment_id FOR UPDATE;
  typ:=5;
 END IF;
 PERFORM public.rep_stamp(at,e.timezone);
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 IF typ=2 THEN raw:=lpad(n::text,9,'0')||'2'||public.rep_stamp(at,e.timezone)||public.rep_field(NEW.responsible_cpf,14)||CASE WHEN length(e.employer_document)=14 THEN '1' ELSE '2' END||public.rep_field(e.employer_document,14)||public.rep_field(e.complementary_document,14)||public.rep_field(e.employer_name,150)||public.rep_field(e.workplace,100);
 ELSE raw:=lpad(n::text,9,'0')||'5'||public.rep_stamp(at,e.timezone)||CASE WHEN TG_OP='INSERT' THEN 'I' ELSE 'A' END||lpad(NEW.cpf,12,'0')||public.rep_field(NEW.worker_name,52)||'    '||NEW.responsible_cpf;
 END IF;
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text)
 VALUES(e.id,n,typ,at,raw||public.rep_crc(raw)); RETURN NEW;
END $$;

INSERT INTO schema_migrations(name) VALUES('165_rep_layout_corrections.sql') ON CONFLICT(name) DO NOTHING;

COMMIT;

-- 166_stripe_billing.sql
BEGIN;
-- Relational billing state: one commercial policy per company, distinct Stripe
-- identities per sandbox/live mode; no card data or raw webhook payloads stored.
CREATE TABLE IF NOT EXISTS company_billing_terms (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id),
  managed BOOLEAN NOT NULL DEFAULT FALSE,
  trial_ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Preserve all existing companies and their promised terms. Legacy access is
-- grandfathered until an explicit subscription is purchased.
INSERT INTO company_billing_terms(company_id, managed, trial_ends_at)
SELECT c.id, FALSE, COALESCE(l.expires_at, now()) FROM companies c
LEFT JOIN company_licenses l ON l.company_id=c.id
ON CONFLICT(company_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS company_billing_accounts (
  company_id INTEGER NOT NULL REFERENCES companies(id),
  livemode BOOLEAN NOT NULL,
  customer_id TEXT UNIQUE,
  subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'none' CHECK(status IN ('none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  plan_key TEXT CHECK(plan_key IN ('brl_small_monthly','brl_growing_monthly','brl_medium_monthly','brl_small_annual','usd_company_monthly','brl_launch_monthly')),
  currency TEXT CHECK(currency IN ('brl','usd')),
  period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_id TEXT,
  checkout_attempt UUID,
  checkout_plan_key TEXT CHECK(checkout_plan_key IN ('brl_small_monthly','brl_growing_monthly','brl_medium_monthly','brl_small_annual','usd_company_monthly')),
  checkout_launch BOOLEAN NOT NULL DEFAULT FALSE,
  checkout_trial_end TIMESTAMPTZ,
  checkout_created_at TIMESTAMPTZ,
  checkout_session_id TEXT UNIQUE,
  checkout_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id, livemode)
);
CREATE TABLE IF NOT EXISTS billing_launch_redemptions (
  company_id INTEGER NOT NULL REFERENCES companies(id),
  livemode BOOLEAN NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 20),
  redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  subscription_id TEXT UNIQUE,
  PRIMARY KEY(company_id,livemode),
  UNIQUE(livemode,slot),
  FOREIGN KEY(company_id,livemode) REFERENCES company_billing_accounts(company_id,livemode)
);
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  livemode BOOLEAN NOT NULL,
  event_type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_webhook_events_processed_idx ON billing_webhook_events(processed_at);

-- New signups receive 30 days in every cohort. Existing licenses are never
-- rewritten. This also covers old app instances during an overlapping rollout.
CREATE OR REPLACE FUNCTION issue_company_early_access_license() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.signup_source='early_access' AND NEW.company_id IS NOT NULL THEN
    INSERT INTO company_licenses(company_id,starts_at,expires_at,offer_tier,trial_days)
    VALUES(NEW.company_id,NEW.created_at,NEW.created_at+interval '30 days','trial',30)
    ON CONFLICT(company_id) DO NOTHING;
    INSERT INTO company_billing_terms(company_id,managed,trial_ends_at)
    SELECT company_id,TRUE,expires_at FROM company_licenses WHERE company_id=NEW.company_id
    ON CONFLICT(company_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON TABLE company_billing_terms IS 'New self-service companies have a 30-day trial; existing companies preserve access. No automatic retroactive billing.';
COMMENT ON TABLE billing_launch_redemptions IS '20 founder slots per Stripe mode. Reservations expire; redeemed slots persist even after cancellation to prevent reuse.';
-- Capacity is an integrity rule, including concurrent hires from different APIs.
-- Only app connections explicitly enabled for a Stripe mode enforce it. Other
-- environments, legacy companies and unpaid local trials are preserved.
CREATE OR REPLACE FUNCTION enforce_company_billing_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  billing_mode TEXT := current_setting('grow.billing_mode',true);
  max_people INTEGER;
  current_people INTEGER;
BEGIN
  IF billing_mode IS NULL OR billing_mode NOT IN ('test','live') OR NEW.employment_status<>'employee' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.employment_status='employee' AND OLD.company_id=NEW.company_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
  SELECT CASE a.plan_key WHEN 'brl_small_monthly' THEN 20 WHEN 'brl_small_annual' THEN 20
    WHEN 'brl_launch_monthly' THEN 20 WHEN 'brl_growing_monthly' THEN 50 WHEN 'brl_medium_monthly' THEN 100 END
    INTO max_people FROM company_billing_accounts a JOIN company_billing_terms t USING(company_id)
    WHERE a.company_id=NEW.company_id AND a.livemode=(billing_mode='live') AND t.managed
      AND a.status IN ('active','trialing') AND a.period_end>now();
  IF max_people IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO current_people FROM candidates WHERE company_id=NEW.company_id AND employment_status='employee' AND id IS DISTINCT FROM NEW.id;
  IF current_people>=max_people THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BILLING_CAPACITY'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS candidates_billing_capacity ON candidates;
CREATE TRIGGER candidates_billing_capacity BEFORE INSERT OR UPDATE OF company_id,employment_status ON candidates
FOR EACH ROW EXECUTE FUNCTION enforce_company_billing_capacity();

INSERT INTO schema_migrations(name) VALUES('166_stripe_billing.sql') ON CONFLICT(name) DO NOTHING;

COMMIT;

BEGIN;

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


INSERT INTO schema_migrations(name) VALUES('167_multiple_rejection_reasons.sql') ON CONFLICT(name) DO NOTHING;
COMMIT;

-- 168_support_response_visibility.sql
-- Separate internal activity from an answer actually visible to the requester.
-- Keep legacy first_response_at unchanged: it previously measured triage.
ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS first_triaged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_response TEXT;
UPDATE product_feedback SET first_triaged_at=first_response_at
 WHERE first_triaged_at IS NULL AND first_response_at IS NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_feedback_public_response_length' AND conrelid='product_feedback'::regclass) THEN
   ALTER TABLE product_feedback ADD CONSTRAINT product_feedback_public_response_length
     CHECK (public_response IS NULL OR char_length(public_response)<=4000);
 END IF;
END $$;
COMMENT ON COLUMN product_feedback.public_response IS 'Plain-text answer visible to the requester in the in-app support history. Internal notes stay private.';

INSERT INTO schema_migrations(name) VALUES('168_support_response_visibility.sql') ON CONFLICT(name) DO NOTHING;

-- 169_billing_admin_operations.sql
-- Durable financial intents and status history. External Stripe identifiers are
-- TEXT; entities and actors retain relational ownership and fixed domains.
CREATE TABLE IF NOT EXISTS billing_admin_operations (
  id UUID PRIMARY KEY,
  company_id INTEGER NOT NULL,
  livemode BOOLEAN NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('cancel_renewal','resume_renewal','terminate','refund')),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','processing','pending','succeeded','failed','needs_review')),
  reason TEXT NOT NULL CHECK(reason IN ('customer_request','withdrawal','annual_early_termination','service_issue','incorrect_charge')),
  note TEXT NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),
  refund_basis TEXT CHECK(refund_basis IN ('full','partial','annual')),
  invoice_id TEXT,
  charge_id TEXT,
  subscription_id TEXT NOT NULL,
  stripe_refund_id TEXT UNIQUE,
  amount INTEGER CHECK(amount>0),
  currency TEXT CHECK(currency IN ('brl','usd')),
  requested_at TIMESTAMPTZ NOT NULL,
  policy_version TEXT NOT NULL,
  error_code TEXT CHECK(char_length(error_code)<=120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,livemode) REFERENCES company_billing_accounts(company_id,livemode),
  CHECK((kind='refund' AND refund_basis IS NOT NULL AND invoice_id IS NOT NULL AND charge_id IS NOT NULL AND amount IS NOT NULL AND currency IS NOT NULL) OR
        (kind<>'refund' AND refund_basis IS NULL AND invoice_id IS NULL AND charge_id IS NULL AND amount IS NULL AND currency IS NULL))
);
CREATE INDEX IF NOT EXISTS billing_admin_operations_company_idx ON billing_admin_operations(company_id,livemode,created_at DESC);
-- One proportional early-termination calculation per invoice; an additional
-- exceptional refund remains a separate, explicit manual decision.
CREATE UNIQUE INDEX IF NOT EXISTS billing_admin_annual_refund_once_idx ON billing_admin_operations(company_id,livemode,invoice_id)
  WHERE kind='refund' AND refund_basis='annual' AND status<>'failed';
CREATE TABLE IF NOT EXISTS billing_admin_operation_events (
  id BIGSERIAL PRIMARY KEY,
  operation_id UUID NOT NULL REFERENCES billing_admin_operations(id),
  status TEXT NOT NULL CHECK(status IN ('prepared','processing','pending','succeeded','failed','needs_review')),
  source TEXT NOT NULL CHECK(source IN ('api','webhook','reconcile')),
  stripe_status TEXT CHECK(stripe_status IN ('pending','requires_action','succeeded','failed','canceled')),
  error_code TEXT CHECK(char_length(error_code)<=120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_admin_operation_events_operation_idx ON billing_admin_operation_events(operation_id,id);
INSERT INTO schema_migrations(name) VALUES('169_billing_admin_operations.sql') ON CONFLICT(name) DO NOTHING;

-- 170: notice attachments
-- Additive: notices remain readable by older releases; files have their own
-- lifecycle and a composite FK enforces ownership by the notice's company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_posts_company_id_id ON company_posts(company_id,id);
CREATE TABLE IF NOT EXISTS company_post_attachments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  post_id BIGINT NOT NULL,
  upload_id UUID NOT NULL,
  object_key TEXT NOT NULL UNIQUE CHECK(char_length(object_key) BETWEEN 1 AND 600),
  file_name TEXT NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 200),
  content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(company_id,post_id,upload_id),
  FOREIGN KEY(company_id,post_id) REFERENCES company_posts(company_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_company_post_attachments_active ON company_post_attachments(company_id,post_id,created_at,id) WHERE deleted=false;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='grow30_app') THEN
    GRANT SELECT,INSERT,UPDATE ON company_post_attachments TO grow30_app;
    GRANT USAGE,SELECT ON SEQUENCE company_post_attachments_id_seq TO grow30_app;
  END IF;
END $$;

INSERT INTO schema_migrations(name) VALUES('170_company_post_attachments.sql') ON CONFLICT(name) DO NOTHING;

-- 171: Reações aos kudos (aditiva).
-- One current reaction per employee and kudo. Existing messages are untouched.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_kudos_company_id_id ON company_kudos(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_company_id_id_unique ON candidates(company_id,id);
CREATE TABLE IF NOT EXISTS company_kudo_reactions (
  company_id BIGINT NOT NULL,
  kudo_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍','❤️','👏','🎉','🙌')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,kudo_id,candidate_id),
  FOREIGN KEY(company_id,kudo_id) REFERENCES company_kudos(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,candidate_id) REFERENCES candidates(company_id,id) ON DELETE CASCADE
);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='grow30_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON company_kudo_reactions TO grow30_app;
  END IF;
END $$;

INSERT INTO schema_migrations(name) VALUES('171_company_kudo_reactions.sql') ON CONFLICT(name) DO NOTHING;

-- 173_expanded_kudo_reactions.sql (aplicar antes dos escritores ampliados)
BEGIN;
-- Expand the fixed emoji domain without changing identity, uniqueness, FKs or data.
-- Apply before deploying the expanded writers. Safe to reapply.
DO $$ BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  ALTER TABLE company_kudo_reactions DROP CONSTRAINT IF EXISTS company_kudo_reactions_emoji_check;
ALTER TABLE company_kudo_reactions ADD CONSTRAINT company_kudo_reactions_emoji_check
  CHECK (emoji IN ('👍','❤️','👏','🎉','🙌','😊','💪','🚀','⭐','🔥','💯','🤝','🏆','🙏','🤩','💡','🥳')) NOT VALID;
ALTER TABLE company_kudo_reactions VALIDATE CONSTRAINT company_kudo_reactions_emoji_check;
END $$;

INSERT INTO schema_migrations(name) VALUES('173_expanded_kudo_reactions.sql') ON CONFLICT(name) DO NOTHING;
COMMIT;

-- 174: eNPS scale correction (no data rewriting).
BEGIN;
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

INSERT INTO schema_migrations(name) VALUES('174_climate_enps_scale.sql') ON CONFLICT(name) DO NOTHING;
COMMIT;

-- 175: Comentários e reações no mural (aditiva, sem alterar avisos atuais).
BEGIN;
CREATE TABLE IF NOT EXISTS company_post_reactions (
  company_id BIGINT NOT NULL,
  post_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍','❤️','👏','🎉','🙌')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, post_id, candidate_id),
  FOREIGN KEY (company_id, post_id) REFERENCES company_posts(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, candidate_id) REFERENCES candidates(company_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS company_post_comments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  post_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY (company_id, post_id) REFERENCES company_posts(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, candidate_id) REFERENCES candidates(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_company_post_comments_active
  ON company_post_comments(company_id, post_id, created_at DESC, id DESC)
  WHERE deleted = false;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grow30_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON company_post_reactions TO grow30_app;
    GRANT SELECT, INSERT, UPDATE ON company_post_comments TO grow30_app;
    GRANT USAGE, SELECT ON SEQUENCE company_post_comments_id_seq TO grow30_app;
  END IF;
END $$;

INSERT INTO schema_migrations(name) VALUES('175_company_post_interactions.sql') ON CONFLICT(name) DO NOTHING;
COMMIT;

-- 176: Banco de horas por colaborador com vigência individual.
BEGIN;
CREATE TABLE IF NOT EXISTS employee_hour_bank_participation (
  company_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  valid_from DATE NOT NULL,
  enabled BOOLEAN NOT NULL,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, candidate_id, valid_from),
  CONSTRAINT employee_hour_bank_participation_candidate_fk
    FOREIGN KEY (company_id, candidate_id) REFERENCES candidates(company_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE employee_hour_bank_participation IS
  'Exceções individuais com vigência: sem linha anterior à data, participa quando o banco da empresa está ativo.';
CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_participation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, OLD.candidate_id, OLD.valid_from);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NEW.candidate_id, NEW.valid_from);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_participation ON employee_hour_bank_participation;
CREATE TRIGGER trg_hour_bank_ckpt_participation
  AFTER INSERT OR UPDATE OR DELETE ON employee_hour_bank_participation
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_participation();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grow30_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON employee_hour_bank_participation TO grow30_app;
  END IF;
END $$;
INSERT INTO schema_migrations(name) VALUES('176_employee_hour_bank_participation.sql') ON CONFLICT(name) DO NOTHING;
COMMIT;

-- 177: Aviso e recibo privados por período de férias.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS employee_leave_requests_scope_uq
  ON employee_leave_requests (id, company_id, candidate_id);
CREATE TABLE IF NOT EXISTS employee_vacation_documents (
  company_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  leave_request_id BIGINT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('notice', 'receipt')),
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (leave_request_id, document_type),
  CONSTRAINT employee_vacation_documents_leave_fk
    FOREIGN KEY (leave_request_id, company_id, candidate_id)
    REFERENCES employee_leave_requests(id, company_id, candidate_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS employee_vacation_documents_company_candidate_idx
  ON employee_vacation_documents (company_id, candidate_id, leave_request_id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grow30_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON employee_vacation_documents TO grow30_app;
  END IF;
END $$;
INSERT INTO schema_migrations(name) VALUES('177_vacation_documents.sql') ON CONFLICT(name) DO NOTHING;
COMMIT;

-- 178: recusa de documento do colaborador com justificativa visível.
BEGIN;
ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE employee_dp_documents
  DROP CONSTRAINT IF EXISTS employee_dp_documents_status_chk;
ALTER TABLE employee_dp_documents
  ADD CONSTRAINT employee_dp_documents_status_chk
  CHECK (status IN ('pending', 'received', 'waived', 'rejected'));
ALTER TABLE employee_dp_documents
  DROP CONSTRAINT IF EXISTS employee_dp_documents_rejection_reason_chk;
ALTER TABLE employee_dp_documents
  ADD CONSTRAINT employee_dp_documents_rejection_reason_chk
  CHECK (char_length(rejection_reason) <= 2000
    AND (status <> 'rejected' OR char_length(btrim(rejection_reason)) > 0));
COMMENT ON COLUMN employee_dp_documents.rejection_reason IS
  'Visible to the employee while a document is rejected; cleared on replacement or status change.';
INSERT INTO schema_migrations(name) VALUES('178_dp_document_rejection.sql') ON CONFLICT(name) DO NOTHING;
COMMIT;
