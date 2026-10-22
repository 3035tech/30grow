-- Diagnóstico da transferência da empresa 2. Executar na ORIGEM pelo pgAdmin.
-- Não exporta dados e não modifica tabelas permanentes. Execute o arquivo inteiro.
-- O resultado final pode ser salvo como CSV no painel Data Output.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;

CREATE TEMP TABLE company_transfer_report (
  section text NOT NULL,
  table_name text NOT NULL,
  detail text NOT NULL,
  row_count bigint
) ON COMMIT DROP;

DO $preflight$
DECLARE
  source_company_id bigint := 2;
  t record;
  n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = source_company_id) THEN
    RAISE EXCEPTION 'Empresa % não existe na origem', source_company_id;
  END IF;

  INSERT INTO pg_temp.company_transfer_report
  SELECT '01_empresa', 'public.companies',
         jsonb_build_object('id', c.id, 'name', to_jsonb(c)->>'name',
                            'slug', to_jsonb(c)->>'slug')::text, 1
  FROM public.companies c WHERE c.id = source_company_id;

  FOR t IN
    SELECT c.oid, ns.nspname, c.relname
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND a.attname = 'company_id' AND a.attnum > 0 AND NOT a.attisdropped
      AND NOT c.relispartition
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE company_id = $1',
                   t.nspname, t.relname) INTO n USING source_company_id;
    INSERT INTO pg_temp.company_transfer_report
    VALUES ('02_contagem_direta', format('%I.%I', t.nspname, t.relname),
            'company_id = ' || source_company_id, n);
  END LOOP;
END
$preflight$;

-- Todas as FKs são inventariadas, incluindo compostas e autorreferências.
-- Não se segue o grafo indiscriminadamente: isso poderia incluir outra empresa.
INSERT INTO pg_temp.company_transfer_report
SELECT '03_chave_estrangeira', format('%I.%I', ns.nspname, child.relname),
       k.conname || ': ' || pg_get_constraintdef(k.oid), NULL
FROM pg_constraint k
JOIN pg_class child ON child.oid = k.conrelid
JOIN pg_namespace ns ON ns.oid = child.relnamespace
WHERE k.contype = 'f' AND ns.nspname = 'public';

-- Tabelas sem company_id podem pertencer à empresa por uma relação indireta
-- ou ser catálogos globais. Precisam de classificação antes da exportação.
INSERT INTO pg_temp.company_transfer_report
SELECT '04_sem_company_id', format('%I.%I', ns.nspname, c.relname),
       'Classificar: relação indireta, catálogo compartilhado ou dado fora do escopo', NULL
FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                  AND a.attname = 'company_id' AND a.attnum > 0 AND NOT a.attisdropped);

-- IDs podem existir em arrays, JSON, snapshots ou campos sem FK.
INSERT INTO pg_temp.company_transfer_report
SELECT '05_referencia_a_revisar', format('%I.%I', ns.nspname, c.relname),
       format('%I: %s', a.attname, format_type(a.atttypid, a.atttypmod)), NULL
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
JOIN pg_type typ ON typ.oid = a.atttypid
WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND a.attnum > 0 AND NOT a.attisdropped
  AND (typ.typname IN ('json', 'jsonb') OR typ.typcategory = 'A'
       OR (a.attname ~ '(_id|_ids)$' AND NOT EXISTS (
         SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid
           AND k.contype = 'f' AND a.attnum = ANY(k.conkey))));

INSERT INTO pg_temp.company_transfer_report
SELECT '06_trigger', format('%I.%I', ns.nspname, c.relname),
       pg_get_triggerdef(t.oid), NULL
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND NOT t.tgisinternal;

SELECT section, table_name, detail, row_count
FROM pg_temp.company_transfer_report
ORDER BY section, table_name, detail;

ROLLBACK;
