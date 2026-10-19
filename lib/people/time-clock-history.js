import { asDb } from '../ae/as-db.js';
import { resolveTimeClockEligibility } from './time-clock-eligibility.js';
export function employmentOn(day, { startDate, exits = [] }) {
  // Exit date is the last employed day; rehire date starts a new interval.
  if (startDate && day < startDate) return false;
  return !exits.some(
    (e) => day > e.exitDate && (!e.rehiredAt || day < e.rehiredAt),
  );
}
export async function loadTimeHistory(
  dbOrQuery,
  { companyId, candidateIds, to },
) {
  const db = asDb(dbOrQuery);
  const [people, companies, exits, units] = await Promise.all([
    db.query(
      `SELECT candidate_id AS "candidateId",to_char(effective_on,'YYYY-MM-DD') AS day,org_unit_id AS "orgUnitId",work_format AS "workFormat",time_clock_override AS "timeClockOverride",to_char(start_date,'YYYY-MM-DD') AS "startDate" FROM time_clock_person_history WHERE company_id=$1 AND candidate_id=ANY($2::bigint[]) AND effective_on<=$3::date ORDER BY effective_on,id`,
      [companyId, candidateIds, to],
    ),
    db.query(
      `SELECT to_char(effective_on,'YYYY-MM-DD') AS day,to_char(workday_start,'HH24:MI') AS "workdayStart",to_char(workday_end,'HH24:MI') AS "workdayEnd",break_minutes AS "breakMinutes",late_grace_minutes AS "lateGraceMinutes",hour_bank_enabled AS "hourBankEnabled",hour_bank_max_minutes AS "hourBankMaxMinutes",to_char(hour_bank_started_on,'YYYY-MM-DD') AS "hourBankStartedOn",timezone FROM time_clock_company_history WHERE company_id=$1 AND effective_on<=$2::date ORDER BY effective_on,id`,
      [companyId, to],
    ),
    db.query(
      `SELECT candidate_id AS "candidateId",to_char(exit_date,'YYYY-MM-DD') AS "exitDate",to_char(rehired_at,'YYYY-MM-DD') AS "rehiredAt" FROM exit_records WHERE company_id=$1 AND candidate_id=ANY($2::bigint[]) ORDER BY exit_date,id`,
      [companyId, candidateIds],
    ),
    db.query(
      `SELECT unit_id AS "unitId",parent_id AS "parentId",to_char(effective_on,'YYYY-MM-DD') AS day FROM time_clock_unit_history WHERE company_id=$1 AND effective_on<=$2::date ORDER BY effective_on,id`,
      [companyId, to],
    ),
  ]);
  const latest = (rows, day) => {
    let value = null;
    for (const row of rows) {
      if (row.day > day) break;
      value = row;
    }
    return value;
  };
  const byPerson = new Map(
    candidateIds.map((id) => [
      Number(id),
      people.rows.filter((p) => Number(p.candidateId) === Number(id)),
    ]),
  );
  const byExit = new Map(
    candidateIds.map((id) => [
      Number(id),
      exits.rows.filter((p) => Number(p.candidateId) === Number(id)),
    ]),
  );
  const unitRows = new Map();
  for (const row of units.rows) {
    const id = Number(row.unitId);
    if (!unitRows.has(id)) unitRows.set(id, []);
    unitRows.get(id).push(row);
  }
  return (person, day, companySchedule) => {
    const p = {
      ...person,
      ...latest(byPerson.get(Number(person.id)) || [], day),
    };
    const requiresHistoryReview =
      !p.startDate ||
      (byExit.get(Number(person.id)) || []).some(
        (e) => p.startDate && e.exitDate < p.startDate && day <= e.exitDate,
      );
    const active = employmentOn(day, {
      startDate: p.startDate,
      exits: byExit.get(Number(person.id)) || [],
    });
    const unitChain = [],
      seen = new Set();
    let unit = Number(p.orgUnitId);
    while (unit && !seen.has(unit) && unitChain.length < 20) {
      seen.add(unit);
      unitChain.push(unit);
      unit = Number(latest(unitRows.get(unit) || [], day)?.parentId);
    }
    return {
      person: p,
      unitChain,
      active: active || requiresHistoryReview,
      requiresHistoryReview,
      enabled: resolveTimeClockEligibility({
        workFormat: p.workFormat,
        override: p.timeClockOverride,
      }).enabled,
      companySchedule: { ...companySchedule, ...latest(companies.rows, day) },
    };
  };
}
