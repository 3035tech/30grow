/**
 * Nucleus = time interno da empresa com Eneagrama (para fit vs vaga — B-403).
 */

import { asDb } from '../ae/as-db.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

const NUCLEUS_CAP = 24;

/**
 * Último top_type por pessoa do roster interno ativo (link /t ou employee).
 * @returns {Promise<Array<{ id: number, name: string, topType: number }>>}
 */
export async function loadCompanyInternalNucleus(dbOrQuery, { companyId, limit = NUCLEUS_CAP }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];

  const cap = Math.min(Math.max(1, Number(limit) || NUCLEUS_CAP), 40);
  const res = await db.query(
    `SELECT c.id AS id,
       c.full_name AS name,
       latest.top_type AS "topType"
     FROM candidates c
     CROSS JOIN LATERAL (
       SELECT a.top_type
       FROM assessments a
       WHERE a.candidate_id = c.id
         AND a.company_id = $1
         AND a.top_type BETWEEN 1 AND 9
         AND (
           a.vacancy_id IS NULL
           OR c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
         )
       ORDER BY a.created_at DESC NULLS LAST, a.id DESC
       LIMIT 1
     ) latest
     WHERE c.company_id = $1
       AND c.employment_status <> '${EMPLOYMENT_STATUS.ALUMNI}'
     ORDER BY c.id
     LIMIT $2`,
    [cid, cap]
  );
  return (res.rows || []).map((r) => ({
    id: r.id,
    name: r.name || '',
    topType: Number(r.topType),
  }));
}
