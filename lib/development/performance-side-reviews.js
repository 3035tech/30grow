/**
 * B-2704: 180/360 side reviews (self + peer) via public token.
 * Manager review stays in performance_reviews.
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import {
  PERFORMANCE_CYCLE_STATUS,
  PERFORMANCE_GOAL_OUTCOMES,
  SIDE_REVIEW_ROLE,
  SIDE_REVIEW_STATUS,
} from '../domain-status.js';
import { listPerformanceGoals } from './performance-reviews.js';

const SELF_CAP = 1;
const PEER_CAP = 10;
const DEFAULT_TTL_DAYS = 14;
const MAX_TTL_DAYS = 90;
const REVIEWER_LABEL_MAX = 120;
const OVERALL_NOTES_MAX = 4000;
const OUTCOME_TYPES = new Set(PERFORMANCE_GOAL_OUTCOMES);
const SIDE_ROLES = new Set(Object.values(SIDE_REVIEW_ROLE));

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString();
}

function normalizeOutcomes(raw, goalIds) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const allowed = new Set((goalIds || []).map(String));
  const out = {};
  for (const gid of allowed) {
    const row = src[gid];
    if (!row || typeof row !== 'object') continue;
    const outcome = String(row.outcome || '').trim().toLowerCase();
    if (!OUTCOME_TYPES.has(outcome)) continue;
    out[gid] = {
      outcome,
      notes: String(row.notes || '').trim().slice(0, 2000),
    };
  }
  return out;
}

function mapSideReviewRow(r) {
  return {
    id: Number(r.id),
    cycleId: Number(r.cycleId),
    companyId: Number(r.companyId),
    candidateId: Number(r.candidateId),
    role: r.role,
    reviewerLabel: r.reviewerLabel || '',
    token: r.token,
    outcomes: r.outcomes && typeof r.outcomes === 'object' ? r.outcomes : {},
    overallNotes: r.overallNotes || '',
    status: r.status,
    submittedAt: r.submittedAt || null,
    expiresAt: r.expiresAt || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    publicPath: `/avaliacao/${r.token}`,
  };
}

/**
 * Create a self or peer side-review invite (returns token).
 */
export async function createSideReviewInvite(dbOrQuery, {
  cycleId,
  companyId,
  candidateId,
  role,
  reviewerLabel = '',
  ttlDays = DEFAULT_TTL_DAYS,
}) {
  const db = asDb(dbOrQuery);
  const safeRole = SIDE_ROLES.has(String(role)) ? String(role) : null;
  if (!safeRole) return { ok: false, errorCode: ERR.INVALID_PARAMS };

  const cycleRes = await db.query(
    `SELECT id, status, allow_self_review AS "allowSelfReview",
            allow_peer_review AS "allowPeerReview", title
     FROM performance_cycles
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [cycleId, companyId]
  );
  if (cycleRes.rowCount === 0) return { ok: false, errorCode: ERR.CYCLE_NOT_FOUND };
  const cycle = cycleRes.rows[0];
  if (cycle.status === PERFORMANCE_CYCLE_STATUS.CLOSED) {
    return { ok: false, errorCode: ERR.INVITE_NOT_AVAILABLE };
  }
  if (safeRole === SIDE_REVIEW_ROLE.SELF && !cycle.allowSelfReview) {
    return { ok: false, errorCode: ERR.INVITE_NOT_AVAILABLE };
  }
  if (safeRole === SIDE_REVIEW_ROLE.PEER && !cycle.allowPeerReview) {
    return { ok: false, errorCode: ERR.INVITE_NOT_AVAILABLE };
  }

  const cand = await db.query(
    `SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [candidateId, companyId]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const cap = safeRole === SIDE_REVIEW_ROLE.SELF ? SELF_CAP : PEER_CAP;
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM performance_side_reviews
     WHERE cycle_id = $1 AND company_id = $2 AND candidate_id = $3 AND role = $4
       AND status IN ('${SIDE_REVIEW_STATUS.PENDING}', '${SIDE_REVIEW_STATUS.SUBMITTED}')`,
    [cycleId, companyId, candidateId, safeRole]
  );
  if ((Number(countRes.rows[0]?.n) || 0) >= cap) {
    return { ok: false, errorCode: ERR.ITEMS_CAP };
  }

  const safeLabel = String(reviewerLabel || '').trim().slice(0, REVIEWER_LABEL_MAX);
  const ttl = Math.min(Math.max(1, Number(ttlDays) || DEFAULT_TTL_DAYS), MAX_TTL_DAYS);
  const token = generateToken();
  const expiresAt = addDaysIso(ttl);

  const res = await db.query(
    `INSERT INTO performance_side_reviews (
       cycle_id, company_id, candidate_id, role, reviewer_label, token, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
     RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
               candidate_id AS "candidateId", role, reviewer_label AS "reviewerLabel",
               token, outcomes, overall_notes AS "overallNotes", status,
               submitted_at AS "submittedAt", expires_at AS "expiresAt",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [cycleId, companyId, candidateId, safeRole, safeLabel, token, expiresAt]
  );

  return {
    ok: true,
    sideReview: mapSideReviewRow(res.rows[0]),
    cycleTitle: cycle.title,
  };
}

/**
 * Resolve side review by token for public GET (includes goals).
 */
export async function getSideReviewByToken(dbOrQuery, token) {
  const db = asDb(dbOrQuery);
  const safeToken = String(token || '').trim();
  if (safeToken.length < 16) return { ok: false, errorCode: ERR.INVITE_NOT_FOUND };

  const res = await db.query(
    `SELECT sr.id, sr.cycle_id AS "cycleId", sr.company_id AS "companyId",
            sr.candidate_id AS "candidateId", sr.role, sr.reviewer_label AS "reviewerLabel",
            sr.token, sr.outcomes, sr.overall_notes AS "overallNotes", sr.status,
            sr.submitted_at AS "submittedAt", sr.expires_at AS "expiresAt",
            sr.created_at AS "createdAt", sr.updated_at AS "updatedAt",
            c.title AS "cycleTitle", cand.full_name AS "candidateName"
     FROM performance_side_reviews sr
     JOIN performance_cycles c ON c.id = sr.cycle_id AND c.company_id = sr.company_id
     JOIN candidates cand ON cand.id = sr.candidate_id AND cand.company_id = sr.company_id
     WHERE sr.token = $1
     LIMIT 1`,
    [safeToken]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.INVITE_NOT_FOUND };

  const row = res.rows[0];
  if (row.status === SIDE_REVIEW_STATUS.SUBMITTED) {
    return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    await db.query(
      `UPDATE performance_side_reviews SET status = $2, updated_at = NOW()
       WHERE id = $1 AND status = $3`,
      [row.id, SIDE_REVIEW_STATUS.EXPIRED, SIDE_REVIEW_STATUS.PENDING]
    );
    return { ok: false, errorCode: ERR.INVITE_EXPIRED };
  }
  if (row.status === SIDE_REVIEW_STATUS.EXPIRED) {
    return { ok: false, errorCode: ERR.INVITE_EXPIRED };
  }

  const goals = await listPerformanceGoals(db, {
    companyId: row.companyId,
    cycleId: row.cycleId,
    candidateId: row.candidateId,
  });

  return {
    ok: true,
    sideReview: mapSideReviewRow(row),
    cycleTitle: row.cycleTitle,
    candidateName: row.candidateName,
    goals,
  };
}

/**
 * Submit side review outcomes by token.
 */
export async function submitSideReviewByToken(dbOrQuery, { token, outcomes, overallNotes = '' }) {
  const db = asDb(dbOrQuery);
  const safeToken = String(token || '').trim();
  if (safeToken.length < 16) return { ok: false, errorCode: ERR.INVITE_NOT_FOUND };

  const existing = await db.query(
    `SELECT id, cycle_id AS "cycleId", company_id AS "companyId",
            candidate_id AS "candidateId", role, status, expires_at AS "expiresAt"
     FROM performance_side_reviews
     WHERE token = $1
     LIMIT 1`,
    [safeToken]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.INVITE_NOT_FOUND };
  const row = existing.rows[0];
  if (row.status === SIDE_REVIEW_STATUS.SUBMITTED) {
    return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };
  }
  if (row.status === SIDE_REVIEW_STATUS.EXPIRED) {
    return { ok: false, errorCode: ERR.INVITE_EXPIRED };
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    await db.query(
      `UPDATE performance_side_reviews SET status = '${SIDE_REVIEW_STATUS.EXPIRED}', updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    return { ok: false, errorCode: ERR.INVITE_EXPIRED };
  }

  const goals = await listPerformanceGoals(db, {
    companyId: row.companyId,
    cycleId: row.cycleId,
    candidateId: row.candidateId,
  });
  const goalIds = (goals || []).map((g) => String(g.id));
  const nextOutcomes = normalizeOutcomes(outcomes, goalIds);
  const safeNotes = String(overallNotes || '').trim().slice(0, OVERALL_NOTES_MAX);

  const res = await db.query(
    `UPDATE performance_side_reviews
     SET outcomes = $2::jsonb,
         overall_notes = $3,
         status = '${SIDE_REVIEW_STATUS.SUBMITTED}',
         submitted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = '${SIDE_REVIEW_STATUS.PENDING}'
     RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
               candidate_id AS "candidateId", role, reviewer_label AS "reviewerLabel",
               token, outcomes, overall_notes AS "overallNotes", status,
               submitted_at AS "submittedAt", expires_at AS "expiresAt",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [row.id, nextOutcomes, safeNotes]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };

  return { ok: true, sideReview: mapSideReviewRow(res.rows[0]) };
}

/**
 * List side reviews for a candidate in a cycle (manager UI).
 */
export async function listSideReviewsForCandidate(dbOrQuery, {
  companyId,
  cycleId,
  candidateId,
  limit = 20,
}) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || 20), 20);
  try {
    const res = await db.query(
      `SELECT id, cycle_id AS "cycleId", company_id AS "companyId",
              candidate_id AS "candidateId", role, reviewer_label AS "reviewerLabel",
              token, outcomes, overall_notes AS "overallNotes", status,
              submitted_at AS "submittedAt", expires_at AS "expiresAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM performance_side_reviews
       WHERE company_id = $1 AND cycle_id = $2 AND candidate_id = $3
       ORDER BY role ASC, created_at DESC, id DESC
       LIMIT $4`,
      [companyId, cycleId, candidateId, cap]
    );
    return (res.rows || []).map(mapSideReviewRow);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return [];
    throw err;
  }
}

export const SIDE_REVIEW_CAPS = {
  SELF_CAP,
  PEER_CAP,
  DEFAULT_TTL_DAYS,
  OUTCOME_TYPES,
};
