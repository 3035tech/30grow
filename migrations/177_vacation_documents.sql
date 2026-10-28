-- Two private documents per vacation period. Existing leave attachments stay untouched.
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

INSERT INTO schema_migrations (name) VALUES ('177_vacation_documents.sql')
ON CONFLICT (name) DO NOTHING;
