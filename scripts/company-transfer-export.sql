-- ORIGEM, pgAdmin: executar inteiro; salvar Data Output como CSV (sem limite).
-- Snapshot da empresa 2; somente tabelas temporárias são escritas.
-- Após salvar o CSV, execute ROLLBACK; na mesma aba para encerrar o snapshot.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout = '300s';
SET LOCAL search_path = pg_catalog, public;
CREATE TEMP TABLE transfer_rows(rel oid NOT NULL, row_tid tid NOT NULL, PRIMARY KEY(rel,row_tid)) ON COMMIT DROP;
CREATE TEMP TABLE transfer_output(kind text, name text, payload jsonb) ON COMMIT DROP;
DO $export$
DECLARE t record; f record; predicate text; affected bigint; changed bigint; rounds integer:=0; wrong bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=2) THEN RAISE EXCEPTION 'Empresa 2 ausente'; END IF;
 INSERT INTO pg_temp.transfer_rows SELECT 'public.companies'::regclass,ctid FROM public.companies WHERE id=2;
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relispartition
   AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped)
 LOOP
   EXECUTE format('INSERT INTO pg_temp.transfer_rows SELECT %s,ctid FROM public.%I WHERE company_id=2 ON CONFLICT DO NOTHING',t.oid,t.relname);
 END LOOP;
 LOOP
   changed:=0; rounds:=rounds+1;
   IF rounds>100 THEN RAISE EXCEPTION 'Fechamento relacional não convergiu'; END IF;
   FOR f IN SELECT k.*,c.relname AS child,p.relname AS parent FROM pg_constraint k
     JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace nc ON nc.oid=c.relnamespace
     JOIN pg_class p ON p.oid=k.confrelid JOIN pg_namespace np ON np.oid=p.relnamespace
     WHERE k.contype='f' AND nc.nspname='public' AND np.nspname='public'
   LOOP
     SELECT string_agg(format('ch.%I=pa.%I',ca.attname,pa.attname),' AND ' ORDER BY u.ord)
       INTO predicate FROM unnest(f.conkey,f.confkey) WITH ORDINALITY u(ca,pa,ord)
       JOIN pg_attribute ca ON ca.attrelid=f.conrelid AND ca.attnum=u.ca
       JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=u.pa;
     -- Pais necessários: catálogos compartilhados, atores e relações da empresa.
     EXECUTE format('INSERT INTO pg_temp.transfer_rows SELECT DISTINCT %s,pa.ctid FROM public.%I ch JOIN pg_temp.transfer_rows s ON s.rel=%s AND s.row_tid=ch.ctid JOIN public.%I pa ON %s ON CONFLICT DO NOTHING',f.confrelid,f.child,f.conrelid,f.parent,predicate);
     GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
     -- Filhos sem company_id: histórico e tabelas intermediárias. Nunca expandir
     -- usuários globais para notificações/dados de outras empresas, nem estatísticas globais.
     IF f.parent<>'users' AND f.child NOT IN ('companies','users','schema_migrations','area_stats')
       AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=f.conrelid AND a.attname='company_id' AND NOT a.attisdropped)
     THEN
       EXECUTE format('INSERT INTO pg_temp.transfer_rows SELECT DISTINCT %s,ch.ctid FROM public.%I pa JOIN pg_temp.transfer_rows s ON s.rel=%s AND s.row_tid=pa.ctid JOIN public.%I ch ON %s ON CONFLICT DO NOTHING',f.conrelid,f.parent,f.confrelid,f.child,predicate);
       GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
     END IF;
   END LOOP;
   -- Relações em arrays conhecidas do projeto, sem FK no PostgreSQL.
   IF to_regclass('public.team_groups') IS NOT NULL THEN
     INSERT INTO pg_temp.transfer_rows SELECT 'public.assessments'::regclass,a.ctid
     FROM public.assessments a JOIN public.team_groups g ON a.id=ANY(g.member_assessment_ids)
     WHERE g.company_id=2 ON CONFLICT DO NOTHING;
     GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   END IF;
   IF to_regclass('public.company_analytics_report_prefs') IS NOT NULL THEN
     INSERT INTO pg_temp.transfer_rows SELECT 'public.users'::regclass,u.ctid
     FROM public.users u JOIN public.company_analytics_report_prefs p ON u.id=ANY(p.recipient_user_ids)
     WHERE p.company_id=2 ON CONFLICT DO NOTHING;
     GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   END IF;
   EXIT WHEN changed=0;
 END LOOP;
 -- Recusar vazamento por vínculo cruzado em vez de copiar outra empresa.
 IF EXISTS(SELECT 1 FROM public.companies c JOIN pg_temp.transfer_rows s ON s.rel='public.companies'::regclass AND s.row_tid=c.ctid WHERE c.id<>2) THEN
   RAISE EXCEPTION 'Dependência de outra empresa detectada: revisar antes de exportar';
 END IF;
 FOR t IN SELECT DISTINCT c.oid,c.relname FROM pg_temp.transfer_rows s JOIN pg_class c ON c.oid=s.rel
 LOOP
   IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='company_id' AND NOT attisdropped) THEN
     EXECUTE format('SELECT count(*) FROM public.%I r JOIN pg_temp.transfer_rows s ON s.rel=%s AND s.row_tid=r.ctid WHERE r.company_id IS NOT NULL AND r.company_id<>2',t.relname,t.oid) INTO wrong;
     IF wrong>0 THEN RAISE EXCEPTION 'Vínculo cruzado em %, % registros',t.relname,wrong; END IF;
   END IF;
   EXECUTE format('INSERT INTO pg_temp.transfer_output SELECT ''row'',%L,to_jsonb(r) FROM public.%I r JOIN pg_temp.transfer_rows s ON s.rel=%s AND s.row_tid=r.ctid',t.relname,t.relname,t.oid);
 END LOOP;
END $export$;
INSERT INTO pg_temp.transfer_output
SELECT 'columns',c.relname,jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,'identity',a.attidentity,'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relispartition GROUP BY c.relname;
INSERT INTO pg_temp.transfer_output
SELECT 'constraint',c.relname,jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid),'deferrable',k.condeferrable,'deferred',k.condeferred)
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public';
INSERT INTO pg_temp.transfer_output
SELECT 'migration',name,to_jsonb(m) FROM public.schema_migrations m;
INSERT INTO pg_temp.transfer_output
SELECT 'manifest','company-transfer',jsonb_build_object('company_id',2,'database',current_database(),'exported_at',transaction_timestamp(),'server_version',current_setting('server_version'),'rows',(SELECT count(*) FROM pg_temp.transfer_output WHERE kind='row'));
SELECT kind,name,payload::text FROM pg_temp.transfer_output ORDER BY kind,name,payload::text;
