import { query, withTransaction } from '../db.js';
import { toDateOnlyIso } from '../format-display-date.js';
import { ERR } from '../api-error-codes.js';
import { POSITION_TRANSITIONS, POSITION_MAX } from '../org-position-constants.js';

const fail = (errorCode) => ({ ok: false, errorCode });
function conflict(code = ERR.POSITION_CONFLICT) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
export async function lockPositionCompany(db, companyId) {
  const result = await db.query(
    'SELECT id FROM companies WHERE id=$1 AND deleted=FALSE FOR UPDATE',
    [companyId],
  );
  if (!result.rowCount) conflict(ERR.NOT_FOUND);
}
const projection = `p.id,p.code,p.title,p.status,p.fte::float8,p.version,
 p.org_unit_id AS "orgUnitId",u.name AS "unitName",p.job_role_id AS "jobRoleId",j.name AS "roleName",
 p.effective_from::text AS "effectiveFrom",p.effective_to::text AS "effectiveTo",p.approved_at AS "approvedAt",
 a.id AS "assignmentId",a.candidate_id AS "candidateId",c.full_name AS "candidateName",a.started_on::text AS "startedOn",
 r.id AS "recruitmentId",r.vacancy_id AS "vacancyId",r.filled_assignment_id AS "filledAssignmentId",v.title AS "vacancyTitle"`;
const joins = `JOIN org_units u ON u.id=p.org_unit_id AND u.company_id=p.company_id
 JOIN job_roles j ON j.id=p.job_role_id AND j.company_id=p.company_id
 LEFT JOIN org_position_assignments a ON a.position_id=p.id AND a.company_id=p.company_id AND a.ended_on IS NULL
 LEFT JOIN candidates c ON c.id=a.candidate_id AND c.company_id=p.company_id
 LEFT JOIN LATERAL(SELECT rr.* FROM org_position_recruitments rr WHERE rr.position_id=p.id AND rr.company_id=p.company_id
 AND (rr.ended_at IS NULL OR (rr.filled_assignment_id IS NOT NULL AND rr.vacancy_id=$6))
 ORDER BY CASE WHEN rr.vacancy_id=$6 THEN 0 ELSE 1 END,rr.linked_at DESC LIMIT 1)r ON TRUE
 LEFT JOIN vacancies v ON v.id=r.vacancy_id AND v.company_id=p.company_id`;
export async function listOrgPositions(
  companyId,
  {
    page = 1,
    pageSize = 20,
    q = '',
    status = '',
    orgUnitId = null,
    jobRoleId = null,
    vacancyId = null,
    candidateId = null,
  } = {},
) {
  const values = [companyId, `%${q}%`, status, orgUnitId, jobRoleId, vacancyId, candidateId];
  const where = `p.company_id=$1 AND ($2='%%' OR p.title ILIKE $2 OR p.code ILIKE $2 OR c.full_name ILIKE $2)
 AND ($3='' OR ($3='occupied' AND a.id IS NOT NULL) OR ($3='open' AND p.status='approved' AND a.id IS NULL) OR ($3 NOT IN ('occupied','open') AND p.status=$3))
 AND ($4::int IS NULL OR p.org_unit_id=$4) AND ($5::bigint IS NULL OR p.job_role_id=$5)
 AND ($6::bigint IS NULL OR r.vacancy_id=$6) AND ($7::bigint IS NULL OR a.candidate_id=$7)`;
  const result = await query(
    `SELECT ${projection},COUNT(*) OVER()::int AS total FROM org_positions p ${joins} WHERE ${where} ORDER BY lower(p.code),p.id LIMIT $8 OFFSET $9`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  let total = result.rows[0]?.total || 0;
  if (!result.rowCount && page > 1) {
    const count = await query(
      `SELECT COUNT(*)::int AS total FROM org_positions p ${joins} WHERE ${where}`,
      values,
    );
    total = count.rows[0].total;
  }
  const summary = await query(
    `SELECT
 COUNT(*) FILTER(WHERE p.status='planned')::int AS planned,
 COUNT(*) FILTER(WHERE p.status='approved')::int AS approved,
 COUNT(*) FILTER(WHERE p.status='approved' AND a.id IS NOT NULL)::int AS occupied,
 COUNT(*) FILTER(WHERE p.status='approved' AND a.id IS NULL)::int AS available,
 COUNT(*) FILTER(WHERE p.status='frozen')::int AS frozen,
 COALESCE(SUM(p.fte) FILTER(WHERE p.status='approved'),0)::float8 AS "approvedFte",
 COALESCE(SUM(p.fte) FILTER(WHERE p.status='approved' AND a.id IS NOT NULL),0)::float8 AS "occupiedFte"
 FROM org_positions p LEFT JOIN org_position_assignments a ON a.company_id=p.company_id AND a.position_id=p.id AND a.ended_on IS NULL
 WHERE p.company_id=$1 AND ($2::int IS NULL OR p.org_unit_id=$2) AND ($3::bigint IS NULL OR p.job_role_id=$3)`,
    [companyId, orgUnitId, jobRoleId],
  );
  const unallocated = await query(
    `SELECT COUNT(*)::int AS n FROM candidates c WHERE c.company_id=$1 AND c.employment_status='employee'
 AND ($2::int IS NULL OR c.org_unit_id=$2) AND ($3::bigint IS NULL OR c.job_role_id=$3)
 AND NOT EXISTS(SELECT 1 FROM org_position_assignments a WHERE a.company_id=c.company_id AND a.candidate_id=c.id AND a.ended_on IS NULL)`,
    [companyId, orgUnitId, jobRoleId],
  );
  return {
    ok: true,
    items: result.rows,
    total,
    page,
    pageSize,
    summary: { ...summary.rows[0], unallocated: unallocated.rows[0].n },
  };
}
async function validateReferences(db, companyId, orgUnitId, jobRoleId) {
  const result = await db.query(
    `SELECT 1 FROM org_units u JOIN job_roles j ON j.company_id=u.company_id WHERE u.company_id=$1 AND u.id=$2 AND u.active AND j.id=$3 AND j.active FOR SHARE OF u,j`,
    [companyId, orgUnitId, jobRoleId],
  );
  if (!result.rowCount) conflict(ERR.POSITION_REFERENCE);
}
export async function saveOrgPosition({
  companyId,
  actorId,
  id = null,
  version,
  code,
  title,
  orgUnitId,
  jobRoleId,
  fte = 1,
  effectiveFrom,
  effectiveTo = null,
}) {
  try {
    return await withTransaction(async (db) => {
      await lockPositionCompany(db, companyId);
      await validateReferences(db, companyId, orgUnitId, jobRoleId);
      if (id) {
        const current = await db.query(
          `SELECT status,version FROM org_positions WHERE company_id=$1 AND id=$2 FOR UPDATE`,
          [companyId, id],
        );
        if (!current.rowCount) return fail(ERR.NOT_FOUND);
        if (current.rows[0].status !== 'planned' || current.rows[0].version !== version)
          return fail(ERR.POSITION_CONFLICT);
      } else {
        const count = await db.query(
          'SELECT COUNT(*)::int AS n FROM org_positions WHERE company_id=$1',
          [companyId],
        );
        if (count.rows[0].n >= POSITION_MAX) return fail(ERR.POSITION_LIMIT);
      }
      const result = id
        ? await db.query(
            `UPDATE org_positions SET code=$3,title=$4,org_unit_id=$5,job_role_id=$6,fte=$7,effective_from=$8,effective_to=$9,version=version+1,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING id`,
            [companyId, id, code, title, orgUnitId, jobRoleId, fte, effectiveFrom, effectiveTo],
          )
        : await db.query(
            `INSERT INTO org_positions(company_id,code,title,org_unit_id,job_role_id,fte,effective_from,effective_to,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [
              companyId,
              code,
              title,
              orgUnitId,
              jobRoleId,
              fte,
              effectiveFrom,
              effectiveTo,
              actorId,
            ],
          );
      return { ok: true, id: result.rows[0].id };
    });
  } catch (error) {
    if (error.code === '23505') return fail(ERR.POSITION_DUPLICATE);
    if (Object.values(ERR).includes(error.code)) return fail(error.code);
    throw error;
  }
}
export async function changeOrgPosition({ companyId, id, version, status, actorId }) {
  return withTransaction(async (db) => {
    await lockPositionCompany(db, companyId);
    const current = await db.query(
      'SELECT * FROM org_positions WHERE company_id=$1 AND id=$2 FOR UPDATE',
      [companyId, id],
    );
    const p = current.rows[0];
    if (!p) return fail(ERR.NOT_FOUND);
    if (p.version !== version || !POSITION_TRANSITIONS[p.status]?.includes(status))
      return fail(ERR.POSITION_CONFLICT);
    const used = await db.query(
      `SELECT 1 WHERE EXISTS(SELECT 1 FROM org_position_assignments WHERE company_id=$1 AND position_id=$2 AND ended_on IS NULL) OR EXISTS(SELECT 1 FROM org_position_recruitments WHERE company_id=$1 AND position_id=$2 AND ended_at IS NULL)`,
      [companyId, id],
    );
    if (used.rowCount) return fail(ERR.POSITION_IN_USE);
    if (status === 'approved') {
      await validateReferences(db, companyId, p.org_unit_id, p.job_role_id);
      if (p.effective_to && toDateOnlyIso(p.effective_to) < new Date().toISOString().slice(0, 10))
        return fail(ERR.INVALID_DATE);
    }
    await db.query(
      `UPDATE org_positions SET status=$3,approved_at=CASE WHEN $3='approved' THEN now() ELSE approved_at END,approved_by_user_id=CASE WHEN $3='approved' THEN $4 ELSE approved_by_user_id END,version=version+1,updated_at=now() WHERE company_id=$1 AND id=$2`,
      [companyId, id, status, actorId],
    );
    return { ok: true, id };
  });
}

/** Called only inside a tenant-locked transaction. An assignment replaces the primary occupation. */
export async function occupyOrgPosition(
  db,
  {
    companyId,
    positionId,
    candidateId,
    startedOn,
    reason,
    actorId = null,
    vacancyId = null,
    allowCandidate = false,
  },
) {
  const position = await db.query(
    'SELECT * FROM org_positions WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [companyId, positionId],
  );
  const p = position.rows[0];
  if (!p) conflict(ERR.NOT_FOUND);
  const existing = await db.query(
    'SELECT * FROM org_position_assignments WHERE company_id=$1 AND position_id=$2 AND ended_on IS NULL FOR UPDATE',
    [companyId, positionId],
  );
  if (existing.rows[0] && Number(existing.rows[0].candidate_id) === Number(candidateId))
    return { id: existing.rows[0].id, idempotent: true };
  if (existing.rowCount || p.status !== 'approved') conflict(ERR.POSITION_IN_USE);
  if (
    startedOn < toDateOnlyIso(p.effective_from) ||
    (p.effective_to && startedOn > toDateOnlyIso(p.effective_to))
  )
    conflict(ERR.INVALID_DATE);
  const overlap = await db.query(
    `SELECT 1 FROM org_position_assignments WHERE company_id=$1 AND (position_id=$2 OR candidate_id=$3) AND ended_on IS NOT NULL AND ended_on>started_on AND ended_on>$4::date LIMIT 1`,
    [companyId, positionId, candidateId, startedOn],
  );
  if (overlap.rowCount) conflict(ERR.INVALID_DATE);
  await validateReferences(db, companyId, p.org_unit_id, p.job_role_id);
  const candidate = await db.query(
    'SELECT employment_status FROM candidates WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [companyId, candidateId],
  );
  if (
    !candidate.rowCount ||
    (!allowCandidate && candidate.rows[0].employment_status !== 'employee')
  )
    conflict(ERR.NOT_EMPLOYEE);
  const recruitment = await db.query(
    `SELECT vacancy_id FROM org_position_recruitments WHERE company_id=$1 AND position_id=$2 AND ended_at IS NULL FOR UPDATE`,
    [companyId, positionId],
  );
  if (recruitment.rowCount && Number(recruitment.rows[0].vacancy_id) !== Number(vacancyId))
    conflict(ERR.POSITION_IN_USE);
  const previous = await db.query(
    'SELECT id,started_on FROM org_position_assignments WHERE company_id=$1 AND candidate_id=$2 AND ended_on IS NULL FOR UPDATE',
    [companyId, candidateId],
  );
  if (previous.rowCount && startedOn < toDateOnlyIso(previous.rows[0].started_on))
    conflict(ERR.INVALID_DATE);
  await db.query(
    `UPDATE org_position_assignments SET ended_on=$3,ended_reason=$4,ended_by_user_id=$5 WHERE company_id=$1 AND candidate_id=$2 AND ended_on IS NULL`,
    [companyId, candidateId, startedOn, reason, actorId],
  );
  const result = await db.query(
    `INSERT INTO org_position_assignments(company_id,position_id,candidate_id,started_on,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [companyId, positionId, candidateId, startedOn, reason, actorId],
  );
  await db.query(
    'UPDATE candidates SET org_unit_id=$3,job_role_id=$4 WHERE company_id=$1 AND id=$2',
    [companyId, candidateId, p.org_unit_id, p.job_role_id],
  );
  await db.query(
    'UPDATE org_positions SET version=version+1,updated_at=now() WHERE company_id=$1 AND id=$2',
    [companyId, positionId],
  );
  if (vacancyId)
    await db.query(
      'UPDATE org_position_recruitments SET ended_at=now(),filled_assignment_id=$3 WHERE company_id=$1 AND position_id=$2 AND ended_at IS NULL',
      [companyId, positionId, result.rows[0].id],
    );
  return { id: result.rows[0].id };
}
export async function manageOrgAssignment({
  companyId,
  positionId,
  candidateId,
  startedOn,
  reason,
  actorId,
}) {
  try {
    return await withTransaction(async (db) => {
      await lockPositionCompany(db, companyId);
      const r = await occupyOrgPosition(db, {
        companyId,
        positionId,
        candidateId,
        startedOn,
        reason,
        actorId,
      });
      return { ok: true, ...r };
    });
  } catch (error) {
    if (Object.values(ERR).includes(error.code)) return fail(error.code);
    throw error;
  }
}
export async function releaseOrgPosition({
  companyId,
  positionId,
  endedOn,
  reason,
  actorId,
  assignmentId,
}) {
  return withTransaction(async (db) => {
    await lockPositionCompany(db, companyId);
    const r = await db.query(
      `UPDATE org_position_assignments SET ended_on=$3,ended_reason=$4,ended_by_user_id=$5 WHERE company_id=$1 AND position_id=$2 AND ended_on IS NULL AND started_on<=$3::date AND id=$6 RETURNING id`,
      [companyId, positionId, endedOn, reason, actorId, assignmentId],
    );
    return r.rowCount ? { ok: true } : fail(ERR.POSITION_CONFLICT);
  });
}
export async function linkOrgPositionVacancy({
  companyId,
  positionId,
  vacancyId,
  actorId,
  recruitmentId,
}) {
  return withTransaction(async (db) => {
    await lockPositionCompany(db, companyId);
    const position = await db.query(
      'SELECT * FROM org_positions WHERE company_id=$1 AND id=$2 FOR UPDATE',
      [companyId, positionId],
    );
    const p = position.rows[0];
    if (!p) return fail(ERR.NOT_FOUND);
    if (vacancyId == null) {
      const unlinked = await db.query(
        'UPDATE org_position_recruitments SET ended_at=COALESCE(ended_at,now()) WHERE company_id=$1 AND position_id=$2 AND id=$3 AND filled_assignment_id IS NULL RETURNING id',
        [companyId, positionId, recruitmentId],
      );
      return unlinked.rowCount ? { ok: true } : fail(ERR.POSITION_CONFLICT);
    }
    const v = await db.query(
      `SELECT job_role_id,status,positions_count FROM vacancies WHERE company_id=$1 AND id=$2 AND deleted=FALSE FOR UPDATE`,
      [companyId, vacancyId],
    );
    if (
      !v.rowCount ||
      v.rows[0].status !== 'open' ||
      Number(v.rows[0].job_role_id) !== Number(p.job_role_id)
    )
      return fail(ERR.POSITION_REFERENCE);
    if (p.status !== 'approved') return fail(ERR.POSITION_CONFLICT);
    if (p.effective_to && toDateOnlyIso(p.effective_to) < new Date().toISOString().slice(0, 10))
      return fail(ERR.INVALID_DATE);
    const current = await db.query(
      'SELECT vacancy_id FROM org_position_recruitments WHERE company_id=$1 AND position_id=$2 AND ended_at IS NULL',
      [companyId, positionId],
    );
    if (current.rowCount && Number(current.rows[0].vacancy_id) === Number(vacancyId))
      return { ok: true };
    await validateReferences(db, companyId, p.org_unit_id, p.job_role_id);
    const used = await db.query(
      `SELECT 1 WHERE EXISTS(SELECT 1 FROM org_position_assignments WHERE company_id=$1 AND position_id=$2 AND ended_on IS NULL) OR EXISTS(SELECT 1 FROM org_position_recruitments WHERE company_id=$1 AND position_id=$2 AND ended_at IS NULL)`,
      [companyId, positionId],
    );
    if (used.rowCount) return fail(ERR.POSITION_IN_USE);
    const counts = await db.query(
      `SELECT COUNT(*)::int AS n FROM org_position_recruitments WHERE company_id=$1 AND vacancy_id=$2 AND (ended_at IS NULL OR filled_assignment_id IS NOT NULL)`,
      [companyId, vacancyId],
    );
    if (counts.rows[0].n >= v.rows[0].positions_count) return fail(ERR.POSITION_VACANCY_FULL);
    await db.query(
      'INSERT INTO org_position_recruitments(company_id,position_id,vacancy_id,linked_by_user_id) VALUES($1,$2,$3,$4)',
      [companyId, positionId, vacancyId, actorId],
    );
    await db.query('UPDATE vacancies SET headcount_managed=TRUE WHERE company_id=$1 AND id=$2', [
      companyId,
      vacancyId,
    ]);
    return { ok: true };
  });
}

/** Legacy vacancies have no structural positions. Linked vacancies must fill exactly one, idempotently. */
export async function fillOrgPositionForHire(
  db,
  { companyId, candidateId, vacancyId, startDate, actorId = null },
) {
  if (!vacancyId) return;
  const links = await db.query(
    `SELECT r.position_id,r.ended_at,r.filled_assignment_id FROM org_position_recruitments r WHERE r.company_id=$1 AND r.vacancy_id=$2 AND (r.ended_at IS NULL OR r.filled_assignment_id IS NOT NULL) ORDER BY r.position_id`,
    [companyId, vacancyId],
  );
  if (!links.rowCount) {
    const v = await db.query(
      'SELECT headcount_managed FROM vacancies WHERE company_id=$1 AND id=$2',
      [companyId, vacancyId],
    );
    if (v.rows[0]?.headcount_managed) conflict(ERR.POSITION_VACANCY_FULL);
    return;
  }
  const existing = await db.query(
    `SELECT 1 FROM org_position_assignments a JOIN org_position_recruitments r ON r.company_id=a.company_id AND r.filled_assignment_id=a.id WHERE a.company_id=$1 AND a.candidate_id=$2 AND r.vacancy_id=$3 AND a.ended_on IS NULL`,
    [companyId, candidateId, vacancyId],
  );
  if (existing.rowCount) return;
  const vacancy = await db.query(
    'SELECT status,positions_count FROM vacancies WHERE company_id=$1 AND id=$2',
    [companyId, vacancyId],
  );
  if (
    !vacancy.rowCount ||
    vacancy.rows[0].status !== 'open' ||
    links.rows.filter((link) => link.filled_assignment_id != null).length >=
      vacancy.rows[0].positions_count
  )
    conflict(ERR.POSITION_VACANCY_FULL);
  const available = links.rows.find((link) => !link.ended_at);
  if (!available) conflict(ERR.POSITION_VACANCY_FULL);
  const p = await db.query(
    `SELECT p.job_role_id,v.job_role_id AS vacancy_role FROM org_positions p JOIN vacancies v ON v.company_id=p.company_id AND v.id=$3 WHERE p.company_id=$1 AND p.id=$2`,
    [companyId, available.position_id, vacancyId],
  );
  if (!p.rowCount || Number(p.rows[0].job_role_id) !== Number(p.rows[0].vacancy_role))
    conflict(ERR.POSITION_REFERENCE);
  await occupyOrgPosition(db, {
    companyId,
    positionId: available.position_id,
    candidateId,
    startedOn: startDate,
    reason: 'vacancy_hire',
    actorId,
    vacancyId,
    allowCandidate: true,
  });
}
export async function getOrgPositionHistory(companyId, positionId) {
  const position = await query('SELECT id FROM org_positions WHERE company_id=$1 AND id=$2', [
    companyId,
    positionId,
  ]);
  if (!position.rowCount) return fail(ERR.NOT_FOUND);
  const result = await query(
    `SELECT a.id,a.candidate_id AS "candidateId",c.full_name AS "candidateName",a.started_on::text AS "startedOn",a.ended_on::text AS "endedOn",a.reason,a.ended_reason AS "endedReason" FROM org_position_assignments a JOIN candidates c ON c.company_id=a.company_id AND c.id=a.candidate_id WHERE a.company_id=$1 AND a.position_id=$2 ORDER BY a.started_on DESC,a.id DESC LIMIT 100`,
    [companyId, positionId],
  );
  return { ok: true, items: result.rows, truncated: result.rowCount === 100 };
}
