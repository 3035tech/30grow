-- 143: Ponto fase 2: jornada por colaborador, feriados e banco de horas calculado.
--
-- Modelagem:
-- * Jornada própria é vigente a partir de uma data (valid_from): mudar a jornada não
--   reescreve dias anteriores. Uma linha com follows_company = TRUE volta para a escala
--   da empresa a partir daquela data. Dias da semana são um conjunto fechado 0–6
--   (0 = domingo), validado por CHECK; horários de intervalo ficam dentro da jornada.
-- * Feriado é cadastro da empresa, opcionalmente restrito a uma unidade (vale para a
--   unidade e as subunidades). Recorrência e origem são domínios fixos. Um feriado por
--   empresa/unidade/data.
-- * Banco calculado: saldo = abertura (lançamentos aprovados antes de hour_bank_started_on)
--   + extras − faltas do espelho a partir dessa data + lançamentos do RH, com teto da
--   empresa. No fechamento, o saldo de cada pessoa no fim do período é congelado em
--   time_clock_closure_balances; o cálculo seguinte parte desse valor.

CREATE TABLE IF NOT EXISTS employee_time_schedules (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  valid_from          DATE NOT NULL,
  follows_company     BOOLEAN NOT NULL DEFAULT FALSE,
  workday_start       TIME,
  workday_end         TIME,
  break_start         TIME,
  break_end           TIME,
  weekdays            SMALLINT[],
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_time_schedules_shape_chk CHECK (
    (follows_company
      AND workday_start IS NULL AND workday_end IS NULL
      AND break_start IS NULL AND break_end IS NULL AND weekdays IS NULL)
    OR (NOT follows_company
      AND workday_start IS NOT NULL AND workday_end IS NOT NULL AND workday_end > workday_start
      AND weekdays IS NOT NULL
      AND cardinality(weekdays) BETWEEN 1 AND 7
      AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
      AND ((break_start IS NULL AND break_end IS NULL)
        OR (break_start IS NOT NULL AND break_end IS NOT NULL
            AND break_start >= workday_start AND break_end <= workday_end
            AND break_end > break_start)))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_time_schedules_from
  ON employee_time_schedules (company_id, candidate_id, valid_from);

COMMENT ON TABLE employee_time_schedules IS
  'Jornada própria do colaborador, vigente a partir de valid_from. Sem linha vigente = escala da empresa (seg–sex).';
COMMENT ON COLUMN employee_time_schedules.weekdays IS
  'Dias de trabalho: 0 = domingo … 6 = sábado.';

CREATE TABLE IF NOT EXISTS company_holidays (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  org_unit_id         INTEGER,
  name                TEXT NOT NULL,
  holiday_on          DATE NOT NULL,
  recurrence          TEXT NOT NULL DEFAULT 'once',
  source              TEXT NOT NULL DEFAULT 'manual',
  created_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_holidays_org_unit_fk
    FOREIGN KEY (org_unit_id, company_id) REFERENCES org_units(id, company_id),
  CONSTRAINT company_holidays_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT company_holidays_recurrence_chk CHECK (recurrence IN ('once', 'yearly')),
  CONSTRAINT company_holidays_source_chk CHECK (source IN ('manual', 'national'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_holidays_day
  ON company_holidays (company_id, (COALESCE(org_unit_id, 0)), holiday_on);

CREATE INDEX IF NOT EXISTS idx_company_holidays_company_day
  ON company_holidays (company_id, holiday_on);

COMMENT ON TABLE company_holidays IS
  'Feriados da empresa (org_unit_id NULL) ou de uma unidade e subunidades. yearly = repete no mesmo dia/mês a partir do ano de holiday_on.';

ALTER TABLE company_time_schedules
  ADD COLUMN IF NOT EXISTS hour_bank_started_on DATE NOT NULL DEFAULT CURRENT_DATE;

COMMENT ON COLUMN company_time_schedules.hour_bank_started_on IS
  'Início do banco calculado pelo espelho. Lançamentos aprovados antes desta data formam o saldo de abertura.';

CREATE TABLE IF NOT EXISTS time_clock_closure_balances (
  closure_id       BIGINT NOT NULL REFERENCES time_clock_closures(id) ON DELETE CASCADE,
  company_id       BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id     BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  balance_minutes  INT NOT NULL,
  extra_minutes    INT NOT NULL DEFAULT 0,
  missing_minutes  INT NOT NULL DEFAULT 0,
  manual_minutes   INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (closure_id, candidate_id),
  CONSTRAINT time_clock_closure_balances_totals_chk
    CHECK (extra_minutes >= 0 AND missing_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_time_clock_closure_balances_person
  ON time_clock_closure_balances (company_id, candidate_id);

COMMENT ON TABLE time_clock_closure_balances IS
  'Saldo do banco congelado no fim de cada fechamento (por pessoa) e totais do período.';
