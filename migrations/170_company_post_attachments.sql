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
