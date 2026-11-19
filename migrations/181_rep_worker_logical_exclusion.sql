-- Preserve worker identity and fiscal history while recording explicit REP inclusion/exclusion.
ALTER TABLE rep_workers
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS rep_workers_active_lookup
  ON rep_workers(company_id, candidate_id) WHERE active = TRUE;

CREATE OR REPLACE FUNCTION rep_guard_worker_deactivation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE last_kind TEXT;
BEGIN
  IF OLD.active AND NOT NEW.active THEN
    SELECT punch_kind INTO last_kind
      FROM public.employee_time_punches
      WHERE company_id=OLD.company_id AND candidate_id=OLD.candidate_id
        AND voided_at IS NULL
        AND public.time_clock_work_day(company_id,candidate_id,punched_at)=
            public.time_clock_work_day(OLD.company_id,OLD.candidate_id,clock_timestamp())
      ORDER BY punched_at DESC,id DESC
      LIMIT 1;
    IF last_kind='in' THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='REP_WORKER_OPEN_SHIFT';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_worker_status_open_shift_guard ON rep_workers;
CREATE TRIGGER rep_worker_status_open_shift_guard
  BEFORE UPDATE OF active ON rep_workers
  FOR EACH ROW EXECUTE FUNCTION rep_guard_worker_deactivation();

CREATE OR REPLACE FUNCTION rep_configuration_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; typ integer; operation char(1);
BEGIN
 IF TG_TABLE_NAME='rep_establishments' THEN
  IF TG_OP='UPDATE' AND ((NEW.company_id,NEW.employer_document,NEW.timezone) IS DISTINCT FROM (OLD.company_id,OLD.employer_document,OLD.timezone) OR (NEW.registration IS DISTINCT FROM OLD.registration AND NOT (length(OLD.registration)=17 AND length(NEW.registration)<17 AND OLD.registration=lpad(NEW.registration,17,'0')))) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.id FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.employer_name,NEW.workplace,NEW.responsible_cpf,NEW.complementary_document,NEW.registration) IS NOT DISTINCT FROM (OLD.employer_name,OLD.workplace,OLD.responsible_cpf,OLD.complementary_document,OLD.registration) THEN RETURN NEW; END IF;
  typ:=2;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.candidates WHERE id=NEW.candidate_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'REP_WORKER_TENANT'; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.establishment_id,NEW.candidate_id,NEW.cpf,NEW.weekly_rest_day) IS DISTINCT FROM (OLD.company_id,OLD.establishment_id,OLD.candidate_id,OLD.cpf,OLD.weekly_rest_day) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  operation:='I';
  IF TG_OP='UPDATE' THEN
   IF NEW.active IS DISTINCT FROM OLD.active THEN operation:=CASE WHEN NEW.active THEN 'I' ELSE 'E' END;
   ELSIF (NEW.worker_name,NEW.responsible_cpf) IS NOT DISTINCT FROM (OLD.worker_name,OLD.responsible_cpf) THEN RETURN NEW;
   ELSE operation:='A'; END IF;
  END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.establishment_id FOR UPDATE;
  typ:=5;
 END IF;
 PERFORM public.rep_stamp(at,e.timezone);
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 IF typ=2 THEN raw:=lpad(n::text,9,'0')||'2'||public.rep_stamp(at,e.timezone)||public.rep_field(NEW.responsible_cpf,14)||CASE WHEN length(e.employer_document)=14 THEN '1' ELSE '2' END||public.rep_field(e.employer_document,14)||public.rep_field(e.complementary_document,14)||public.rep_field(e.employer_name,150)||public.rep_field(e.workplace,100);
 ELSE raw:=lpad(n::text,9,'0')||'5'||public.rep_stamp(at,e.timezone)||operation||lpad(NEW.cpf,12,'0')||public.rep_field(NEW.worker_name,52)||'    '||NEW.responsible_cpf; END IF;
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text)
 VALUES(e.id,n,typ,at,raw||public.rep_crc(raw)); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION rep_capture_punch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE w public.rep_workers%ROWTYPE; e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; h text; collector text;
BEGIN
 IF NEW.source='manager' THEN RETURN NEW; END IF;
 SELECT * INTO w FROM public.rep_workers WHERE company_id=NEW.company_id AND candidate_id=NEW.candidate_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NOT w.active THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='REP_WORKER_EXCLUDED'; END IF;
 SELECT * INTO e FROM public.rep_establishments WHERE id=w.establishment_id FOR UPDATE;
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 collector:=NEW.rep_collector;
 raw:=lpad(n::text,9,'0')||'7'||public.rep_stamp(NEW.punched_at,e.timezone)||lpad(w.cpf,12,'0')||public.rep_stamp(at,e.timezone)||collector||'0';
 h:=encode(public.digest(convert_to(raw||e.last_punch_hash,'LATIN1'),'sha256'),'hex');
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,punch_id,worker_id,record_text,record_hash,previous_hash)
 VALUES(e.id,n,7,at,NEW.id,w.id,raw||h,h,e.last_punch_hash);
 UPDATE public.rep_establishments SET last_punch_hash=h WHERE id=e.id;
 RETURN NEW;
END $$;

INSERT INTO schema_migrations(name) VALUES('181_rep_worker_logical_exclusion.sql') ON CONFLICT(name) DO NOTHING;
