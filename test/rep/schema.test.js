import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { repRegistrySchema, saveRepRegistry } from '../../lib/rep/registry.js';
import { fiscalExport } from '../../lib/rep/exports.js';
import {
  createTimePunch,
  getEmployeeTimeClockToday,
} from '../../lib/people/time-clock.js';
const cfg = {
  host: '127.0.0.1',
  port: 55479,
  user: 'rep_test',
  database: 'postgres',
};
test('full canonical schema migrates and REP expansion is reentrant', async () => {
  const control = new pg.Client(cfg);
  await control.connect();
  const name = 'rep_schema_' + Date.now();
  let db;
  try {
    await control.query(`CREATE DATABASE ${name}`);
    db = new pg.Client({ ...cfg, database: name });
    await db.connect();
    await db.query(
      await readFile(
        new URL('../../scripts/rds-bootstrap-completo.sql', import.meta.url),
        'utf8',
      ),
    );
    const names = (await readdir(new URL('../../migrations/', import.meta.url)))
      .filter((n) => n.endsWith('.sql'))
      .sort();
    const applied = new Set(
      (await db.query('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    for (const name of names) {
      if (applied.has(name)) continue;
      await db.query('BEGIN');
      try {
        await db.query(
          await readFile(
            new URL('../../migrations/' + name, import.meta.url),
            'utf8',
          ),
        );
        await db.query(
          'INSERT INTO schema_migrations(name) VALUES($1) ON CONFLICT DO NOTHING',
          [name],
        );
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw new Error(name + ': ' + e.message);
      }
    }
    await db.query(
      `INSERT INTO companies(id,name,slug,enabled_modules) VALUES(900001,'REP test','rep-test',ARRAY['dp']); INSERT INTO candidates(id,company_id,full_name,employment_status,work_format,start_date) VALUES(900001,900001,'Ana','employee','clt','2026-01-01');`,
    );
    await db.query(
      `INSERT INTO rep_establishments(id,company_id,employer_document,employer_name,workplace,registration,responsible_cpf) VALUES(900001,900001,'11222333000181','Escola','Rua','00005120261234567','52998224725'); INSERT INTO rep_workers(company_id,establishment_id,candidate_id,cpf,worker_name,responsible_cpf) VALUES(900001,900001,900001,'52998224725','Ana','52998224725');`,
    );
    const first = await createTimePunch(db, {
      companyId: 900001,
      candidateId: 900001,
      punchKind: 'in',
      collector: '01',
      idempotencyKey: 'schema-replay-key',
    });
    assert.equal(first.ok, true, first.errorCode);
    const replay = await createTimePunch(db, {
      companyId: 900001,
      candidateId: 900001,
      punchKind: 'in',
      collector: '01',
      idempotencyKey: 'schema-replay-key',
    });
    assert.equal(replay.punch.id, first.punch.id);
    const record = (
      await db.query('SELECT * FROM rep_original_records WHERE punch_id=$1', [
        first.punch.id,
      ])
    ).rows[0];
    assert.equal(record.record_text.slice(70, 72), '01');
    const today = await getEmployeeTimeClockToday(db, {
      companyId: 900001,
      candidateId: 900001,
    });
    assert.equal(today.ok, true);
    assert.ok(today.serverTime);
    assert.equal(today.punches.length, 1);
    await db.query(
      await readFile(
        new URL(
          '../../migrations/160_rep_original_records.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.equal(
      (
        await db.query(
          "SELECT name FROM schema_migrations WHERE name='160_rep_original_records.sql'",
        )
      ).rowCount,
      1,
    );
    // Simulate a legacy writer after 160 reapplication; migration 165 must not rewrite it.
    await db.query(
      "UPDATE rep_establishments SET employer_name='Legacy writer' WHERE id=900001",
    );
    const originalsBefore = (
      await db.query(
        'SELECT nsr,record_text,record_hash,previous_hash FROM rep_original_records ORDER BY nsr',
      )
    ).rows;
    const fix = await readFile(
      new URL(
        '../../migrations/165_rep_layout_corrections.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.query(fix);
    await db.query(fix);
    assert.deepEqual(
      (
        await db.query(
          'SELECT nsr,record_text,record_hash,previous_hash FROM rep_original_records ORDER BY nsr',
        )
      ).rows,
      originalsBefore,
    );
    assert.equal(
      (
        await db.query(
          'SELECT registration FROM rep_establishments WHERE id=900001',
        )
      ).rows[0].registration,
      '00005120261234567',
    );
    const config = repRegistrySchema.parse({
      action: 'establishment',
      employerDocument: '11222333000181',
      employerName: 'Escola atualizada',
      workplace: 'Rua',
      registration: '5120261234567',
      timezone: 'America/Sao_Paulo',
      responsibleCpf: '52998224725',
    });
    assert.equal(await saveRepRegistry(db, 900001, config), '900001');
    assert.equal(
      (
        await db.query(
          'SELECT registration FROM rep_establishments WHERE id=900001',
        )
      ).rows[0].registration,
      '5120261234567',
    );
    assert.equal(
      await saveRepRegistry(db, 900001, {
        ...config,
        registration: '5120269999999',
      }),
      null,
    );
    await assert.rejects(
      db.query(
        "UPDATE rep_establishments SET registration='5120269999999' WHERE id=900001",
      ),
      /REP_IDENTITY_IMMUTABLE/,
    );
    const appended = (
      await db.query(
        'SELECT record_text FROM rep_original_records WHERE record_type=2 ORDER BY nsr DESC LIMIT 1',
      )
    ).rows[0].record_text;
    assert.equal(appended.slice(34, 48), '52998224725   ');
    assert.equal(appended.slice(63, 77), '              ');
    assert.deepEqual(
      (
        await db.query(
          'SELECT nsr,record_text,record_hash,previous_hash FROM rep_original_records WHERE nsr <= $1 ORDER BY nsr',
          [originalsBefore.at(-1).nsr],
        )
      ).rows,
      originalsBefore,
    );
    assert.equal(await saveRepRegistry(db, 999999, config), null);
    const worker = repRegistrySchema.parse({
      action: 'worker',
      establishmentId: 900001,
      candidateId: 900001,
      cpf: '52998224725',
      workerName: 'Ana atualizada',
      responsibleCpf: '52998224725',
    });
    assert.ok(await saveRepRegistry(db, 900001, worker));
    assert.equal(await saveRepRegistry(db, 999999, worker), null);
    const day = '2026-10-15';
    await db.query(
      `INSERT INTO employee_time_schedules(company_id,candidate_id,valid_from,follows_company,workday_start,workday_end,break_start,break_end,weekdays) VALUES(900001,900001,$1,false,'09:00','17:00','12:00','13:00',ARRAY[1,2,3,4,5]::smallint[])`,
      [day],
    );
    for (const [hour, kind] of [
      ['12', 'in'],
      ['15', 'out'],
      ['16', 'in'],
      ['21', 'out'],
    ]) {
      const point = await createTimePunch(db, {
        companyId: 900001,
        candidateId: 900001,
        punchKind: kind,
        punchedAt: `${day}T${hour}:00:00Z`,
      });
      assert.equal(point.ok, true, point.errorCode);
    }
    await db.query(
      `INSERT INTO company_time_schedules(company_id,workday_start,workday_end,break_minutes,timezone,hour_bank_enabled,hour_bank_started_on) VALUES(900001,'09:00','18:00',60,'America/Sao_Paulo',TRUE,'2026-01-01'); UPDATE company_time_schedules SET hour_bank_enabled=FALSE WHERE company_id=900001;`,
    );
    await db.query(
      `INSERT INTO employee_hour_bank_entries(company_id,candidate_id,entry_kind,minutes,status,source,work_on,created_by_candidate_id) VALUES(900001,900001,'credit',45,'approved','manual',$1,900001)`,
      [day],
    );
    const developer = {
      document: '11222333000181',
      name: '30Grow',
      version: '1.0',
      legalName: '3035TECH',
      email: 'support@example.com',
    };
    const aej = await fiscalExport(db, {
      companyId: 900001,
      establishmentId: 900001,
      from: day,
      to: day,
      format: 'aej',
      developer,
    });
    assert.equal(
      aej
        .toString('latin1')
        .split('\r\n')
        .filter((l) => l.startsWith('05|')).length,
      4,
    );
    assert.ok(
      aej.toString('latin1').split('\r\n').includes(`07|1|3|${day}|105|1`),
      'historical calculated overtime + approved manual credit survive current disabled bank',
    );
    const afd = await fiscalExport(db, {
      companyId: 900001,
      establishmentId: 900001,
      from: day,
      to: day,
      format: 'afd',
      developer,
    });
    assert.equal(
      afd
        .toString('latin1')
        .split('\r\n')
        .filter((l) => l[9] === '7').length,
      4,
    );

    console.log('All canonical migrations applied to full bootstrap');
  } finally {
    if (db) await db.end();
    await control.query(`DROP DATABASE IF EXISTS ${name}`);
    await control.end();
  }
});
