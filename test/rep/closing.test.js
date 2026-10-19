import { exerciseEvolution } from './evolution-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { getTimeClosingReadiness } from '../../lib/people/time-clock-readiness.js';
import {
  createTimeClockClosure,
  cancelTimeClockClosure,
} from '../../lib/people/time-clock-manager.js';
import { exportClosurePeopleCsv } from '../../lib/people/time-clock-closure-people.js';
import { assertTimeDayOpen, csvCell } from '../../lib/people/time-clock.js';
import { ERR } from '../../lib/api-error-codes.js';
const cfg = {
  host: '127.0.0.1',
  port: 55479,
  user: 'rep_test',
  database: 'postgres',
};
test('closing refuses pending inputs, freezes accounting totals, survives reopening and serializes writers', async () => {
  const control = new pg.Client(cfg);
  await control.connect();
  const name = 'closing_' + Date.now();
  let db, writer;
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
    const applied = new Set(
      (await db.query('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    for (const file of (
      await readdir(new URL('../../migrations/', import.meta.url))
    )
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      if (applied.has(file)) continue;
      await db.query('BEGIN');
      await db.query(
        await readFile(
          new URL('../../migrations/' + file, import.meta.url),
          'utf8',
        ),
      );
      await db.query(
        'INSERT INTO schema_migrations(name) VALUES($1) ON CONFLICT DO NOTHING',
        [file],
      );
      await db.query('COMMIT');
    }
    await db.query(`INSERT INTO companies(id,name,slug,enabled_modules) VALUES(900001,'Closing test','closing-test',ARRAY['dp']),(900002,'Other company','closing-other',ARRAY['dp']);
   INSERT INTO org_units(id,company_id,name) VALUES(910001,900001,'Unidade A'),(910002,900001,'Unidade B'),(910003,900002,'Outra empresa');
   INSERT INTO candidates(id,company_id,full_name,email,employment_status,work_format,start_date,org_unit_id) VALUES(900001,900001,'=2+2','test@example.invalid','employee','clt','2026-09-28',910001),(900002,900002,'Other person','other@example.invalid','employee','clt','2026-09-28',910003);
   INSERT INTO company_time_schedules(company_id,workday_start,workday_end,break_minutes,timezone,late_grace_minutes,hour_bank_enabled,hour_bank_started_on) VALUES(900001,'09:00','18:00',60,'UTC',10,TRUE,'2026-09-28');
   INSERT INTO employee_time_schedules(company_id,candidate_id,valid_from,follows_company,workday_start,workday_end,break_start,break_end,weekdays) VALUES(900001,900001,'2026-09-28',FALSE,'09:00','18:00','12:00','13:00',ARRAY[1,2,3,4,5]::smallint[]);`);
    const opts = {
      companyId: 900001,
      periodStart: '2026-09-28',
      periodEnd: '2026-09-28',
      orgUnitId: 910001,
    };
    const tx = async (fn) => {
      await db.query('BEGIN');
      try {
        const result = await fn(db);
        await db.query('COMMIT');
        return result;
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    };
    const insert = async (time, kind, connection = db) =>
      connection.query(
        `INSERT INTO employee_time_punches(company_id,candidate_id,punched_at,punch_kind,source,review_status) VALUES(900001,900001,$1,$2,'manager','none')`,
        [`2026-09-28T${time}:00Z`, kind],
      );
    await insert('09:00', 'in');
    await insert('12:00', 'out');
    await insert('13:00', 'in');
    let report = await getTimeClosingReadiness(db, opts);
    assert.equal(report.ready, false);
    assert.equal(report.totals.incompleteDays, 1);
    assert.equal(
      (await createTimeClockClosure(opts, tx)).errorCode,
      ERR.TIME_CLOCK_CLOSURE_PENDING,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM time_clock_closures'))
        .rows[0].n,
      0,
    );
    await insert('18:00', 'out');
    assert.equal((await getTimeClosingReadiness(db, opts)).ready, true);
    await db.query(
      `INSERT INTO employee_time_requests(company_id,candidate_id,work_on,kind,justification) VALUES(900001,900001,'2026-09-28','adjustment','Conferir marcação');`,
    );
    assert.equal(
      (await getTimeClosingReadiness(db, opts)).totals.pendingRequests,
      1,
    );
    assert.equal(
      (await createTimeClockClosure(opts, tx)).errorCode,
      ERR.TIME_CLOCK_CLOSURE_PENDING,
    );
    await db.query(
      "UPDATE employee_time_requests SET status='rejected', decided_at=NOW() WHERE company_id=900001",
    );
    await db.query(
      `INSERT INTO employee_hour_bank_entries(company_id,candidate_id,entry_kind,minutes,status,source,work_on,created_by_candidate_id) VALUES(900001,900001,'debit',30,'pending','employee','2026-09-28',900001)`,
    );
    assert.equal(
      (await getTimeClosingReadiness(db, opts)).totals.pendingBank,
      1,
    );
    assert.equal(
      (await createTimeClockClosure(opts, tx)).errorCode,
      ERR.TIME_CLOCK_CLOSURE_PENDING,
    );
    await db.query(
      "UPDATE employee_hour_bank_entries SET status='rejected', decided_at=NOW() WHERE company_id=900001",
    );
    assert.equal(
      (await getTimeClosingReadiness(db, { ...opts, orgUnitId: 910003 }))
        .errorCode,
      ERR.NOT_FOUND,
    );
    const closed = await createTimeClockClosure(opts, tx);
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.equal((await getTimeClosingReadiness(db, opts)).closed, true);
    const before = (
      await db.query(
        'SELECT * FROM time_clock_closure_people WHERE closure_id=$1',
        [closed.id],
      )
    ).rows[0];
    assert.equal(before.worked_minutes, 480);
    const csv = await exportClosurePeopleCsv(db, {
      companyId: 900001,
      closureId: closed.id,
      profile: 'accounting',
    });
    assert.equal(csv.ok, true);
    assert.match(csv.csv, /layout_version,company_id/);
    assert.match(csv.csv, /'=2\+2/);
    assert.equal(
      (
        await exportClosurePeopleCsv(db, {
          companyId: 900002,
          closureId: closed.id,
          profile: 'accounting',
        })
      ).errorCode,
      ERR.NOT_FOUND,
    );
    assert.equal(csvCell(-120), '-120');
    assert.equal(csvCell('\t=2+2'), "'\t=2+2");
    await assert.rejects(insert('18:10', 'in'), /TIME_CLOCK_PERIOD_CLOSED/);
    await assert.rejects(db.query("UPDATE employee_time_punches SET punched_at='2026-09-29T09:00:00Z' WHERE company_id=900001"), /TIME_CLOCK_PERIOD_CLOSED|REP_PUNCH_ORIGINAL_IMMUTABLE/);
    await db.query("UPDATE time_clock_closure_people SET ack_status='disputed', ack_at=NOW(), dispute_note='Conferir os horarios registrados' WHERE closure_id=$1", [closed.id]);
    assert.equal((await exportClosurePeopleCsv(db, {companyId:900001,closureId:closed.id,profile:'accounting'})).errorCode, ERR.TIME_CLOCK_CLOSURE_PENDING);
    await db.query("UPDATE time_clock_closure_people SET ack_status='pending', ack_at=NULL, dispute_note='' WHERE closure_id=$1", [closed.id]);

    await assert.rejects(
      db.query(
        "UPDATE employee_time_punches SET review_status='confirmed' WHERE company_id=900001",
      ),
      /TIME_CLOCK_PERIOD_CLOSED/,
    );
    await db.query('UPDATE candidates SET org_unit_id=910002 WHERE id=900001');
    assert.equal(
      (
        await assertTimeDayOpen(db, {
          companyId: 900001,
          candidateId: 900001,
          day: '2026-09-28',
        })
      ).errorCode,
      ERR.TIME_CLOCK_PERIOD_CLOSED,
    );
    assert.equal(
      (await getTimeClosingReadiness(db, { ...opts, orgUnitId: 910002 }))
        .closed,
      true,
    );
    assert.equal(
      (
        await cancelTimeClockClosure(
          {
            companyId: 900001,
            closureId: closed.id,
            reason: 'Revisar fechamento',
          },
          db,
        )
      ).ok,
      true,
    );
    assert.equal(
      (
        await exportClosurePeopleCsv(db, {
          companyId: 900001,
          closureId: closed.id,
          profile: 'accounting',
        })
      ).errorCode,
      ERR.TIME_CLOCK_CLOSURE_NOT_ACTIVE,
    );
    assert.equal(
      (
        await db.query(
          'SELECT snapshot_hash FROM time_clock_closure_people WHERE closure_id=$1',
          [closed.id],
        )
      ).rows[0].snapshot_hash,
      before.snapshot_hash,
    );
    writer = new pg.Client({ ...cfg, database: name });
    await writer.connect();
    // Turning the bank off today must not erase the previous month's bank snapshot.
    await db.query('UPDATE company_time_schedules SET hour_bank_enabled=FALSE WHERE company_id=900001');
    let release, prepared;
    const commitGate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      prepared = resolve;
    });
    const pendingClose = createTimeClockClosure(
      { ...opts, orgUnitId: 910001 },
      async (fn) => {
        await db.query('BEGIN');
        try {
          const result = await fn(db);
          prepared(result);
          await commitGate;
          await db.query('COMMIT');
          return result;
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      },
    );
    assert.equal((await ready).ok, true);
    let settled = false;
    const writing = insert('18:10', 'in', writer).then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(settled, false, 'writer must wait for the closure snapshot');
    release();
    assert.equal((await pendingClose).ok, true);
    assert.match((await writing).message, /TIME_CLOCK_PERIOD_CLOSED/);
    await db.query(
      await readFile(
        new URL(
          '../../migrations/161_time_clock_closed_day_guards.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM time_clock_closure_people'))
        .rows[0].n,
      2,
    );
    for(const file of ['162_time_clock_history.sql','163_time_clock_shifts.sql','164_time_clock_operations.sql'])await db.query(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
    const bankRows=await db.query('SELECT count(*)::int AS n FROM time_clock_closure_balances WHERE company_id=900001');assert.equal(bankRows.rows[0].n,2);
    await exerciseEvolution(db);
  } finally {
    if (writer) await writer.end();
    if (db) await db.end();
    await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await control.end();
  }
});
