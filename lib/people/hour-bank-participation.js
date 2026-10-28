import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { parseIsoDay } from './time-day-summary.js';
import { listClosureLocksForCandidate } from './time-clock.js';

const FAR_FUTURE = '9999-12-31';

/** The most recent individual choice applies; no choice means following the company. */
export function hourBankParticipantOn(rows, day) {
  let enabled = true;
  for (const row of rows || []) {
    if (row.validFrom > day) break;
    enabled = row.enabled;
  }
  return enabled;
}

export async function loadHourBankParticipation(dbOrQuery, { companyId, candidateIds, upTo }) {
  const ids = [...new Set((candidateIds || []).map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0);
  const result = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return result;
  const db = asDb(dbOrQuery);
  const rows = await db.query(
    `SELECT candidate_id AS "candidateId", to_char(valid_from, 'YYYY-MM-DD') AS "validFrom", enabled
     FROM employee_hour_bank_participation
     WHERE company_id = $1 AND candidate_id = ANY($2::bigint[]) AND valid_from <= $3::date
     ORDER BY candidate_id, valid_from`,
    [companyId, ids, upTo]
  );
  for (const row of rows.rows || []) result.get(Number(row.candidateId))?.push(row);
  return result;
}

/** Current and next version for a paged roster, using the participation primary key. */
export async function loadHourBankParticipationOverview(dbOrQuery, { companyId, candidateIds, day }) {
  const ids = [...new Set((candidateIds || []).map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0);
  const result = new Map(ids.map((id) => [id, { enabled: true, next: null }]));
  if (!ids.length) return result;
  const db = asDb(dbOrQuery);
  const rows = await db.query(
    `SELECT p.candidate_id AS "candidateId", COALESCE(current_version.enabled, TRUE) AS enabled,
            to_char(next_version.valid_from, 'YYYY-MM-DD') AS "nextValidFrom",
            next_version.enabled AS "nextEnabled"
     FROM unnest($2::bigint[]) AS p(candidate_id)
     LEFT JOIN LATERAL (
       SELECT enabled FROM employee_hour_bank_participation
       WHERE company_id = $1 AND candidate_id = p.candidate_id AND valid_from <= $3::date
       ORDER BY valid_from DESC LIMIT 1
     ) current_version ON TRUE
     LEFT JOIN LATERAL (
       SELECT valid_from, enabled FROM employee_hour_bank_participation
       WHERE company_id = $1 AND candidate_id = p.candidate_id AND valid_from > $3::date
       ORDER BY valid_from ASC LIMIT 1
     ) next_version ON TRUE`,
    [companyId, ids, day]
  );
  for (const row of rows.rows || []) {
    result.set(Number(row.candidateId), {
      enabled: row.enabled,
      next: row.nextValidFrom ? { validFrom: row.nextValidFrom, enabled: row.nextEnabled } : null,
    });
  }
  return result;
}

export async function saveHourBankParticipation(dbOrQuery, {
  companyId, candidateId, validFrom, enabled, userId = null,
}) {
  const cid = Number(companyId);
  const personId = Number(candidateId);
  const from = parseIsoDay(validFrom);
  if (![cid, personId].every((id) => Number.isSafeInteger(id) && id > 0)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  if (!from) return { ok: false, errorCode: ERR.INVALID_DATE };
  if (typeof enabled !== 'boolean') return { ok: false, errorCode: ERR.INVALID_DATA };
  const db = asDb(dbOrQuery);
  const person = await db.query(
    'SELECT id FROM candidates WHERE company_id = $1 AND id = $2 AND employment_status = $3',
    [cid, personId, 'employee']
  );
  if (!person.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const locks = await listClosureLocksForCandidate(db, {
    companyId: cid, candidateId: personId, from, to: FAR_FUTURE,
  });
  if (locks.length) return { ok: false, errorCode: ERR.TIME_CLOCK_PERIOD_CLOSED };
  await db.query(
    `INSERT INTO employee_hour_bank_participation
       (company_id, candidate_id, valid_from, enabled, created_by_user_id)
     VALUES ($1, $2, $3::date, $4, $5)
     ON CONFLICT (company_id, candidate_id, valid_from) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       created_by_user_id = EXCLUDED.created_by_user_id,
       updated_at = NOW()`,
    [cid, personId, from, enabled, userId]
  );
  return { ok: true, item: { candidateId: personId, validFrom: from, enabled } };
}
