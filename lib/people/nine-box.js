/**
 * 9-Box matrix — performance (HR Score 0–100) × potential (leadership / succession readiness).
 * Hedged placement for development conversations — not a competence verdict nor promotion decision.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';
import { getHrScoresByCandidateIds } from '../hr-score.js';
import { computeLeadershipPotential010 } from '../analytics/leadership-analytics.js';
import { computeSuccessionReadinessScore } from '../succession-plans.js';

export const NINE_BOX_EMPLOYEE_CAP = 150;

/** Inclusive thirds on 0–100 for performance and potential axes. */
export const NINE_BOX_BAND_EDGES = Object.freeze({ LOW_MAX: 33, MID_MAX: 66 });

/**
 * @param {number|null|undefined} score
 * @returns {'low'|'mid'|'high'|null}
 */
export function bandForScore100(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const n = Number(score);
  if (n <= NINE_BOX_BAND_EDGES.LOW_MAX) return 'low';
  if (n <= NINE_BOX_BAND_EDGES.MID_MAX) return 'mid';
  return 'high';
}

/**
 * Cell index 1–9 (low performance bottom row, high performance top; potential left → right).
 * @param {'low'|'mid'|'high'|null} performanceBand
 * @param {'low'|'mid'|'high'|null} potentialBand
 */
export function nineBoxCellIndex(performanceBand, potentialBand) {
  const row = { low: 2, mid: 1, high: 0 }[performanceBand];
  const col = { low: 0, mid: 1, high: 2 }[potentialBand];
  if (row == null || col == null) return null;
  return (2 - row) * 3 + col + 1;
}

/**
 * Potential 0–100: leadership from latest assessment, else succession readiness leadership leg.
 */
export function potentialScore100({ hrScore, assessmentScores }) {
  if (assessmentScores) {
    const { score010 } = computeLeadershipPotential010(assessmentScores);
    if (score010 != null) return Math.round(score010 * 10);
  }
  const readiness = computeSuccessionReadinessScore({ hrScore, assessmentScores });
  if (readiness.leadershipScore != null) return readiness.leadershipScore;
  return readiness.score ?? null;
}

/**
 * @param {import('pg').Pool|Function} dbOrQuery
 * @param {{ companyId: number, limit?: number }} opts
 */
export async function loadNineBoxForCompany(dbOrQuery, { companyId, limit = NINE_BOX_EMPLOYEE_CAP }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_COMPANY };
  }
  const cap = Math.min(NINE_BOX_EMPLOYEE_CAP, Math.max(1, Number(limit) || NINE_BOX_EMPLOYEE_CAP));

  const empRes = await db.query(
    `SELECT c.id, c.full_name AS "name"
     FROM candidates c
     WHERE c.company_id = $1
       AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     ORDER BY c.full_name ASC NULLS LAST, c.id ASC
     LIMIT $2`,
    [cid, cap]
  );

  const employees = empRes.rows || [];
  const ids = employees.map((r) => Number(r.id)).filter((id) => id > 0);
  if (!ids.length) {
    return {
      ok: true,
      companyId: cid,
      cap,
      scanned: 0,
      placed: 0,
      cells: Object.fromEntries([...Array(9)].map((_, i) => [String(i + 1), []])),
      unplaced: [],
    };
  }

  const [hrScores, assmtRes] = await Promise.all([
    getHrScoresByCandidateIds(db, ids),
    db.query(
      `SELECT DISTINCT ON (candidate_id)
         candidate_id AS "candidateId", scores
       FROM assessments
       WHERE candidate_id = ANY($1::bigint[])
         AND company_id = $2
         AND top_type IS NOT NULL
       ORDER BY candidate_id, created_at DESC`,
      [ids, cid]
    ),
  ]);

  const assessmentByCandidate = new Map(
    assmtRes.rows.map((r) => [Number(r.candidateId), r.scores])
  );

  const cells = Object.fromEntries([...Array(9)].map((_, i) => [String(i + 1), []]));
  const unplaced = [];

  for (const emp of employees) {
    const candidateId = Number(emp.id);
    const performanceScore = hrScores.get(candidateId) ?? null;
    const assessmentScores = assessmentByCandidate.get(candidateId) ?? null;
    const potScore = potentialScore100({ hrScore: performanceScore, assessmentScores });
    const perfBand = bandForScore100(performanceScore);
    const potBand = bandForScore100(potScore);
    const cell = nineBoxCellIndex(perfBand, potBand);

    const entry = {
      candidateId,
      name: emp.name || `#${candidateId}`,
      performanceScore,
      potentialScore: potScore,
      performanceBand: perfBand,
      potentialBand: potBand,
      cell,
    };

    if (cell == null) {
      unplaced.push(entry);
      continue;
    }
    cells[String(cell)].push(entry);
  }

  const placed = Object.values(cells).reduce((n, arr) => n + arr.length, 0);

  return {
    ok: true,
    companyId: cid,
    cap,
    scanned: employees.length,
    placed,
    cells,
    unplaced: unplaced.slice(0, 40),
  };
}
