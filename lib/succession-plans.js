/**
 * Succession Plans — critical roles + successors + readiness (B-1005, Epic B-1000).
 * Reusa HR Score (B-1001) e leadership potential para ranqueamento.
 */

import { asDb } from './ae/as-db.js';
import { getHrScoresByCandidateIds } from './hr-score.js';
import { computeLeadershipPotential010 } from './analytics/leadership-analytics.js';
import { ERR } from './api-error-codes.js';
import { EMPLOYMENT_STATUS, SUCCESSION_IMPACT, SUCCESSION_IMPACTS, SUCCESSION_READINESS, SUCCESSION_READINESSES } from './domain-status.js';
import { sanitizeRichTextHtml } from './sanitize-html.js';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 8000;
const NOTES_MAX = 4000;
const LIST_CAP = 40;
const SUCCESSORS_CAP = 20;

const IMPACT_LEVELS = new Set(SUCCESSION_IMPACTS);
const READINESS_LEVELS = new Set(SUCCESSION_READINESSES);

function normalizeTitle(raw, max = TITLE_MAX) {
  const title = String(raw || '').trim().slice(0, max);
  return title.length >= 1 ? title : null;
}

function normalizeStatus(raw, allowed, fallback) {
  const s = String(raw || '').trim().toLowerCase();
  return allowed.has(s) ? s : fallback;
}

function dateOrNull(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ========================================
// CRITICAL ROLES
// ========================================

/**
 * List critical roles for a company.
 */
export async function listCriticalRoles(dbOrQuery, { companyId, includeInactive = false, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const activeClause = includeInactive ? '' : 'AND r.active = TRUE';
  const res = await db.query(
    `SELECT r.id, r.company_id AS "companyId", r.title, r.description, r.area_key AS "areaKey",
            r.impact_level AS "impactLevel", r.active,
            r.created_by_user_id AS "createdByUserId",
            r.created_at AS "createdAt", r.updated_at AS "updatedAt",
            COALESCE(sc.successor_count, 0)::int AS "successorCount",
            COALESCE(sc.ready_count, 0)::int AS "readyCount",
            COALESCE(sc.developing_count, 0)::int AS "developingCount",
            COALESCE(sc.not_ready_count, 0)::int AS "notReadyCount"
     FROM critical_roles r
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS successor_count,
         COUNT(*) FILTER (WHERE s.readiness IN ('ready', 'now'))::int AS ready_count,
         COUNT(*) FILTER (WHERE s.readiness = 'developing')::int AS developing_count,
         COUNT(*) FILTER (WHERE s.readiness = '${SUCCESSION_READINESS.NOT_READY}')::int AS not_ready_count
       FROM succession_plans s
       WHERE s.critical_role_id = r.id AND s.company_id = r.company_id
     ) sc ON TRUE
     WHERE r.company_id = $1 ${activeClause}
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT $2`,
    [companyId, cap]
  );
  return res.rows;
}

/**
 * Get a single critical role by ID.
 */
export async function getCriticalRole(dbOrQuery, { companyId, roleId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT r.id, r.company_id AS "companyId", r.title, r.description, r.area_key AS "areaKey",
            r.impact_level AS "impactLevel", r.active,
            r.created_by_user_id AS "createdByUserId",
            r.created_at AS "createdAt", r.updated_at AS "updatedAt"
     FROM critical_roles r
     WHERE r.id = $1 AND r.company_id = $2
     LIMIT 1`,
    [roleId, companyId]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0];
}

/**
 * Create a new critical role.
 */
export async function createCriticalRole(dbOrQuery, {
  companyId,
  title,
  description = '',
  areaKey = null,
  impactLevel = 'high',
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const safeTitle = normalizeTitle(title);
  if (!safeTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const safeDescription = sanitizeRichTextHtml(description || '', DESCRIPTION_MAX) || '';
  const safeImpact = normalizeStatus(impactLevel, IMPACT_LEVELS, 'high');
  const safeAreaKey = areaKey && String(areaKey).trim().length > 0 ? String(areaKey).trim() : null;

  const res = await db.query(
    `INSERT INTO critical_roles (
       company_id, title, description, area_key, impact_level, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, company_id AS "companyId", title, description, area_key AS "areaKey",
               impact_level AS "impactLevel", active,
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [companyId, safeTitle, safeDescription, safeAreaKey, safeImpact, createdByUserId || null]
  );
  return { ok: true, role: res.rows[0] };
}

/**
 * Update a critical role.
 */
export async function updateCriticalRole(dbOrQuery, {
  companyId,
  roleId,
  title,
  description,
  areaKey,
  impactLevel,
  active,
}) {
  const db = asDb(dbOrQuery);
  const existing = await getCriticalRole(db, { companyId, roleId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  const nextTitle = title !== undefined ? normalizeTitle(title) : existing.title;
  if (!nextTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const nextDescription =
    description !== undefined
      ? (sanitizeRichTextHtml(description || '', DESCRIPTION_MAX) || '')
      : existing.description;
  const nextAreaKey =
    areaKey !== undefined
      ? (areaKey && String(areaKey).trim().length > 0 ? String(areaKey).trim() : null)
      : existing.areaKey;
  const nextImpact =
    impactLevel !== undefined ? normalizeStatus(impactLevel, IMPACT_LEVELS, existing.impactLevel) : existing.impactLevel;
  const nextActive = active !== undefined ? Boolean(active) : existing.active;

  const res = await db.query(
    `UPDATE critical_roles
     SET title = $3, description = $4, area_key = $5, impact_level = $6, active = $7, updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING id, company_id AS "companyId", title, description, area_key AS "areaKey",
               impact_level AS "impactLevel", active,
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [roleId, companyId, nextTitle, nextDescription, nextAreaKey, nextImpact, nextActive]
  );
  return { ok: true, role: res.rows[0] };
}

/**
 * Deactivate a critical role (soft delete).
 */
export async function deactivateCriticalRole(dbOrQuery, { companyId, roleId }) {
  return updateCriticalRole(dbOrQuery, { companyId, roleId, active: false });
}

// ========================================
// SUCCESSION PLANS (Successors)
// ========================================

/**
 * List successors for a critical role.
 */
export async function listSuccessors(dbOrQuery, { companyId, roleId, limit = SUCCESSORS_CAP }) {
  const byRole = await listSuccessorsForRoles(dbOrQuery, { companyId, roleIds: [roleId], limit });
  return byRole.get(String(roleId)) || [];
}

const SUCCESSOR_READINESS_ORDER_SQL = `CASE s.readiness
         WHEN '${SUCCESSION_READINESS.NOW}' THEN 1
         WHEN '${SUCCESSION_READINESS.READY}' THEN 2
         WHEN '${SUCCESSION_READINESS.DEVELOPING}' THEN 3
         WHEN '${SUCCESSION_READINESS.NOT_READY}' THEN 4
         ELSE 5
       END`;

/**
 * Successors for many critical roles in one query (top `limit` per role).
 * @returns {Promise<Map<string, object[]>>} keyed by String(roleId)
 */
async function listSuccessorsForRoles(dbOrQuery, { companyId, roleIds, limit = SUCCESSORS_CAP }) {
  const ids = [...new Set((roleIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || SUCCESSORS_CAP), SUCCESSORS_CAP);
  const res = await db.query(
    `SELECT "id", "roleId", "companyId", "successorId", readiness, notes, "targetDate",
            "createdByUserId", "createdAt", "updatedAt", "successorName", "successorEmail"
     FROM (
       SELECT s.id, s.critical_role_id AS "roleId", s.company_id AS "companyId",
              s.successor_candidate_id AS "successorId", s.readiness, s.notes,
              s.target_date AS "targetDate",
              s.created_by_user_id AS "createdByUserId",
              s.created_at AS "createdAt", s.updated_at AS "updatedAt",
              c.full_name AS "successorName", c.email AS "successorEmail",
              ROW_NUMBER() OVER (
                PARTITION BY s.critical_role_id
                ORDER BY ${SUCCESSOR_READINESS_ORDER_SQL}, s.updated_at DESC, s.id DESC
              ) AS rn
       FROM succession_plans s
       JOIN candidates c ON c.id = s.successor_candidate_id AND c.company_id = s.company_id
       WHERE s.critical_role_id = ANY($1::bigint[]) AND s.company_id = $2
     ) ranked
     WHERE rn <= $3
     ORDER BY "roleId", rn`,
    [ids, companyId, cap]
  );
  for (const row of res.rows) {
    const key = String(row.roleId);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

/**
 * List all succession plans for a company (rollup view).
 */
export async function listCompanySuccessionPlans(dbOrQuery, { companyId, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const roles = await listCriticalRoles(db, { companyId, includeInactive: false, limit: cap });
  const byRole = await listSuccessorsForRoles(db, { companyId, roleIds: roles.map((r) => r.id) });
  return roles.map((role) => ({ ...role, successors: byRole.get(String(role.id)) || [] }));
}

/**
 * Create a succession plan (assign successor to critical role).
 */
export async function createSuccessionPlan(dbOrQuery, {
  companyId,
  roleId,
  successorId,
  readiness = 'developing',
  notes = '',
  targetDate = null,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  // Validate role exists and belongs to company
  const role = await getCriticalRole(db, { companyId, roleId });
  if (!role) return { ok: false, errorCode: ERR.ROLE_NOT_FOUND };

  // Validate successor exists and belongs to company
  const cand = await db.query(
    `SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [successorId, companyId]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.SUCCESSOR_NOT_FOUND };

  const safeReadiness = normalizeStatus(readiness, READINESS_LEVELS, 'developing');
  const safeNotes = sanitizeRichTextHtml(notes || '', NOTES_MAX) || '';

  try {
    const res = await db.query(
      `INSERT INTO succession_plans (
         critical_role_id, company_id, successor_candidate_id, readiness, notes, target_date, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6::date, $7)
       RETURNING id, critical_role_id AS "roleId", company_id AS "companyId",
                 successor_candidate_id AS "successorId", readiness, notes,
                 target_date AS "targetDate",
                 created_by_user_id AS "createdByUserId",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [roleId, companyId, successorId, safeReadiness, safeNotes, dateOrNull(targetDate), createdByUserId || null]
    );
    return { ok: true, plan: res.rows[0] };
  } catch (err) {
    if (err?.code === '23505') return { ok: false, errorCode: ERR.SUCCESSOR_ALREADY_ASSIGNED };
    throw err;
  }
}

/**
 * Update a succession plan.
 */
export async function updateSuccessionPlan(dbOrQuery, {
  companyId,
  planId,
  readiness,
  notes,
  targetDate,
}) {
  const db = asDb(dbOrQuery);
  const existing = await db.query(
    `SELECT s.id, s.readiness, s.notes, s.target_date AS "targetDate"
     FROM succession_plans s
     WHERE s.id = $1 AND s.company_id = $2
     LIMIT 1`,
    [planId, companyId]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = existing.rows[0];

  const nextReadiness = readiness !== undefined ? normalizeStatus(readiness, READINESS_LEVELS, row.readiness) : row.readiness;
  const nextNotes =
    notes !== undefined ? (sanitizeRichTextHtml(notes || '', NOTES_MAX) || '') : row.notes;
  const nextTargetDate = targetDate !== undefined ? dateOrNull(targetDate) : row.targetDate;

  const res = await db.query(
    `UPDATE succession_plans
     SET readiness = $2, notes = $3, target_date = $4::date, updated_at = NOW()
     WHERE id = $1
     RETURNING id, critical_role_id AS "roleId", company_id AS "companyId",
               successor_candidate_id AS "successorId", readiness, notes,
               target_date AS "targetDate",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [planId, nextReadiness, nextNotes, nextTargetDate]
  );
  return { ok: true, plan: res.rows[0] };
}

/**
 * Delete a succession plan (hard delete).
 */
export async function deleteSuccessionPlan(dbOrQuery, { companyId, planId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `DELETE FROM succession_plans
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [planId, companyId]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

// ========================================
// READINESS SCORING (integração HR Score + leadership)
// ========================================

/**
 * Combine HR Score + leadership into readiness (pure; no DB).
 */
export function computeSuccessionReadinessScore({ hrScore, assessmentScores }) {
  let leadershipScore = null;
  if (assessmentScores) {
    const { score010 } = computeLeadershipPotential010(assessmentScores);
    leadershipScore = score010 != null ? score010 * 10 : null;
  }

  if (hrScore == null && leadershipScore == null) {
    return { score: null, hrScore: null, leadershipScore: null };
  }
  const hr = hrScore != null ? hrScore : (leadershipScore != null ? 50 : 0);
  const ld = leadershipScore != null ? leadershipScore : (hrScore != null ? 50 : 0);
  const combined = Math.round(hr * 0.7 + ld * 0.3);

  return {
    score: combined,
    hrScore: hrScore ?? null,
    leadershipScore,
  };
}

/**
 * Calculate succession readiness score for a candidate (0-100).
 * Combines HR Score (70%) + Leadership Potential (30%).
 */
export async function calculateSuccessionReadiness(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(candidateId);

  const [hrScores, assmt] = await Promise.all([
    getHrScoresByCandidateIds(db, [cid]),
    db.query(
      `SELECT scores FROM assessments
       WHERE candidate_id = $1 AND company_id = $2 AND top_type IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [cid, companyId]
    ),
  ]);

  const hrScore = hrScores.get(cid) ?? null;
  const scores = assmt.rowCount > 0 ? assmt.rows[0].scores : null;
  return computeSuccessionReadinessScore({ hrScore, assessmentScores: scores });
}

/**
 * Get potential successors for a role (candidates ranked by readiness score).
 */
export async function getPotentialSuccessors(dbOrQuery, { companyId, roleId, limit = 10 }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || 10), 20);
  void roleId;

  const candidates = await db.query(
    `SELECT c.id, c.full_name AS "name", c.email
     FROM candidates c
     WHERE c.company_id = $1 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 100`,
    [companyId]
  );

  const ids = candidates.rows.map((c) => Number(c.id));
  if (!ids.length) return [];

  const [hrScores, assmtRes] = await Promise.all([
    getHrScoresByCandidateIds(db, ids),
    db.query(
      `SELECT DISTINCT ON (candidate_id)
         candidate_id AS "candidateId", scores
       FROM assessments
       WHERE candidate_id = ANY($1::bigint[])
         AND company_id = $2
         AND top_type IS NOT NULL
       ORDER BY candidate_id, created_at DESC`,
      [ids, companyId]
    ),
  ]);

  const assessmentByCandidate = new Map(
    assmtRes.rows.map((r) => [Number(r.candidateId), r.scores])
  );

  const scored = [];
  for (const cand of candidates.rows) {
    const cid = Number(cand.id);
    const readiness = computeSuccessionReadinessScore({
      hrScore: hrScores.get(cid) ?? null,
      assessmentScores: assessmentByCandidate.get(cid) ?? null,
    });
    if (readiness.score != null) {
      scored.push({ ...cand, readinessScore: readiness.score });
    }
  }

  scored.sort((a, b) => b.readinessScore - a.readinessScore);
  return scored.slice(0, cap);
}

export const SUCCESSION_CAPS = {
  LIST_CAP,
  SUCCESSORS_CAP,
  IMPACT_LEVELS,
  READINESS_LEVELS,
};
