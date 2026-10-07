import { asDb } from '../ae/as-db.js';
import { isRichTextEmpty, sanitizeRichTextHtml } from '../sanitize-html.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

const NOTES_MAX = 8000;
const NEXT_STEPS_MAX = 4000;

function trimRichOrNull(value, max) {
  const safe = sanitizeRichTextHtml(value, max);
  if (!safe || isRichTextEmpty(safe)) return null;
  return safe;
}

const STALE_LIST_MAX = 50;

/**
 * Employees without a 1:1 in the last `staleDays` (never met first), bounded by `limit`.
 * Shared by the weekly digest and the people copilot.
 * @returns {Promise<Array<{ candidateId: number, candidateName: string, lastMeeting: string|null }>>}
 */
export async function listStaleOneOnOnes(dbOrQuery, { companyId, staleDays = 30, limit = 8 }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];
  const days = Math.min(365, Math.max(1, Number(staleDays) || 30));
  const cap = Math.min(STALE_LIST_MAX, Math.max(1, Number(limit) || 8));
  const res = await db.query(
    `SELECT c.id AS "candidateId", c.full_name AS "candidateName",
            (
              SELECT MAX(o.meeting_date)
              FROM one_on_ones o
              WHERE o.candidate_id = c.id AND o.company_id = $1
            ) AS "lastMeeting"
     FROM candidates c
     WHERE c.company_id = $1
       AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       AND NOT EXISTS (
         SELECT 1 FROM one_on_ones o
         WHERE o.candidate_id = c.id
           AND o.company_id = $1
           AND o.meeting_date >= (CURRENT_DATE - ($2::int))
       )
     ORDER BY "lastMeeting" NULLS FIRST, c.full_name ASC
     LIMIT $3`,
    [cid, days, cap]
  );
  return res.rows || [];
}

/** Last 1:1 date per person (one grouped query). @returns {Promise<Map<number, string|null>>} */
export async function lastOneOnOneByCandidate(dbOrQuery, { companyId, candidateIds }) {
  const db = asDb(dbOrQuery);
  const ids = [...new Set((candidateIds || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 200);
  const out = new Map();
  if (!ids.length) return out;
  const res = await db.query(
    `SELECT candidate_id AS "candidateId", MAX(meeting_date) AS "lastMeeting"
     FROM one_on_ones
     WHERE company_id = $1 AND candidate_id = ANY($2::bigint[])
     GROUP BY candidate_id`,
    [Number(companyId), ids]
  );
  for (const r of res.rows || []) out.set(Number(r.candidateId), r.lastMeeting || null);
  return out;
}

/**
 * @param {{ query: Function } | Function} dbOrQuery
 * @param {{ candidateId: string|number, companyId?: string|number|null, isAdmin?: boolean }} scope
 */
export async function listOneOnOnes(
  dbOrQuery,
  { candidateId, companyId = null, isAdmin = false, limit = 50 } = {}
) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || 50), 50);
  const params = [candidateId];
  let companyClause = '';
  if (!isAdmin) {
    if (companyId == null) return [];
    companyClause = 'AND o.company_id = $2';
    params.push(companyId);
  }
  params.push(cap);
  const limitParam = `$${params.length}`;
  const res = await db.query(
    `SELECT o.id, o.company_id AS "companyId", o.candidate_id AS "candidateId",
            o.meeting_date AS "meetingDate", o.notes, o.next_steps AS "nextSteps",
            o.created_by_user_id AS "createdByUserId",
            o.created_at AS "createdAt", o.updated_at AS "updatedAt",
            u.email AS "createdByName"
     FROM one_on_ones o
     LEFT JOIN users u ON u.id = o.created_by_user_id
     WHERE o.candidate_id = $1 ${companyClause}
     ORDER BY o.meeting_date DESC, o.id DESC
     LIMIT ${limitParam}`,
    params
  );
  return res.rows;
}

/**
 * @param {{ query: Function } | Function} dbOrQuery
 */
export async function createOneOnOne(dbOrQuery, {
  companyId,
  candidateId,
  meetingDate,
  notes,
  nextSteps,
  createdByUserId,
}) {
  const db = asDb(dbOrQuery);
  const safeNotes = trimRichOrNull(notes, NOTES_MAX);
  if (!safeNotes) return { ok: false, errorCode: ERR.NOTES_REQUIRED };

  const dateStr = meetingDate ? String(meetingDate).slice(0, 10) : null;
  const res = await db.query(
    `INSERT INTO one_on_ones (
       company_id, candidate_id, meeting_date, notes, next_steps, created_by_user_id
     ) VALUES (
       $1, $2,
       COALESCE($3::date, CURRENT_DATE),
       $4, $5, $6
     )
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               meeting_date AS "meetingDate", notes, next_steps AS "nextSteps",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      companyId,
      candidateId,
      dateStr,
      safeNotes,
      trimRichOrNull(nextSteps, NEXT_STEPS_MAX),
      createdByUserId || null,
    ]
  );
  return { ok: true, item: res.rows[0] };
}

/**
 * @param {{ query: Function } | Function} dbOrQuery
 */
export async function updateOneOnOne(dbOrQuery, {
  id,
  companyId,
  isAdmin,
  meetingDate,
  notes,
  nextSteps,
}) {
  const db = asDb(dbOrQuery);
  const owned = await db.query(
    `SELECT id, company_id AS "companyId" FROM one_on_ones WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (!isAdmin && String(owned.rows[0].companyId) !== String(companyId)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  const sets = [];
  const params = [id];
  let n = 2;

  if (meetingDate !== undefined) {
    sets.push(`meeting_date = $${n++}::date`);
    params.push(String(meetingDate).slice(0, 10));
  }
  if (notes !== undefined) {
    const safeNotes = trimRichOrNull(notes, NOTES_MAX);
    if (!safeNotes) return { ok: false, errorCode: ERR.NOTES_REQUIRED };
    sets.push(`notes = $${n++}`);
    params.push(safeNotes);
  }
  if (nextSteps !== undefined) {
    sets.push(`next_steps = $${n++}`);
    params.push(trimRichOrNull(nextSteps, NEXT_STEPS_MAX));
  }
  if (sets.length === 0) return { ok: false, errorCode: ERR.NO_FIELDS_TO_UPDATE };

  sets.push('updated_at = NOW()');
  const res = await db.query(
    `UPDATE one_on_ones SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               meeting_date AS "meetingDate", notes, next_steps AS "nextSteps",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  return { ok: true, item: res.rows[0] };
}

/**
 * @param {{ query: Function } | Function} dbOrQuery
 */
export async function deleteOneOnOne(dbOrQuery, { id, companyId, isAdmin }) {
  const db = asDb(dbOrQuery);
  const owned = await db.query(
    `SELECT id, company_id AS "companyId" FROM one_on_ones WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (!isAdmin && String(owned.rows[0].companyId) !== String(companyId)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  await db.query(`DELETE FROM one_on_ones WHERE id = $1`, [id]);
  return { ok: true };
}
