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
