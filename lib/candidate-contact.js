import { ERR } from './api-error-codes.js';

/** Resolve a known person's current contact; never fall back to a stale snapshot. */
export async function candidateContact(dbQuery, { companyId, candidateId = null, email = null }) {
  const result = await dbQuery(`SELECT id, email FROM candidates
    WHERE company_id=$1 AND ${candidateId != null ? 'id=$2' : "(LOWER(email)=$2 OR LOWER(personal_email)=$2)"}
    LIMIT 2`, [companyId, candidateId ?? String(email || '').trim().toLowerCase()]);
  if (result.rowCount > 1) throw Object.assign(new Error(ERR.EMAIL_TAKEN), { code: ERR.EMAIL_TAKEN });
  return result.rows[0] ?? null;
}
