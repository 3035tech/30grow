/**
 * LMS trail by job role — ordered courses for a cargo (P0 journey).
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';
import { query } from '../db.js';
import { enrollLmsCandidates } from './lms.js';
import { toDateOnlyIso } from '../format-display-date.js';

export const LMS_TRAIL_CAP = 40;

function dbApi(dbOrQuery) {
  return asDb(dbOrQuery || query);
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days));
  return dt.toISOString().slice(0, 10);
}

function mapTrailRow(r) {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    jobRoleId: Number(r.jobRoleId),
    courseId: Number(r.courseId),
    courseTitle: r.courseTitle || '',
    courseActive: r.courseActive !== false,
    sortOrder: Number(r.sortOrder) || 0,
    mandatory: Boolean(r.mandatory),
    dueOffsetDays: Number(r.dueOffsetDays) || 30,
  };
}

export async function listJobRoleLmsTrail(dbOrQuery, { companyId, jobRoleId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(jobRoleId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(rid) || rid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const role = await db.query(
    `SELECT id FROM job_roles WHERE id = $1 AND company_id = $2 AND active = TRUE LIMIT 1`,
    [rid, cid]
  );
  if (role.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const r = await db.query(
    `SELECT t.id, t.company_id AS "companyId", t.job_role_id AS "jobRoleId",
            t.course_id AS "courseId", t.sort_order AS "sortOrder",
            t.mandatory, t.due_offset_days AS "dueOffsetDays",
            c.title AS "courseTitle", c.active AS "courseActive"
     FROM lms_job_role_courses t
     JOIN lms_courses c ON c.id = t.course_id AND c.company_id = t.company_id
     WHERE t.company_id = $1 AND t.job_role_id = $2
     ORDER BY t.sort_order ASC, t.id ASC
     LIMIT $3`,
    [cid, rid, LMS_TRAIL_CAP]
  );
  return { ok: true, items: (r.rows || []).map(mapTrailRow) };
}

/**
 * Replace trail for a job role. `items`: [{ courseId, mandatory?, dueOffsetDays?, sortOrder? }]
 */
export async function setJobRoleLmsTrail(dbOrQuery, { companyId, jobRoleId, items = [] }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(jobRoleId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(rid) || rid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const role = await db.query(
    `SELECT id FROM job_roles WHERE id = $1 AND company_id = $2 AND active = TRUE LIMIT 1`,
    [rid, cid]
  );
  if (role.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const raw = Array.isArray(items) ? items.slice(0, LMS_TRAIL_CAP) : [];
  const seen = new Set();
  const normalized = [];
  for (let i = 0; i < raw.length; i += 1) {
    const courseId = Number(raw[i].courseId);
    if (!Number.isFinite(courseId) || courseId <= 0 || seen.has(courseId)) continue;
    seen.add(courseId);
    const dueOffsetDays = Math.min(
      365,
      Math.max(1, Number(raw[i].dueOffsetDays) || 30)
    );
    normalized.push({
      courseId,
      mandatory: raw[i].mandatory !== false,
      dueOffsetDays,
      sortOrder: Number.isFinite(Number(raw[i].sortOrder))
        ? Number(raw[i].sortOrder)
        : i,
    });
  }

  if (normalized.length) {
    const courseIds = normalized.map((x) => x.courseId);
    const valid = await db.query(
      `SELECT id FROM lms_courses
       WHERE company_id = $1 AND id = ANY($2::bigint[]) AND active = TRUE`,
      [cid, courseIds]
    );
    const okIds = new Set((valid.rows || []).map((r) => Number(r.id)));
    const filtered = normalized.filter((x) => okIds.has(x.courseId));
    if (filtered.length !== normalized.length) {
      return { ok: false, errorCode: ERR.NOT_FOUND };
    }
    normalized.length = 0;
    normalized.push(...filtered);
  }

  await db.query(
    `DELETE FROM lms_job_role_courses WHERE company_id = $1 AND job_role_id = $2`,
    [cid, rid]
  );

  for (const row of normalized) {
    await db.query(
      `INSERT INTO lms_job_role_courses (
         company_id, job_role_id, course_id, sort_order, mandatory, due_offset_days
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [cid, rid, row.courseId, row.sortOrder, row.mandatory, row.dueOffsetDays]
    );
  }

  return listJobRoleLmsTrail(db, { companyId: cid, jobRoleId: rid });
}

/**
 * Enroll one employee into every active course on their job-role trail.
 */
export async function enrollJobRoleTrailForCandidate(
  dbOrQuery,
  { companyId, candidateId, enrolledByUserId = null }
) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(candId) || candId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const cand = await db.query(
    `SELECT id, job_role_id AS "jobRoleId",
            employment_status AS "employmentStatus",
            start_date AS "startDate", hired_at AS "hiredAt"
     FROM candidates
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [candId, cid]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = cand.rows[0];
  if (row.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
    return { ok: true, skipped: true, enrolled: 0 };
  }
  const jobRoleId = row.jobRoleId != null ? Number(row.jobRoleId) : null;
  if (!jobRoleId) return { ok: true, skipped: true, enrolled: 0, reason: 'no_job_role' };

  const trail = await listJobRoleLmsTrail(db, { companyId: cid, jobRoleId });
  if (!trail.ok) return trail;
  const active = (trail.items || []).filter((x) => x.courseActive);
  if (!active.length) return { ok: true, skipped: true, enrolled: 0, reason: 'empty_trail' };

  const start =
    toDateOnlyIso(row.startDate) ||
    (row.hiredAt ? String(row.hiredAt).slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  let enrolled = 0;
  const errors = [];
  for (const item of active) {
    const due = addDaysIso(start, item.dueOffsetDays);
    const res = await enrollLmsCandidates(db, {
      companyId: cid,
      courseId: item.courseId,
      candidateIds: [candId],
      dueDate: due,
      mandatory: item.mandatory,
      enrolledByUserId,
    });
    if (res.ok) enrolled += Number(res.enrolled || 0);
    else if (res.errorCode) {
      errors.push({ courseId: item.courseId, errorCode: res.errorCode });
    }
  }
  return { ok: true, enrolled, jobRoleId, errors };
}

/** Resolve employees with a job role for batch enroll on one course. */
export async function candidateIdsForJobRole(dbOrQuery, { companyId, jobRoleId, limit = 200 }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(jobRoleId);
  const lim = Math.min(200, Math.max(1, Number(limit) || 200));
  if (!Number.isFinite(cid) || !Number.isFinite(rid)) return [];
  const r = await db.query(
    `SELECT id FROM candidates
     WHERE company_id = $1
       AND job_role_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     ORDER BY id ASC
     LIMIT $3`,
    [cid, rid, lim]
  );
  return (r.rows || []).map((x) => Number(x.id));
}
