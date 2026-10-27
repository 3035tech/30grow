/**
 * Performance reviews + goals → PDI (B-1004, Epic B-1000).
 * Ciclo leve (gestor → colaborador; não 360).
 * Gap/outcome `develop` gera item PDI automaticamente.
 */

import { asDb } from '../ae/as-db.js';
import { createDevelopmentPlan, addDevelopmentPlanItem, listDevelopmentPlans } from '../people/development-plans.js';
import { stampOverallScoreOnSubmit } from '../people/performance-calibration.js';
import { suggestVariablePayFromReview } from '../people/variable-pay.js';
import { ERR } from '../api-error-codes.js';
import {
  DEVELOPMENT_PLAN_ITEM_SOURCE,
  DEVELOPMENT_PLAN_ITEM_STATUS,
  DEVELOPMENT_PLAN_STATUS,
  PERFORMANCE_CYCLE_STATUS,
  PERFORMANCE_GOAL_OUTCOME,
  PERFORMANCE_GOAL_OUTCOMES,
  PERFORMANCE_REVIEW_STATUS,
} from '../domain-status.js';
import { isRichTextEmpty, sanitizeRichTextHtml } from '../sanitize-html.js';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const GOAL_TITLE_MAX = 300;
const GOAL_DESCRIPTION_MAX = 2000;
const OVERALL_NOTES_MAX = 4000;
const LIST_CAP = 40;
const GOALS_CAP = 20;

const CYCLE_STATUSES = new Set(Object.values(PERFORMANCE_CYCLE_STATUS));
const REVIEW_STATUSES = new Set(Object.values(PERFORMANCE_REVIEW_STATUS));
const OUTCOME_TYPES = new Set(PERFORMANCE_GOAL_OUTCOMES);

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
// CYCLES
// ========================================

/**
 * List performance cycles for a company.
 */
export async function listPerformanceCycles(dbOrQuery, { companyId, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const res = await db.query(
    `SELECT c.id, c.company_id AS "companyId", c.title, c.description, c.status,
            c.period_start AS "periodStart", c.period_end AS "periodEnd",
            c.allow_self_review AS "allowSelfReview", c.allow_peer_review AS "allowPeerReview",
            c.created_by_user_id AS "createdByUserId",
            c.created_at AS "createdAt", c.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM performance_reviews r WHERE r.cycle_id = c.id) AS "reviewCount",
            (SELECT COUNT(*)::int FROM performance_reviews r WHERE r.cycle_id = c.id AND r.status = '${PERFORMANCE_REVIEW_STATUS.SUBMITTED}') AS "submittedCount"
     FROM performance_cycles c
     WHERE c.company_id = $1
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT $2`,
    [companyId, cap]
  );
  return res.rows;
}

/**
 * Get a single performance cycle by ID.
 */
export async function getPerformanceCycle(dbOrQuery, { companyId, cycleId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT c.id, c.company_id AS "companyId", c.title, c.description, c.status,
            c.period_start AS "periodStart", c.period_end AS "periodEnd",
            c.allow_self_review AS "allowSelfReview", c.allow_peer_review AS "allowPeerReview",
            c.created_by_user_id AS "createdByUserId",
            c.created_at AS "createdAt", c.updated_at AS "updatedAt"
     FROM performance_cycles c
     WHERE c.id = $1 AND c.company_id = $2
     LIMIT 1`,
    [cycleId, companyId]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0];
}

/**
 * Create a new performance cycle.
 */
export async function createPerformanceCycle(dbOrQuery, {
  companyId,
  title,
  description = '',
  status = PERFORMANCE_CYCLE_STATUS.DRAFT,
  periodStart = null,
  periodEnd = null,
  allowSelfReview = false,
  allowPeerReview = false,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const safeTitle = normalizeTitle(title);
  if (!safeTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const safeDescription = (() => {
    const html = sanitizeRichTextHtml(description || '', DESCRIPTION_MAX) || '';
    return isRichTextEmpty(html) ? '' : html;
  })();
  const safeStatus = normalizeStatus(status, CYCLE_STATUSES, PERFORMANCE_CYCLE_STATUS.DRAFT);
  const safeAllowSelf = Boolean(allowSelfReview);
  const safeAllowPeer = Boolean(allowPeerReview);

  const res = await db.query(
    `INSERT INTO performance_cycles (
       company_id, title, description, status, period_start, period_end,
       allow_self_review, allow_peer_review, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9)
     RETURNING id, company_id AS "companyId", title, description, status,
               period_start AS "periodStart", period_end AS "periodEnd",
               allow_self_review AS "allowSelfReview", allow_peer_review AS "allowPeerReview",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      companyId,
      safeTitle,
      safeDescription,
      safeStatus,
      dateOrNull(periodStart),
      dateOrNull(periodEnd),
      safeAllowSelf,
      safeAllowPeer,
      createdByUserId || null,
    ]
  );
  return { ok: true, cycle: res.rows[0] };
}

/**
 * Update a performance cycle.
 */
export async function updatePerformanceCycle(dbOrQuery, {
  companyId,
  cycleId,
  title,
  description,
  status,
  periodStart,
  periodEnd,
  allowSelfReview,
  allowPeerReview,
}) {
  const db = asDb(dbOrQuery);
  const existing = await getPerformanceCycle(db, { companyId, cycleId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  const nextTitle = title !== undefined ? normalizeTitle(title) : existing.title;
  if (!nextTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const nextDescription =
    description !== undefined
      ? (() => {
          const html = sanitizeRichTextHtml(description || '', DESCRIPTION_MAX) || '';
          return isRichTextEmpty(html) ? '' : html;
        })()
      : existing.description;
  const nextStatus = status !== undefined ? normalizeStatus(status, CYCLE_STATUSES, existing.status) : existing.status;
  const nextStart = periodStart !== undefined ? dateOrNull(periodStart) : existing.periodStart;
  const nextEnd = periodEnd !== undefined ? dateOrNull(periodEnd) : existing.periodEnd;
  const nextAllowSelf =
    allowSelfReview !== undefined ? Boolean(allowSelfReview) : Boolean(existing.allowSelfReview);
  const nextAllowPeer =
    allowPeerReview !== undefined ? Boolean(allowPeerReview) : Boolean(existing.allowPeerReview);

  const res = await db.query(
    `UPDATE performance_cycles
     SET title = $3, description = $4, status = $5,
         period_start = $6::date, period_end = $7::date,
         allow_self_review = $8, allow_peer_review = $9,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING id, company_id AS "companyId", title, description, status,
               period_start AS "periodStart", period_end AS "periodEnd",
               allow_self_review AS "allowSelfReview", allow_peer_review AS "allowPeerReview",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [cycleId, companyId, nextTitle, nextDescription, nextStatus, nextStart, nextEnd, nextAllowSelf, nextAllowPeer]
  );
  return { ok: true, cycle: res.rows[0] };
}

/**
 * Close a performance cycle (status → 'closed').
 */
export async function closePerformanceCycle(dbOrQuery, { companyId, cycleId }) {
  return updatePerformanceCycle(dbOrQuery, { companyId, cycleId, status: PERFORMANCE_CYCLE_STATUS.CLOSED });
}

/**
 * Close or hard-delete a performance cycle.
 * Draft with no reviews → DELETE. Otherwise → status closed (soft).
 */
export async function deletePerformanceCycle(dbOrQuery, { companyId, cycleId }) {
  const db = asDb(dbOrQuery);
  const existing = await getPerformanceCycle(db, { companyId, cycleId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  const counts = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM performance_reviews
     WHERE cycle_id = $1 AND company_id = $2`,
    [cycleId, companyId]
  );
  const n = Number(counts.rows[0]?.n) || 0;

  if (existing.status === PERFORMANCE_CYCLE_STATUS.DRAFT && n === 0) {
    await db.query(
      `DELETE FROM performance_cycles WHERE id = $1 AND company_id = $2`,
      [cycleId, companyId]
    );
    return { ok: true, mode: 'deleted' };
  }

  const closed = await closePerformanceCycle(db, { companyId, cycleId });
  if (!closed.ok) return closed;
  return { ok: true, mode: 'closed', cycle: closed.cycle };
}

// ========================================
// GOALS
// ========================================

/**
 * List goals for a candidate in a cycle.
 */
export async function listPerformanceGoals(dbOrQuery, { companyId, cycleId, candidateId, limit = GOALS_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || GOALS_CAP), GOALS_CAP);
  const res = await db.query(
    `SELECT g.id, g.cycle_id AS "cycleId", g.company_id AS "companyId",
            g.candidate_id AS "candidateId", g.title, g.description, g.weight, g.sort_order AS "sortOrder",
            g.created_at AS "createdAt", g.updated_at AS "updatedAt"
     FROM performance_goals g
     WHERE g.cycle_id = $1 AND g.company_id = $2 AND g.candidate_id = $3
     ORDER BY g.sort_order ASC, g.id ASC
     LIMIT $4`,
    [cycleId, companyId, candidateId, cap]
  );
  return res.rows;
}

/**
 * Create a performance goal for a candidate in a cycle.
 */
export async function createPerformanceGoal(dbOrQuery, {
  companyId,
  cycleId,
  candidateId,
  title,
  description = '',
  weight = 100,
  sortOrder = 0,
}) {
  const db = asDb(dbOrQuery);
  const safeTitle = normalizeTitle(title, GOAL_TITLE_MAX);
  if (!safeTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const safeDescription = String(description || '').trim().slice(0, GOAL_DESCRIPTION_MAX);
  const safeWeight = Math.min(Math.max(0, Number(weight) || 100), 100);
  const safeSortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0;

  // Check if candidate belongs to company
  const cand = await db.query(
    `SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [candidateId, companyId]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  // Check if cycle exists and belongs to company
  const cycle = await db.query(
    `SELECT id FROM performance_cycles WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [cycleId, companyId]
  );
  if (cycle.rowCount === 0) return { ok: false, errorCode: ERR.CYCLE_NOT_FOUND };

  const res = await db.query(
    `INSERT INTO performance_goals (
       cycle_id, company_id, candidate_id, title, description, weight, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
               candidate_id AS "candidateId", title, description, weight, sort_order AS "sortOrder",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [cycleId, companyId, candidateId, safeTitle, safeDescription, safeWeight, safeSortOrder]
  );
  return { ok: true, goal: res.rows[0] };
}

/**
 * Update a performance goal.
 */
export async function updatePerformanceGoal(dbOrQuery, {
  companyId,
  goalId,
  title,
  description,
  weight,
  sortOrder,
}) {
  const db = asDb(dbOrQuery);
  const existing = await db.query(
    `SELECT g.id, g.title, g.description, g.weight, g.sort_order AS "sortOrder"
     FROM performance_goals g
     WHERE g.id = $1 AND g.company_id = $2
     LIMIT 1`,
    [goalId, companyId]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = existing.rows[0];

  const nextTitle = title !== undefined ? normalizeTitle(title, GOAL_TITLE_MAX) : row.title;
  if (!nextTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const nextDescription =
    description !== undefined ? String(description || '').trim().slice(0, GOAL_DESCRIPTION_MAX) : row.description;
  const nextWeight = weight !== undefined ? Math.min(Math.max(0, Number(weight) || 0), 100) : row.weight;
  const nextSortOrder =
    sortOrder !== undefined ? (Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0) : row.sortOrder;

  const res = await db.query(
    `UPDATE performance_goals
     SET title = $2, description = $3, weight = $4, sort_order = $5, updated_at = NOW()
     WHERE id = $1
     RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
               candidate_id AS "candidateId", title, description, weight, sort_order AS "sortOrder",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [goalId, nextTitle, nextDescription, nextWeight, nextSortOrder]
  );
  return { ok: true, goal: res.rows[0] };
}

/**
 * Delete a performance goal (hard delete, only if review not yet submitted).
 */
export async function deletePerformanceGoal(dbOrQuery, { companyId, goalId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `DELETE FROM performance_goals
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [goalId, companyId]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

// ========================================
// REVIEWS
// ========================================

/**
 * Get or create a draft review for a candidate in a cycle.
 */
export async function getPerformanceReview(dbOrQuery, { companyId, cycleId, candidateId, reviewerUserId = null }) {
  const db = asDb(dbOrQuery);

  const cycle = await db.query(
    `SELECT id FROM performance_cycles WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [cycleId, companyId]
  );
  if (cycle.rowCount === 0) return { ok: false, errorCode: ERR.CYCLE_NOT_FOUND };

  const cand = await db.query(
    `SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [candidateId, companyId]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  // Check if review exists
  let res = await db.query(
    `SELECT r.id, r.cycle_id AS "cycleId", r.company_id AS "companyId",
            r.candidate_id AS "candidateId", r.reviewer_user_id AS "reviewerUserId",
            r.outcomes, r.overall_notes AS "overallNotes", r.status,
            r.submitted_at AS "submittedAt", r.created_at AS "createdAt", r.updated_at AS "updatedAt"
     FROM performance_reviews r
     WHERE r.cycle_id = $1 AND r.company_id = $2 AND r.candidate_id = $3
     LIMIT 1`,
    [cycleId, companyId, candidateId]
  );
  if (res.rowCount > 0) return { ok: true, review: res.rows[0], created: false };

  // Create draft review
  res = await db.query(
    `INSERT INTO performance_reviews (
       cycle_id, company_id, candidate_id, reviewer_user_id, outcomes, overall_notes, status
     ) VALUES ($1, $2, $3, $4, '{}'::jsonb, '', '${PERFORMANCE_REVIEW_STATUS.DRAFT}')
     RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
               candidate_id AS "candidateId", reviewer_user_id AS "reviewerUserId",
               outcomes, overall_notes AS "overallNotes", status,
               submitted_at AS "submittedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [cycleId, companyId, candidateId, reviewerUserId || null]
  );
  return { ok: true, review: res.rows[0], created: true };
}

/**
 * Update a review (outcomes + notes). Does NOT submit.
 */
export async function updatePerformanceReview(dbOrQuery, {
  companyId,
  cycleId,
  candidateId,
  outcomes,
  overallNotes,
  reviewerUserId,
}) {
  const db = asDb(dbOrQuery);
  const existing = await db.query(
    `SELECT r.id, r.outcomes, r.overall_notes AS "overallNotes", r.reviewer_user_id AS "reviewerUserId", r.status
     FROM performance_reviews r
     WHERE r.cycle_id = $1 AND r.company_id = $2 AND r.candidate_id = $3
     LIMIT 1`,
    [cycleId, companyId, candidateId]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = existing.rows[0];
  if (row.status === PERFORMANCE_REVIEW_STATUS.SUBMITTED) return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };

  const nextOutcomes = outcomes !== undefined ? outcomes : row.outcomes || {};
  const nextNotes =
    overallNotes !== undefined ? String(overallNotes || '').trim().slice(0, OVERALL_NOTES_MAX) : row.overallNotes;
  const nextReviewer = reviewerUserId !== undefined ? reviewerUserId : row.reviewerUserId;

  const res = await db.query(
    `UPDATE performance_reviews
     SET outcomes = $4::jsonb, overall_notes = $5, reviewer_user_id = $6, updated_at = NOW()
     WHERE id = $1 AND cycle_id = $2 AND company_id = $3
     RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
               candidate_id AS "candidateId", reviewer_user_id AS "reviewerUserId",
               outcomes, overall_notes AS "overallNotes", status,
               submitted_at AS "submittedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [row.id, cycleId, companyId, nextOutcomes, nextNotes, nextReviewer || null]
  );
  return { ok: true, review: res.rows[0] };
}

/**
 * Submit a review (status → 'submitted', auto-generate PDI for 'develop' outcomes).
 */
export async function submitPerformanceReview(dbOrQuery, {
  companyId,
  cycleId,
  candidateId,
  reviewerUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const existing = await db.query(
    `SELECT r.id, r.outcomes, r.status, r.reviewer_user_id AS "reviewerUserId"
     FROM performance_reviews r
     WHERE r.cycle_id = $1 AND r.company_id = $2 AND r.candidate_id = $3
     LIMIT 1`,
    [cycleId, companyId, candidateId]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = existing.rows[0];
  if (row.status === PERFORMANCE_REVIEW_STATUS.SUBMITTED) return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };

  // Update status to submitted
  const nextReviewer = reviewerUserId !== undefined ? reviewerUserId : row.reviewerUserId;
  const res = await db.query(
    `UPDATE performance_reviews
     SET status = '${PERFORMANCE_REVIEW_STATUS.SUBMITTED}', submitted_at = NOW(), reviewer_user_id = $4, updated_at = NOW()
     WHERE id = $1 AND cycle_id = $2 AND company_id = $3
     RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
               candidate_id AS "candidateId", reviewer_user_id AS "reviewerUserId",
               outcomes, overall_notes AS "overallNotes", status,
               submitted_at AS "submittedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [row.id, cycleId, companyId, nextReviewer || null]
  );
  const review = res.rows[0];

  await stampOverallScoreOnSubmit(db, {
    companyId,
    reviewId: review.id,
    outcomes: review.outcomes || row.outcomes,
  });

  // Auto-generate PDI items for 'develop' outcomes
  const autoResult = await autoGeneratePdiFromReview(db, {
    companyId,
    candidateId,
    cycleId,
    review,
  });

  let variablePay = { suggested: false };
  try {
    variablePay = await suggestVariablePayFromReview(db, {
      companyId,
      candidateId,
      cycleId,
      reviewId: review.id,
      outcomes: review.outcomes || row.outcomes,
      createdByUserId: nextReviewer || null,
    });
  } catch {
    variablePay = { suggested: false };
  }

  return {
    ok: true,
    review,
    pdiGenerated: autoResult.itemsCreated,
    variablePay: variablePay?.ok
      ? { suggested: !!variablePay.suggested, eventId: variablePay.event?.id || null }
      : { suggested: false },
  };
}

/**
 * Auto-generate PDI items for goals with outcome 'develop'.
 */
async function autoGeneratePdiFromReview(db, { companyId, candidateId, cycleId, review }) {
  const outcomes = review.outcomes || {};
  const goalIds = Object.keys(outcomes).filter((gid) => {
    const outcome = outcomes[gid];
    return outcome && outcome.outcome === PERFORMANCE_GOAL_OUTCOME.DEVELOP;
  });

  if (goalIds.length === 0) return { itemsCreated: 0 };

  // Fetch goals to get titles
  const goals = await db.query(
    `SELECT g.id, g.title, g.description
     FROM performance_goals g
     WHERE g.id = ANY($1::bigint[]) AND g.company_id = $2`,
    [goalIds.map(Number), companyId]
  );
  const goalMap = {};
  goals.rows.forEach((g) => {
    goalMap[String(g.id)] = g;
  });

  // Find or create active PDI plan for this candidate
  const activePlans = await listDevelopmentPlans(db, { companyId, candidateId, limit: 1 });
  let plan = activePlans.find((p) => p.status === DEVELOPMENT_PLAN_STATUS.ACTIVE);

  if (!plan) {
    // Create a new plan
    const cycle = await db.query(
      `SELECT title, period_start AS "periodStart", period_end AS "periodEnd"
       FROM performance_cycles WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [cycleId, companyId]
    );
    const cycleTitle = cycle.rows[0]?.title || 'Avaliação';
    const periodEnd =
      cycle.rows[0]?.periodEnd ||
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const created = await createDevelopmentPlan(db, {
      companyId,
      candidateId,
      title: `PDI · ${cycleTitle}`,
      objective: 'Plano de desenvolvimento gerado automaticamente pela avaliação de desempenho.',
      status: DEVELOPMENT_PLAN_STATUS.ACTIVE,
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd,
      createdByUserId: review.reviewerUserId,
    });
    if (!created.ok) return { itemsCreated: 0 };
    plan = created.plan;
  }

  // Add items for each 'develop' goal
  let itemsCreated = 0;
  for (const gid of goalIds) {
    const goal = goalMap[gid];
    if (!goal) continue;
    const outcomeData = outcomes[gid];
    const notes = outcomeData.notes || '';
    const item = await db.query(
      `INSERT INTO development_plan_items (
         plan_id, company_id, title, notes, status, source, sort_order, performance_goal_id
       ) VALUES ($1, $2, $3, $4, '${DEVELOPMENT_PLAN_ITEM_STATUS.TODO}', '${DEVELOPMENT_PLAN_ITEM_SOURCE.PERFORMANCE_REVIEW}', 0, $5)
       RETURNING id`,
      [
        plan.id,
        companyId,
        `${goal.title}`.slice(0, 300),
        `${notes}\n\nMeta: ${goal.description || goal.title}`.slice(0, 4000),
        Number(gid),
      ]
    );
    if (item.rowCount > 0) itemsCreated += 1;
  }

  return { itemsCreated };
}

/**
 * List reviews in a cycle (for admin overview).
 */
export async function listCycleReviews(dbOrQuery, { companyId, cycleId, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const res = await db.query(
    `SELECT r.id, r.cycle_id AS "cycleId", r.company_id AS "companyId",
            r.candidate_id AS "candidateId", r.reviewer_user_id AS "reviewerUserId",
            r.status, r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
            c.full_name AS "candidateName", c.email AS "candidateEmail"
     FROM performance_reviews r
     JOIN candidates c ON c.id = r.candidate_id AND c.company_id = r.company_id
     WHERE r.cycle_id = $1 AND r.company_id = $2
     ORDER BY r.status DESC, r.updated_at DESC, r.id DESC
     LIMIT $3`,
    [cycleId, companyId, cap]
  );
  return res.rows;
}

export const PERFORMANCE_REVIEW_CAPS = {
  LIST_CAP,
  GOALS_CAP,
  CYCLE_STATUSES,
  REVIEW_STATUSES,
  OUTCOME_TYPES,
};
