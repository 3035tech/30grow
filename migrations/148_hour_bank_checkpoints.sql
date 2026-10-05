-- 148: Banco de horas incremental (B-2804.1): checkpoint de saldo por pessoa.
--
-- Modelagem:
-- * Sem fechamento, o saldo era recalculado desde o início do banco a cada leitura
--   (custo ∝ pessoas × dias). O cron hour-bank-checkpoints grava, por pessoa, o saldo
--   num dia já passado (as_of, ~1 mês atrás); a leitura parte do mais recente entre
--   esse checkpoint e o último fechamento e só recalcula os dias seguintes.
-- * Um checkpoint por pessoa (PK company_id + candidate_id): é cache, não histórico.
--   O histórico auditável continua em time_clock_closure_balances.
-- * calc_version: o código ignora checkpoints de outra versão do cálculo (mudança de
--   regra não reaproveita saldo calculado com a regra antiga).
-- * Invalidação no banco, não na aplicação: triggers em todas as entradas do cálculo
--   (marcações, justificativas, lançamentos, jornadas, feriados, escala da empresa,
--   dados do colaborador que mudam elegibilidade/calendário, unidades e fechamentos)
--   apagam os checkpoints com as_of >= dia afetado. Nenhum caminho de escrita esquece.
-- * Corrida cron × edição: o cron calcula e grava sob pg_advisory_xact_lock exclusivo
--   da empresa; a invalidação pega o mesmo lock compartilhado. Uma edição concorrente
--   ou entra antes (o cálculo já a enxerga) ou espera o cron e apaga o checkpoint.
--
-- Idempotente. Rollback (o código antigo não usa a tabela); as funções de trigger primeiro,
-- pois o CASCADE delas remove os triggers e o corpo plpgsql não cria dependência:
--   DROP FUNCTION IF EXISTS hour_bank_ckpt_on_punch, hour_bank_ckpt_on_work_day,
--     hour_bank_ckpt_on_schedule, hour_bank_ckpt_on_holiday, hour_bank_ckpt_on_closure,
--     hour_bank_ckpt_on_company, hour_bank_ckpt_on_candidate CASCADE;
--   DROP FUNCTION IF EXISTS hour_bank_checkpoint_invalidate(BIGINT, BIGINT, DATE);
--   DROP TABLE IF EXISTS hour_bank_checkpoints;

CREATE TABLE IF NOT EXISTS hour_bank_checkpoints (
  company_id       BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id     BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  as_of            DATE NOT NULL,
  balance_minutes  INT NOT NULL,
  calc_version     SMALLINT NOT NULL,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, candidate_id),
  CONSTRAINT hour_bank_checkpoints_version_chk CHECK (calc_version > 0)
);

COMMENT ON TABLE hour_bank_checkpoints IS
  'Cache do saldo do banco de horas em as_of (dia passado). Apagado por trigger quando uma entrada do cálculo muda em dia <= as_of.';

-- Lock key: (3035148, company_id). Shared here; exclusive in the checkpoint cron.
CREATE OR REPLACE FUNCTION hour_bank_checkpoint_invalidate(p_company BIGINT, p_candidate BIGINT, p_from DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_company IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(3035148, (p_company % 2147483647)::int);
  DELETE FROM hour_bank_checkpoints
  WHERE company_id = p_company
    AND (p_candidate IS NULL OR candidate_id = p_candidate)
    AND (p_from IS NULL OR as_of >= p_from);
END;
$$;

-- Punches: the local day is unknown here (company time zone), so go one UTC day back.
CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_punch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, OLD.candidate_id, (OLD.punched_at AT TIME ZONE 'UTC')::date - 1);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NEW.candidate_id, (NEW.punched_at AT TIME ZONE 'UTC')::date - 1);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_work_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, OLD.candidate_id, OLD.work_on);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NEW.candidate_id, NEW.work_on);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, OLD.candidate_id, OLD.valid_from);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NEW.candidate_id, NEW.valid_from);
  END IF;
  RETURN NULL;
END;
$$;

-- Yearly holidays repeat after holiday_on, so everything from that day on is affected.
CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_holiday() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, NULL, OLD.holiday_on);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NULL, NEW.holiday_on);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, NULL, OLD.period_start);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NULL, NEW.period_start);
  END IF;
  RETURN NULL;
END;
$$;

-- Whole company: schedule/cap/start/time zone, or unit tree (holiday inheritance).
CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM hour_bank_checkpoint_invalidate(OLD.company_id, NULL, NULL);
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NULL, NULL);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hour_bank_ckpt_on_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM hour_bank_checkpoint_invalidate(NEW.company_id, NEW.id, NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_punch ON employee_time_punches;
CREATE TRIGGER trg_hour_bank_ckpt_punch
  AFTER INSERT OR UPDATE OR DELETE ON employee_time_punches
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_punch();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_justification ON employee_time_day_justifications;
CREATE TRIGGER trg_hour_bank_ckpt_justification
  AFTER INSERT OR UPDATE OR DELETE ON employee_time_day_justifications
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_work_day();

-- Pending entries never count; only rows approved before or after the change matter.
DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_entry_ins ON employee_hour_bank_entries;
CREATE TRIGGER trg_hour_bank_ckpt_entry_ins
  AFTER INSERT ON employee_hour_bank_entries
  FOR EACH ROW WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION hour_bank_ckpt_on_work_day();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_entry_upd ON employee_hour_bank_entries;
CREATE TRIGGER trg_hour_bank_ckpt_entry_upd
  AFTER UPDATE ON employee_hour_bank_entries
  FOR EACH ROW WHEN (OLD.status = 'approved' OR NEW.status = 'approved')
  EXECUTE FUNCTION hour_bank_ckpt_on_work_day();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_entry_del ON employee_hour_bank_entries;
CREATE TRIGGER trg_hour_bank_ckpt_entry_del
  AFTER DELETE ON employee_hour_bank_entries
  FOR EACH ROW WHEN (OLD.status = 'approved')
  EXECUTE FUNCTION hour_bank_ckpt_on_work_day();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_schedule ON employee_time_schedules;
CREATE TRIGGER trg_hour_bank_ckpt_schedule
  AFTER INSERT OR UPDATE OR DELETE ON employee_time_schedules
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_schedule();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_holiday ON company_holidays;
CREATE TRIGGER trg_hour_bank_ckpt_holiday
  AFTER INSERT OR UPDATE OR DELETE ON company_holidays
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_holiday();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_closure ON time_clock_closures;
CREATE TRIGGER trg_hour_bank_ckpt_closure
  AFTER INSERT OR UPDATE OF status, period_start, period_end OR DELETE ON time_clock_closures
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_closure();

-- The settings upsert rewrites every column on each save; only a real change counts.
-- Compared as "all but audit columns" so a future column invalidates by default.
DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_company_schedule ON company_time_schedules;
CREATE TRIGGER trg_hour_bank_ckpt_company_schedule
  AFTER INSERT OR DELETE ON company_time_schedules
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_company();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_company_schedule_upd ON company_time_schedules;
CREATE TRIGGER trg_hour_bank_ckpt_company_schedule_upd
  AFTER UPDATE ON company_time_schedules
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'updated_at' - 'updated_by_user_id')
        IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'updated_by_user_id'))
  EXECUTE FUNCTION hour_bank_ckpt_on_company();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_org_unit ON org_units;
CREATE TRIGGER trg_hour_bank_ckpt_org_unit
  AFTER UPDATE OF parent_id OR DELETE ON org_units
  FOR EACH ROW EXECUTE FUNCTION hour_bank_ckpt_on_company();

DROP TRIGGER IF EXISTS trg_hour_bank_ckpt_candidate ON candidates;
CREATE TRIGGER trg_hour_bank_ckpt_candidate
  AFTER UPDATE OF work_format, time_clock_override, start_date, hired_at, org_unit_id ON candidates
  FOR EACH ROW
  WHEN (OLD.work_format IS DISTINCT FROM NEW.work_format
     OR OLD.time_clock_override IS DISTINCT FROM NEW.time_clock_override
     OR OLD.start_date IS DISTINCT FROM NEW.start_date
     OR OLD.hired_at IS DISTINCT FROM NEW.hired_at
     OR OLD.org_unit_id IS DISTINCT FROM NEW.org_unit_id)
  EXECUTE FUNCTION hour_bank_ckpt_on_candidate();
