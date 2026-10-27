/**
 * Minimal employee portal via token — no candidate account (B-604).
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { listActiveDevelopmentPlansWithItems } from './development-plans.js';
import { listOneOnOnes } from './one-on-ones.js';
import { buildManagementHypotheses } from './management-hypotheses.js';
import { listCandidateLmsCourses, completeLmsLesson, uncompleteLmsLesson } from '../development/lms.js';
import { notifyCompanyManagers } from '../manager-notifications.js';
import { NOTIF } from '../manager-notification-catalog.js';
import { ERR } from '../api-error-codes.js';

const TTL_DAYS_DEFAULT = 14;
const TTL_DAYS_MAX = 90;

function dateOrNull(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function createEmployeePortalToken(dbOrQuery, {
  companyId,
  candidateId,
  createdByUserId = null,
  ttlDays = TTL_DAYS_DEFAULT,
}) {
  const db = asDb(dbOrQuery);
  const cand = await db.query(
    `SELECT id, company_id AS "companyId", full_name AS "fullName",
            employment_status AS "employmentStatus"
     FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (String(cand.rows[0].companyId) !== String(companyId)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  const days = Math.min(Math.max(7, Number(ttlDays) || TTL_DAYS_DEFAULT), TTL_DAYS_MAX);
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + days);

  const res = await db.query(
    `INSERT INTO employee_portal_tokens (
       company_id, candidate_id, token, expires_at, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, token, expires_at AS "expiresAt", created_at AS "createdAt"`,
    [companyId, candidateId, token, expires.toISOString(), createdByUserId || null]
  );
  return {
    ok: true,
    invite: res.rows[0],
    candidateName: cand.rows[0].fullName,
  };
}

export async function revokeEmployeePortalToken(dbOrQuery, { companyId, candidateId, tokenId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `UPDATE employee_portal_tokens
     SET revoked_at = NOW()
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3 AND revoked_at IS NULL
     RETURNING id`,
    [tokenId, companyId, candidateId]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

export async function listEmployeePortalTokens(dbOrQuery, { companyId, candidateId, limit = 10 }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || 10), 20);
  const res = await db.query(
    `SELECT id, token, expires_at AS "expiresAt", revoked_at AS "revokedAt",
            created_at AS "createdAt", last_seen_at AS "lastSeenAt",
            prepared_at AS "preparedAt", note_to_manager AS "noteToManager"
     FROM employee_portal_tokens
     WHERE company_id = $1 AND candidate_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [companyId, candidateId, cap]
  );
  return res.rows;
}

async function resolveActiveToken(db, token) {
  const tok = String(token || '').trim();
  if (tok.length < 16) return null;
  const res = await db.query(
    `SELECT t.id, t.company_id AS "companyId", t.candidate_id AS "candidateId",
            t.expires_at AS "expiresAt", t.revoked_at AS "revokedAt",
            t.prepared_at AS "preparedAt", t.note_to_manager AS "noteToManager",
            c.full_name AS "fullName"
     FROM employee_portal_tokens t
     JOIN candidates c ON c.id = t.candidate_id
     WHERE t.token = $1
     LIMIT 1`,
    [tok]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  if (row.revokedAt) return { errorCode: ERR.REVOKED };
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return { errorCode: ERR.EXPIRED };
  return row;
}

/**
 * Public payload for /e/{token} — read-only PDI + recent next steps + 1:1 prompts.
 */
export async function getEmployeePortalView(dbOrQuery, { token, locale = 'pt-BR' }) {
  const db = asDb(dbOrQuery);
  const row = await resolveActiveToken(db, token);
  if (!row) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (row.errorCode) return { ok: false, errorCode: row.errorCode };

  await db.query(
    `UPDATE employee_portal_tokens SET last_seen_at = NOW() WHERE id = $1`,
    [row.id]
  );

  const [activePlans, oos, promptsBundle, courses] = await Promise.all([
    listActiveDevelopmentPlansWithItems(db, {
      companyId: row.companyId,
      candidateId: row.candidateId,
      planLimit: 2,
    }),
    listOneOnOnes(db, {
      companyId: row.companyId,
      candidateId: row.candidateId,
      limit: 8,
    }),
    (async () => {
      let prompts = [];
      try {
        const [mot, enn] = await Promise.all([
          db.query(
            `SELECT a.dimension_scores AS "dimensionScores", a.ranking
             FROM ae_attempts a
             WHERE a.candidate_id = $1 AND a.company_id = $2 AND a.status = 'completed'
             ORDER BY a.completed_at DESC NULLS LAST, a.id DESC
             LIMIT 1`,
            [row.candidateId, row.companyId]
          ),
          db.query(
            `SELECT a.top_type AS "topType", a.scores
             FROM assessments a
             JOIN candidates c ON c.id = a.candidate_id
             WHERE a.candidate_id = $1 AND c.company_id = $2
             ORDER BY a.created_at DESC NULLS LAST, a.id DESC
             LIMIT 1`,
            [row.candidateId, row.companyId]
          ),
        ]);
        const hyp = buildManagementHypotheses({
          locale,
          scores: enn.rows[0]?.scores || null,
          topType: enn.rows[0]?.topType ?? null,
          motivators: mot.rows[0]
            ? {
                dimensionScores: mot.rows[0].dimensionScores,
                ranking: mot.rows[0].ranking,
              }
            : null,
        });
        prompts = (hyp.oneOnOnePrompts || []).slice(0, 5);
      } catch {
        prompts = [];
      }
      return prompts;
    })(),
    (async () => {
      try {
        return await listCandidateLmsCourses(db, {
          companyId: row.companyId,
          candidateId: row.candidateId,
        });
      } catch {
        return [];
      }
    })(),
  ]);

  const planDetails = (activePlans || []).map((full) => ({
    id: full.id,
    title: full.title,
    objective: full.objective,
    periodStart: full.periodStart ? dateOrNull(full.periodStart) : null,
    periodEnd: full.periodEnd ? dateOrNull(full.periodEnd) : null,
    items: (full.items || []).map((it) => ({
      id: it.id,
      title: it.title,
      status: it.status,
      dueDate: it.dueDate ? dateOrNull(it.dueDate) : null,
      ownerLabel: it.ownerLabel || '',
    })),
  }));

  const recentAgreements = (oos || [])
    .filter((o) => o.nextSteps)
    .slice(0, 3)
    .map((o) => ({
      id: o.id,
      meetingDate: o.meetingDate ? dateOrNull(o.meetingDate) : null,
      nextSteps: o.nextSteps,
    }));

  return {
    ok: true,
    personName: row.fullName,
    plans: planDetails,
    recentAgreements,
    oneOnOnePrompts: promptsBundle,
    courses,
    expiresAt: row.expiresAt,
    preparedAt: row.preparedAt || null,
    noteToManager: row.noteToManager || '',
  };
}

/**
 * Employee marks 1:1 prep done and optionally leaves a short note for the manager.
 */
export async function submitEmployeePortalPrep(dbOrQuery, { token, noteToManager = '' }) {
  const db = asDb(dbOrQuery);
  const row = await resolveActiveToken(db, token);
  if (!row) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (row.errorCode) return { ok: false, errorCode: row.errorCode };

  const note = String(noteToManager || '')
    .trim()
    .slice(0, 2000);
  // Bump prepared_at on every save; keep previous note when the new note is empty.
  const res = await db.query(
    `UPDATE employee_portal_tokens
     SET prepared_at = NOW(),
         note_to_manager = CASE WHEN $2 <> '' THEN $2 ELSE note_to_manager END,
         last_seen_at = NOW()
     WHERE id = $1
     RETURNING prepared_at AS "preparedAt", note_to_manager AS "noteToManager"`,
    [row.id, note]
  );
  return {
    ok: true,
    preparedAt: res.rows[0]?.preparedAt || null,
    noteToManager: res.rows[0]?.noteToManager || '',
  };
}

/**
 * Employee marks an LMS lesson complete via /e token.
 */
export async function submitEmployeePortalLessonComplete(dbOrQuery, { token, lessonId }) {
  const db = asDb(dbOrQuery);
  const row = await resolveActiveToken(db, token);
  if (!row) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (row.errorCode) return { ok: false, errorCode: row.errorCode };

  await db.query(`UPDATE employee_portal_tokens SET last_seen_at = NOW() WHERE id = $1`, [row.id]);

  const result = await completeLmsLesson(db, {
    companyId: row.companyId,
    candidateId: row.candidateId,
    lessonId,
  });
  if (!result.ok) return result;

  if (result.newlyCompleted) {
    try {
      const course = await db.query(
        `SELECT title FROM lms_courses WHERE id = $1 AND company_id = $2 LIMIT 1`,
        [result.courseId, row.companyId]
      );
      await notifyCompanyManagers({
        companyId: row.companyId,
        type: NOTIF.LMS_COMPLETED,
        entityType: 'lms_enrollment',
        entityId: result.enrollmentId,
        dedupeKey: `lms_completed:${result.enrollmentId}`,
        payload: {
          candidateId: row.candidateId,
          candidateName: row.fullName || '',
          courseId: result.courseId,
          courseTitle: course.rows[0]?.title || '',
        },
      });
    } catch (err) {
      console.error('lms completed notif', err?.message || err);
    }
  }
  return result;
}

/**
 * Employee unmarks an LMS lesson via /e token.
 */
export async function submitEmployeePortalLessonUncomplete(dbOrQuery, { token, lessonId }) {
  const db = asDb(dbOrQuery);
  const row = await resolveActiveToken(db, token);
  if (!row) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (row.errorCode) return { ok: false, errorCode: row.errorCode };

  await db.query(`UPDATE employee_portal_tokens SET last_seen_at = NOW() WHERE id = $1`, [row.id]);

  return uncompleteLmsLesson(db, {
    companyId: row.companyId,
    candidateId: row.candidateId,
    lessonId,
  });
}
