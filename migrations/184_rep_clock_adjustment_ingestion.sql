-- Immutable, idempotent host-reported clock adjustments; only the trigger emits AFD type 4.
CREATE TABLE IF NOT EXISTS rep_clock_adjustment_events (
  event_id UUID PRIMARY KEY,
  before_at TIMESTAMPTZ NOT NULL,
  adjusted_at TIMESTAMPTZ NOT NULL,
  responsible_cpf VARCHAR(11) NOT NULL CHECK (responsible_cpf ~ '^[0-9]{11}$'),
  source VARCHAR(100) NOT NULL CHECK (source ~ '^[A-Za-z0-9._:-]{1,100}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (before_at IS DISTINCT FROM adjusted_at)
);

ALTER TABLE rep_original_records
  ADD COLUMN IF NOT EXISTS source_event_id UUID
  REFERENCES rep_clock_adjustment_events(event_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS rep_original_records_clock_event_unique
  ON rep_original_records(establishment_id,source_event_id)
  WHERE source_event_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='rep_original_records_clock_event_type_check'
      AND conrelid='rep_original_records'::regclass
  ) THEN
    ALTER TABLE rep_original_records
      ADD CONSTRAINT rep_original_records_clock_event_type_check
      CHECK ((record_type=4) = (source_event_id IS NOT NULL));
  END IF;
END $$;

DROP TRIGGER IF EXISTS rep_clock_adjustment_immutable ON rep_clock_adjustment_events;
CREATE TRIGGER rep_clock_adjustment_immutable
  BEFORE UPDATE OR DELETE ON rep_clock_adjustment_events
  FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_clock_adjustment_no_truncate ON rep_clock_adjustment_events;
CREATE TRIGGER rep_clock_adjustment_no_truncate
  BEFORE TRUNCATE ON rep_clock_adjustment_events
  FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();

CREATE OR REPLACE FUNCTION rep_capture_clock_adjustment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  e RECORD;
  n BIGINT;
  raw TEXT;
  affected INTEGER := 0;
BEGIN
  FOR e IN
    SELECT id,timezone FROM public.rep_establishments ORDER BY id FOR UPDATE
  LOOP
    UPDATE public.rep_establishments
      SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
    raw := lpad(n::text,9,'0')||'4'||
      public.rep_stamp(NEW.before_at,e.timezone)||
      public.rep_stamp(NEW.adjusted_at,e.timezone)||NEW.responsible_cpf;
    INSERT INTO public.rep_original_records(
      establishment_id,nsr,record_type,recorded_at,record_text,source_event_id
    ) VALUES (
      e.id,n,4,NEW.recorded_at,raw||public.rep_crc(raw),NEW.event_id
    );
    affected := affected+1;
  END LOOP;
  IF affected=0 THEN
    RAISE EXCEPTION 'REP_CLOCK_NO_ESTABLISHMENTS' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rep_capture_clock_adjustment ON rep_clock_adjustment_events;
CREATE TRIGGER rep_capture_clock_adjustment
  AFTER INSERT ON rep_clock_adjustment_events
  FOR EACH ROW EXECUTE FUNCTION rep_capture_clock_adjustment();

INSERT INTO schema_migrations(name)
VALUES('184_rep_clock_adjustment_ingestion.sql')
ON CONFLICT(name) DO NOTHING;
