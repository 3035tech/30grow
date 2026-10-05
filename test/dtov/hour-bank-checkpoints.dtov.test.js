/**
 * DTOV: B-2804.1 hour bank checkpoints (migration 148): the balance read from a checkpoint
 * equals the full recomputation, every calculation input invalidates it through triggers,
 * other calc versions are ignored and the cron refresh is idempotent.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import {
  HOLIDAY_RECURRENCE,
  HOUR_BANK_ENTRY_KIND,
  HOUR_BANK_SOURCE,
  HOUR_BANK_STATUS,
  TIME_DAY_JUSTIFICATION,
  TIME_PUNCH_KIND,
  TIME_PUNCH_SOURCE,
  WORK_FORMAT,
} from '../../lib/domain-status.js';
import { createHourBankManualEntry, getHourBankBalance } from '../../lib/people/hour-bank.js';
import { HOUR_BANK_CALC_VERSION, HOUR_BANK_CHECKPOINT_LAG_DAYS } from '../../lib/people/hour-bank-balance.js';
import { refreshCompanyHourBankCheckpoints } from '../../lib/people/hour-bank-checkpoints.js';
import { createTimePunch, isoDayInTz, upsertCompanyTimeSchedule } from '../../lib/people/time-clock.js';
import { addDaysIso, cancelTimeClockClosure, createTimeClockClosure } from '../../lib/people/time-clock-manager.js';
import { saveEmployeeSchedule, saveHoliday } from '../../lib/people/time-clock-calendar.js';

const TZ = 'UTC';

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing: run dtov:reset');
  const companyId = co.rows[0].id;
  const emp = await query(
    `SELECT id, work_format AS "workFormat" FROM candidates WHERE company_id = $1 AND email = 'colaborador@todos-os-dados.demo' LIMIT 1`,
    [companyId]
  );
  assert.ok(emp.rowCount, 'demo collaborator missing');
  const candidateId = emp.rows[0].id;
  const originalWorkFormat = emp.rows[0].workFormat;
  const hr = await query(
    `SELECT id AS "userId" FROM users WHERE company_id = $1 AND email = 'hr@todos-os-dados.demo' AND deleted = FALSE LIMIT 1`,
    [companyId]
  );
  const userId = hr.rows[0]?.userId || null;

  const today = isoDayInTz(new Date(), TZ);
  const asOf = addDaysIso(today, -HOUR_BANK_CHECKPOINT_LAG_DAYS);
  const start = addDaysIso(today, -60);
  const D1 = addDaysIso(today, -45);
  const weekday = new Date(`${D1}T12:00:00Z`).getUTCDay();

  const cleanup = async () => {
    await query(`DELETE FROM hour_bank_checkpoints WHERE company_id = $1`, [companyId]);
    await query(`DELETE FROM employee_hour_bank_entries WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM employee_time_punches WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM employee_time_day_justifications WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM employee_time_schedules WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM company_holidays WHERE company_id = $1`, [companyId]);
    await query(`UPDATE candidates SET work_format = $3 WHERE company_id = $1 AND id = $2`, [companyId, candidateId, originalWorkFormat]);
  };
  await cleanup();

  const sched = await upsertCompanyTimeSchedule({ query }, {
    companyId, workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60, timezone: TZ,
    lateGraceMinutes: 5, hourBankEnabled: true, hourBankMaxMinutes: 100000, updatedByUserId: userId,
  });
  assert.equal(sched.ok, true, sched.errorCode);
  await query(`UPDATE company_time_schedules SET hour_bank_started_on = $2::date WHERE company_id = $1`, [companyId, start]);
  await query(`UPDATE candidates SET work_format = $3 WHERE company_id = $1 AND id = $2`, [companyId, candidateId, WORK_FORMAT.CLT]);
  const own = await saveEmployeeSchedule({ query }, {
    companyId, candidateId, validFrom: addDaysIso(start, -20), userId,
    workdayStart: '09:00', workdayEnd: '17:00', weekdays: [weekday],
  });
  assert.equal(own.ok, true, own.errorCode);
  for (const [hm, kind] of [['09:00', TIME_PUNCH_KIND.IN], ['19:00', TIME_PUNCH_KIND.OUT]]) {
    const r = await createTimePunch({ query }, {
      companyId, candidateId, punchKind: kind, source: TIME_PUNCH_SOURCE.WEB, punchedAt: `${D1}T${hm}:00.000Z`,
    });
    assert.equal(r.ok, true, r.errorCode);
  }

  const balance = async () => (await getHourBankBalance({ query }, { companyId, candidateId })).balanceMinutes;
  const checkpoint = async () => (await query(
    `SELECT to_char(as_of, 'YYYY-MM-DD') AS "asOf", balance_minutes AS b, calc_version AS v
     FROM hour_bank_checkpoints WHERE company_id = $1 AND candidate_id = $2`,
    [companyId, candidateId]
  )).rows[0];
  const refresh = () => refreshCompanyHourBankCheckpoints(companyId);
  const fresh = async () => {
    await refresh();
    assert.ok(await checkpoint(), 'refresh writes the checkpoint');
  };

  const full = await balance();
  const first = await refresh();
  assert.ok(first.refreshed >= 1, 'company employees refreshed');
  assert.equal(first.asOf, asOf);
  const row = await checkpoint();
  assert.equal(row?.asOf, asOf, 'checkpoint day = today − lag');
  assert.equal(Number(row.v), HOUR_BANK_CALC_VERSION);
  assert.equal(await balance(), full, 'balance from the checkpoint = full recomputation');

  const again = await refresh();
  assert.equal(again.refreshed, 0, 'second run is a no-op');

  // The checkpoint is really the base: a tampered balance shows through.
  await query(`UPDATE hour_bank_checkpoints SET balance_minutes = balance_minutes + 7 WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
  assert.equal(await balance(), full + 7, 'reads start from the checkpoint');
  await query(`UPDATE hour_bank_checkpoints SET calc_version = $3 WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId, HOUR_BANK_CALC_VERSION + 1]);
  assert.equal(await balance(), full, 'another calc version is ignored');
  await query(`DELETE FROM hour_bank_checkpoints WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);

  // A change after the checkpoint day keeps it; the balance still matches.
  await fresh();
  await createTimePunch({ query }, {
    companyId, candidateId, punchKind: TIME_PUNCH_KIND.IN, source: TIME_PUNCH_SOURCE.WEB, punchedAt: `${addDaysIso(today, -3)}T09:00:00.000Z`,
  });
  assert.ok(await checkpoint(), 'punch after as_of keeps the checkpoint');
  const withCheckpoint = await balance();
  await query(`DELETE FROM hour_bank_checkpoints WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
  assert.equal(await balance(), withCheckpoint, 'later change: checkpoint + tail = full recomputation');

  const invalidates = async (label, change) => {
    await fresh();
    await change();
    assert.equal(await checkpoint(), undefined, `${label} invalidates the checkpoint`);
    const recomputed = await balance();
    await fresh();
    assert.equal(await balance(), recomputed, `${label}: new checkpoint keeps the balance`);
  };

  await invalidates('punch before as_of', () => createTimePunch({ query }, {
    companyId, candidateId, punchKind: TIME_PUNCH_KIND.IN, source: TIME_PUNCH_SOURCE.WEB, punchedAt: `${addDaysIso(D1, 7)}T09:00:00.000Z`,
  }));
  await invalidates('punch void', () => query(
    `UPDATE employee_time_punches SET voided_at = NOW() WHERE company_id = $1 AND candidate_id = $2 AND punched_at = $3::timestamptz`,
    [companyId, candidateId, `${addDaysIso(D1, 7)}T09:00:00.000Z`]
  ));
  await invalidates('justification', () => query(
    `INSERT INTO employee_time_day_justifications (company_id, candidate_id, work_on, reason, created_by_user_id)
     VALUES ($1, $2, $3::date, '${TIME_DAY_JUSTIFICATION.MEDICAL_CERTIFICATE}', $4)`,
    [companyId, candidateId, addDaysIso(D1, 5), userId]
  ));
  await invalidates('approved manual entry', async () => {
    const r = await createHourBankManualEntry({ query }, {
      companyId, candidateId, entryKind: HOUR_BANK_ENTRY_KIND.CREDIT, minutes: 45, workOn: addDaysIso(D1, 2), createdByUserId: userId,
    });
    assert.equal(r.ok, true, r.errorCode);
  });
  await invalidates('employee schedule', async () => {
    const r = await saveEmployeeSchedule({ query }, {
      companyId, candidateId, validFrom: addDaysIso(D1, 3), userId,
      workdayStart: '09:00', workdayEnd: '16:00', weekdays: [weekday],
    });
    assert.equal(r.ok, true, r.errorCode);
  });
  await invalidates('holiday', async () => {
    const r = await saveHoliday({ query }, { companyId, userId, name: 'Feriado checkpoint', day: addDaysIso(D1, 7), recurrence: HOLIDAY_RECURRENCE.ONCE });
    assert.equal(r.ok, true, r.errorCode);
  });
  await fresh();
  await query(`UPDATE company_time_schedules SET updated_at = NOW(), updated_by_user_id = $2 WHERE company_id = $1`, [companyId, userId]);
  assert.ok(await checkpoint(), 'saving settings without changes keeps the checkpoint');
  await invalidates('company schedule', () => query(
    `UPDATE company_time_schedules SET late_grace_minutes = late_grace_minutes + 1 WHERE company_id = $1`, [companyId]
  ));
  await invalidates('work format', () => query(
    `UPDATE candidates SET work_format = $3 WHERE company_id = $1 AND id = $2`, [companyId, candidateId, WORK_FORMAT.PJ]
  ));
  await query(`UPDATE candidates SET work_format = $3 WHERE company_id = $1 AND id = $2`, [companyId, candidateId, WORK_FORMAT.CLT]);

  const unit = await query(`SELECT id FROM org_units WHERE company_id = $1 LIMIT 1`, [companyId]);
  if (unit.rowCount) {
    await invalidates('org unit tree', () => query(`UPDATE org_units SET parent_id = parent_id WHERE id = $1`, [unit.rows[0].id]));
  }

  let closureId = null;
  await invalidates('closure', async () => {
    const r = await createTimeClockClosure({ companyId, periodStart: addDaysIso(D1, -2), periodEnd: D1, userId });
    assert.equal(r.ok, true, r.errorCode);
    closureId = r.id;
  });
  await invalidates('closure cancel', async () => {
    const r = await cancelTimeClockClosure({ companyId, closureId, reason: 'fim do teste', userId });
    assert.equal(r.ok, true, r.errorCode);
  });

  // Pending requests never count, so they leave the checkpoint alone.
  await fresh();
  await query(
    `INSERT INTO employee_hour_bank_entries
       (company_id, candidate_id, entry_kind, minutes, work_on, status, source, note, created_by_candidate_id)
     VALUES ($1, $2, '${HOUR_BANK_ENTRY_KIND.DEBIT}', 30, $3::date, '${HOUR_BANK_STATUS.PENDING}', '${HOUR_BANK_SOURCE.EMPLOYEE}', 'pedido', $2)`,
    [companyId, candidateId, addDaysIso(D1, 1)]
  );
  assert.ok(await checkpoint(), 'pending entry keeps the checkpoint');

  await cleanup();
  console.log('hour-bank-checkpoints.dtov.test.js OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
