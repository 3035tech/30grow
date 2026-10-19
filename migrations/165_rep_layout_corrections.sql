-- Forward-only formatting fix: do not modify any historical fiscal record or hash.
-- Accept the real numeric INPI identifier; field width belongs to the serializer.
ALTER TABLE rep_establishments DROP CONSTRAINT IF EXISTS rep_establishments_registration_check;
ALTER TABLE rep_establishments ADD CONSTRAINT rep_establishments_registration_check CHECK (registration ~ '^[0-9]{1,17}$');
-- Explicit removal of legacy left zero padding is permitted, never automatic.
-- All other identity changes remain forbidden. The correction appends an event.
CREATE OR REPLACE FUNCTION rep_configuration_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; typ integer;
BEGIN
 IF TG_TABLE_NAME='rep_establishments' THEN
  IF TG_OP='UPDATE' AND ((NEW.company_id,NEW.employer_document,NEW.timezone) IS DISTINCT FROM (OLD.company_id,OLD.employer_document,OLD.timezone) OR (NEW.registration IS DISTINCT FROM OLD.registration AND NOT (length(OLD.registration)=17 AND length(NEW.registration)<17 AND OLD.registration=lpad(NEW.registration,17,'0')))) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.id FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.employer_name,NEW.workplace,NEW.responsible_cpf,NEW.complementary_document,NEW.registration) IS NOT DISTINCT FROM (OLD.employer_name,OLD.workplace,OLD.responsible_cpf,OLD.complementary_document,OLD.registration) THEN RETURN NEW; END IF;
  typ:=2;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.candidates WHERE id=NEW.candidate_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'REP_WORKER_TENANT'; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.establishment_id,NEW.candidate_id,NEW.cpf,NEW.weekly_rest_day) IS DISTINCT FROM (OLD.company_id,OLD.establishment_id,OLD.candidate_id,OLD.cpf,OLD.weekly_rest_day) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  IF TG_OP='UPDATE' AND (NEW.worker_name,NEW.responsible_cpf) IS NOT DISTINCT FROM (OLD.worker_name,OLD.responsible_cpf) THEN RETURN NEW; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.establishment_id FOR UPDATE;
  typ:=5;
 END IF;
 PERFORM public.rep_stamp(at,e.timezone);
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 IF typ=2 THEN raw:=lpad(n::text,9,'0')||'2'||public.rep_stamp(at,e.timezone)||public.rep_field(NEW.responsible_cpf,14)||CASE WHEN length(e.employer_document)=14 THEN '1' ELSE '2' END||public.rep_field(e.employer_document,14)||public.rep_field(e.complementary_document,14)||public.rep_field(e.employer_name,150)||public.rep_field(e.workplace,100);
 ELSE raw:=lpad(n::text,9,'0')||'5'||public.rep_stamp(at,e.timezone)||CASE WHEN TG_OP='INSERT' THEN 'I' ELSE 'A' END||lpad(NEW.cpf,12,'0')||public.rep_field(NEW.worker_name,52)||'    '||NEW.responsible_cpf;
 END IF;
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text)
 VALUES(e.id,n,typ,at,raw||public.rep_crc(raw)); RETURN NEW;
END $$;

INSERT INTO schema_migrations(name) VALUES('165_rep_layout_corrections.sql') ON CONFLICT(name) DO NOTHING;
