-- =============================================================================
-- 30Grow — bootstrap base no PostgreSQL (RDS ou outro)
-- =============================================================================
-- Execute conectado ao DATABASE que você criou (não na instância “postgres”
-- template, a menos que esse seja o alvo).
--
-- Como rodar (exemplos):
--   psql "postgresql://USER:PASS@HOST:5432/SEU_DATABASE" -f scripts/rds-bootstrap-completo.sql
--
-- Antes de rodar:
--   1) Ajuste, se quiser, o bloco “ADMIN INICIAL” (email e senha).
--   2) O usuário precisa de permissão para CREATE EXTENSION pgcrypto (RDS:
--      normalmente permitido). Se falhar, comente o bloco do admin e crie o
--      usuário depois com outra ferramenta.
--
-- Este arquivo cria a base histórica. Sempre execute `npm run db:migrate`
-- depois dele; migrations/ é a fonte canônica do schema atual.
-- =============================================================================

-- Extensão para gerar hash bcrypt compatível com bcryptjs (login da app)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ── 001_init.sql (schema base) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_slug_unique ON companies (LOWER(slug));

CREATE TABLE IF NOT EXISTS company_links (
  id         BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_links_token_unique ON company_links (token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_links_company_active_unique
  ON company_links (company_id)
  WHERE active = TRUE;

ALTER TABLE company_links
  ADD COLUMN IF NOT EXISTS require_candidate_email BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS results (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  top_type    INTEGER NOT NULL CHECK (top_type BETWEEN 1 AND 9),
  scores      JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_results_name ON results (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_results_created ON results (created_at DESC);

CREATE TABLE IF NOT EXISTS areas (
  id         SERIAL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  linkedin_url TEXT,
  city        TEXT,
  state       TEXT,
  salary_expectation TEXT,
  availability TEXT,
  source      TEXT,
  consent_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE candidates SET email = NULL WHERE email = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_company_email_lower_unique
  ON candidates (company_id, LOWER(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS assessments (
  id           BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  area_id      INTEGER NOT NULL REFERENCES areas(id),
  top_type     INTEGER NOT NULL CHECK (top_type BETWEEN 1 AND 9),
  scores       JSONB NOT NULL,
  source       TEXT NOT NULL DEFAULT 'public_form',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fill_duration_ms INTEGER CHECK (fill_duration_ms IS NULL OR fill_duration_ms >= 0),
  copy_event_count INTEGER NOT NULL DEFAULT 0 CHECK (copy_event_count >= 0),
  attr_source TEXT,
  attr_medium TEXT,
  attr_campaign TEXT,
  attr_content TEXT,
  attr_term TEXT,
  attr_ref TEXT,
  attr_landing TEXT,
  attr_session_id TEXT
);

CREATE OR REPLACE FUNCTION trg_assessments_company_matches_candidate()
RETURNS TRIGGER AS $$
DECLARE
  cand_company BIGINT;
BEGIN
  SELECT company_id INTO cand_company FROM candidates WHERE id = NEW.candidate_id;
  IF cand_company IS NULL THEN
    RAISE EXCEPTION 'Candidate % not found', NEW.candidate_id;
  END IF;
  IF NEW.company_id IS DISTINCT FROM cand_company THEN
    RAISE EXCEPTION 'Assessment company_id (%) does not match candidate company_id (%)', NEW.company_id, cand_company;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assessments_company_matches_candidate ON assessments;
CREATE TRIGGER assessments_company_matches_candidate
BEFORE INSERT OR UPDATE OF candidate_id, company_id ON assessments
FOR EACH ROW EXECUTE FUNCTION trg_assessments_company_matches_candidate();

CREATE INDEX IF NOT EXISTS idx_assessments_area_created ON assessments (area_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_candidate_created ON assessments (candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_company_created ON assessments (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  company_id     BIGINT REFERENCES companies(id) ON DELETE RESTRICT,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','direction','hr')),
  locale         TEXT NOT NULL DEFAULT 'pt-BR' CHECK (locale IN ('pt-BR', 'en')),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS user_capability_overrides (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  granted    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_user_capability_overrides_user
  ON user_capability_overrides (user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  actor_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS area_rubrics (
  area_id              INTEGER PRIMARY KEY REFERENCES areas(id) ON DELETE CASCADE,
  desired_type_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes                TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS area_stats (
  area_id     INTEGER PRIMARY KEY REFERENCES areas(id) ON DELETE CASCADE,
  type_means  JSONB NOT NULL,
  type_stds   JSONB NOT NULL,
  n           INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO areas (key, label)
VALUES
  ('comercial',  'Comercial'),
  ('rh',         'RH'),
  ('financeiro', 'Financeiro'),
  ('tecnologia', 'Tecnologia'),
  ('outros',     'Outros')
ON CONFLICT (key) DO NOTHING;

INSERT INTO companies (name, slug)
VALUES ('Default', 'default')
ON CONFLICT ((LOWER(slug))) DO NOTHING;

-- ── 002_add_company_areas.sql ───────────────────────────────────────────────

INSERT INTO areas (key, label)
VALUES
  ('produto', 'Produto'),
  ('cs', 'Customer Success'),
  ('atendimento', 'Atendimento/Suporte'),
  ('marketing', 'Marketing'),
  ('operacoes', 'Operações/Projetos'),
  ('juridico', 'Jurídico/Compliance')
ON CONFLICT (key) DO NOTHING;

-- ── 003_seed_area_rubrics.sql ───────────────────────────────────────────────

INSERT INTO area_rubrics (area_id, desired_type_weights)
SELECT id, '{}'::jsonb
FROM areas
ON CONFLICT (area_id) DO NOTHING;

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '1', 0.7,
  '5', 1.0,
  '6', 0.8,
  '3', 0.5
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'tecnologia';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '3', 0.9,
  '7', 0.8,
  '8', 0.7,
  '2', 0.5
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'comercial';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '3', 0.7,
  '5', 0.8,
  '7', 0.7,
  '1', 0.6
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'produto';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '3', 0.8,
  '7', 0.9,
  '4', 0.7,
  '2', 0.5
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'marketing';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '2', 0.9,
  '6', 0.8,
  '9', 0.7,
  '7', 0.4
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'cs';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '2', 0.9,
  '6', 0.8,
  '9', 0.6
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'atendimento';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '1', 0.9,
  '6', 0.8,
  '3', 0.6,
  '9', 0.4
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'operacoes';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '1', 1.0,
  '5', 0.8,
  '6', 0.7
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'financeiro';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '2', 0.9,
  '9', 0.8,
  '6', 0.7,
  '1', 0.5
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'rh';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '1', 1.0,
  '6', 0.8,
  '9', 0.6,
  '5', 0.5
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'juridico';

UPDATE area_rubrics r
SET desired_type_weights = jsonb_build_object(
  '1', 0.5, '2', 0.5, '3', 0.5, '4', 0.5, '5', 0.5, '6', 0.5, '7', 0.5, '8', 0.5, '9', 0.5
)
FROM areas a
WHERE a.id = r.area_id AND a.key = 'outros';

-- ── 004_vacancies.sql ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vacancies (
  id         BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  slug       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vacancies_company_slug_unique
  ON vacancies (company_id, LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_vacancies_company_created
  ON vacancies (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vacancy_links (
  id          BIGSERIAL PRIMARY KEY,
  vacancy_id  BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  rotated_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vacancy_links_token_unique ON vacancy_links (token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vacancy_links_vacancy_active_unique
  ON vacancy_links (vacancy_id)
  WHERE active = TRUE;

ALTER TABLE vacancy_links
  ADD COLUMN IF NOT EXISTS require_candidate_email BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS vacancy_id BIGINT REFERENCES vacancies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_vacancy_created
  ON assessments (vacancy_id, created_at DESC);

CREATE OR REPLACE FUNCTION trg_assessments_company_matches_vacancy()
RETURNS TRIGGER AS $$
DECLARE
  vac_company BIGINT;
BEGIN
  IF NEW.vacancy_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_id INTO vac_company FROM vacancies WHERE id = NEW.vacancy_id;
  IF vac_company IS NULL THEN
    RAISE EXCEPTION 'Vacancy % not found', NEW.vacancy_id;
  END IF;
  IF NEW.company_id IS DISTINCT FROM vac_company THEN
    RAISE EXCEPTION 'Assessment company_id (%) does not match vacancy company_id (%)', NEW.company_id, vac_company;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assessments_company_matches_vacancy ON assessments;
CREATE TRIGGER assessments_company_matches_vacancy
BEFORE INSERT OR UPDATE OF vacancy_id, company_id ON assessments
FOR EACH ROW EXECUTE FUNCTION trg_assessments_company_matches_vacancy();

-- ── 005_soft_delete_flags.sql ───────────────────────────────────────────────

ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS positions_count INT NOT NULL DEFAULT 1;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS target_date DATE;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS salary_min TEXT;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS salary_max TEXT;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS client_report_show_salary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS workplace_modality TEXT;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS workplace_city TEXT;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS workplace_state TEXT;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS public_page_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS public_allow_index BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS public_show_company_info BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS public_show_salary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS about_html TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'pt-BR';
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_setup_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_setup_expires_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IN ('pt-BR', 'pt-PT', 'en', 'es-419', 'es-ES', 'fr-FR', 'de-DE'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_password_setup_token
  ON users (password_setup_token)
  WHERE password_setup_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_company_slug_public
  ON vacancies (company_id, LOWER(slug))
  WHERE deleted = FALSE AND public_page_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_vacancies_public_open_created
  ON vacancies (created_at DESC)
  WHERE deleted = FALSE
    AND public_page_enabled = TRUE
    AND public_allow_index = TRUE
    AND status = 'open';

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

DROP INDEX IF EXISTS idx_companies_slug_unique;
CREATE UNIQUE INDEX idx_companies_slug_unique ON companies (LOWER(slug)) WHERE deleted = FALSE;

DROP INDEX IF EXISTS idx_vacancies_company_slug_unique;
CREATE UNIQUE INDEX idx_vacancies_company_slug_unique ON vacancies (company_id, LOWER(slug)) WHERE deleted = FALSE;

DROP INDEX IF EXISTS idx_users_email_unique;
CREATE UNIQUE INDEX idx_users_email_unique ON users (LOWER(email)) WHERE deleted = FALSE;

-- ── 006_performance_indexes.sql ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_vacencies_company_created_active
  ON vacancies (company_id, created_at DESC)
  WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_assessments_company_top_created
  ON assessments (company_id, top_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidates_company_lower_name
  ON candidates (company_id, (LOWER(full_name)));

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created
  ON audit_log (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

-- ── 009_recruiting_workflow.sql ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS candidate_invites (
  id                  BIGSERIAL PRIMARY KEY,
  vacancy_id          BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_name      TEXT NOT NULL,
  candidate_email     TEXT NOT NULL,
  token               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'opened', 'completed', 'cancelled')),
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at           TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  last_reminder_at    TIMESTAMPTZ,
  reminder_count      INTEGER NOT NULL DEFAULT 0,
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_invites_token_unique ON candidate_invites (token);
CREATE INDEX IF NOT EXISTS idx_candidate_invites_vacancy_email ON candidate_invites (vacancy_id, LOWER(candidate_email));
CREATE INDEX IF NOT EXISTS idx_candidate_invites_reminder ON candidate_invites (status, sent_at)
  WHERE status IN ('sent', 'opened');

CREATE TABLE IF NOT EXISTS vacancy_rubrics (
  vacancy_id              BIGINT PRIMARY KEY REFERENCES vacancies(id) ON DELETE CASCADE,
  desired_type_weights      JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes                     TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS invite_id BIGINT REFERENCES candidate_invites(id) ON DELETE SET NULL;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'test_completed';

ALTER TABLE assessments
  DROP CONSTRAINT IF EXISTS assessments_pipeline_stage_check;

ALTER TABLE assessments
  ADD CONSTRAINT assessments_pipeline_stage_check CHECK (
    pipeline_stage IN (
      'new',
      'test_completed',
      'screening',
      'interview',
      'approved',
      'hired',
      'rejected',
      'archived'
    )
  );

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date DATE;

CREATE INDEX IF NOT EXISTS idx_assessments_pipeline ON assessments (company_id, pipeline_stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_invite ON assessments (invite_id) WHERE invite_id IS NOT NULL;

-- ── 014 vacancy_candidates (entrevista → notas → desafio) ─────────────────
CREATE TABLE IF NOT EXISTS vacancy_candidates (
  id                  BIGSERIAL PRIMARY KEY,
  vacancy_id          BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  interview_notes     TEXT,
  pipeline_stage      TEXT,
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vacancy_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_vacancy_candidates_vacancy
  ON vacancy_candidates (vacancy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vacancy_candidates_candidate
  ON vacancy_candidates (candidate_id);

ALTER TABLE candidate_invites
  ADD COLUMN IF NOT EXISTS candidate_id BIGINT REFERENCES candidates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_invites_candidate
  ON candidate_invites (candidate_id)
  WHERE candidate_id IS NOT NULL;

-- ── 017 hire / reject / timeline ───────────────────────────────────────────
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS employment_status TEXT NOT NULL DEFAULT 'candidate',
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS hired_vacancy_id BIGINT REFERENCES vacancies(id) ON DELETE SET NULL;
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_employment_status_check;
ALTER TABLE candidates ADD CONSTRAINT candidates_employment_status_check
  CHECK (employment_status IN ('candidate', 'employee', 'alumni'));

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

ALTER TABLE vacancy_candidates
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE vacancy_candidates DROP CONSTRAINT IF EXISTS vacancy_candidates_pipeline_stage_check;
ALTER TABLE vacancy_candidates ADD CONSTRAINT vacancy_candidates_pipeline_stage_check CHECK (
  pipeline_stage IS NULL OR pipeline_stage IN (
    'new', 'test_completed', 'screening', 'interview',
    'approved', 'hired', 'rejected', 'archived'
  )
);

-- ── 019 candidate hr_notes ─────────────────────────────────────────────────
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS hr_notes TEXT;

-- ── Controle de migrations (opcional, alinha com scripts/migrate.js) ─────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (name) VALUES
  ('001_init.sql'),
  ('002_add_company_areas.sql'),
  ('003_seed_area_rubrics.sql'),
  ('004_vacancies.sql'),
  ('005_soft_delete_flags.sql'),
  ('006_performance_indexes.sql'),
  ('007_link_require_candidate_email.sql'),
  ('008_user_locale.sql'),
  ('009_recruiting_workflow.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ── ADMIN INICIAL (fora da transação acima: extensão já habilitada) ─────────
-- Troque email e senha antes de usar em produção.
-- Senha abaixo: altere a string entre aspas simples.

INSERT INTO users (email, password_hash, role, active)
SELECT
  'admin@3035tech.com',
  crypt('TroqueEstaSenha123!', gen_salt('bf', 10)),
  'admin',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE LOWER(email) = LOWER('admin@3035tech.com')
);

-- Fim.
-- Recruiting workspace ownership and per-user saved views (migration 113).
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
