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
