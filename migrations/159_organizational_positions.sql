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
