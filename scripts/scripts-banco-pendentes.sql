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
