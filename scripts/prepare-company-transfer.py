#!/usr/bin/env python3
"""Prepare an offline, reviewed company transfer from pgAdmin CSV snapshots.

No database/network access. Refuses unknown collisions and missing dependencies.
Artifacts contain private data: keep them outside the repository, mode 0600.
"""
import argparse
import collections
import copy
import csv
import decimal
import hashlib
import json
import os
from pathlib import Path
import re


def dumps(v):
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, dict):
        return '{' + ','.join(json.dumps(k) + ':' + dumps(x) for k, x in v.items()) + '}'
    if isinstance(v, list):
        return '[' + ','.join(dumps(x) for x in v) + ']'
    return json.dumps(v, ensure_ascii=False, allow_nan=False)


def qi(v):
    return '"' + v.replace('"', '""') + '"'


def ql(v):
    return "'" + str(v).replace("'", "''") + "'"


def write_private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(text)
    os.chmod(path, 0o600)


def snapshot(path):
    result = collections.defaultdict(list)
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            result[r['kind']].append((r['name'], json.loads(r['payload'], parse_float=decimal.Decimal)))
    manifest = result['manifest'][0][1]
    assert len(result['row']) == manifest['rows'], 'Snapshot incompleto/truncado'
    return result


def columns(s):
    return dict(s['columns'])


def rows(s):
    result = collections.defaultdict(list)
    for n, r in s['row']:
        result[n].append(r)
    return result


def foreign_keys(s):
    result = collections.defaultdict(list)
    for table, c in s['constraint']:
        if c['type'] != 'f':
            continue
        m = re.match(r'FOREIGN KEY \(([^)]+)\) REFERENCES (?:public\.)?([\w"]+)\(([^)]+)\)', c['definition'])
        assert m, f'FK não reconhecida: {table}/{c["name"]}'
        child = [x.strip().strip('"') for x in m[1].split(',')]
        parent = m[2].strip('"')
        refs = [x.strip().strip('"') for x in m[3].split(',')]
        result[table].append((child, parent, refs))
    return result


def insert_sql(table, row, cols):
    names = [c['name'] for c in cols if not c['generated'] and c['name'] in row]
    names_sql = ','.join(qi(n) for n in names)
    data = {n: row[n] for n in names}
    return (f'INSERT INTO public.{qi(table)} ({names_sql}) OVERRIDING SYSTEM VALUE '
            f'SELECT {names_sql} FROM jsonb_populate_record(NULL::public.{qi(table)},'
            f'{ql(dumps(data))}::jsonb);')


def table_ddl(table, cols):
    statements = []
    definitions = []
    for c in cols:
        assert not c['identity'], 'Identity DDL needs explicit review'
        default = c['default']
        if default and 'nextval(' in default:
            seq = re.search(r"nextval\('([^']+)'::regclass\)", default)[1]
            assert re.fullmatch(r'[a-z_][a-z_0-9]*', seq), 'Sequence needs explicit review'
            statements.append(f'CREATE SEQUENCE IF NOT EXISTS public.{qi(seq)};')
        definitions.append(f'{qi(c["name"])} {c["type"]}' +
                           (f' GENERATED ALWAYS AS ({default}) STORED' if c['generated'] else
                            (f' DEFAULT {default}' if default else '')) +
                           (' NOT NULL' if c['notnull'] else ''))
    statements.append(f'CREATE TABLE public.{qi(table)} (' + ','.join(definitions) + ');')
    for c in cols:
        if c['default'] and 'nextval(' in c['default']:
            seq = re.search(r"nextval\('([^']+)'::regclass\)", c['default'])[1]
            statements.append(f'ALTER SEQUENCE public.{qi(seq)} OWNED BY public.{qi(table)}.{qi(c["name"])};')
    return statements


def prepare(source, destination, out):
    sc, dc = columns(source), columns(destination)
    sr, dr = rows(source), rows(destination)
    fks = foreign_keys(source)
    source_id = source['manifest'][0][1]['company_id']
    company = sr['companies'][0]
    assert len(sr['companies']) == 1 and company['id'] == source_id
    assert not any(x['slug'] == company['slug'] for x in dr['companies']), 'Empresa já existe no destino'
    target_id = max(x['id'] for x in dr['companies']) + 1
    users = {}
    password_sql = ['-- ETAPA MANUAL: executar pessoalmente no pgAdmin do destino após a migração.',
                    '-- Substitui somente as senhas das mesmas contas, sem alterar permissões ou 2FA.',
                    'BEGIN;', 'SET LOCAL search_path=pg_catalog,public;', 'DO $passwords$ BEGIN',
                    "IF current_database()<>'grow30' THEN RAISE EXCEPTION 'Banco incorreto'; END IF;"]
    for u in sr.get('users', []):
        matches = [v for v in dr['users'] if v['email'].strip().lower() == u['email'].strip().lower()]
        assert len(matches) == 1, 'Ator precisa de mapeamento explícito; não criar acesso automaticamente'
        v = matches[0]
        assert u['role'] == v['role'], 'Papel diferente: revisar permissões'
        users[u['id']] = v['id']
        assert u.get('password_hash'), 'Senha de origem ausente'
        password_sql += [f'UPDATE public.users SET password_hash={ql(u["password_hash"])},'
                         'session_version=session_version+1 '
                         f'WHERE id={v["id"]} AND lower(email)={ql(v["email"].strip().lower())};',
                         "IF NOT FOUND THEN RAISE EXCEPTION 'Conta de destino não encontrada'; END IF;"]
    password_sql += ['END $passwords$;', 'COMMIT;']

    # Shared catalogs are reused only when the business values match.
    areas = {}
    for a in sr.get('areas', []):
        match = [v for v in dr['areas'] if v['key'] == a['key']]
        assert len(match) == 1 and match[0]['label'] == a['label'], 'Área global diferente'
        areas[a['id']] = match[0]['id']
    for a in sr.get('area_rubrics', []):
        match = [v for v in dr['area_rubrics'] if v['area_id'] == areas[a['area_id']]]
        assert len(match) == 1
        assert all(match[0][k] == v for k, v in a.items() if k not in ('area_id', 'updated_at')), 'Rubrica global diferente'

    files = []
    def transform_json(v, key=''):
        if isinstance(v, dict):
            return {k: transform_json(x, k) for k, x in v.items()}
        if isinstance(v, list):
            return [transform_json(x, key) for x in v]
        if key in ('company_id', 'companyId') and v == source_id:
            return target_id
        if key.endswith('_user_id') or key.endswith('UserId') or key in ('userId', 'user_id', 'updated_by'):
            if v is not None:
                assert v in users, f'Usuário sem mapeamento em {key}'
                return users[v]
        # Other entity IDs stay unchanged. Object paths are copied separately.
        return v

    transformed = []
    for table, records in sr.items():
        if table in ('users', 'areas', 'area_rubrics'):
            continue
        for original in records:
            r = transform_json(copy.deepcopy(original))
            if table == 'companies':
                r['id'] = target_id
            for child, parent, refs in fks[table]:
                for col, ref in zip(child, refs):
                    if original.get(col) is None:
                        continue
                    if parent == 'users' and ref == 'id':
                        assert original[col] in users
                        r[col] = users[original[col]]
                    elif parent == 'companies' and ref == 'id':
                        assert original[col] == source_id
                        r[col] = target_id
                    elif parent == 'areas' and ref == 'id':
                        r[col] = areas[original[col]]
            if table == 'audit_log' and r.get('target_type') in ('company', 'companies') and str(r.get('target_id')) == str(source_id):
                r['target_id'] = str(target_id) if isinstance(r['target_id'], str) else target_id
            for field in ('file_key', 'cv_key'):
                if r.get(field):
                    old = r[field]
                    assert old.startswith(f'companies/{source_id}/'), 'Arquivo fora do escopo'
                    new = old.replace(f'companies/{source_id}/', f'companies/{target_id}/', 1)
                    files.append({'table': table, 'field': field, 'id': r.get('id'), 'source_key': old, 'destination_key': new})
                    # This is a database-only transfer. Preserve the original key/URL.
                    # files.json is a future copy plan, not a claim that objects moved.
            transformed.append((table, r))

    missing = {t for t, r in transformed} - dc.keys()
    assert missing <= {'company_billing_terms', 'time_clock_person_history'}, f'Tabelas novas requerem revisão: {missing}'
    effective_cols = dict(dc)
    additions = []
    for t in sorted(missing):
        additions += table_ddl(t, sc[t])
        effective_cols[t] = sc[t]
    for t in sorted({t for t, r in transformed} - missing):
        existing = {c['name']: c for c in dc[t]}
        for c in sc[t]:
            if c['name'] in existing:
                assert existing[c['name']]['type'] == c['type'], f'Tipo diferente em {t}.{c["name"]}'
            elif any(c['name'] in r for tt, r in transformed if tt == t):
                assert (t, c['name']) == ('employee_time_punches', 'rep_collector'), 'Coluna nova requer revisão'
                additions.append(f'ALTER TABLE public.{qi(t)} ADD COLUMN {qi(c["name"])} {c["type"]}' +
                                 (f' DEFAULT {c["default"]}' if c['default'] else '') +
                                 (' NOT NULL' if c['notnull'] else '') + ';')
                effective_cols[t] = effective_cols[t] + [c]
    # Create source constraints for the new tables; FKs can exist before insertion.
    for t, c in sorted(source['constraint'], key=lambda x: x[1]['type'] == 'f'):
        if t in missing and c['type'] in ('p', 'u', 'c', 'f'):
            additions.append(f'ALTER TABLE public.{qi(t)} ADD CONSTRAINT {qi(c["name"])} {c["definition"]};')
        if t == 'employee_time_punches' and c['type'] == 'c' and 'rep_collector' in c['definition']:
            additions.append(f'ALTER TABLE public.{qi(t)} ADD CONSTRAINT {qi(c["name"])} {c["definition"]};')
    if 'time_clock_person_history' in missing:
        additions.append('CREATE INDEX time_clock_person_history_lookup ON public.time_clock_person_history(company_id,candidate_id,effective_on DESC);')

    # Actual row graph, including composite/self FKs. No trigger/constraint disabling.
    all_rows = list(transformed)
    required_keys = collections.defaultdict(set)
    for child_table, relations in fks.items():
        for child, parent, refs in relations:
            required_keys[parent].add(tuple(refs))
    lookup = {}
    for t, r in destination['row']:
        for key in required_keys[t]:
            lookup[(t, key, tuple(r.get(k) for k in key))] = None
    for i, (t, r) in enumerate(all_rows):
        for key in required_keys[t]:
            marker = (t, key, tuple(r.get(k) for k in key))
            assert marker not in lookup, f'Conflito de chave em {t}; importação interrompida'
            lookup[marker] = i
    dependencies = {}
    for i, (t, r) in enumerate(all_rows):
        deps = set()
        for child, parent, refs in fks[t]:
            val = tuple(r.get(k) for k in child)
            if any(x is None for x in val):
                continue
            marker = (parent, tuple(refs), val)
            assert marker in lookup, f'Dependência não exportada: {t} -> {parent} ({child})'
            if lookup[marker] is not None and lookup[marker] != i:
                deps.add(lookup[marker])
        dependencies[i] = deps
    ordered = []
    done = set()
    while len(done) < len(all_rows):
        ready = [i for i in range(len(all_rows)) if i not in done and dependencies[i] <= done]
        assert ready, 'Ciclo entre registros: preparar tratamento explícito'
        ordered += ready
        done.update(ready)

    # Full baseline guard and postcondition, including unchanged production credentials.
    baseline = ['CREATE TEMP TABLE transfer_baseline(tab text,data jsonb) ON COMMIT DROP;']
    for t, r in destination['row']:
        baseline.append(f'INSERT INTO transfer_baseline VALUES({ql(t)},{ql(dumps(r))}::jsonb);')
    guard = """DO $guard$ DECLARE t record; bad bigint; BEGIN
IF EXISTS(SELECT 1 FROM transfer_baseline b LEFT JOIN public.users u ON u.id=(b.data->>'id')::bigint
 WHERE b.tab='users' AND ROW(b.data->'email',b.data->'role',b.data->'company_id') IS DISTINCT FROM ROW(to_jsonb(u)->'email',to_jsonb(u)->'role',to_jsonb(u)->'company_id'))
 THEN RAISE EXCEPTION 'Identidade/papel de usuario mudou'; END IF;
FOR t IN SELECT DISTINCT tab FROM transfer_baseline WHERE tab IN ('areas','area_rubrics') LOOP
 EXECUTE format('SELECT count(*) FROM (SELECT data-''created_at''-''updated_at'' FROM transfer_baseline WHERE tab=$1 EXCEPT SELECT to_jsonb(r)-''created_at''-''updated_at'' FROM public.%I r) q',t.tab) INTO bad USING t.tab;
 IF bad<>0 THEN RAISE EXCEPTION 'Catalogo global mudou: %',t.tab; END IF;
END LOOP;
DELETE FROM transfer_baseline;
FOR t IN SELECT c.relname AS tab FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relispartition LOOP
 EXECUTE format('INSERT INTO transfer_baseline SELECT %L,to_jsonb(r) FROM public.%I r',t.tab,t.tab);
END LOOP;
FOR t IN SELECT DISTINCT tab FROM transfer_baseline LOOP
 EXECUTE format('SELECT count(*) FROM (SELECT data FROM transfer_baseline WHERE tab=$1 EXCEPT SELECT to_jsonb(r) FROM public.%I r) q',t.tab) INTO bad USING t.tab;
 IF bad<>0 THEN RAISE EXCEPTION 'Baseline divergente: %',t.tab; END IF;
END LOOP;
END $guard$;"""
    post = """DO $preserve$ DECLARE t record; bad bigint; BEGIN
FOR t IN SELECT DISTINCT tab FROM transfer_baseline LOOP
 EXECUTE format('SELECT count(*) FROM (SELECT data FROM transfer_baseline WHERE tab=$1 EXCEPT SELECT to_jsonb(r) FROM public.%I r) q',t.tab) INTO bad USING t.tab;
 IF bad<>0 THEN RAISE EXCEPTION 'Registro anterior alterado: %',t.tab; END IF;
END LOOP;
END $preserve$;"""
    body = ['BEGIN;', "SET LOCAL lock_timeout='5s';", "SET LOCAL statement_timeout='120s';",
            'SET LOCAL search_path=pg_catalog,public,pg_temp;', "SET LOCAL TIME ZONE 'UTC';",
            "SET LOCAL standard_conforming_strings=on;",
            "DO $db$ BEGIN IF current_database()<>'grow30' THEN RAISE EXCEPTION 'Banco incorreto'; END IF; END $db$;",
            'SELECT pg_advisory_xact_lock(3035,22026);', *baseline,
            'LOCK TABLE ' + ','.join('public.'+qi(t) for t in sorted(dc)) + ' IN SHARE ROW EXCLUSIVE MODE;',
            guard, f"DO $company$ BEGIN IF EXISTS(SELECT 1 FROM public.companies WHERE id={target_id} OR slug={ql(company['slug'])}) THEN RAISE EXCEPTION 'Empresa/ID já existe'; END IF; END $company$;",
            *additions]
    for i in ordered:
        t, r = all_rows[i]
        body.append(insert_sql(t, r, effective_cols[t]))
    body.append(post)
    # Compare every imported row against its typed representation, not only counts.
    for t in sorted({t for t, r in transformed}):
        expected = [r for tt, r in transformed if tt == t]
        names = [c['name'] for c in effective_cols[t] if any(c['name'] in r for r in expected)]
        checks = [f"SELECT count(*) FROM (SELECT to_jsonb(x) AS data FROM jsonb_populate_recordset(NULL::public.{qi(t)}, {ql(dumps(expected))}::jsonb) x EXCEPT SELECT to_jsonb(r) FROM public.{qi(t)} r) q"]
        body.append(f'DO $verify$ DECLARE n bigint; BEGIN {checks[0]} INTO n; IF n<>0 THEN RAISE EXCEPTION {ql("Dados importados divergentes: "+t)}; END IF; END $verify$;')
    # Sequences are advanced, never rewound. They are nontransactional in PostgreSQL.
    for t in sorted({t for t, r in transformed}):
        for c in effective_cols[t]:
            if c['default'] and 'nextval(' in c['default']:
                seq = re.search(r"nextval\('([^']+)'::regclass\)", c['default'])[1]
                body.append(f'SELECT setval({ql(seq)}::regclass,GREATEST((SELECT last_value FROM public.{qi(seq)}),COALESCE((SELECT max({qi(c["name"])}) FROM public.{qi(t)}),1)),true);')
    body += ['COMMIT;', f'SELECT id,name,slug FROM public.companies WHERE id={target_id};']
    write_private(out/'import.sql', '\n'.join(body)+'\n')
    write_private(out/'restore-origin-passwords-MANUAL.sql','\n'.join(password_sql)+'\n')
    write_private(out/'files.json', dumps(files)+'\n')
    report = {'source_company_id': source_id, 'destination_company_id': target_id,
              'source_rows': len(source['row']), 'import_rows': len(transformed),
              'reused_users': users, 'reused_areas': areas, 'created_tables': sorted(missing),
              'counts': dict(sorted(collections.Counter(t for t,r in transformed).items())),
              'external_file_references_preserved': len(files), 's3_copy_in_scope': False,
              'passwords_require_manual_execution': True}
    write_private(out/'report.json',dumps(report)+'\n')
    write_private(out/'transformed.json',dumps([{'table':t,'data':r} for t,r in transformed])+'\n')
    print(dumps(report))


def clone_sql(s):
    """Reconstruct the captured destination in an EMPTY disposable database only."""
    sql = ['CREATE EXTENSION IF NOT EXISTS pgcrypto;', 'CREATE EXTENSION IF NOT EXISTS pg_trgm;',
           'SET check_function_bodies=off;', "SET TIME ZONE 'UTC';", 'BEGIN;']
    for t, cols in s['columns']:
        sql += table_ddl(t, cols)
    for t, r in s['row']:
        sql.append(insert_sql(t,r,columns(s)[t]))
    for t, c in sorted(s['constraint'], key=lambda x: x[1]['type'] == 'f'):
        if c['type'] in ('p','u','c'):
            sql.append(f'ALTER TABLE public.{qi(t)} ADD CONSTRAINT {qi(c["name"])} {c["definition"]};')
    for n, v in s['function']:
        sql.append(v['sql']+';')
    for n, v in s['index']:
        sql.append(v['sql'].replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ').replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')+';')
    for t, c in s['constraint']:
        if c['type'] == 'f':
            sql.append(f'ALTER TABLE public.{qi(t)} ADD CONSTRAINT {qi(c["name"])} {c["definition"]};')
    for n, v in s['trigger']:
        assert v['enabled']=='O', 'Disabled/nonstandard trigger needs explicit review'
        sql.append(v['sql']+';')
    sql.append('COMMIT;')
    return '\n'.join(sql)+'\n'


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--out', required=True)
    args=parser.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True,mode=0o700)
    src=snapshot(args.source);dst=snapshot(args.destination)
    prepare(src,dst,out)
    write_private(out/'clone-destination-LOCAL-ONLY.sql',clone_sql(dst))
    write_private(out/'provenance.json',dumps({
        'source_sha256':hashlib.sha256(Path(args.source).read_bytes()).hexdigest(),
        'destination_sha256':hashlib.sha256(Path(args.destination).read_bytes()).hexdigest(),
        'source_manifest':src['manifest'][0][1],
        'destination_manifest':dst['manifest'][0][1],
    })+'\n')
