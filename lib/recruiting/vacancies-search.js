/**
 * Typeahead de vagas abertas (tenant-scoped, capped).
 */

import { asDb } from '../ae/as-db.js';
import { VACANCY_STATUS } from '../domain-status.js';

const SEARCH_CAP = 20;
const Q_MAX = 80;

/**
 * @returns {Promise<{ id: number, label: string, email?: null }[]>}
 */
export async function searchOpenVacancies(dbOrQuery, { companyId, q = '', limit = SEARCH_CAP } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];

  const cap = Math.min(Math.max(1, Number(limit) || SEARCH_CAP), SEARCH_CAP);
  const needle = String(q || '').trim().slice(0, Q_MAX);

  const params = [cid];
  let titleFilter = '';
  if (needle) {
    params.push(`%${needle}%`);
    titleFilter = `AND v.title ILIKE $${params.length}`;
  }
  params.push(cap);

  const res = await db.query(
    `SELECT v.id, v.title AS label
     FROM vacancies v
     WHERE v.company_id = $1
       AND v.deleted = FALSE
       AND v.status = '${VACANCY_STATUS.OPEN}'
       ${titleFilter}
     ORDER BY LOWER(v.title) ASC, v.id DESC
     LIMIT $${params.length}`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    label: r.label,
    email: null,
  }));
}
