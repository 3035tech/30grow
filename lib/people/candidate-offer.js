/**
 * Minimal offer / acceptance on vacancy pipeline — B-703.
 * Not a full offer-letter / e-sign suite.
 */

import { asDb } from '../ae/as-db.js';
import { normalizeStartDate } from '../recruiting/pipeline.js';
import { ERR } from '../api-error-codes.js';
import { OFFER_STATUS, OFFER_STATUSES } from '../domain-status.js';

const OFFER_STATUS_SET = new Set(OFFER_STATUSES);
const SALARY_MAX = 80;
const NOTES_MAX = 1000;

export function normalizeOfferStatus(raw, fallback = OFFER_STATUS.NONE) {
  const s = String(raw || '').trim().toLowerCase();
  return OFFER_STATUS_SET.has(s) ? s : fallback;
}

export function normalizeOfferSalary(raw) {
  return String(raw || '').trim().slice(0, SALARY_MAX);
}

function mapOffer(row) {
  if (!row) {
    return {
      offerSalary: '',
      offerStartDate: null,
      offerStatus: OFFER_STATUS.NONE,
      offerAcceptedAt: null,
      offerNotes: '',
    };
  }
  return {
    offerSalary: row.offerSalary || '',
    offerStartDate: row.offerStartDate || null,
    offerStatus: normalizeOfferStatus(row.offerStatus, OFFER_STATUS.NONE),
    offerAcceptedAt: row.offerAcceptedAt || null,
    offerNotes: row.offerNotes || '',
  };
}

/**
 * Upsert offer fields on vacancy_candidates and/or assessments for the same pair.
 */
export async function updateCandidateOffer(dbOrQuery, {
  companyId,
  vacancyId,
  candidateId,
  assessmentId = null,
  offerSalary,
  offerStartDate,
  offerStatus,
  offerNotes,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const vid = Number(vacancyId);
  const candId = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(vid) || !Number.isFinite(candId)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const status = normalizeOfferStatus(offerStatus, OFFER_STATUS.PROPOSED);
  if (status === OFFER_STATUS.NONE) return { ok: false, errorCode: ERR.INVALID_STATUS };

  const salary = normalizeOfferSalary(offerSalary);
  if (!salary && (status === OFFER_STATUS.PROPOSED || status === OFFER_STATUS.ACCEPTED)) {
    return { ok: false, errorCode: ERR.OFFER_SALARY_REQUIRED };
  }
  const start = normalizeStartDate(offerStartDate);
  if (!start && (status === OFFER_STATUS.PROPOSED || status === OFFER_STATUS.ACCEPTED)) {
    return { ok: false, errorCode: ERR.OFFER_START_DATE_REQUIRED };
  }
  const notes = String(offerNotes || '').trim().slice(0, NOTES_MAX);

  const vc = await db.query(
    `UPDATE vacancy_candidates
     SET offer_salary = $4,
         offer_start_date = $5::date,
         offer_status = $6,
         offer_accepted_at = ${status === OFFER_STATUS.ACCEPTED ? 'COALESCE(offer_accepted_at, NOW())' : 'NULL'},
         offer_notes = $7,
         updated_at = NOW()
     WHERE vacancy_id = $1 AND candidate_id = $2 AND company_id = $3
     RETURNING id,
               offer_salary AS "offerSalary",
               offer_start_date AS "offerStartDate",
               offer_status AS "offerStatus",
               offer_accepted_at AS "offerAcceptedAt",
               offer_notes AS "offerNotes"`,
    [vid, candId, cid, salary, start, status, notes]
  );

  if (assessmentId) {
    await db.query(
      `UPDATE assessments
       SET offer_salary = $3,
           offer_start_date = $4::date,
           offer_status = $5,
           offer_accepted_at = ${status === OFFER_STATUS.ACCEPTED ? 'COALESCE(offer_accepted_at, NOW())' : 'NULL'},
           offer_notes = $6
       WHERE id = $1 AND company_id = $2`,
      [assessmentId, cid, salary, start, status, notes]
    );
  } else {
    await db.query(
      `UPDATE assessments
       SET offer_salary = $4,
           offer_start_date = $5::date,
           offer_status = $6,
           offer_accepted_at = ${status === OFFER_STATUS.ACCEPTED ? 'COALESCE(offer_accepted_at, NOW())' : 'NULL'},
           offer_notes = $7
       WHERE vacancy_id = $1 AND candidate_id = $2 AND company_id = $3`,
      [vid, candId, cid, salary, start, status, notes]
    );
  }

  if (vc.rowCount === 0) {
    const ass = await db.query(
      `SELECT offer_salary AS "offerSalary",
              offer_start_date AS "offerStartDate",
              offer_status AS "offerStatus",
              offer_accepted_at AS "offerAcceptedAt",
              offer_notes AS "offerNotes"
       FROM assessments
       WHERE vacancy_id = $1 AND candidate_id = $2 AND company_id = $3
       LIMIT 1`,
      [vid, candId, cid]
    );
    if (ass.rowCount === 0 && !assessmentId) return { ok: false, errorCode: ERR.NOT_FOUND };
    if (ass.rowCount > 0) return { ok: true, offer: mapOffer(ass.rows[0]) };
  }

  return {
    ok: true,
    offer: mapOffer(vc.rows[0] || null),
  };
}

export { mapOffer };
