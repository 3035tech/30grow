-- Registra eventos AFD tipo 6 apenas para transições entre observações conhecidas.
-- A primeira leitura de cada estabelecimento fica como linha de base, sem evento presumido.
CREATE OR REPLACE FUNCTION rep_capture_service_state() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  e public.rep_establishments%ROWTYPE;
  prior BOOLEAN;
  has_prior BOOLEAN;
  n BIGINT;
BEGIN
  SELECT * INTO e
    FROM public.rep_establishments
    WHERE id=NEW.establishment_id
    FOR UPDATE;

  SELECT available INTO prior
    FROM public.rep_service_observations
    WHERE establishment_id=NEW.establishment_id AND id<NEW.id
    ORDER BY id DESC
    LIMIT 1;
  has_prior := FOUND;

  IF NOT has_prior OR prior=NEW.available THEN RETURN NEW; END IF;

  UPDATE public.rep_establishments
    SET last_nsr=last_nsr+1
    WHERE id=e.id
    RETURNING last_nsr INTO n;

  INSERT INTO public.rep_original_records(
    establishment_id,nsr,record_type,recorded_at,record_text
  ) VALUES (
    e.id,n,6,NEW.recorded_at,
    lpad(n::text,9,'0')||'6'||public.rep_stamp(NEW.recorded_at,e.timezone)||
      CASE WHEN NEW.available THEN '07' ELSE '08' END
  );
  RETURN NEW;
END $$;

INSERT INTO schema_migrations(name)
VALUES('182_rep_service_state_transitions.sql')
ON CONFLICT(name) DO NOTHING;
