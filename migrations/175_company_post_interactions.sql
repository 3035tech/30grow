-- Additive interactions for employee feed posts. Existing posts remain unchanged.
CREATE TABLE IF NOT EXISTS company_post_reactions (
  company_id BIGINT NOT NULL,
  post_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍','❤️','👏','🎉','🙌')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, post_id, candidate_id),
  FOREIGN KEY (company_id, post_id) REFERENCES company_posts(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, candidate_id) REFERENCES candidates(company_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS company_post_comments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  post_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY (company_id, post_id) REFERENCES company_posts(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, candidate_id) REFERENCES candidates(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_company_post_comments_active
  ON company_post_comments(company_id, post_id, created_at DESC, id DESC)
  WHERE deleted = false;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grow30_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON company_post_reactions TO grow30_app;
    GRANT SELECT, INSERT, UPDATE ON company_post_comments TO grow30_app;
    GRANT USAGE, SELECT ON SEQUENCE company_post_comments_id_seq TO grow30_app;
  END IF;
END $$;
