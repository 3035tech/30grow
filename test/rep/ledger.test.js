import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { receiptRecord, listReceipts } from '../../lib/rep/receipts.js';
import { verifyRecords, crc16, buildAfd } from '../../lib/rep/formats.js';
const config = {
  host: '127.0.0.1',
  port: 55479,
  user: 'rep_test',
  database: 'postgres',
};
test('REP migration, atomic numbering, tamper protection, tenant and retry invariants', async () => {
  const pool = new pg.Pool(config);
  const c = await pool.connect();
  const schema = 'rep_' + Date.now();
  try {
    await c.query(
      `CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public`,
    );
    // Migration uses public-qualified functions/tables; test runs in a dedicated disposable database.
    await c.query(`CREATE DATABASE ${schema}`);
    c.release();
    const db = new pg.Pool({ ...config, database: schema });
    try {
      await db.query(
        `CREATE TABLE companies(id bigserial PRIMARY KEY,name text);CREATE TABLE users(id bigserial PRIMARY KEY);CREATE TABLE candidates(id bigserial PRIMARY KEY,company_id bigint REFERENCES companies(id) ON DELETE CASCADE,full_name text);CREATE TABLE schema_migrations(name text PRIMARY KEY);CREATE TABLE company_kudos(company_id bigint,from_candidate_id bigint);CREATE TABLE org_units(id integer,company_id bigint,UNIQUE(id,company_id));`,
      );
      for (const name of [
        '091_time_clock.sql',
        '120_mobile_employee_mutation_idempotency.sql',
        '137_time_clock_manager.sql',
        '160_rep_original_records.sql',
      ])
        await db.query(
          await readFile(
            new URL('../../migrations/' + name, import.meta.url),
            'utf8',
          ),
        );
      // Reapply additive migration with live records later as well.
      await db.query(
        `INSERT INTO companies(id,name) VALUES(1,'A'),(2,'B');INSERT INTO candidates(id,company_id,full_name) VALUES(1,1,'Ana'),(2,2,'Bia');`,
      );
      await db.query(
        `INSERT INTO employee_time_punches(company_id,candidate_id,punch_kind) VALUES(1,1,'in')`,
      );
      const original = await db.query('SELECT * FROM employee_time_punches');
      assert.equal(original.rowCount, 1);
      assert.equal(
        (await db.query('SELECT * FROM rep_original_records')).rowCount,
        0,
        'no retrospective NSR',
      );
      await db.query(
        `INSERT INTO rep_establishments(id,company_id,employer_document,employer_name,workplace,registration,responsible_cpf) VALUES(1,1,'11222333000181','Escola A','Rua 1','12345678901234567','52998224725')`,
      );
      await assert.rejects(
        db.query(
          `INSERT INTO rep_workers(company_id,establishment_id,candidate_id,cpf,worker_name,responsible_cpf) VALUES(1,1,2,'52998224725','Bia','52998224725')`,
        ),
        /REP_WORKER_TENANT/,
      );
      await db.query(
        `INSERT INTO rep_workers(company_id,establishment_id,candidate_id,cpf,worker_name,responsible_cpf) VALUES(1,1,1,'52998224725','Ana','52998224725')`,
      );
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          db.query(
            `INSERT INTO employee_time_punches(company_id,candidate_id,punch_kind,idempotency_key) VALUES(1,1,'in',$1)`,
            ['concurrent-' + i],
          ),
        ),
      );
      const rows = (
        await db.query('SELECT * FROM rep_original_records ORDER BY nsr')
      ).rows;
      assert.equal(rows.length, 14);
      assert.equal(verifyRecords(rows), true);
      assert.equal(rows[0].record_type, 2);
      assert.equal(rows[0].record_text.length, 331);
      assert.equal(rows[1].record_text.length, 118);
      assert.equal(rows[1].record_type, 5);
      assert.equal(
        (await db.query(`SELECT rep_crc('123456789') AS crc`)).rows[0].crc,
        '2189',
      );
      assert.equal(crc16('123456789'), '2189');
      const punch = rows[2].punch_id;
      assert.equal(
        await receiptRecord(db, {
          companyId: 2,
          candidateId: 2,
          nsr: rows[2].nsr,
          establishmentId: 1,
        }),
        null,
      );
      assert.equal(
        (await listReceipts(db, { companyId: 2, candidateId: 2 })).items.length,
        0,
      );
      assert.equal(
        (
          await receiptRecord(db, {
            companyId: 1,
            candidateId: 1,
            nsr: rows[2].nsr,
            establishmentId: 1,
          })
        ).worker_name.trim(),
        'Ana',
      );
      await assert.rejects(
        db.query('UPDATE rep_establishments SET last_nsr=0 WHERE id=1'),
        /REP_COUNTER_MANAGED/,
      );
      await assert.rejects(
        db.query(
          "INSERT INTO rep_original_records(establishment_id,nsr,record_type,recorded_at,record_text) VALUES(1,99,6,now(),'fake')",
        ),
        /REP_APPEND_INTERNAL_ONLY/,
      );
      await db.query(
        `INSERT INTO employee_time_punches(company_id,candidate_id,punch_kind,idempotency_key) VALUES(1,1,'in','concurrent-0') ON CONFLICT(company_id,candidate_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET idempotency_key=excluded.idempotency_key`,
      );
      assert.equal(
        (await db.query('SELECT count(*) n FROM rep_original_records')).rows[0]
          .n,
        '14',
      );
      for (const sql of [
        `UPDATE employee_time_punches SET punched_at=now()+interval '1 day' WHERE id=${punch}`,
        `DELETE FROM employee_time_punches WHERE id=${punch}`,
        `UPDATE rep_original_records SET record_text='changed'`,
        `TRUNCATE rep_original_records`,
        `DELETE FROM companies WHERE id=1`,
      ])
        await assert.rejects(db.query(sql));
      await db.query(
        `UPDATE employee_time_punches SET voided_at=now(),void_reason='Duplicada',review_status='adjusted' WHERE id=$1`,
        [punch],
      );
      assert.equal(
        (
          await db.query(
            'SELECT record_text FROM rep_original_records WHERE punch_id=$1',
            [punch],
          )
        ).rows[0].record_text,
        rows[2].record_text,
      );
      await db.query(
        `INSERT INTO employee_time_punches(company_id,candidate_id,punch_kind,source,notes) VALUES(1,1,'out','manager','Ajuste')`,
      );
      assert.equal(
        (await db.query('SELECT count(*) n FROM rep_original_records')).rows[0]
          .n,
        '14',
      );
      await db.query(
        await readFile(
          new URL(
            '../../migrations/160_rep_original_records.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const e = (await db.query('SELECT * FROM rep_establishments WHERE id=1'))
        .rows[0];
      const day = rows[0].record_text.slice(10, 20);
      assert.throws(
        () =>
          buildAfd({
            establishment: e,
            records: rows,
            from: day,
            to: day,
            developer: { document: '11222333000181' },
            generatedAt: new Date(),
          }),
        /REP_LEGACY_RECORD_FORMAT/,
      );
      const corrupt = rows.map((r) => ({ ...r }));
      corrupt[2].record_text = corrupt[2].record_text.slice(0, -1) + 'x';
      assert.throws(() => verifyRecords(corrupt), /REP_HASH/);
      await db.query(
        'INSERT INTO rep_service_observations(establishment_id,available) VALUES(1,true),(1,true),(1,false)',
      );
      const withService = (
        await db.query('SELECT * FROM rep_original_records ORDER BY nsr')
      ).rows;
      assert.equal(withService.length, 16);
      assert.equal(withService.at(-2).record_text.slice(-2), '07');
      assert.equal(withService.at(-1).record_text.slice(-2), '08');
      assert.equal(verifyRecords(withService), true);
      console.log(
        'Verified 12 concurrent punches, retry, preservation, CRC, chain, cascade and reapplication',
      );
    } finally {
      await db.end();
    }
    await pool.query(`DROP DATABASE ${schema}`);
  } finally {
    await pool.end();
  }
});
