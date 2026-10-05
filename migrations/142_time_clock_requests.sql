-- 142: Pedidos do colaborador no ponto (ajuste de marcações e abono), com aprovação do RH/gestor.
--
-- Modelagem:
-- * Pedido é entidade própria (quem, dia, tipo, situação, justificativa, anexo, decisão):
--   tem ciclo de vida e histórico, então não cabe em colunas da marcação nem do abono.
-- * As alterações propostas de um ajuste são linhas relacionais (incluir / desconsiderar),
--   não JSONB: a marcação desconsiderada é FK para employee_time_punches, e o horário
--   incluído tem tipo fixo (in/out). Nada é aplicado antes da aprovação; ao aprovar, o
--   sistema usa o mesmo caminho do ajuste do gestor (desconsidera + inclui, nunca edita).
-- * Abono pode ser do dia inteiro ou de um intervalo (excuse_start/excuse_end). O abono
--   efetivado continua em employee_time_day_justifications, que ganha o intervalo e a
--   referência ao pedido de origem.
-- * No máximo um pedido pendente por pessoa, dia e tipo (índice único parcial).

CREATE TABLE IF NOT EXISTS employee_time_requests (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  work_on             DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  justification       TEXT NOT NULL,
  excuse_reason       TEXT,
  excuse_start        TIME,
  excuse_end          TIME,
  file_key            TEXT,
  file_name           TEXT NOT NULL DEFAULT '',
  decided_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  decision_note       TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_time_requests_kind_chk CHECK (kind IN ('adjustment', 'excuse')),
  CONSTRAINT employee_time_requests_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT employee_time_requests_justification_len
    CHECK (char_length(btrim(justification)) BETWEEN 3 AND 1000),
  CONSTRAINT employee_time_requests_excuse_reason_chk
    CHECK (excuse_reason IS NULL
           OR excuse_reason IN ('medical_certificate', 'excused_absence', 'day_off', 'other')),
  CONSTRAINT employee_time_requests_excuse_shape_chk CHECK (
    (kind = 'adjustment' AND excuse_reason IS NULL AND excuse_start IS NULL AND excuse_end IS NULL)
    OR (kind = 'excuse' AND excuse_reason IS NOT NULL
        AND ((excuse_start IS NULL AND excuse_end IS NULL)
             OR (excuse_start IS NOT NULL AND excuse_end IS NOT NULL AND excuse_end > excuse_start)))
  ),
  CONSTRAINT employee_time_requests_decision_chk
    CHECK ((status IN ('approved', 'rejected')) = (decided_at IS NOT NULL)),
  CONSTRAINT employee_time_requests_decision_note_len CHECK (char_length(decision_note) <= 500),
  CONSTRAINT employee_time_requests_file_name_len CHECK (char_length(file_name) <= 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_time_requests_pending
  ON employee_time_requests (candidate_id, work_on, kind)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_employee_time_requests_queue
  ON employee_time_requests (company_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_employee_time_requests_person_day
  ON employee_time_requests (company_id, candidate_id, work_on);

COMMENT ON TABLE employee_time_requests IS
  'Pedido do colaborador no ponto: ajuste de marcações ou abono. Só altera o espelho quando aprovado.';

CREATE TABLE IF NOT EXISTS employee_time_request_punches (
  id          BIGSERIAL PRIMARY KEY,
  request_id  BIGINT NOT NULL REFERENCES employee_time_requests(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  punch_id    BIGINT REFERENCES employee_time_punches(id) ON DELETE CASCADE,
  punch_time  TIME,
  punch_kind  TEXT,
  CONSTRAINT employee_time_request_punches_action_chk CHECK (
    (action = 'void' AND punch_id IS NOT NULL AND punch_time IS NULL AND punch_kind IS NULL)
    OR (action = 'add' AND punch_id IS NULL AND punch_time IS NOT NULL AND punch_kind IN ('in', 'out'))
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_time_request_punches_request
  ON employee_time_request_punches (request_id);

COMMENT ON TABLE employee_time_request_punches IS
  'Alterações propostas num pedido de ajuste: incluir horário (add) ou desconsiderar marcação existente (void).';

ALTER TABLE employee_time_day_justifications
  ADD COLUMN IF NOT EXISTS excused_start TIME,
  ADD COLUMN IF NOT EXISTS excused_end TIME,
  ADD COLUMN IF NOT EXISTS source_request_id BIGINT REFERENCES employee_time_requests(id) ON DELETE SET NULL;

ALTER TABLE employee_time_day_justifications
  DROP CONSTRAINT IF EXISTS employee_time_day_justifications_interval_chk;
ALTER TABLE employee_time_day_justifications
  ADD CONSTRAINT employee_time_day_justifications_interval_chk CHECK (
    (excused_start IS NULL AND excused_end IS NULL)
    OR (excused_start IS NOT NULL AND excused_end IS NOT NULL AND excused_end > excused_start)
  );

COMMENT ON COLUMN employee_time_day_justifications.excused_start IS
  'Início do intervalo abonado. NULL com excused_end NULL = dia inteiro.';
COMMENT ON COLUMN employee_time_day_justifications.source_request_id IS
  'Pedido do colaborador que originou o abono (NULL quando lançado direto pelo gestor).';
