/**
 * Basic LMS — courses, ordered URL lessons, enrollments, progress.
 * Collaborator surface: employee portal /e (token). Academy catalog stays separate.
 * Pure media helpers live in `lib/lms-media.js` (safe for client bundles).
 */

import { DB_FANOUT_CONCURRENCY } from './concurrency.js';
import { asDb } from './ae/as-db.js';
import { ERR } from './api-error-codes.js';
import { sanitizeRichTextHtml } from './sanitize-html.js';
import { EMPLOYMENT_STATUS } from './domain-status.js';
import { query } from './db.js';
import { toDateOnlyIso } from './format-display-date.js';
import {
  LMS_CONTENT_KINDS,
  inferLmsContentKind,
  lmsEmbedUrl,
  lmsPdfCanEmbed,
  lmsVimeoVideoId,
  lmsYoutubeVideoId,
} from './lms-media.js';

export {
  LMS_CONTENT_KINDS,
  inferLmsContentKind,
  lmsEmbedUrl,
  lmsPdfCanEmbed,
  lmsVimeoVideoId,
  lmsYoutubeVideoId,
};

export const LMS_LIST_CAP = 80;
export const LMS_LESSON_CAP = 60;
export const LMS_ENROLL_BATCH_CAP = 100;
export const LMS_ENROLL_ALL_CAP = 200;

/** Days until due (negative = overdue). Null if no due or already complete. */
export function lmsDueDaysLeft(dueDateIso, { completed = false, today = null } = {}) {
  if (completed || !dueDateIso) return null;
  const due = new Date(`${String(dueDateIso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const base = today instanceof Date ? new Date(today) : new Date();
  base.setHours(12, 0, 0, 0);
  return Math.round((due.getTime() - base.getTime()) / 86400000);
}

function dbApi(dbOrQuery) {
  return asDb(dbOrQuery || query);
}

function normalizeUrl(raw) {
  const s = String(raw || '').trim().slice(0, 2000);
  if (!s) return null;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function progressPct(done, total) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

function isComplete(pct, requiredPct) {
  return pct >= Math.min(100, Math.max(1, Number(requiredPct) || 100));
}

export async function listLmsCourses(dbOrQuery, opts = {}) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  const includeInactive = opts.includeInactive === true;
  const limit = Math.min(LMS_LIST_CAP, Math.max(1, Number(opts.limit) || 40));
  const q = String(opts.q || '').trim().slice(0, 80);

  const params = [companyId];
  const where = ['c.company_id = $1'];
  if (!includeInactive) where.push('c.active = TRUE');
  if (q) {
    params.push(`%${q}%`);
    where.push(`c.title ILIKE $${params.length}`);
  }
  params.push(limit);

  const r = await db.query(
    `SELECT c.id, c.title, c.description, c.active, c.completion_pct AS "completionPct",
            c.created_at AS "createdAt", c.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM lms_lessons l
              WHERE l.course_id = c.id AND l.active = TRUE) AS "lessonCount",
            (SELECT COUNT(*)::int FROM lms_enrollments e
              WHERE e.course_id = c.id) AS "enrollmentCount",
            (SELECT COUNT(*)::int FROM lms_enrollments e
              WHERE e.course_id = c.id AND e.completed_at IS NOT NULL) AS "completedCount"
     FROM lms_courses c
     WHERE ${where.join(' AND ')}
     ORDER BY LOWER(c.title) ASC, c.id ASC
     LIMIT $${params.length}`,
    params
  );
  return { ok: true, courses: r.rows };
}

export async function getLmsCourse(dbOrQuery, { companyId, courseId, includeInactiveLessons = false }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const id = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  if (!Number.isFinite(id) || id <= 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const courseR = await db.query(
    `SELECT id, title, description, active, completion_pct AS "completionPct",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM lms_courses
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [id, cid]
  );
  if (courseR.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const course = courseR.rows[0];

  const lessonParams = [id, cid];
  let lessonWhere = 'course_id = $1 AND company_id = $2';
  if (!includeInactiveLessons) lessonWhere += ' AND active = TRUE';

  const lessonsR = await db.query(
    `SELECT id, title, description, content_url AS "contentUrl", content_kind AS "contentKind",
            sort_order AS "sortOrder", active,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM lms_lessons
     WHERE ${lessonWhere}
     ORDER BY sort_order ASC, id ASC
     LIMIT ${LMS_LESSON_CAP}`,
    lessonParams
  );

  return { ok: true, course, lessons: lessonsR.rows };
}

export async function createLmsCourse(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const title = String(opts.title || '').trim().slice(0, 300);
  const description = sanitizeRichTextHtml(String(opts.description || ''), 8000) || '';
  const completionPct = Math.min(100, Math.max(1, Number(opts.completionPct) || 100));
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  if (!title) return { ok: false, errorCode: ERR.NAME_REQUIRED };

  const r = await db.query(
    `INSERT INTO lms_courses (company_id, title, description, completion_pct, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, description, active, completion_pct AS "completionPct",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [companyId, title, description, completionPct, opts.createdByUserId || null]
  );
  return { ok: true, course: r.rows[0] };
}

export async function updateLmsCourse(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const courseId = Number(opts.courseId);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  if (!Number.isFinite(courseId) || courseId <= 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const sets = [];
  const params = [];
  let n = 1;
  if (opts.title !== undefined) {
    const title = String(opts.title || '').trim().slice(0, 300);
    if (!title) return { ok: false, errorCode: ERR.NAME_REQUIRED };
    sets.push(`title = $${n++}`);
    params.push(title);
  }
  if (opts.description !== undefined) {
    sets.push(`description = $${n++}`);
    params.push(sanitizeRichTextHtml(String(opts.description || ''), 8000) || '');
  }
  if (opts.active !== undefined) {
    sets.push(`active = $${n++}`);
    params.push(Boolean(opts.active));
  }
  if (opts.completionPct !== undefined) {
    sets.push(`completion_pct = $${n++}`);
    params.push(Math.min(100, Math.max(1, Number(opts.completionPct) || 100)));
  }
  if (sets.length === 0) return { ok: false, errorCode: ERR.NO_FIELDS_TO_UPDATE };

  sets.push('updated_at = NOW()');
  params.push(courseId, companyId);
  const r = await db.query(
    `UPDATE lms_courses SET ${sets.join(', ')}
     WHERE id = $${n++} AND company_id = $${n}
     RETURNING id, title, description, active, completion_pct AS "completionPct",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, course: r.rows[0] };
}

export async function createLmsLesson(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const courseId = Number(opts.courseId);
  const title = String(opts.title || '').trim().slice(0, 300);
  const description = sanitizeRichTextHtml(String(opts.description || ''), 8000) || '';
  const contentUrl = normalizeUrl(opts.contentUrl);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  if (!Number.isFinite(courseId) || courseId <= 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (!title) return { ok: false, errorCode: ERR.NAME_REQUIRED };
  if (!contentUrl) return { ok: false, errorCode: ERR.INVALID_DATA };

  const course = await db.query(
    `SELECT id FROM lms_courses WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [courseId, companyId]
  );
  if (course.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const cnt = await db.query(
    `SELECT COUNT(*)::int AS n FROM lms_lessons WHERE course_id = $1 AND company_id = $2`,
    [courseId, companyId]
  );
  if ((cnt.rows[0]?.n || 0) >= LMS_LESSON_CAP) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  let kind = String(opts.contentKind || '').trim().toLowerCase();
  if (!LMS_CONTENT_KINDS.includes(kind)) kind = inferLmsContentKind(contentUrl);

  let sortOrder = Number(opts.sortOrder);
  if (!Number.isFinite(sortOrder)) {
    const maxR = await db.query(
      `SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM lms_lessons WHERE course_id = $1`,
      [courseId]
    );
    sortOrder = (maxR.rows[0]?.m ?? -1) + 1;
  }
  sortOrder = Math.min(10000, Math.max(0, sortOrder));

  const r = await db.query(
    `INSERT INTO lms_lessons (company_id, course_id, title, description, content_url, content_kind, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, description, content_url AS "contentUrl", content_kind AS "contentKind",
               sort_order AS "sortOrder", active, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [companyId, courseId, title, description, contentUrl, kind, sortOrder]
  );
  await db.query(`UPDATE lms_courses SET updated_at = NOW() WHERE id = $1 AND company_id = $2`, [
    courseId,
    companyId,
  ]);
  return { ok: true, lesson: r.rows[0] };
}

export async function updateLmsLesson(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const lessonId = Number(opts.lessonId);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  if (!Number.isFinite(lessonId) || lessonId <= 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const sets = [];
  const params = [];
  let n = 1;
  if (opts.title !== undefined) {
    const title = String(opts.title || '').trim().slice(0, 300);
    if (!title) return { ok: false, errorCode: ERR.NAME_REQUIRED };
    sets.push(`title = $${n++}`);
    params.push(title);
  }
  if (opts.description !== undefined) {
    sets.push(`description = $${n++}`);
    params.push(sanitizeRichTextHtml(String(opts.description || ''), 8000) || '');
  }
  if (opts.contentUrl !== undefined) {
    const contentUrl = normalizeUrl(opts.contentUrl);
    if (!contentUrl) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`content_url = $${n++}`);
    params.push(contentUrl);
    if (opts.contentKind === undefined) {
      sets.push(`content_kind = $${n++}`);
      params.push(inferLmsContentKind(contentUrl));
    }
  }
  if (opts.contentKind !== undefined) {
    let kind = String(opts.contentKind || '').trim().toLowerCase();
    if (!LMS_CONTENT_KINDS.includes(kind)) kind = 'link';
    sets.push(`content_kind = $${n++}`);
    params.push(kind);
  }
  if (opts.sortOrder !== undefined) {
    sets.push(`sort_order = $${n++}`);
    params.push(Math.min(10000, Math.max(0, Number(opts.sortOrder) || 0)));
  }
  if (opts.active !== undefined) {
    sets.push(`active = $${n++}`);
    params.push(Boolean(opts.active));
  }
  if (sets.length === 0) return { ok: false, errorCode: ERR.NO_FIELDS_TO_UPDATE };

  sets.push('updated_at = NOW()');
  params.push(lessonId, companyId);
  const r = await db.query(
    `UPDATE lms_lessons SET ${sets.join(', ')}
     WHERE id = $${n++} AND company_id = $${n}
     RETURNING id, course_id AS "courseId", title, description, content_url AS "contentUrl",
               content_kind AS "contentKind", sort_order AS "sortOrder", active,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, lesson: r.rows[0] };
}

export async function listLmsEnrollments(dbOrQuery, { companyId, courseId, limit = 80 }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const course = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  if (!Number.isFinite(course) || course <= 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const cap = Math.min(200, Math.max(1, Number(limit) || 80));

  const courseR = await db.query(
    `SELECT id, completion_pct AS "completionPct"
     FROM lms_courses WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [course, cid]
  );
  if (courseR.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const requiredPct = courseR.rows[0].completionPct;

  const lessonCnt = await db.query(
    `SELECT COUNT(*)::int AS n FROM lms_lessons
     WHERE course_id = $1 AND company_id = $2 AND active = TRUE`,
    [course, cid]
  );
  const totalLessons = lessonCnt.rows[0]?.n || 0;

  const r = await db.query(
    `SELECT e.id, e.candidate_id AS "candidateId", e.enrolled_at AS "enrolledAt",
            e.completed_at AS "completedAt", e.due_date AS "dueDate", e.mandatory,
            e.cohort_id AS "cohortId",
            c.full_name AS "fullName", c.email,
            co.name AS "cohortName",
            (SELECT COUNT(*)::int FROM lms_lesson_completions lc
              JOIN lms_lessons l ON l.id = lc.lesson_id AND l.active = TRUE
             WHERE lc.enrollment_id = e.id) AS "completedLessons"
     FROM lms_enrollments e
     JOIN candidates c ON c.id = e.candidate_id
     LEFT JOIN lms_cohorts co ON co.id = e.cohort_id
     WHERE e.company_id = $1 AND e.course_id = $2
     ORDER BY LOWER(c.full_name) ASC, e.id ASC
     LIMIT $3`,
    [cid, course, cap]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const enrollments = (r.rows || []).map((row) => {
    const pct = progressPct(row.completedLessons, totalLessons);
    const dueIso = toDateOnlyIso(row.dueDate);
    let overdue = false;
    if (dueIso && !row.completedAt) {
      const due = new Date(`${dueIso}T12:00:00`);
      overdue = !Number.isNaN(due.getTime()) && due < today;
    }
    return {
      id: row.id,
      candidateId: row.candidateId,
      fullName: row.fullName,
      email: row.email,
      enrolledAt: row.enrolledAt,
      completedAt: row.completedAt,
      dueDate: dueIso,
      mandatory: Boolean(row.mandatory),
      cohortId: row.cohortId ? Number(row.cohortId) : null,
      cohortName: row.cohortName || null,
      overdue,
      completedLessons: row.completedLessons,
      totalLessons,
      progressPct: pct,
      isComplete: Boolean(row.completedAt) || isComplete(pct, requiredPct),
    };
  });

  return { ok: true, enrollments, totalLessons, completionPct: requiredPct };
}

export async function enrollLmsCandidates(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const courseId = Number(opts.courseId);
  let ids = Array.isArray(opts.candidateIds)
    ? [...new Set(opts.candidateIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
    : [];
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  if (!Number.isFinite(courseId) || courseId <= 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const course = await db.query(
    `SELECT id, title FROM lms_courses WHERE id = $1 AND company_id = $2 AND active = TRUE LIMIT 1`,
    [courseId, companyId]
  );
  if (course.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const courseTitle = course.rows[0].title;

  if (opts.allEmployees === true) {
    const all = await db.query(
      `SELECT id FROM candidates
       WHERE company_id = $1 AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       ORDER BY id ASC
       LIMIT $2`,
      [companyId, LMS_ENROLL_ALL_CAP]
    );
    ids = (all.rows || []).map((r) => Number(r.id));
  } else if (opts.teamGroupId) {
    const gid = Number(opts.teamGroupId);
    const g = await db.query(
      `SELECT member_assessment_ids AS ids
       FROM team_groups
       WHERE id = $1 AND company_id = $2 AND deleted = FALSE
       LIMIT 1`,
      [gid, companyId]
    );
    if (g.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    const assessmentIds = Array.isArray(g.rows[0].ids) ? g.rows[0].ids.map(Number) : [];
    if (assessmentIds.length) {
      const mapped = await db.query(
        `SELECT DISTINCT a.candidate_id AS id
         FROM assessments a
         JOIN candidates c ON c.id = a.candidate_id
         WHERE a.company_id = $1
           AND a.id = ANY($2::bigint[])
           AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
        [companyId, assessmentIds]
      );
      ids = (mapped.rows || []).map((r) => Number(r.id));
    } else {
      ids = [];
    }
  } else if (opts.jobRoleId) {
    const rid = Number(opts.jobRoleId);
    if (!Number.isFinite(rid) || rid <= 0) {
      return { ok: false, errorCode: ERR.INVALID_ID };
    }
    const byRole = await db.query(
      `SELECT id FROM candidates
       WHERE company_id = $1
         AND job_role_id = $2
         AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       ORDER BY id ASC
       LIMIT $3`,
      [companyId, rid, LMS_ENROLL_ALL_CAP]
    );
    ids = (byRole.rows || []).map((r) => Number(r.id));
  }

  if (ids.length === 0) return { ok: false, errorCode: ERR.INVALID_DATA };
  if (ids.length > LMS_ENROLL_BATCH_CAP && opts.allEmployees !== true) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (ids.length > LMS_ENROLL_ALL_CAP) {
    ids = ids.slice(0, LMS_ENROLL_ALL_CAP);
  }

  const valid = await db.query(
    `SELECT id FROM candidates
     WHERE company_id = $1
       AND id = ANY($2::bigint[])
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
    [companyId, ids]
  );
  const validIds = (valid.rows || []).map((r) => Number(r.id));
  if (validIds.length === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  let cohortId = opts.cohortId != null ? Number(opts.cohortId) : null;
  let dueDate = null;
  if (opts.dueDate != null && String(opts.dueDate).trim() !== '') {
    const s = toDateOnlyIso(opts.dueDate);
    if (!s) return { ok: false, errorCode: ERR.INVALID_DATE };
    dueDate = s;
  }
  const mandatory = opts.mandatory === true;

  if (opts.cohortName) {
    const name = String(opts.cohortName).trim().slice(0, 200);
    if (!name) return { ok: false, errorCode: ERR.NAME_REQUIRED };
    const co = await db.query(
      `INSERT INTO lms_cohorts (company_id, course_id, name, due_date, mandatory, created_by_user_id)
       VALUES ($1, $2, $3, $4::date, $5, $6)
       RETURNING id`,
      [companyId, courseId, name, dueDate, mandatory, opts.enrolledByUserId || null]
    );
    cohortId = Number(co.rows[0].id);
  } else if (cohortId) {
    const co = await db.query(
      `SELECT id, due_date AS "dueDate", mandatory
       FROM lms_cohorts WHERE id = $1 AND company_id = $2 AND course_id = $3 LIMIT 1`,
      [cohortId, companyId, courseId]
    );
    if (co.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    if (dueDate == null && co.rows[0].dueDate) {
      dueDate = toDateOnlyIso(co.rows[0].dueDate);
    }
  }

  const inserted = await db.query(
    `INSERT INTO lms_enrollments (
       company_id, course_id, candidate_id, enrolled_by_user_id,
       cohort_id, due_date, mandatory
     )
     SELECT $1, $2, x.id, $3, $4, $5::date, $6
     FROM unnest($7::bigint[]) AS x(id)
     ON CONFLICT (course_id, candidate_id) DO NOTHING
     RETURNING id, candidate_id AS "candidateId"`,
    [
      companyId,
      courseId,
      opts.enrolledByUserId || null,
      cohortId || null,
      dueDate,
      mandatory,
      validIds,
    ]
  );

  return {
    ok: true,
    enrolled: inserted.rowCount,
    skipped: validIds.length - inserted.rowCount,
    candidateIds: validIds,
    cohortId: cohortId || null,
    courseTitle,
    dueDate,
    mandatory,
  };
}

export async function removeLmsEnrollment(dbOrQuery, { companyId, enrollmentId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const eid = Number(enrollmentId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  if (!Number.isFinite(eid) || eid <= 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const r = await db.query(
    `DELETE FROM lms_enrollments WHERE id = $1 AND company_id = $2 RETURNING id`,
    [eid, cid]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

async function refreshEnrollmentCompletion(db, { companyId, enrollmentId }) {
  const enr = await db.query(
    `SELECT e.id, e.course_id AS "courseId", c.completion_pct AS "completionPct"
     FROM lms_enrollments e
     JOIN lms_courses c ON c.id = e.course_id
     WHERE e.id = $1 AND e.company_id = $2
     LIMIT 1`,
    [enrollmentId, companyId]
  );
  if (enr.rowCount === 0) return null;
  const { courseId, completionPct } = enr.rows[0];

  const stats = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM lms_lessons
         WHERE course_id = $1 AND company_id = $2 AND active = TRUE) AS total,
       (SELECT COUNT(*)::int FROM lms_lesson_completions lc
         JOIN lms_lessons l ON l.id = lc.lesson_id AND l.active = TRUE AND l.course_id = $1
        WHERE lc.enrollment_id = $3) AS done`,
    [courseId, companyId, enrollmentId]
  );
  const total = stats.rows[0]?.total || 0;
  const done = stats.rows[0]?.done || 0;
  const pct = progressPct(done, total);
  const complete = total > 0 && isComplete(pct, completionPct);

  if (complete) {
    await db.query(
      `UPDATE lms_enrollments SET completed_at = COALESCE(completed_at, NOW())
       WHERE id = $1 AND company_id = $2`,
      [enrollmentId, companyId]
    );
  } else {
    await db.query(
      `UPDATE lms_enrollments SET completed_at = NULL
       WHERE id = $1 AND company_id = $2 AND completed_at IS NOT NULL`,
      [enrollmentId, companyId]
    );
  }
  return { progressPct: pct, completedLessons: done, totalLessons: total, isComplete: complete };
}

export async function completeLmsLesson(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const candidateId = Number(opts.candidateId);
  const lessonId = Number(opts.lessonId);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  if (!Number.isFinite(candidateId) || candidateId <= 0) {
    return { ok: false, errorCode: ERR.NOT_FOUND };
  }
  if (!Number.isFinite(lessonId) || lessonId <= 0) {
    return { ok: false, errorCode: ERR.NOT_FOUND };
  }

  const lesson = await db.query(
    `SELECT l.id, l.course_id AS "courseId"
     FROM lms_lessons l
     JOIN lms_courses c ON c.id = l.course_id AND c.company_id = l.company_id
     WHERE l.id = $1 AND l.company_id = $2 AND l.active = TRUE AND c.active = TRUE
     LIMIT 1`,
    [lessonId, companyId]
  );
  if (lesson.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const courseId = lesson.rows[0].courseId;

  const enr = await db.query(
    `SELECT id, completed_at AS "completedAt" FROM lms_enrollments
     WHERE company_id = $1 AND course_id = $2 AND candidate_id = $3
     LIMIT 1`,
    [companyId, courseId, candidateId]
  );
  if (enr.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const enrollmentId = enr.rows[0].id;
  const wasComplete = Boolean(enr.rows[0].completedAt);

  const { countQuizQuestionsForLessons, hasPassedLessonQuiz } = await import('./lms-quiz.js');
  const quizCounts = await countQuizQuestionsForLessons(db, {
    companyId,
    lessonIds: [lessonId],
  });
  if ((quizCounts.get(lessonId) || 0) > 0) {
    const passed = await hasPassedLessonQuiz(db, { companyId, enrollmentId, lessonId });
    if (!passed) return { ok: false, errorCode: ERR.LMS_QUIZ_REQUIRED };
  }

  await db.query(
    `INSERT INTO lms_lesson_completions (company_id, enrollment_id, lesson_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (enrollment_id, lesson_id) DO NOTHING`,
    [companyId, enrollmentId, lessonId]
  );

  const progress = await refreshEnrollmentCompletion(db, { companyId, enrollmentId });
  const newlyCompleted = Boolean(progress?.isComplete) && !wasComplete;
  let pdiItemsMarked = 0;
  if (newlyCompleted) {
    const marked = await markLinkedPdiItemsDoneForLmsCourse(db, {
      companyId,
      candidateId,
      courseId,
    });
    pdiItemsMarked = marked.updated || 0;
  }
  return {
    ok: true,
    enrollmentId,
    lessonId,
    courseId,
    newlyCompleted,
    pdiItemsMarked,
    ...progress,
  };
}

/**
 * Employee portal payload: enrolled courses + lessons + completion flags.
 */
export async function listCandidateLmsCourses(dbOrQuery, { companyId, candidateId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) return [];

  const enr = await db.query(
    `SELECT e.id AS "enrollmentId", e.course_id AS "courseId", e.enrolled_at AS "enrolledAt",
            e.completed_at AS "completedAt", e.due_date AS "dueDate", e.mandatory,
            c.title, c.description, c.completion_pct AS "completionPct"
     FROM lms_enrollments e
     JOIN lms_courses c ON c.id = e.course_id AND c.company_id = e.company_id
     WHERE e.company_id = $1 AND e.candidate_id = $2 AND c.active = TRUE
     ORDER BY e.enrolled_at DESC, e.id DESC
     LIMIT 30`,
    [cid, cand]
  );
  if (enr.rowCount === 0) return [];

  const courseIds = enr.rows.map((r) => Number(r.courseId));
  const enrollmentIds = enr.rows.map((r) => Number(r.enrollmentId));

  const lessonsR = await db.query(
    `SELECT id, course_id AS "courseId", title, description, content_url AS "contentUrl",
            content_kind AS "contentKind", sort_order AS "sortOrder"
     FROM (
       SELECT id, course_id, title, description, content_url, content_kind, sort_order,
              ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY sort_order ASC, id ASC) AS rn
       FROM lms_lessons
       WHERE company_id = $1 AND course_id = ANY($2::bigint[]) AND active = TRUE
     ) x
     WHERE rn <= $3
     ORDER BY course_id ASC, sort_order ASC, id ASC`,
    [cid, courseIds, LMS_LESSON_CAP]
  );

  const doneR = await db.query(
    `SELECT enrollment_id AS "enrollmentId", lesson_id AS "lessonId"
     FROM lms_lesson_completions
     WHERE company_id = $1 AND enrollment_id = ANY($2::bigint[])`,
    [cid, enrollmentIds]
  );
  const doneSet = new Set(
    (doneR.rows || []).map((r) => `${r.enrollmentId}:${r.lessonId}`)
  );

  const lessonIds = (lessonsR.rows || []).map((l) => Number(l.id));
  let quizCountByLesson = new Map();
  let passedQuiz = new Set();
  let watchByKey = new Map();
  try {
    const quizMod = await import('./lms-quiz.js');
    quizCountByLesson = await quizMod.countQuizQuestionsForLessons(db, {
      companyId: cid,
      lessonIds,
    });
    passedQuiz = await quizMod.listPassedQuizLessonIds(db, {
      companyId: cid,
      enrollmentIds,
    });
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }
  try {
    watchByKey = await mapWatchProgressForEnrollments(db, {
      companyId: cid,
      enrollmentIds,
    });
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }

  const lessonsByCourse = new Map();
  for (const l of lessonsR.rows || []) {
    const list = lessonsByCourse.get(Number(l.courseId)) || [];
    list.push(l);
    lessonsByCourse.set(Number(l.courseId), list);
  }

  return enr.rows.map((row) => {
    const lessons = (lessonsByCourse.get(Number(row.courseId)) || []).map((l) => {
      const quizCount = quizCountByLesson.get(Number(l.id)) || 0;
      const quizPassed = passedQuiz.has(`${row.enrollmentId}:${l.id}`);
      const watch = watchByKey.get(`${row.enrollmentId}:${l.id}`);
      return {
        id: l.id,
        title: l.title,
        description: l.description,
        contentUrl: l.contentUrl,
        contentKind: l.contentKind,
        embedUrl: lmsEmbedUrl(l.contentUrl, l.contentKind),
        videoId:
          l.contentKind === 'youtube'
            ? lmsYoutubeVideoId(l.contentUrl)
            : l.contentKind === 'vimeo'
              ? lmsVimeoVideoId(l.contentUrl)
              : null,
        sortOrder: l.sortOrder,
        completed: doneSet.has(`${row.enrollmentId}:${l.id}`),
        quizCount,
        quizRequired: quizCount > 0,
        quizPassed,
        watchPositionSec: watch?.positionSec ?? 0,
        watchDurationSec: watch?.durationSec ?? 0,
      };
    });
    const done = lessons.filter((l) => l.completed).length;
    const total = lessons.length;
    const pct = progressPct(done, total);
    const dueIso = toDateOnlyIso(row.dueDate);
    const daysLeft = lmsDueDaysLeft(dueIso, { completed: Boolean(row.completedAt) });
    const overdue = daysLeft != null && daysLeft < 0;
    const continueLesson =
      lessons.find((l) => !l.completed) || lessons[lessons.length - 1] || null;
    return {
      enrollmentId: row.enrollmentId,
      courseId: row.courseId,
      title: row.title,
      description: row.description,
      enrolledAt: row.enrolledAt,
      completedAt: row.completedAt,
      dueDate: dueIso,
      mandatory: Boolean(row.mandatory),
      overdue,
      daysLeft,
      progressPct: pct,
      isComplete: Boolean(row.completedAt) || isComplete(pct, row.completionPct),
      certificateAvailable: Boolean(row.completedAt) || isComplete(pct, row.completionPct),
      continueLessonId: continueLesson?.id || null,
      continueWatchPositionSec: continueLesson?.watchPositionSec || 0,
      lessons,
    };
  });
}

export async function uncompleteLmsLesson(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const candidateId = Number(opts.candidateId);
  const lessonId = Number(opts.lessonId);
  if (!Number.isFinite(companyId) || !Number.isFinite(candidateId) || !Number.isFinite(lessonId)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const lesson = await db.query(
    `SELECT l.id, l.course_id AS "courseId" FROM lms_lessons l
     WHERE l.id = $1 AND l.company_id = $2 LIMIT 1`,
    [lessonId, companyId]
  );
  if (lesson.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const enr = await db.query(
    `SELECT id FROM lms_enrollments
     WHERE company_id = $1 AND course_id = $2 AND candidate_id = $3 LIMIT 1`,
    [companyId, lesson.rows[0].courseId, candidateId]
  );
  if (enr.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const enrollmentId = enr.rows[0].id;
  await db.query(
    `DELETE FROM lms_lesson_completions
     WHERE company_id = $1 AND enrollment_id = $2 AND lesson_id = $3`,
    [companyId, enrollmentId, lessonId]
  );
  const progress = await refreshEnrollmentCompletion(db, { companyId, enrollmentId });
  return { ok: true, enrollmentId, lessonId, ...progress };
}

export async function resetLmsEnrollmentProgress(dbOrQuery, { companyId, enrollmentId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const eid = Number(enrollmentId);
  if (!Number.isFinite(cid) || !Number.isFinite(eid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const enr = await db.query(
    `SELECT id FROM lms_enrollments WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [eid, cid]
  );
  if (enr.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  await db.query(`DELETE FROM lms_lesson_completions WHERE enrollment_id = $1 AND company_id = $2`, [
    eid,
    cid,
  ]);
  await db.query(
    `UPDATE lms_enrollments SET completed_at = NULL WHERE id = $1 AND company_id = $2`,
    [eid, cid]
  );
  return { ok: true };
}

export async function reorderLmsLessons(dbOrQuery, { companyId, courseId, lessonIds }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const course = Number(courseId);
  const ids = Array.isArray(lessonIds)
    ? lessonIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!Number.isFinite(cid) || !Number.isFinite(course) || ids.length === 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (ids.length > LMS_LESSON_CAP) return { ok: false, errorCode: ERR.INVALID_DATA };

  const owned = await db.query(
    `SELECT id FROM lms_lessons WHERE company_id = $1 AND course_id = $2 AND id = ANY($3::bigint[])`,
    [cid, course, ids]
  );
  if (owned.rowCount !== ids.length) return { ok: false, errorCode: ERR.INVALID_DATA };

  for (let i = 0; i < ids.length; i += 1) {
    await db.query(
      `UPDATE lms_lessons SET sort_order = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 AND course_id = $4`,
      [i, ids[i], cid, course]
    );
  }
  await db.query(`UPDATE lms_courses SET updated_at = NOW() WHERE id = $1 AND company_id = $2`, [
    course,
    cid,
  ]);
  return { ok: true };
}

export async function listLmsCohorts(dbOrQuery, { companyId, courseId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const course = Number(courseId);
  if (!Number.isFinite(cid) || !Number.isFinite(course)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const r = await db.query(
    `SELECT co.id, co.name, co.due_date AS "dueDate", co.mandatory,
            co.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM lms_enrollments e WHERE e.cohort_id = co.id) AS "enrollmentCount"
     FROM lms_cohorts co
     WHERE co.company_id = $1 AND co.course_id = $2
     ORDER BY co.created_at DESC, co.id DESC
     LIMIT 40`,
    [cid, course]
  );
  return { ok: true, cohorts: r.rows };
}

export async function updateLmsEnrollment(dbOrQuery, opts) {
  const db = dbApi(dbOrQuery);
  const companyId = Number(opts.companyId);
  const enrollmentId = Number(opts.enrollmentId);
  if (!Number.isFinite(companyId) || !Number.isFinite(enrollmentId)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const sets = [];
  const params = [];
  let n = 1;
  if (opts.dueDate !== undefined) {
    if (opts.dueDate == null || opts.dueDate === '') {
      sets.push('due_date = NULL');
    } else {
      const s = toDateOnlyIso(opts.dueDate);
      if (!s) return { ok: false, errorCode: ERR.INVALID_DATE };
      sets.push(`due_date = $${n++}::date`);
      params.push(s);
    }
  }
  if (opts.mandatory !== undefined) {
    sets.push(`mandatory = $${n++}`);
    params.push(Boolean(opts.mandatory));
  }
  if (sets.length === 0) return { ok: false, errorCode: ERR.NO_FIELDS_TO_UPDATE };
  params.push(enrollmentId, companyId);
  const r = await db.query(
    `UPDATE lms_enrollments SET ${sets.join(', ')}
     WHERE id = $${n++} AND company_id = $${n}
     RETURNING id, due_date AS "dueDate", mandatory`,
    params
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, enrollment: r.rows[0] };
}

/** Overdue mandatory (or any with due_date) incomplete enrollments — Overview pulse. */
export async function getCompanyLmsOverduePulse(dbOrQuery, { companyId, limit = 40 }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { overdueCount: 0, items: [] };
  }
  const cap = Math.min(80, Math.max(1, Number(limit) || 40));
  const r = await db.query(
    `SELECT e.id, e.candidate_id AS "candidateId", e.due_date AS "dueDate", e.mandatory,
            c.full_name AS "fullName", course.title AS "courseTitle", course.id AS "courseId"
     FROM lms_enrollments e
     JOIN candidates c ON c.id = e.candidate_id
     JOIN lms_courses course ON course.id = e.course_id AND course.company_id = e.company_id
     WHERE e.company_id = $1
       AND e.completed_at IS NULL
       AND e.due_date IS NOT NULL
       AND e.due_date < CURRENT_DATE
       AND course.active = TRUE
     ORDER BY e.due_date ASC, e.id ASC
     LIMIT $2`,
    [cid, cap]
  );
  return {
    overdueCount: r.rowCount,
    mandatoryOverdueCount: (r.rows || []).filter((x) => x.mandatory).length,
    items: r.rows || [],
  };
}

/** Cron: notify managers about overdue LMS enrollments (dedupe per enrollment+day). */
export async function notifyLmsOverdueEnrollments(dbOrQuery, { withinPastDays = 30 } = {}) {
  const { notifyCompanyManagers } = await import('./manager-notifications.js');
  const { NOTIF } = await import('./manager-notification-catalog.js');
  const db = dbApi(dbOrQuery);
  const days = Math.min(90, Math.max(1, Number(withinPastDays) || 30));
  const r = await db.query(
    `SELECT e.id, e.company_id AS "companyId", e.candidate_id AS "candidateId",
            e.due_date AS "dueDate", c.full_name AS "fullName",
            course.id AS "courseId", course.title AS "courseTitle"
     FROM lms_enrollments e
     JOIN candidates c ON c.id = e.candidate_id
     JOIN lms_courses course ON course.id = e.course_id
     WHERE e.completed_at IS NULL
       AND e.due_date IS NOT NULL
       AND e.due_date < CURRENT_DATE
       AND e.due_date >= CURRENT_DATE - ($1 || ' days')::interval
       AND course.active = TRUE
     ORDER BY e.due_date ASC
     LIMIT 200`,
    [String(days)]
  );
  let notified = 0;
  const today = new Date().toISOString().slice(0, 10);
  const rows = r.rows || [];
  const CHUNK = DB_FANOUT_CONCURRENCY;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (row) => {
        const dedupeKey = `lms_overdue:${row.id}:${today}`;
        await notifyCompanyManagers(db, {
          companyId: row.companyId,
          type: NOTIF.LMS_OVERDUE,
          entityType: 'lms_enrollment',
          entityId: row.id,
          dedupeKey,
          payload: {
            candidateId: row.candidateId,
            candidateName: row.fullName,
            courseId: row.courseId,
            courseTitle: row.courseTitle,
            dueDate: toDateOnlyIso(row.dueDate),
          },
        });
        try {
          const { notifyCandidate, EMPLOYEE_NOTIF } = await import('./employee-notifications.js');
          await notifyCandidate(db, {
            companyId: row.companyId,
            candidateId: row.candidateId,
            type: EMPLOYEE_NOTIF.LMS_OVERDUE,
            entityType: 'lms_enrollment',
            entityId: row.id,
            dedupeKey,
            payload: {
              courseId: row.courseId,
              courseTitle: row.courseTitle,
              dueDate: toDateOnlyIso(row.dueDate),
            },
          });
        } catch {
          /* schema may lag */
        }
      })
    );
    notified += slice.length;
  }
  return { scanned: r.rowCount, notified };
}

export async function linkLmsCourseToPdi(dbOrQuery, { companyId, planItemId, courseId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const itemId = Number(planItemId);
  const course = Number(courseId);
  if (!Number.isFinite(cid) || !Number.isFinite(itemId) || !Number.isFinite(course)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const item = await db.query(
    `SELECT i.id FROM development_plan_items i
     JOIN development_plans p ON p.id = i.plan_id
     WHERE i.id = $1 AND i.company_id = $2 AND p.company_id = $2 LIMIT 1`,
    [itemId, cid]
  );
  if (item.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const co = await db.query(
    `SELECT id FROM lms_courses WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [course, cid]
  );
  if (co.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  await db.query(
    `INSERT INTO development_plan_lms_links (plan_item_id, course_id)
     VALUES ($1, $2) ON CONFLICT (plan_item_id, course_id) DO NOTHING`,
    [itemId, course]
  );
  return { ok: true };
}

export async function unlinkLmsCourseFromPdi(dbOrQuery, { companyId, planItemId, courseId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const itemId = Number(planItemId);
  const course = Number(courseId);
  const item = await db.query(
    `SELECT i.id FROM development_plan_items i WHERE i.id = $1 AND i.company_id = $2 LIMIT 1`,
    [itemId, cid]
  );
  if (item.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  await db.query(
    `DELETE FROM development_plan_lms_links WHERE plan_item_id = $1 AND course_id = $2`,
    [itemId, course]
  );
  return { ok: true };
}

export async function getPdiLinkedLmsCourses(dbOrQuery, { companyId, planItemIds }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const ids = (planItemIds || []).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return [];
  const r = await db.query(
    `SELECT l.plan_item_id AS "planItemId", c.id AS "courseId", c.title
     FROM development_plan_lms_links l
     JOIN lms_courses c ON c.id = l.course_id
     JOIN development_plan_items i ON i.id = l.plan_item_id
     WHERE i.company_id = $1 AND l.plan_item_id = ANY($2::bigint[]) AND c.company_id = $1`,
    [cid, ids]
  );
  return r.rows || [];
}

export async function listActiveLmsCoursesForSelect(dbOrQuery, { companyId, limit = 80 }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const cap = Math.min(LMS_LIST_CAP, Math.max(1, Number(limit) || 80));
  const r = await db.query(
    `SELECT id, title FROM lms_courses
     WHERE company_id = $1 AND active = TRUE
     ORDER BY LOWER(title) ASC
     LIMIT $2`,
    [cid, cap]
  );
  return r.rows || [];
}

/** Overdue incomplete enrollments for one candidate (Equipe chip). */
export async function listCandidateOverdueLms(dbOrQuery, { companyId, candidateId, limit = 5 }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) return [];
  const cap = Math.min(10, Math.max(1, Number(limit) || 5));
  try {
    const r = await db.query(
      `SELECT e.id AS "enrollmentId", e.due_date AS "dueDate", e.mandatory,
              course.id AS "courseId", course.title AS "courseTitle"
       FROM lms_enrollments e
       JOIN lms_courses course ON course.id = e.course_id AND course.company_id = e.company_id
       WHERE e.company_id = $1
         AND e.candidate_id = $2
         AND e.completed_at IS NULL
         AND e.due_date IS NOT NULL
         AND e.due_date < CURRENT_DATE
         AND course.active = TRUE
       ORDER BY e.due_date ASC, e.id ASC
       LIMIT $3`,
      [cid, cand, cap]
    );
    return (r.rows || []).map((row) => ({
      ...row,
      dueDate: toDateOnlyIso(row.dueDate),
    }));
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return [];
    throw err;
  }
}

/** Ops strip for a course: enrolled / completed / overdue. */
export async function getLmsCourseOpsSummary(dbOrQuery, { companyId, courseId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const course = Number(courseId);
  if (!Number.isFinite(cid) || !Number.isFinite(course)) {
    return { enrolled: 0, completed: 0, overdue: 0, mandatoryOverdue: 0 };
  }
  const r = await db.query(
    `SELECT
       COUNT(*)::int AS enrolled,
       COUNT(*) FILTER (WHERE e.completed_at IS NOT NULL)::int AS completed,
       COUNT(*) FILTER (
         WHERE e.completed_at IS NULL
           AND e.due_date IS NOT NULL
           AND e.due_date < CURRENT_DATE
       )::int AS overdue,
       COUNT(*) FILTER (
         WHERE e.completed_at IS NULL
           AND e.mandatory = TRUE
           AND e.due_date IS NOT NULL
           AND e.due_date < CURRENT_DATE
       )::int AS "mandatoryOverdue"
     FROM lms_enrollments e
     WHERE e.company_id = $1 AND e.course_id = $2`,
    [cid, course]
  );
  const row = r.rows[0] || {};
  return {
    enrolled: row.enrolled || 0,
    completed: row.completed || 0,
    overdue: row.overdue || 0,
    mandatoryOverdue: row.mandatoryOverdue || 0,
  };
}

/**
 * When an LMS course is completed, mark linked open PDI items as done
 * (same candidate + company via development_plan_lms_links).
 */
export async function markLinkedPdiItemsDoneForLmsCourse(
  dbOrQuery,
  { companyId, candidateId, courseId }
) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const course = Number(courseId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand) || !Number.isFinite(course)) {
    return { updated: 0 };
  }
  try {
    const { DEVELOPMENT_PLAN_ITEM_STATUS } = await import('./domain-status.js');
    const r = await db.query(
      `UPDATE development_plan_items i
       SET status = '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}', updated_at = NOW()
       FROM development_plan_lms_links l, development_plans p
       WHERE l.plan_item_id = i.id
         AND p.id = i.plan_id
         AND l.course_id = $1
         AND i.company_id = $2
         AND p.company_id = $2
         AND p.candidate_id = $3
         AND i.status <> '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}'
       RETURNING i.id`,
      [course, cid, cand]
    );
    return { updated: r.rowCount };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return { updated: 0 };
    throw err;
  }
}

/**
 * Printable certificate metadata (session-auth; no stored PDF blob).
 */
export async function getLmsCertificatePayload(dbOrQuery, {
  companyId,
  candidateId,
  enrollmentId,
}) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const eid = Number(enrollmentId);
  if (![cid, cand, eid].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const r = await db.query(
    `SELECT e.id AS "enrollmentId", e.completed_at AS "completedAt",
            e.due_date AS "dueDate", e.mandatory,
            c.id AS "courseId", c.title AS "courseTitle",
            c.completion_pct AS "completionPct",
            cand.full_name AS "candidateName",
            co.name AS "companyName"
     FROM lms_enrollments e
     JOIN lms_courses c ON c.id = e.course_id AND c.company_id = e.company_id
     JOIN candidates cand ON cand.id = e.candidate_id AND cand.company_id = e.company_id
     JOIN companies co ON co.id = e.company_id AND co.deleted = FALSE
     WHERE e.id = $1 AND e.company_id = $2 AND e.candidate_id = $3
     LIMIT 1`,
    [eid, cid, cand]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = r.rows[0];
  if (!row.completedAt) {
    const progress = await listCandidateLmsCourses(db, { companyId: cid, candidateId: cand });
    const course = progress.find((x) => Number(x.enrollmentId) === eid);
    if (!course?.isComplete) return { ok: false, errorCode: ERR.INVALID_ACTION };
    return {
      ok: true,
      certificate: {
        enrollmentId: eid,
        courseId: Number(row.courseId),
        courseTitle: row.courseTitle,
        candidateName: row.candidateName,
        companyName: row.companyName,
        completedAt: new Date().toISOString(),
        mandatory: Boolean(row.mandatory),
        progressPct: course.progressPct ?? 100,
      },
    };
  }
  return {
    ok: true,
    certificate: {
      enrollmentId: eid,
      courseId: Number(row.courseId),
      courseTitle: row.courseTitle,
      candidateName: row.candidateName,
      companyName: row.companyName,
      completedAt: row.completedAt,
      mandatory: Boolean(row.mandatory),
      progressPct: 100,
    },
  };
}

/**
 * RH cohort report for a course: completion % + overdue per turma.
 */
export async function getLmsCohortReport(dbOrQuery, { companyId, courseId }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const course = Number(courseId);
  if (!Number.isFinite(cid) || !Number.isFinite(course)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const courseR = await db.query(
    `SELECT id, title FROM lms_courses WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [course, cid]
  );
  if (courseR.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const cohorts = await db.query(
    `SELECT co.id, co.name, co.due_date AS "dueDate", co.mandatory,
            COUNT(e.id)::int AS enrolled,
            COUNT(e.id) FILTER (WHERE e.completed_at IS NOT NULL)::int AS completed,
            COUNT(e.id) FILTER (
              WHERE e.completed_at IS NULL
                AND e.due_date IS NOT NULL
                AND e.due_date < CURRENT_DATE
            )::int AS overdue
     FROM lms_cohorts co
     LEFT JOIN lms_enrollments e ON e.cohort_id = co.id AND e.company_id = co.company_id
     WHERE co.company_id = $1 AND co.course_id = $2
     GROUP BY co.id
     ORDER BY co.created_at DESC, co.id DESC
     LIMIT 40`,
    [cid, course]
  );

  const unassigned = await db.query(
    `SELECT
       COUNT(*)::int AS enrolled,
       COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed,
       COUNT(*) FILTER (
         WHERE completed_at IS NULL AND due_date IS NOT NULL AND due_date < CURRENT_DATE
       )::int AS overdue
     FROM lms_enrollments
     WHERE company_id = $1 AND course_id = $2 AND cohort_id IS NULL`,
    [cid, course]
  );

  const mapRow = (row, name) => {
    const enrolled = Number(row.enrolled) || 0;
    const completed = Number(row.completed) || 0;
    return {
      id: row.id != null ? Number(row.id) : null,
      name,
      dueDate: toDateOnlyIso(row.dueDate),
      mandatory: Boolean(row.mandatory),
      enrolled,
      completed,
      overdue: Number(row.overdue) || 0,
      completionPct: enrolled ? Math.round((completed / enrolled) * 100) : 0,
    };
  };

  const items = (cohorts.rows || []).map((row) => mapRow(row, row.name));
  const u = unassigned.rows[0];
  if (u && (Number(u.enrolled) || 0) > 0) {
    items.push(mapRow({ ...u, id: null, dueDate: null, mandatory: false }, null));
  }

  return {
    ok: true,
    courseId: course,
    courseTitle: courseR.rows[0].title,
    items,
  };
}

const LMS_WATCH_SEC_CAP = 172800;

function clampWatchSec(n) {
  const v = Math.floor(Number(n) || 0);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(LMS_WATCH_SEC_CAP, v);
}

/** Map `${enrollmentId}:${lessonId}` → { positionSec, durationSec }. */
export async function mapWatchProgressForEnrollments(dbOrQuery, { companyId, enrollmentIds }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const ids = (enrollmentIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!Number.isFinite(cid) || !ids.length) return new Map();
  const r = await db.query(
    `SELECT enrollment_id AS "enrollmentId", lesson_id AS "lessonId",
            position_sec AS "positionSec", duration_sec AS "durationSec"
     FROM lms_lesson_watch_progress
     WHERE company_id = $1 AND enrollment_id = ANY($2::bigint[])`,
    [cid, ids]
  );
  return new Map(
    (r.rows || []).map((row) => [
      `${row.enrollmentId}:${row.lessonId}`,
      {
        positionSec: Number(row.positionSec) || 0,
        durationSec: Number(row.durationSec) || 0,
      },
    ])
  );
}

/**
 * Upsert watch position for youtube/vimeo lesson (B-2717).
 * Does not mark lesson complete.
 */
export async function upsertLmsWatchProgress(dbOrQuery, {
  companyId,
  candidateId,
  lessonId,
  positionSec,
  durationSec,
}) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const lid = Number(lessonId);
  const pos = clampWatchSec(positionSec);
  const dur = clampWatchSec(durationSec);
  if (![cid, cand, lid].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const lesson = await db.query(
    `SELECT l.id, l.course_id AS "courseId", l.content_kind AS "contentKind"
     FROM lms_lessons l
     JOIN lms_courses c ON c.id = l.course_id AND c.company_id = l.company_id
     WHERE l.id = $1 AND l.company_id = $2 AND l.active = TRUE AND c.active = TRUE
     LIMIT 1`,
    [lid, cid]
  );
  if (lesson.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const kind = lesson.rows[0].contentKind;
  if (kind !== 'youtube' && kind !== 'vimeo') {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  const enr = await db.query(
    `SELECT id FROM lms_enrollments
     WHERE company_id = $1 AND course_id = $2 AND candidate_id = $3
     LIMIT 1`,
    [cid, lesson.rows[0].courseId, cand]
  );
  if (enr.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const enrollmentId = enr.rows[0].id;

  await db.query(
    `INSERT INTO lms_lesson_watch_progress (
       company_id, enrollment_id, lesson_id, position_sec, duration_sec, updated_at
     ) VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET
       position_sec = EXCLUDED.position_sec,
       duration_sec = GREATEST(lms_lesson_watch_progress.duration_sec, EXCLUDED.duration_sec),
       updated_at = NOW()`,
    [cid, enrollmentId, lid, pos, dur]
  );

  return {
    ok: true,
    enrollmentId,
    lessonId: lid,
    positionSec: pos,
    durationSec: dur,
  };
}
