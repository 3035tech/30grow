-- Expand only. Historical punches are not assigned retrospective fiscal numbers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE employee_time_punches ADD COLUMN IF NOT EXISTS rep_collector CHAR(2) NOT NULL DEFAULT '02' CHECK(rep_collector IN ('01','02'));
CREATE TABLE IF NOT EXISTS rep_establishments (
 id BIGSERIAL PRIMARY KEY,
 company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 employer_document VARCHAR(14) NOT NULL UNIQUE CHECK (employer_document ~ '^([0-9]{11}|[A-Z0-9]{12}[0-9]{2})$'),
 employer_name VARCHAR(150) NOT NULL CHECK (length(trim(employer_name))>0),
 workplace VARCHAR(100) NOT NULL CHECK (length(trim(workplace))>0),
 registration VARCHAR(17) NOT NULL CHECK (registration ~ '^[0-9]{17}$'),
 timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
 complementary_document VARCHAR(14) NOT NULL DEFAULT '' CHECK (complementary_document ~ '^([0-9]{12}|[0-9]{14})?$'),
 responsible_cpf VARCHAR(11) NOT NULL CHECK (responsible_cpf ~ '^[0-9]{11}$'),
 last_nsr BIGINT NOT NULL DEFAULT 0 CHECK (last_nsr BETWEEN 0 AND 999999999),
 last_punch_hash VARCHAR(64) NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,company_id)
);
CREATE TABLE IF NOT EXISTS rep_workers (
 id BIGSERIAL PRIMARY KEY,
 company_id BIGINT NOT NULL,
 establishment_id BIGINT NOT NULL,
 candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
 cpf VARCHAR(11) NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
 weekly_rest_day SMALLINT NOT NULL DEFAULT 0 CHECK(weekly_rest_day BETWEEN 0 AND 6),
 worker_name VARCHAR(52) NOT NULL CHECK(length(trim(worker_name))>0),
 responsible_cpf VARCHAR(11) NOT NULL CHECK (responsible_cpf ~ '^[0-9]{11}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(establishment_id,company_id) REFERENCES rep_establishments(id,company_id) ON DELETE RESTRICT,
 UNIQUE(company_id,candidate_id), UNIQUE(establishment_id,cpf)
);
CREATE TABLE IF NOT EXISTS rep_original_records (
 establishment_id BIGINT NOT NULL REFERENCES rep_establishments(id) ON DELETE RESTRICT,
 nsr BIGINT NOT NULL CHECK (nsr BETWEEN 1 AND 999999999),
 record_type SMALLINT NOT NULL CHECK(record_type IN (2,5,6,7)),
 recorded_at TIMESTAMPTZ NOT NULL,
 punch_id BIGINT UNIQUE REFERENCES employee_time_punches(id) ON DELETE RESTRICT,
 worker_id BIGINT REFERENCES rep_workers(id) ON DELETE RESTRICT,
 record_text TEXT NOT NULL CHECK(record_text !~ E'[\r\n]'),
 record_hash VARCHAR(64), previous_hash VARCHAR(64),
 PRIMARY KEY(establishment_id,nsr),
 CHECK ((record_type=7)=(punch_id IS NOT NULL)),
 CHECK(record_type<>7 OR (record_hash ~ '^[a-f0-9]{64}$' AND worker_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS rep_original_records_period ON rep_original_records(establishment_id,recorded_at,nsr);
CREATE TABLE IF NOT EXISTS rep_signed_documents (
 establishment_id BIGINT NOT NULL,
 nsr BIGINT NOT NULL,
 pdf BYTEA NOT NULL,
 sha256 VARCHAR(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 certificate_fingerprint VARCHAR(64) NOT NULL,
 signed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(establishment_id,nsr),
 FOREIGN KEY(establishment_id,nsr) REFERENCES rep_original_records(establishment_id,nsr) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION rep_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REP_IMMUTABLE_RECORD' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS rep_original_immutable ON rep_original_records;
CREATE TRIGGER rep_original_immutable BEFORE UPDATE OR DELETE ON rep_original_records FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_original_no_truncate ON rep_original_records;
CREATE TRIGGER rep_original_no_truncate BEFORE TRUNCATE ON rep_original_records FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_document_immutable ON rep_signed_documents;
CREATE TRIGGER rep_document_immutable BEFORE UPDATE OR DELETE ON rep_signed_documents FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_document_no_truncate ON rep_signed_documents;
CREATE TRIGGER rep_document_no_truncate BEFORE TRUNCATE ON rep_signed_documents FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
-- Fixed fields reject overflow and unrepresentable characters instead of corrupting exports.
CREATE OR REPLACE FUNCTION rep_field(v text,n integer) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF v IS NULL OR char_length(v)>n OR v ~ E'[\r\n]' THEN RAISE EXCEPTION 'REP_INVALID_FIELD'; END IF;
 PERFORM convert_to(v,'LATIN1'); RETURN rpad(v,n,' ');
END $$;
CREATE OR REPLACE FUNCTION rep_stamp(t timestamptz,z text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT to_char(t AT TIME ZONE z,'YYYY-MM-DD"T"HH24:MI:00') ||
 CASE WHEN extract(epoch FROM ((t AT TIME ZONE z)-(t AT TIME ZONE 'UTC'))) < 0 THEN '-' ELSE '+' END ||
 to_char(make_interval(secs=>abs(extract(epoch FROM ((t AT TIME ZONE z)-(t AT TIME ZONE 'UTC'))))) ,'HH24MI')
$$;
CREATE OR REPLACE FUNCTION rep_crc(v text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE b bytea:=convert_to(v,'LATIN1'); crc integer:=0; i integer;j integer;
BEGIN
 FOR i IN 0..length(b)-1 LOOP
 crc:=crc # get_byte(b,i);
 FOR j IN 1..8 LOOP crc:=CASE WHEN (crc & 1)=1 THEN (crc>>1)#33800 ELSE crc>>1 END; END LOOP;
 END LOOP; RETURN lpad(to_hex(crc),4,'0');
END $$;
CREATE OR REPLACE FUNCTION rep_guard_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND (NEW.last_nsr<>0 OR NEW.last_punch_hash<>'') THEN RAISE EXCEPTION 'REP_COUNTER_MANAGED'; END IF;
 IF TG_OP='UPDATE' AND (NEW.last_nsr,NEW.last_punch_hash) IS DISTINCT FROM (OLD.last_nsr,OLD.last_punch_hash) AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'REP_COUNTER_MANAGED'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_guard_counter ON rep_establishments;
CREATE TRIGGER rep_guard_counter BEFORE INSERT OR UPDATE ON rep_establishments FOR EACH ROW EXECUTE FUNCTION rep_guard_counter();
CREATE OR REPLACE FUNCTION rep_guard_append() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'REP_APPEND_INTERNAL_ONLY'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS rep_guard_append ON rep_original_records;
CREATE TRIGGER rep_guard_append BEFORE INSERT ON rep_original_records FOR EACH ROW EXECUTE FUNCTION rep_guard_append();
CREATE OR REPLACE FUNCTION rep_configuration_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; typ integer;
BEGIN
 IF TG_TABLE_NAME='rep_establishments' THEN
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.employer_document,NEW.registration,NEW.timezone) IS DISTINCT FROM (OLD.company_id,OLD.employer_document,OLD.registration,OLD.timezone) THEN RAISE EXCEPTION 'REP_IDENTITY_IMMUTABLE'; END IF;
  SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.id FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.employer_name,NEW.workplace,NEW.responsible_cpf,NEW.complementary_document) IS NOT DISTINCT FROM (OLD.employer_name,OLD.workplace,OLD.responsible_cpf,OLD.complementary_document) THEN RETURN NEW; END IF;
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
 IF typ=2 THEN raw:=lpad(n::text,9,'0')||'2'||public.rep_stamp(at,e.timezone)||lpad(NEW.responsible_cpf,14,'0')||CASE WHEN length(e.employer_document)=14 THEN '1' ELSE '2' END||public.rep_field(e.employer_document,14)||lpad(e.complementary_document,14,'0')||public.rep_field(e.employer_name,150)||public.rep_field(e.workplace,100);
 ELSE raw:=lpad(n::text,9,'0')||'5'||public.rep_stamp(at,e.timezone)||CASE WHEN TG_OP='INSERT' THEN 'I' ELSE 'A' END||lpad(NEW.cpf,12,'0')||public.rep_field(NEW.worker_name,52)||'    '||NEW.responsible_cpf;
 END IF;
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text)
 VALUES(e.id,n,typ,at,raw||public.rep_crc(raw)); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_establishment_events ON rep_establishments;
CREATE TRIGGER rep_establishment_events AFTER INSERT OR UPDATE ON rep_establishments FOR EACH ROW EXECUTE FUNCTION rep_configuration_event();
DROP TRIGGER IF EXISTS rep_worker_events ON rep_workers;
CREATE TRIGGER rep_worker_events AFTER INSERT OR UPDATE ON rep_workers FOR EACH ROW EXECUTE FUNCTION rep_configuration_event();
DROP TRIGGER IF EXISTS rep_establishment_delete ON rep_establishments;
CREATE TRIGGER rep_establishment_delete BEFORE DELETE ON rep_establishments FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_worker_delete ON rep_workers;
CREATE TRIGGER rep_worker_delete BEFORE DELETE ON rep_workers FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
CREATE OR REPLACE FUNCTION rep_capture_punch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE w public.rep_workers%ROWTYPE; e public.rep_establishments%ROWTYPE; n bigint; at timestamptz:=clock_timestamp(); raw text; h text; collector text;
BEGIN
 IF NEW.source='manager' THEN RETURN NEW; END IF;
 SELECT * INTO w FROM public.rep_workers WHERE company_id=NEW.company_id AND candidate_id=NEW.candidate_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
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
DROP TRIGGER IF EXISTS rep_capture_punch ON employee_time_punches;
CREATE TRIGGER rep_capture_punch AFTER INSERT ON employee_time_punches FOR EACH ROW EXECUTE FUNCTION rep_capture_punch();
CREATE OR REPLACE FUNCTION rep_protect_punch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REP_PUNCH_DELETE_FORBIDDEN' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.company_id,NEW.candidate_id,NEW.punched_at,NEW.punch_kind,NEW.source,NEW.latitude,NEW.longitude,NEW.notes,NEW.created_at,NEW.created_by_user_id,NEW.idempotency_key,NEW.rep_collector) IS DISTINCT FROM
 (OLD.id,OLD.company_id,OLD.candidate_id,OLD.punched_at,OLD.punch_kind,OLD.source,OLD.latitude,OLD.longitude,OLD.notes,OLD.created_at,OLD.created_by_user_id,OLD.idempotency_key,OLD.rep_collector) THEN
 RAISE EXCEPTION 'REP_PUNCH_ORIGINAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_protect_punch ON employee_time_punches;
CREATE TRIGGER rep_protect_punch BEFORE UPDATE OR DELETE ON employee_time_punches FOR EACH ROW EXECUTE FUNCTION rep_protect_punch();
DROP TRIGGER IF EXISTS rep_punch_no_truncate ON employee_time_punches;
CREATE TRIGGER rep_punch_no_truncate BEFORE TRUNCATE ON employee_time_punches FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
CREATE TABLE IF NOT EXISTS rep_service_observations (
 id BIGSERIAL PRIMARY KEY,
 establishment_id BIGINT NOT NULL REFERENCES rep_establishments(id) ON DELETE RESTRICT,
 available BOOLEAN NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS rep_service_observations_last ON rep_service_observations(establishment_id,id DESC);
DROP TRIGGER IF EXISTS rep_service_immutable ON rep_service_observations;
CREATE TRIGGER rep_service_immutable BEFORE UPDATE OR DELETE ON rep_service_observations FOR EACH ROW EXECUTE FUNCTION rep_reject_mutation();
DROP TRIGGER IF EXISTS rep_service_no_truncate ON rep_service_observations;
CREATE TRIGGER rep_service_no_truncate BEFORE TRUNCATE ON rep_service_observations FOR EACH STATEMENT EXECUTE FUNCTION rep_reject_mutation();
CREATE OR REPLACE FUNCTION rep_capture_service_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.rep_establishments%ROWTYPE; prior boolean; n bigint;
BEGIN
 SELECT * INTO e FROM public.rep_establishments WHERE id=NEW.establishment_id FOR UPDATE;
 SELECT right(record_text,2)='07' INTO prior FROM public.rep_original_records WHERE establishment_id=NEW.establishment_id AND record_type=6 ORDER BY nsr DESC LIMIT 1;
 IF prior IS NOT DISTINCT FROM NEW.available THEN RETURN NEW; END IF;
 UPDATE public.rep_establishments SET last_nsr=last_nsr+1 WHERE id=e.id RETURNING last_nsr INTO n;
 INSERT INTO public.rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text)
 VALUES(e.id,n,6,NEW.recorded_at,lpad(n::text,9,'0')||'6'||public.rep_stamp(NEW.recorded_at,e.timezone)||CASE WHEN NEW.available THEN '07' ELSE '08' END);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rep_capture_service_state ON rep_service_observations;
CREATE TRIGGER rep_capture_service_state AFTER INSERT ON rep_service_observations FOR EACH ROW EXECUTE FUNCTION rep_capture_service_state();
INSERT INTO schema_migrations(name) VALUES('160_rep_original_records.sql') ON CONFLICT(name) DO NOTHING;
