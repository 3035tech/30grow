import { withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import {
  listClosureLocksForCandidate,
  isoDayInTz,
  getCompanyTimeSchedule,
} from './time-clock.js';
import { parseIsoDay } from './time-day-summary.js';
export async function correctTimeEmploymentHistory(
  { companyId, candidateId, effectiveOn, startDate, reason },
  transaction = withTransaction,
) {
  if (
    !parseIsoDay(effectiveOn) ||
    !parseIsoDay(startDate) ||
    startDate > effectiveOn ||
    String(reason || '').trim().length < 10
  )
    return { ok: false, errorCode: ERR.INVALID_DATA };
  return transaction(async (db) => {
    const employee = await db.query(
      "SELECT id FROM candidates WHERE company_id=$1 AND id=$2 AND employment_status IN ('employee','alumni') FOR NO KEY UPDATE",
      [companyId, candidateId],
    );
    if (!employee.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
    const sched = await getCompanyTimeSchedule(db, { companyId });
    if (effectiveOn > isoDayInTz(new Date(), sched.schedule.timezone))
      return { ok: false, errorCode: ERR.INVALID_DATE };
    const locks = await listClosureLocksForCandidate(db, {
      companyId,
      candidateId,
      from: effectiveOn,
      to: '9999-12-31',
    });
    if (locks.length)
      return { ok: false, errorCode: ERR.TIME_CLOCK_PERIOD_CLOSED };
    const result = await db.query(
      `INSERT INTO time_clock_person_history(company_id,candidate_id,effective_on,org_unit_id,work_format,time_clock_override,start_date)
   SELECT company_id,candidate_id,$3::date,org_unit_id,work_format,time_clock_override,$4::date FROM time_clock_person_history WHERE company_id=$1 AND candidate_id=$2 AND effective_on<=$3::date ORDER BY effective_on DESC,id DESC LIMIT 1
   ON CONFLICT(company_id,candidate_id,effective_on) DO UPDATE SET start_date=EXCLUDED.start_date,recorded_at=clock_timestamp() RETURNING id`,
      [companyId, candidateId, effectiveOn, startDate],
    );
    if (!result.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
    return { ok: true, id: Number(result.rows[0].id) };
  });
}
