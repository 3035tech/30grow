-- Fixed stage domain, one decision per employee/stage. No JSONB: these decisions
-- participate in task creation, tenant integrity and author/date history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_company_id_id_unique ON candidates(company_id,id);
CREATE TABLE IF NOT EXISTS employee_onboarding_stage_choices (
  company_id BIGINT NOT NULL REFERENCES companies(id),
  candidate_id BIGINT NOT NULL,
  stage_key TEXT NOT NULL CHECK(stage_key IN ('arrival','d30','d60','d90')),
  enabled BOOLEAN NOT NULL,
  decided_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,candidate_id,stage_key),
  FOREIGN KEY(company_id,candidate_id) REFERENCES candidates(company_id,id) ON DELETE CASCADE
);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='grow30_app') THEN
    GRANT SELECT,INSERT,UPDATE ON employee_onboarding_stage_choices TO grow30_app;
  END IF;
END $$;
