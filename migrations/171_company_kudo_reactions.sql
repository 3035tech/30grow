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
