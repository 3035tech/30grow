import { correctTimeEmploymentHistory } from '../../lib/people/time-clock-history-admin.js';
import { reconcileClosure } from '../../lib/people/time-clock-closure-people.js';
import assert from 'node:assert/strict';
import { getTimeClosingReadiness } from '../../lib/people/time-clock-readiness.js';
import { getEmployeeTimeMirror } from '../../lib/people/time-clock-manager.js';
import {
  processTimePush,
  retryTimePush,
} from '../../lib/people/time-clock-delivery.js';
import { loadTimeDayInputs } from '../../lib/people/hour-bank-balance.js';
import { saveEmployeeSchedule } from '../../lib/people/time-clock-calendar.js';
export async function exerciseEvolution(db) {
  const tx = async (fn) => {
    await db.query('BEGIN');
    try {
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  };
  const last = await db.query(
    "SELECT id FROM time_clock_closures WHERE company_id=900001 AND status='closed' ORDER BY id DESC LIMIT 1",
  );
  const closureId = Number(last.rows[0].id);
  assert.equal(
    (await reconcileClosure(db, { companyId: 900001, closureId })).balanced,
    true,
  );
  assert.equal(
    (await reconcileClosure(db, { companyId: 900002, closureId })).ok,
    false,
  );
  await assert.rejects(
    db.query(
      'UPDATE time_clock_closure_people SET worked_minutes=worked_minutes+1 WHERE closure_id=$1',
      [closureId],
    ),
    /SNAPSHOT_IMMUTABLE/,
  );
  await db.query(
    `INSERT INTO time_clock_company_history(company_id,effective_on,workday_start,workday_end,break_minutes,late_grace_minutes,timezone,hour_bank_enabled,hour_bank_max_minutes,hour_bank_started_on) VALUES(900001,'2026-09-28','09:00','17:00',60,10,'UTC',TRUE,2400,'2026-09-28')`,
  );
  assert.equal(
    (await reconcileClosure(db, { companyId: 900001, closureId })).balanced,
    true,
    'Own contractual schedule takes precedence over company defaults',
  );
  await db.query(
    "DELETE FROM time_clock_company_history WHERE company_id=900001 AND effective_on='2026-09-28'",
  );
  assert.equal(
    (await reconcileClosure(db, { companyId: 900001, closureId })).balanced,
    true,
  );
  await db.query(
    'ALTER TABLE time_clock_closure_people DISABLE TRIGGER time_clock_snapshot_preserve',
  );
  await db.query(
    'UPDATE time_clock_closure_people SET worked_minutes=worked_minutes+1 WHERE closure_id=$1',
    [closureId],
  );
  await db.query(
    'ALTER TABLE time_clock_closure_people ENABLE TRIGGER time_clock_snapshot_preserve',
  );
  const mismatch = await reconcileClosure(db, { companyId: 900001, closureId });
  assert.equal(mismatch.balanced, false);
  assert.ok(mismatch.differences[0].fields.includes('snapshotHash'));
  await db.query(
    'ALTER TABLE time_clock_closure_people DISABLE TRIGGER time_clock_snapshot_preserve',
  );
  await db.query(
    'UPDATE time_clock_closure_people SET worked_minutes=worked_minutes-1 WHERE closure_id=$1',
    [closureId],
  );
  await db.query(
    'ALTER TABLE time_clock_closure_people ENABLE TRIGGER time_clock_snapshot_preserve',
  );

  await db.query(
    `INSERT INTO candidates(id,company_id,full_name,email,employment_status,start_date,work_format) VALUES(900010,900001,'Ex employee','former@example.invalid','employee','2026-09-01','clt'),(900011,900002,'Night employee','night@example.invalid','employee','2026-09-01','clt')`,
  );
  await db.query(
    `INSERT INTO exit_records(company_id,candidate_id,exit_date,exit_type,exit_reason) VALUES(900001,900010,'2026-09-02','voluntary','other')`,
  );
  await db.query(
    "UPDATE candidates SET employment_status='alumni' WHERE id=900010",
  );
  const report = await getTimeClosingReadiness(db, {
    companyId: 900001,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-03',
  });
  const former = report.items.find((p) => p.candidateId === 900010);
  assert.ok(former, 'Former employee belongs to the worked period');
  assert.equal(former.missingMinutes, 960);
  await db.query(
    `INSERT INTO company_time_schedules(company_id,workday_start,workday_end,break_minutes,timezone,late_grace_minutes) VALUES(900002,'09:00','18:00',60,'UTC',10) ON CONFLICT(company_id) DO UPDATE SET timezone='UTC'`,
  );
  const saved = await saveEmployeeSchedule(db, {
    companyId: 900002,
    candidateId: 900011,
    validFrom: '2026-09-01',
    workdayStart: '22:00',
    workdayEnd: '06:00',
    breakStart: '02:00',
    breakEnd: '03:00',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    nightRule: 'urban_clt',
    shiftPattern: 'weekly',
  });
  assert.equal(saved.ok, true);
  for (const [at, kind] of [
    ['2026-09-01T22:00:00Z', 'in'],
    ['2026-09-02T02:00:00Z', 'out'],
    ['2026-09-02T03:00:00Z', 'in'],
    ['2026-09-02T06:00:00Z', 'out'],
  ])
    await db.query(
      `INSERT INTO employee_time_punches(company_id,candidate_id,punched_at,punch_kind,source) VALUES(900002,900011,$1,$2,'manager')`,
      [at, kind],
    );
  const mirror = await getEmployeeTimeMirror(db, {
    companyId: 900002,
    candidateId: 900011,
    from: '2026-09-01',
    to: '2026-09-02',
  });
  assert.equal(mirror.ok, true);
  assert.equal(mirror.days[0].workedMinutes, 420);
  assert.equal(mirror.days[0].nightMinutes, 360);
  assert.equal(mirror.days[0].nightEquivalentMinutes, 411);
  assert.equal(mirror.days[0].missingMinutes, 0);
  assert.equal(mirror.days[1].workedMinutes, 0);
  const cyc = await saveEmployeeSchedule(db, {
    companyId: 900002,
    candidateId: 900011,
    validFrom: '2026-09-03',
    workdayStart: '18:00',
    workdayEnd: '06:00',
    breakStart: '00:00',
    breakEnd: '01:00',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    shiftPattern: '12x36',
    cycleAnchor: '2026-09-03',
    nightRule: 'urban_clt',
  });
  assert.equal(cyc.ok, true);
  const inputs = await loadTimeDayInputs(db, {
    companyId: 900002,
    candidateIds: [900011],
    from: '2026-09-03',
    to: '2026-09-05',
    timezone: 'UTC',
  });
  const calendar = inputs.calendarFor(
    {
      timezone: 'UTC',
      workdayStart: '09:00',
      workdayEnd: '18:00',
      breakMinutes: 60,
    },
    { id: 900011 },
  );
  assert.equal(calendar('2026-09-03').isWorkday, true);
  assert.equal(calendar('2026-09-04').isWorkday, false);
  assert.equal(calendar('2026-09-05').isWorkday, true);
  await db.query(
    `INSERT INTO mobile_employee_push_tokens(candidate_id,company_id,expo_push_token,platform,push_destinations) VALUES(900011,900002,'ExpoPushToken[fixtureEvolution]','ios',ARRAY['time_clock'])`,
  );
  await db.query(
    `INSERT INTO candidate_notifications(company_id,recipient_candidate_id,type,payload,dedupe_key) VALUES(900002,900011,'time_closing_reminder','{}','evolution') ON CONFLICT DO NOTHING`,
  );
  const queued = await db.query(
    'SELECT * FROM time_clock_push_deliveries WHERE candidate_id=900011',
  );
  assert.equal(queued.rows.length, 1);
  const first = await processTimePush(db, {
    fetcher: async () => {
      throw Error('offline');
    },
  });
  assert.equal(first.retry, 1);
  await db.query(
    'UPDATE time_clock_push_deliveries SET next_attempt_at=now() WHERE candidate_id=900011',
  );
  let body;
  const second = await processTimePush(db, {
    fetcher: async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ data: { status: 'ok', id: 'test-ticket' } }),
      };
    },
  });
  assert.equal(second.sent, 1);
  assert.equal(body.data.destination, 'time_clock');
  assert.equal(JSON.stringify(body).includes('night@example'), false);
  assert.equal(
    (await retryTimePush(db, { companyId: 900001, id: queued.rows[0].id })).ok,
    false,
  );
  const attempts = await db.query(
    'SELECT count(*)::int AS n FROM time_clock_push_attempts WHERE delivery_id=$1',
    [queued.rows[0].id],
  );
  assert.equal(attempts.rows[0].n, 2);
  const zero = await processTimePush(db, {
    fetcher: async () => {
      throw Error('Must not resend');
    },
  });
  assert.equal(zero.sent, 0);
  await db.query(
    `INSERT INTO candidate_notifications(company_id,recipient_candidate_id,type,payload,dedupe_key) VALUES(900002,900011,'time_closing_reminder','{}','evolution-failure')`,
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    await db.query(
      "UPDATE time_clock_push_deliveries SET next_attempt_at=now() WHERE status='pending'",
    );
    await processTimePush(db, {
      limit: 1,
      fetcher: async () => ({ ok: false, json: async () => ({}) }),
    });
  }
  const failed = await db.query(
    "SELECT * FROM time_clock_push_deliveries WHERE status='failed'",
  );
  assert.equal(failed.rows.length, 1);
  assert.equal(failed.rows[0].total_attempts, 5);
  assert.equal(
    (await retryTimePush(db, { companyId: 900001, id: failed.rows[0].id })).ok,
    false,
  );
  assert.equal(
    (await retryTimePush(db, { companyId: 900002, id: failed.rows[0].id })).ok,
    true,
  );
  const invalid = await processTimePush(db, {
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        data: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      }),
    }),
  });
  assert.equal(invalid.skipped, 1);
  const archived = await db.query(
    'SELECT total_attempts FROM time_clock_push_deliveries WHERE id=$1',
    [failed.rows[0].id],
  );
  assert.equal(archived.rows[0].total_attempts, 6);

  await db.query(
    `INSERT INTO candidates(id,company_id,full_name,email,employment_status,start_date,work_format) VALUES(900012,900002,'Rehired employee','rehire@example.invalid','employee','2026-09-01','clt')`,
  );
  await db.query(
    `INSERT INTO exit_records(company_id,candidate_id,exit_date,rehired_at,exit_type,exit_reason) VALUES(900002,900012,'2026-08-20','2026-09-01','voluntary','other')`,
  );
  const before = await getTimeClosingReadiness(db, {
    companyId: 900002,
    periodStart: '2026-08-03',
    periodEnd: '2026-08-04',
  });
  assert.ok(
    before.items.find((p) => p.candidateId === 900012).scheduleReviewDays > 0,
  );
  const corrected = await correctTimeEmploymentHistory(
    {
      companyId: 900002,
      candidateId: 900012,
      effectiveOn: '2026-08-01',
      startDate: '2026-08-01',
      reason: 'Contract archived under fixture reference',
    },
    tx,
  );
  assert.equal(corrected.ok, true);
  const after = await getTimeClosingReadiness(db, {
    companyId: 900002,
    periodStart: '2026-08-03',
    periodEnd: '2026-08-04',
  });
  assert.equal(
    after.items.find((p) => p.candidateId === 900012).scheduleReviewDays,
    0,
  );
  const current = await db.query(
    'SELECT start_date::text AS day FROM candidates WHERE id=900012',
  );
  assert.equal(current.rows[0].day, '2026-09-01');
  assert.equal(
    (
      await correctTimeEmploymentHistory(
        {
          companyId: 900001,
          candidateId: 900012,
          effectiveOn: '2026-08-01',
          startDate: '2026-08-01',
          reason: 'Contract archived under fixture reference',
        },
        tx,
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await correctTimeEmploymentHistory(
        {
          companyId: 900001,
          candidateId: 900001,
          effectiveOn: '2026-09-01',
          startDate: '2026-09-01',
          reason: 'Must reopen the existing closed period',
        },
        tx,
      )
    ).ok,
    false,
  );

  await assert.rejects(db.query(`INSERT INTO exit_records(company_id,candidate_id,exit_date,exit_type,exit_reason) VALUES(900001,900001,'2026-09-27','voluntary','other')`),/TIME_CLOCK_PERIOD_CLOSED/);
  await db.query(`INSERT INTO exit_records(company_id,candidate_id,exit_date,exit_type,exit_reason) VALUES(900001,900001,'2026-10-20','voluntary','other')`);
  await db.query("UPDATE exit_records SET rehired_at='2026-10-25' WHERE company_id=900001 AND candidate_id=900001");
  await db.query(`INSERT INTO rep_establishments(id,company_id,employer_document,employer_name,workplace,registration,responsible_cpf,timezone) VALUES(900001,900001,'11222333000181','Fictional school','Fixture address','12345678901234567','52998224725','UTC'); INSERT INTO rep_workers(company_id,establishment_id,candidate_id,cpf,worker_name,responsible_cpf) VALUES(900001,900001,900001,'52998224725','Fixture employee','52998224725');`);
  const original=await db.query(`INSERT INTO employee_time_punches(company_id,candidate_id,punched_at,punch_kind,source) VALUES(900001,900001,'2026-09-28T18:05:00Z','in','web') RETURNING id`);
  const fiscal=await db.query('SELECT count(*)::int AS n FROM rep_original_records WHERE punch_id=$1',[original.rows[0].id]);assert.equal(fiscal.rows[0].n,1,'New original marking is preserved despite an already closed logical day');
  assert.equal((await reconcileClosure(db,{companyId:900001,closureId})).balanced,false,'New original requires reconciliation and reopening; frozen snapshot is preserved');
}
