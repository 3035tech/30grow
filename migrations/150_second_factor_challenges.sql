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
