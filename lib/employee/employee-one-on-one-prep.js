/**
 * Prep 1:1 na sessão autenticada do colaborador (B-2501).
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

export async function getEmployeeOneOnOnePrep(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT one_on_one_prep_at AS "preparedAt", one_on_one_prep_note AS "noteToManager"
     FROM candidates
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [candidateId, companyId]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const row = res.rows[0];
  return {
    ok: true,
    preparedAt: row.preparedAt || null,
    noteToManager: row.noteToManager || '',
  };
}

export async function submitEmployeeOneOnOnePrep(dbOrQuery, {
  companyId,
  candidateId,
  noteToManager = '',
}) {
  const db = asDb(dbOrQuery);
  const note = String(noteToManager || '')
    .trim()
    .slice(0, 2000);
  // Bump preparedAt on every save; keep previous note when the new note is empty.
  const res = await db.query(
    `UPDATE candidates
     SET one_on_one_prep_at = NOW(),
         one_on_one_prep_note = CASE WHEN $3 <> '' THEN $3 ELSE one_on_one_prep_note END
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     RETURNING one_on_one_prep_at AS "preparedAt", one_on_one_prep_note AS "noteToManager"`,
    [candidateId, companyId, note]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  return {
    ok: true,
    preparedAt: res.rows[0]?.preparedAt || null,
    noteToManager: res.rows[0]?.noteToManager || '',
  };
}
