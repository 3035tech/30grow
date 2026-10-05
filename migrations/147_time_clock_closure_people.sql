-- 147: B-2721 item 9 — resumo congelado por pessoa em cada fechamento de ponto +
-- assinatura (ou contestação) do espelho pelo colaborador.
--
-- Modelagem:
--   * Uma linha por (fechamento, pessoa) com os totais do período no momento do
--     fechamento. Relacional (não JSONB): é listado, filtrado por status e exportado.
--   * O saldo do banco continua em time_clock_closure_balances (join na leitura).
--   * ack_status é domínio fechado (pending / signed / disputed). Contestação exige
--     motivo; quem contestou pode assinar depois (RH corrigiu e explicou).
--   * snapshot_hash = sha256 dos totais + período: prova de que o colaborador assinou
--     exatamente estes números.
--   * Cancelar o fechamento mantém as linhas (histórico); um novo fechamento gera novas.
-- Reaplicável.

CREATE TABLE IF NOT EXISTS time_clock_closure_people (
  closure_id          BIGINT NOT NULL REFERENCES time_clock_closures(id) ON DELETE CASCADE,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  expected_minutes    INT NOT NULL DEFAULT 0,
  worked_minutes      INT NOT NULL DEFAULT 0,
  extra_minutes       INT NOT NULL DEFAULT 0,
  missing_minutes     INT NOT NULL DEFAULT 0,
  workdays            SMALLINT NOT NULL DEFAULT 0,
  absence_days        SMALLINT NOT NULL DEFAULT 0,
  justified_days      SMALLINT NOT NULL DEFAULT 0,
  incomplete_days     SMALLINT NOT NULL DEFAULT 0,
  snapshot_hash       TEXT NOT NULL,
  ack_status          TEXT NOT NULL DEFAULT 'pending',
  ack_at              TIMESTAMPTZ,
  signer_name         TEXT NOT NULL DEFAULT '',
  signer_ip           TEXT,
  signer_user_agent   TEXT,
  consent_version     TEXT NOT NULL DEFAULT '',
  dispute_note        TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (closure_id, candidate_id),
  CONSTRAINT time_clock_closure_people_totals_chk CHECK (
    expected_minutes >= 0 AND worked_minutes >= 0 AND extra_minutes >= 0 AND missing_minutes >= 0
    AND workdays >= 0 AND absence_days >= 0 AND justified_days >= 0 AND incomplete_days >= 0
  ),
  CONSTRAINT time_clock_closure_people_ack_status_chk
    CHECK (ack_status IN ('pending', 'signed', 'disputed')),
  CONSTRAINT time_clock_closure_people_ack_at_chk
    CHECK ((ack_status = 'pending') = (ack_at IS NULL)),
  CONSTRAINT time_clock_closure_people_signed_chk
    CHECK (ack_status <> 'signed' OR char_length(btrim(signer_name)) BETWEEN 3 AND 120),
  CONSTRAINT time_clock_closure_people_dispute_chk
    CHECK (ack_status <> 'disputed' OR char_length(btrim(dispute_note)) BETWEEN 10 AND 1000),
  CONSTRAINT time_clock_closure_people_lengths_chk CHECK (
    char_length(signer_name) <= 120 AND char_length(dispute_note) <= 1000
    AND char_length(consent_version) <= 40 AND char_length(snapshot_hash) = 64
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'time_clock_closure_people_signer_meta_chk'
  ) THEN
    ALTER TABLE time_clock_closure_people
      ADD CONSTRAINT time_clock_closure_people_signer_meta_chk CHECK (
        (signer_ip IS NULL OR char_length(signer_ip) <= 64)
        AND (signer_user_agent IS NULL OR char_length(signer_user_agent) <= 300)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_time_clock_closure_people_person
  ON time_clock_closure_people (company_id, candidate_id, closure_id DESC);

COMMENT ON TABLE time_clock_closure_people IS
  'Resumo congelado do ponto por pessoa em cada fechamento + assinatura/contestação do espelho pelo colaborador.';
COMMENT ON COLUMN time_clock_closure_people.ack_status IS
  'pending = aguardando o colaborador; signed = assinou (nome + consentimento); disputed = contestou com motivo.';
COMMENT ON COLUMN time_clock_closure_people.snapshot_hash IS
  'sha256 hex de período + totais no fechamento; mostrado no recibo e no CSV.';
