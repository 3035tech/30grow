-- 154: B-2725 — equipe de campo: visitas (rota do dia + check-in) e reembolsos.
-- Módulo DP; acesso do colaborador pelo portal /employee e pelo app (Bearer).
--
-- Decisões de modelagem:
-- * Visita e reembolso são entidades próprias (ciclo de status, responsável, arquivo),
--   por empresa (company_id FK) e pessoa (candidate_id FK), não JSONB no colaborador.
-- * Status e categoria = domínios fixos (CHECK), espelhados em FIELD_VISIT_STATUS,
--   FIELD_EXPENSE_STATUS e FIELD_EXPENSE_CATEGORY (lib/domain-status.js).
-- * Check-in guarda a posição do aparelho no momento (NUMERIC(9,6) como o ponto) e a
--   precisão informada; não há cerca virtual nem rastreio contínuo.
-- * Valor em centavos (INTEGER) + moeda ISO de 3 letras; teto evita digitação errada.
-- * Reembolso pode citar a visita (SET NULL se a visita sumir), mas não depende dela.
-- * idempotency_key: reenvio do app não duplica o pedido (índice único parcial).
-- * Comprovante/foto ficam no S3 (chave com prefixo da empresa); a linha guarda só a chave.

CREATE TABLE IF NOT EXISTS field_visits (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  visit_date          DATE NOT NULL,
  planned_time        TIME,
  title               TEXT NOT NULL,
  address             TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'planned',
  checkin_at          TIMESTAMPTZ,
  checkin_latitude    NUMERIC(9, 6),
  checkin_longitude   NUMERIC(9, 6),
  checkin_accuracy_m  INTEGER,
  checkout_at         TIMESTAMPTZ,
  outcome_note        TEXT NOT NULL DEFAULT '',
  photo_file_key      TEXT,
  photo_file_name     TEXT NOT NULL DEFAULT '',
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS field_visits_status_chk;
ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_status_chk CHECK (status IN ('planned', 'checked_in', 'done', 'cancelled'));

ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS field_visits_text_chk;
ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_text_chk CHECK (
    char_length(title) BETWEEN 1 AND 200
    AND char_length(address) <= 300
    AND char_length(notes) <= 1000
    AND char_length(outcome_note) <= 1000
    AND char_length(photo_file_name) <= 200
  );

ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS field_visits_checkin_chk;
ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_checkin_chk CHECK (
    (checkin_latitude IS NULL) = (checkin_longitude IS NULL)
    AND (checkin_latitude IS NULL OR checkin_latitude BETWEEN -90 AND 90)
    AND (checkin_longitude IS NULL OR checkin_longitude BETWEEN -180 AND 180)
    AND (checkin_accuracy_m IS NULL OR checkin_accuracy_m BETWEEN 0 AND 100000)
    AND (status NOT IN ('checked_in', 'done') OR checkin_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_field_visits_person_day
  ON field_visits (company_id, candidate_id, visit_date);

CREATE INDEX IF NOT EXISTS idx_field_visits_company_day
  ON field_visits (company_id, visit_date);

CREATE TABLE IF NOT EXISTS field_expenses (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  visit_id            BIGINT REFERENCES field_visits(id) ON DELETE SET NULL,
  expense_date        DATE NOT NULL,
  category            TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            CHAR(3) NOT NULL DEFAULT 'BRL',
  description         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  receipt_file_key    TEXT,
  receipt_file_name   TEXT NOT NULL DEFAULT '',
  decided_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  decision_note       TEXT NOT NULL DEFAULT '',
  idempotency_key     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_status_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_category_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_category_chk CHECK (category IN (
    'mileage', 'fuel', 'meal', 'parking', 'toll', 'transport', 'lodging', 'other'
  ));

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_amount_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_amount_chk CHECK (amount_cents > 0 AND amount_cents <= 10000000);

ALTER TABLE field_expenses DROP CONSTRAINT IF EXISTS field_expenses_text_chk;
ALTER TABLE field_expenses
  ADD CONSTRAINT field_expenses_text_chk CHECK (
    char_length(description) BETWEEN 3 AND 500
    AND char_length(decision_note) <= 500
    AND char_length(receipt_file_name) <= 200
    AND currency ~ '^[A-Z]{3}$'
    AND (idempotency_key IS NULL OR char_length(idempotency_key) <= 128)
  );

CREATE INDEX IF NOT EXISTS idx_field_expenses_queue
  ON field_expenses (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_expenses_person
  ON field_expenses (company_id, candidate_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_field_expenses_idempotency
  ON field_expenses (company_id, candidate_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('154_field_team.sql')
ON CONFLICT (name) DO NOTHING;
