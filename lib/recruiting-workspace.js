import { query, queryRead } from './db.js';
import { ERR } from './api-error-codes.js';

const SAVED_VIEW_CAP = 20;
const RECRUITER_CAP = 200;

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function normalizeRecruitingFilters(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    q: String(source.q || '').trim().slice(0, 80),
    owner: String(source.owner || 'all').slice(0, 24),
    aging: String(source.aging || 'all').slice(0, 16),
    fit: String(source.fit || 'all').slice(0, 16),
    notes: source.notes === true,
    hideEmpty: source.hideEmpty === true,
    compact: source.compact === true,
  };
}

export async function resolveRecruiterUserId(companyId, ownerUserId) {
  if (ownerUserId == null || ownerUserId === '') return { ok: true, ownerUserId: null };
  const cid = positiveId(companyId);
  const uid = positiveId(ownerUserId);
  if (!cid || !uid) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const result = await queryRead(
    `SELECT id FROM users
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE AND active = TRUE
     LIMIT 1`,
    [uid, cid]
  );
  return result.rowCount
    ? { ok: true, ownerUserId: uid }
    : { ok: false, errorCode: ERR.NOT_FOUND };
}

/** Active managers of one company (owner/assignee pickers), capped. */
export async function listActiveCompanyUsers(companyId, cap = RECRUITER_CAP) {
  const cid = positiveId(companyId);
  if (!cid) return { rows: [] };
  return queryRead(
    `SELECT id, COALESCE(NULLIF(TRIM(display_name), ''), email) AS name, email, role
     FROM users
     WHERE company_id = $1 AND deleted = FALSE AND active = TRUE
     ORDER BY COALESCE(NULLIF(TRIM(display_name), ''), email) ASC
     LIMIT $2`,
    [cid, Math.min(Math.max(Number(cap) || RECRUITER_CAP, 1), RECRUITER_CAP)]
  );
}

export async function getRecruitingWorkspace({ companyId, userId, vacancyId }) {
  const cid = positiveId(companyId);
  const uid = positiveId(userId);
  const vid = positiveId(vacancyId);
  if (!cid || !uid || !vid) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const [vacancy, recruiters, views] = await Promise.all([
    queryRead(
      `SELECT v.owner_user_id AS "ownerUserId"
       FROM vacancies v WHERE v.id = $1 AND v.company_id = $2 AND v.deleted = FALSE LIMIT 1`,
      [vid, cid]
    ),
    listActiveCompanyUsers(cid),
    queryRead(
      `SELECT id, name, filters, updated_at AS "updatedAt"
       FROM recruiting_saved_views
       WHERE company_id = $1 AND user_id = $2 AND vacancy_id = $3
       ORDER BY updated_at DESC LIMIT ${SAVED_VIEW_CAP}`,
      [cid, uid, vid]
    ),
  ]);
  if (!vacancy.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  return {
    ok: true,
    currentUserId: uid,
    vacancyOwnerUserId: vacancy.rows[0].ownerUserId ? Number(vacancy.rows[0].ownerUserId) : null,
    recruiters: recruiters.rows.map((row) => ({ ...row, id: Number(row.id) })),
    views: views.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      filters: normalizeRecruitingFilters(row.filters),
    })),
  };
}

export async function assignRecruitingCandidate({ companyId, vacancyId, candidateId, ownerUserId, updatedByUserId }) {
  const cid = positiveId(companyId);
  const vid = positiveId(vacancyId);
  const candidate = positiveId(candidateId);
  const owner = await resolveRecruiterUserId(cid, ownerUserId);
  if (!cid || !vid || !candidate || !owner.ok) return owner.ok ? { ok: false, errorCode: ERR.INVALID_PARAMS } : owner;
  const result = await query(
    `INSERT INTO recruiting_candidate_assignments
       (company_id, vacancy_id, candidate_id, owner_user_id, updated_by_user_id)
     SELECT $1, vacancy.id, candidate.id, $4, $5
     FROM vacancies vacancy
     JOIN candidates candidate ON candidate.id = $3 AND candidate.company_id = vacancy.company_id
     WHERE vacancy.id = $2 AND vacancy.company_id = $1 AND vacancy.deleted = FALSE
     ON CONFLICT (vacancy_id, candidate_id) DO UPDATE
       SET owner_user_id = EXCLUDED.owner_user_id,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = NOW()
     RETURNING owner_user_id AS "ownerUserId"`,
    [cid, vid, candidate, owner.ownerUserId, positiveId(updatedByUserId)]
  );
  return result.rowCount
    ? { ok: true, ownerUserId: result.rows[0].ownerUserId ? Number(result.rows[0].ownerUserId) : null }
    : { ok: false, errorCode: ERR.NOT_FOUND };
}

export async function saveRecruitingView({ companyId, userId, vacancyId, name, filters }) {
  const cid = positiveId(companyId);
  const uid = positiveId(userId);
  const vid = positiveId(vacancyId);
  const cleanName = String(name || '').trim().slice(0, 60);
  if (!cid || !uid || !vid || !cleanName) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const count = await queryRead(
    `SELECT COUNT(*)::int AS n FROM recruiting_saved_views
     WHERE company_id = $1 AND user_id = $2 AND vacancy_id = $3`,
    [cid, uid, vid]
  );
  if (Number(count.rows[0]?.n || 0) >= SAVED_VIEW_CAP) return { ok: false, errorCode: ERR.RECRUITING_VIEW_LIMIT };
  try {
    const result = await query(
      `INSERT INTO recruiting_saved_views (company_id, user_id, vacancy_id, name, filters)
       SELECT $1, $2, vacancy.id, $4, $5::jsonb
       FROM vacancies vacancy
       WHERE vacancy.id = $3 AND vacancy.company_id = $1 AND vacancy.deleted = FALSE
       RETURNING id, name, filters, updated_at AS "updatedAt"`,
      [cid, uid, vid, cleanName, JSON.stringify(normalizeRecruitingFilters(filters))]
    );
    return result.rowCount ? { ok: true, view: { ...result.rows[0], id: Number(result.rows[0].id) } } : { ok: false, errorCode: ERR.NOT_FOUND };
  } catch (error) {
    if (error?.code === '23505') return { ok: false, errorCode: ERR.RECRUITING_VIEW_NAME_EXISTS };
    throw error;
  }
}

export async function deleteRecruitingView({ companyId, userId, viewId }) {
  const result = await query(
    `DELETE FROM recruiting_saved_views
     WHERE id = $1 AND company_id = $2 AND user_id = $3 RETURNING id`,
    [positiveId(viewId), positiveId(companyId), positiveId(userId)]
  );
  return result.rowCount ? { ok: true } : { ok: false, errorCode: ERR.NOT_FOUND };
}
