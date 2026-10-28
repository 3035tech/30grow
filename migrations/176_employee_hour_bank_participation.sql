-- Participação individual no banco de horas, com vigência própria.
-- Sem registro vigente, o colaborador segue a configuração da empresa.
-- O saldo já acumulado e os lançamentos aprovados permanecem preservados.
CREATE TABLE IF NOT EXISTS employee_hour_bank_participation (
  company_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  valid_from DATE NOT NULL,
  enabled BOOLEAN NOT NULL,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, candidate_id, valid_from),
  CONSTRAINT employee_hour_bank_participation_candidate_fk
    FOREIGN KEY (company_id, candidate_id) REFERENCES candidates(company_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE employee_hour_bank_participation IS
  'Exceções individuais com vigência: sem linha anterior à data, participa quando o banco da empresa está ativo.';

CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_participation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, OLD.candidate_id, OLD.valid_from);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NEW.candidate_id, NEW.valid_from);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_participation ON employee_hour_bank_participation;
CREATE TRIGGER trg_hour_bank_ckpt_participation
  AFTER INSERT OR UPDATE OR DELETE ON employee_hour_bank_participation
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_participation();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grow30_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON employee_hour_bank_participation TO grow30_app;
  END IF;
END $$;
