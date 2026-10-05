/**
 * B-RH2-15 — Formal competency reviews (90 / 180 / 360 + optional self).
 * Separate from light performance_cycles (goals → PDI).
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { validateCompetencyCategory } from './competency-categories.js';
import {
  EMPLOYMENT_STATUS,
  FORMAL_LIKERT_MAX,
  FORMAL_LIKERT_MIN,
  FORMAL_RATER_ROLE,
  FORMAL_RATER_STATUS,
  FORMAL_REVIEW_CYCLE_STATUS,
  FORMAL_REVIEW_MODEL,
  FORMAL_REVIEW_MODELS,
  FORMAL_REVIEW_STATUS,
  formalCycleDisplayStatus,
} from '../domain-status.js';

const TITLE_MAX = 200;
const DESC_MAX = 4000;
const LABEL_MAX = 200;
const NOTES_MAX = 4000;
const SCORE_NOTES_MAX = 2000;
const LIST_CAP = 40;
const ITEMS_CAP = 30;
const TOKEN_TTL_DAYS = 45;

const CYCLE_STATUSES = new Set(Object.values(FORMAL_REVIEW_CYCLE_STATUS));
const REVIEW_STATUSES = new Set(Object.values(FORMAL_REVIEW_STATUS));
const MODELS = new Set(FORMAL_REVIEW_MODELS);

// JSON is only the API projection here; the source is a normalized relationship.
function questionnaireSql(alias) {
  return `COALESCE((SELECT jsonb_agg(jsonb_build_object('competencyId', qc.competency_id, 'label', qc.label, 'description', qc.description, 'selfDescription', qc.self_description) ORDER BY qc.sort_order) FROM formal_cycle_competencies qc WHERE qc.cycle_id = ${alias}.id AND qc.company_id = ${alias}.company_id), '[]'::jsonb) AS questionnaire`;
}

async function replaceDraftCompetencies(db, { companyId, cycleId, questionnaire }) {
  await db.query('DELETE FROM formal_cycle_competencies WHERE cycle_id = $1 AND company_id = $2', [cycleId, companyId]);
  if (!questionnaire.length) return;
  await db.query(
    `INSERT INTO formal_cycle_competencies (company_id, cycle_id, competency_id, label, description, self_description, sort_order)
     SELECT $1, $2, q.competency_id, q.label, q.description, q.self_description, (q.ord - 1)::smallint
     FROM unnest($3::bigint[], $4::text[], $5::text[], $6::text[]) WITH ORDINALITY AS q(competency_id, label, description, self_description, ord)`,
    [
      companyId,
      cycleId,
      questionnaire.map(item => item.competencyId),
      questionnaire.map(item => item.label),
      questionnaire.map(item => item.description || ''),
      questionnaire.map(item => item.selfDescription || ''),
    ]
  );
}

/** Same item set on every review in `reviewIds` (sort_order = position in `items`). */
async function insertReviewItems(db, { companyId, reviewIds, items }) {
  if (!reviewIds.length || !items.length) return;
  await db.query(
    `INSERT INTO formal_review_items (review_id, company_id, competency_id, label, description, self_description, sort_order)
     SELECT r.id, $2, i.competency_id, i.label, i.description, i.self_description, (i.ord - 1)::int
     FROM unnest($1::bigint[]) AS r(id)
     CROSS JOIN unnest($3::bigint[], $4::text[], $5::text[], $6::text[]) WITH ORDINALITY AS i(competency_id, label, description, self_description, ord)
     ORDER BY r.id, i.ord`,
    [
      reviewIds,
      companyId,
      items.map(item => item.competencyId ?? null),
      items.map(item => item.label),
      items.map(item => item.description ?? ''),
      items.map(item => item.selfDescription ?? ''),
    ]
  );
}

async function listCycleQuestions(db, cycleId) {
  const result = await db.query('SELECT id, prompt FROM formal_cycle_questions WHERE cycle_id = $1 ORDER BY sort_order, id', [cycleId]);
  return result.rows;
}

async function replaceDraftQuestions(db, cycleId, questions) {
  // Only called with the cycle locked in draft; published questions are immutable.
  await db.query('DELETE FROM formal_cycle_questions WHERE cycle_id = $1', [cycleId]);
  if (!questions.length) return [];
  const inserted = await db.query(
    `INSERT INTO formal_cycle_questions (cycle_id, prompt, sort_order)
     SELECT $1, q.prompt, (q.ord - 1)::smallint FROM unnest($2::text[]) WITH ORDINALITY AS q(prompt, ord)
     RETURNING id, prompt, sort_order AS "sortOrder"`,
    [cycleId, questions.map(prompt => prompt.trim())]
  );
  return inserted.rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ id, prompt }) => ({ id, prompt }));
}

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
  const s = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s ? s : null;
}

function normalizeModel(raw) {
  const m = String(raw || '').trim();
  return MODELS.has(m) ? m : FORMAL_REVIEW_MODEL.NINETY;
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString();
}

function isLockedReviewStatus(status) {
  return (
    status === FORMAL_REVIEW_STATUS.FINALIZED ||
    status === FORMAL_REVIEW_STATUS.SENT ||
    status === FORMAL_REVIEW_STATUS.ARCHIVED
  );
}

function mapCycle(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    description: row.description || '',
    questionnaire: row.questionnaire || [],
    instructions: row.instructions || '',
    responseScale: row.responseScale || 'agreement',
    openQuestions: row.openQuestions || [],
    model: row.model,
    includeSelf: !!row.includeSelf,
    status: row.status,
    displayStatus: formalCycleDisplayStatus(row.status, dateOrNull(row.periodStart)),
    periodStart: row.periodStart || null,
    periodEnd: row.periodEnd || null,
    createdByUserId: row.createdByUserId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewCount: row.reviewCount != null ? Number(row.reviewCount) : undefined,
  };
}

function mapReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    cycleId: row.cycleId,
    companyId: row.companyId,
    subjectCandidateId: row.subjectCandidateId,
    subjectName: row.subjectName || null,
    subjectEmail: row.subjectEmail || null,
    managerUserId: row.managerUserId || null,
    jobRoleId: row.jobRoleId || null,
    status: row.status,
    finalizedAt: row.finalizedAt || null,
    sentAt: row.sentAt || null,
    archivedAt: row.archivedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    responseCount: Number(row.responseCount || 0),
    submittedCount: Number(row.submittedCount || 0),
  };
}

function mapItem(row) {
  return {
    id: row.id,
    reviewId: row.reviewId,
    competencyId: row.competencyId || null,
    label: row.label,
    description: row.description || '',
    selfDescription: row.selfDescription || '',
    sortOrder: row.sortOrder,
  };
}

function mapRater(row) {
  return {
    id: row.id,
    reviewId: row.reviewId,
    role: row.role,
    userId: row.userId || null,
    candidateId: row.candidateId || null,
    externalName: row.externalName || '',
    externalEmail: row.externalEmail || '',
    externalTitle: row.externalTitle || '',
    token: row.token || null,
    tokenExpiresAt: row.tokenExpiresAt || null,
    status: row.status,
    submittedAt: row.submittedAt || null,
    overallNotes: row.overallNotes || '',
    openAnswers: row.openAnswers || [],
  };
}

// ── Competency catalog ──────────────────────────────────────────────────────

export async function listCompanyCompetencies(dbOrQuery, { companyId, includeInactive = false, limit = LIST_CAP } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const res = await db.query(
    `SELECT id, company_id AS "companyId", name, description, active, category_id AS "categoryId",
            (SELECT cat.name FROM competency_categories cat WHERE cat.id = company_competencies.category_id AND cat.company_id = $1) AS "categoryName",
            self_description AS "selfDescription",
            (SELECT COUNT(*)::int FROM (
              SELECT qc.cycle_id FROM formal_cycle_competencies qc WHERE qc.competency_id = company_competencies.id AND qc.company_id = $1
              UNION SELECT r.cycle_id FROM formal_review_items i JOIN formal_reviews r ON r.id = i.review_id WHERE i.competency_id = company_competencies.id AND i.company_id = $1
            ) used_cycles) AS "usageCount",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM company_competencies
     WHERE company_id = $1
       AND ($2::boolean OR active = TRUE)
     ORDER BY name ASC, id ASC
     LIMIT $3`,
    [cid, !!includeInactive, cap]
  );
  return res.rows;
}

export async function createCompanyCompetency(dbOrQuery, { companyId, name, description = '', categoryId = null, selfDescription = '' }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const safeName = normalizeTitle(name);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.INVALID_COMPANY };
  if (!safeName) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const categoryError = await validateCompetencyCategory(db, { companyId: cid, categoryId });
  if (categoryError) return { ok: false, errorCode: categoryError };
  try {
    const res = await db.query(
      `INSERT INTO company_competencies (company_id, name, description, category_id, self_description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, company_id AS "companyId", name, description, active, category_id AS "categoryId",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [cid, safeName, String(description || '').trim().slice(0, 2000), categoryId, String(selfDescription || '').trim().slice(0, 2000)]
    );
    return { ok: true, competency: res.rows[0] };
  } catch (err) {
    if (err?.code === '23505') return { ok: false, errorCode: ERR.COMPETENCY_NAME_EXISTS };
    throw err;
  }
}

export async function updateCompanyCompetency(dbOrQuery, { companyId, id, name, description, active, categoryId, selfDescription }) {
  const db = asDb(dbOrQuery);
  if (name !== undefined && !normalizeTitle(name)) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  if (categoryId !== undefined) {
    const categoryError = await validateCompetencyCategory(db, { companyId, categoryId, competencyId: id });
    if (categoryError) return { ok: false, errorCode: categoryError };
  }
  try {
    const result = await db.query(
      `UPDATE company_competencies SET name = COALESCE($3, name), description = COALESCE($4, description),
       active = COALESCE($5, active), category_id = CASE WHEN $8 THEN $6::bigint ELSE category_id END, self_description = COALESCE($7, self_description), updated_at = NOW()
       WHERE company_id = $1 AND id = $2
         AND (NOT $8 OR $6::bigint IS NULL OR category_id = $6::bigint OR EXISTS
           (SELECT 1 FROM competency_categories cat WHERE cat.company_id = $1 AND cat.id = $6::bigint AND cat.active))
       RETURNING id, name, description, active, category_id AS "categoryId", self_description AS "selfDescription"`,
      [companyId, id, name === undefined ? null : normalizeTitle(name), description === undefined ? null : String(description || '').trim().slice(0, 2000),
        active ?? null, categoryId ?? null, selfDescription === undefined ? null : String(selfDescription || '').trim().slice(0, 2000), categoryId !== undefined]
    );
    return result.rowCount ? { ok: true, competency: result.rows[0] } : { ok: false, errorCode: ERR.NOT_FOUND };
  } catch (err) {
    if (err?.code === '23505') return { ok: false, errorCode: ERR.COMPETENCY_NAME_EXISTS };
    throw err;
  }
}

export async function listJobRoleCompetencies(dbOrQuery, { companyId, jobRoleId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(jobRoleId);
  if (!Number.isFinite(cid) || !Number.isFinite(rid)) return [];
  const res = await db.query(
    `SELECT jrc.id, jrc.competency_id AS "competencyId", jrc.sort_order AS "sortOrder",
            c.name, c.description, c.self_description AS "selfDescription"
     FROM job_role_competencies jrc
     JOIN company_competencies c ON c.id = jrc.competency_id AND c.company_id = jrc.company_id
     WHERE jrc.company_id = $1 AND jrc.job_role_id = $2 AND c.active = TRUE
     ORDER BY jrc.sort_order ASC, jrc.id ASC
     LIMIT $3`,
    [cid, rid, ITEMS_CAP]
  );
  return res.rows;
}

export async function setJobRoleCompetencies(dbOrQuery, { companyId, jobRoleId, competencyIds = [] }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(jobRoleId);
  if (!Number.isFinite(cid) || !Number.isFinite(rid)) return { ok: false, errorCode: ERR.INVALID_ID };
  const role = await db.query(
    `SELECT id FROM job_roles WHERE id = $1 AND company_id = $2 AND active = TRUE LIMIT 1`,
    [rid, cid]
  );
  if (role.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const ids = [...new Set((competencyIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))].slice(
    0,
    ITEMS_CAP
  );
  await db.query(`DELETE FROM job_role_competencies WHERE company_id = $1 AND job_role_id = $2`, [cid, rid]);
  for (let i = 0; i < ids.length; i += 1) {
    await db.query(
      `INSERT INTO job_role_competencies (company_id, job_role_id, competency_id, sort_order)
       SELECT $1, $2, c.id, $4
       FROM company_competencies c
       WHERE c.id = $3 AND c.company_id = $1 AND c.active = TRUE
       ON CONFLICT (job_role_id, competency_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [cid, rid, ids[i], i]
    );
  }
  return { ok: true, items: await listJobRoleCompetencies(db, { companyId: cid, jobRoleId: rid }) };
}

// ── Cycles ──────────────────────────────────────────────────────────────────

export async function listFormalReviewCycles(dbOrQuery, { companyId, limit = LIST_CAP } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const res = await db.query(
    `SELECT c.id, c.company_id AS "companyId", c.title, c.description, c.model,
            c.include_self AS "includeSelf", c.status, ${questionnaireSql('c')}, c.instructions, c.response_scale AS "responseScale",
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt) ORDER BY q.sort_order) FROM formal_cycle_questions q WHERE q.cycle_id = c.id), '[]'::jsonb) AS "openQuestions",
            c.period_start AS "periodStart", c.period_end AS "periodEnd",
            c.created_by_user_id AS "createdByUserId",
            c.created_at AS "createdAt", c.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM formal_reviews r WHERE r.cycle_id = c.id) AS "reviewCount"
     FROM formal_review_cycles c
     WHERE c.company_id = $1
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT $2`,
    [cid, cap]
  );
  return res.rows.map(mapCycle);
}

export async function createFormalReviewCycle(dbOrQuery, {
  companyId,
  title,
  description = '',
  model = FORMAL_REVIEW_MODEL.NINETY,
  includeSelf = false,
  periodStart = null,
  periodEnd = null,
  createdByUserId = null,
  competencyIds = [],
  instructions = '',
  responseScale = 'agreement',
  openQuestions = [],
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const safeTitle = normalizeTitle(title);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.INVALID_COMPANY };
  if (!safeTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  if (!['agreement', 'frequency'].includes(responseScale) || !Array.isArray(openQuestions) || openQuestions.length > 10 || openQuestions.some(q => typeof q !== 'string' || !q.trim() || q.length > 1000)) return { ok: false, errorCode: ERR.INVALID_DATA };
  const ids = [...new Set(competencyIds.map(Number))];
  if (ids.length > ITEMS_CAP || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return { ok: false, errorCode: ERR.INVALID_DATA };
  let questionnaire = [];
  if (ids.length) {
    const catalog = await db.query(`SELECT id AS "competencyId", name AS label, description, self_description AS "selfDescription" FROM company_competencies WHERE company_id = $1 AND id = ANY($2::bigint[]) AND active = TRUE ORDER BY name, id`, [cid, ids]);
    if (catalog.rows.length !== ids.length) return { ok: false, errorCode: ERR.INVALID_DATA };
    questionnaire = catalog.rows;
  }
  const start = dateOrNull(periodStart), end = dateOrNull(periodEnd);
  if ((periodStart && !start) || (periodEnd && !end) || (start && end && start > end)) return { ok: false, errorCode: ERR.INVALID_DATA };
  const res = await db.query(
    `INSERT INTO formal_review_cycles (
       company_id, title, description, model, include_self, status,
       period_start, period_end, created_by_user_id, instructions, response_scale
     ) VALUES ($1, $2, $3, $4, $5, '${FORMAL_REVIEW_CYCLE_STATUS.DRAFT}', $6::date, $7::date, $8, $9, $10)
     RETURNING id, company_id AS "companyId", title, description, model,
               include_self AS "includeSelf", status,
               period_start AS "periodStart", period_end AS "periodEnd",
               created_by_user_id AS "createdByUserId", instructions, response_scale AS "responseScale",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      cid,
      safeTitle,
      String(description || '').trim().slice(0, DESC_MAX),
      normalizeModel(model),
      !!includeSelf,
      dateOrNull(periodStart),
      dateOrNull(periodEnd),
      createdByUserId || null,
      String(instructions || '').trim().slice(0, 4000),
      responseScale,
    ]
  );
  await replaceDraftCompetencies(db, { companyId: cid, cycleId: res.rows[0].id, questionnaire });
  res.rows[0].questionnaire = questionnaire;
  res.rows[0].openQuestions = await replaceDraftQuestions(db, res.rows[0].id, openQuestions);
  return { ok: true, cycle: mapCycle(res.rows[0]) };
}

export async function updateFormalReviewCycle(dbOrQuery, {
  companyId,
  cycleId,
  title,
  description,
  model,
  includeSelf,
  status,
  periodStart,
  periodEnd,
  questionnaire,
  instructions,
  responseScale,
  openQuestions,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const id = Number(cycleId);
  if (!Number.isFinite(cid) || !Number.isFinite(id)) return { ok: false, errorCode: ERR.INVALID_ID };
  const existing = await db.query(
    `SELECT id, status, model, include_self AS "includeSelf", title, description, ${questionnaireSql('formal_review_cycles')}, instructions, response_scale AS "responseScale",
            period_start AS "periodStart", period_end AS "periodEnd"
     FROM formal_review_cycles WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [id, cid]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const cur = existing.rows[0];
  // Publishing goes through the respondent validation flow, never a status-only PATCH.
  if (status !== undefined && status !== cur.status && status !== FORMAL_REVIEW_CYCLE_STATUS.CLOSED) return { ok: false, errorCode: ERR.INVALID_STATUS };
  const configurationChanged = [title, description, model, includeSelf, periodStart, periodEnd, questionnaire, instructions, responseScale, openQuestions].some(value => value !== undefined);
  if ((responseScale !== undefined && !['agreement', 'frequency'].includes(responseScale)) || (openQuestions !== undefined && (!Array.isArray(openQuestions) || openQuestions.length > 10 || openQuestions.some(q => typeof q !== 'string' || !q.trim() || q.length > 1000)))) return { ok: false, errorCode: ERR.INVALID_DATA };
  if (configurationChanged && cur.status !== FORMAL_REVIEW_CYCLE_STATUS.DRAFT) return { ok: false, errorCode: ERR.INVALID_STATUS };
  const start = dateOrNull(periodStart !== undefined ? periodStart : cur.periodStart);
  const end = dateOrNull(periodEnd !== undefined ? periodEnd : cur.periodEnd);
  if ((periodStart && !start) || (periodEnd && !end) || (start && end && start > end)) return { ok: false, errorCode: ERR.INVALID_DATA };
  let nextQuestionnaire = cur.questionnaire || [];
  if (questionnaire !== undefined) {
    const ids = questionnaire.map(item => Number(item.competencyId));
    if (ids.length > ITEMS_CAP || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return { ok: false, errorCode: ERR.INVALID_DATA };
    const currentIds = (cur.questionnaire || []).map(item => Number(item.competencyId));
    const catalog = await db.query(`SELECT id, name, description, self_description FROM company_competencies WHERE company_id = $1 AND id = ANY($2::bigint[]) AND (active = TRUE OR id = ANY($3::bigint[]))`, [cid, ids, currentIds]);
    if (catalog.rowCount !== ids.length) return { ok: false, errorCode: ERR.INVALID_DATA };
    nextQuestionnaire = questionnaire.map(item => {
      const source = catalog.rows.find(row => Number(row.id) === Number(item.competencyId));
      const snapshot = cur.questionnaire?.find(row => Number(row.competencyId) === Number(item.competencyId));
      return { competencyId: source.id, label: snapshot?.label || source.name, description: snapshot?.description ?? source.description,
        selfDescription: String(item.selfDescription ?? snapshot?.selfDescription ?? source.self_description ?? '').trim().slice(0, DESC_MAX) };
    });
  }
  if (cur.status === FORMAL_REVIEW_CYCLE_STATUS.CLOSED && status !== FORMAL_REVIEW_CYCLE_STATUS.CLOSED) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }
  const nextTitle = title !== undefined ? normalizeTitle(title) : cur.title;
  if (!nextTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const nextStatus =
    status !== undefined
      ? normalizeStatus(status, CYCLE_STATUSES, cur.status)
      : cur.status;
  const nextModel =
    cur.status === FORMAL_REVIEW_CYCLE_STATUS.DRAFT && model !== undefined
      ? normalizeModel(model)
      : cur.model;
  const nextSelf =
    cur.status === FORMAL_REVIEW_CYCLE_STATUS.DRAFT && includeSelf !== undefined
      ? !!includeSelf
      : cur.includeSelf;

  const res = await db.query(
    `UPDATE formal_review_cycles
     SET title = $3, description = $4, model = $5, include_self = $6, status = $7,
         period_start = $8::date, period_end = $9::date, instructions = $10, response_scale = $11, updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING id, company_id AS "companyId", title, description, model,
               include_self AS "includeSelf", status,
               period_start AS "periodStart", period_end AS "periodEnd",
               created_by_user_id AS "createdByUserId", instructions, response_scale AS "responseScale",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      id,
      cid,
      nextTitle,
      description !== undefined ? String(description || '').trim().slice(0, DESC_MAX) : cur.description,
      nextModel,
      nextSelf,
      nextStatus,
      start,
      end,
      instructions !== undefined ? String(instructions || '').trim().slice(0, DESC_MAX) : cur.instructions,
      responseScale ?? cur.responseScale ?? 'agreement',
    ]
  );
  res.rows[0].openQuestions = openQuestions !== undefined ? await replaceDraftQuestions(db, id, openQuestions) : await listCycleQuestions(db, id);
  res.rows[0].questionnaire = nextQuestionnaire;
  if (questionnaire !== undefined) {
    await replaceDraftCompetencies(db, { companyId: cid, cycleId: id, questionnaire: nextQuestionnaire });
    const drafts = await db.query(`SELECT id FROM formal_reviews WHERE cycle_id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`, [id, cid]);
    const draftIds = drafts.rows.map(review => Number(review.id));
    if (draftIds.length) {
      await db.query('DELETE FROM formal_review_items WHERE review_id = ANY($1::bigint[]) AND company_id = $2', [draftIds, cid]);
      await insertReviewItems(db, { companyId: cid, reviewIds: draftIds, items: nextQuestionnaire });
    }
  }
  return { ok: true, cycle: mapCycle(res.rows[0]) };
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export async function listFormalReviews(dbOrQuery, { companyId, cycleId, limit = LIST_CAP } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cyc = Number(cycleId);
  if (!Number.isFinite(cid) || !Number.isFinite(cyc)) return [];
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const res = await db.query(
    `SELECT r.id, r.cycle_id AS "cycleId", r.company_id AS "companyId",
            r.subject_candidate_id AS "subjectCandidateId",
            r.manager_user_id AS "managerUserId", r.job_role_id AS "jobRoleId",
            r.status, r.finalized_at AS "finalizedAt", r.sent_at AS "sentAt",
            r.archived_at AS "archivedAt",
            r.created_at AS "createdAt", r.updated_at AS "updatedAt",
            c.full_name AS "subjectName", c.email AS "subjectEmail",
            (SELECT count(*)::int FROM formal_review_raters rr WHERE rr.review_id = r.id AND rr.company_id = r.company_id) AS "responseCount",
            (SELECT count(*)::int FROM formal_review_raters rr WHERE rr.review_id = r.id AND rr.company_id = r.company_id AND rr.status = 'submitted') AS "submittedCount"
     FROM formal_reviews r
     JOIN candidates c ON c.id = r.subject_candidate_id AND c.company_id = r.company_id
     WHERE r.company_id = $1 AND r.cycle_id = $2
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT $3`,
    [cid, cyc, cap]
  );
  return res.rows.map(mapReview);
}

async function seedItemsFromJobRole(db, { companyId, reviewId, jobRoleId }) {
  if (!jobRoleId) return 0;
  const comps = await listJobRoleCompetencies(db, { companyId, jobRoleId });
  await insertReviewItems(db, {
    companyId,
    reviewIds: [reviewId],
    items: comps.map(c => ({
      competencyId: c.competencyId, label: c.name.slice(0, LABEL_MAX), description: c.description, selfDescription: c.selfDescription,
    })),
  });
  return comps.length;
}

export async function createFormalReview(dbOrQuery, {
  companyId,
  cycleId,
  subjectCandidateId,
  managerUserId = null,
  jobRoleId = null,
  externalName = '',
  externalEmail = '',
  externalTitle = '',
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cyc = Number(cycleId);
  const sid = Number(subjectCandidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cyc) || !Number.isFinite(sid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const cycle = await db.query(
    `SELECT id, model, include_self AS "includeSelf", status, ${questionnaireSql('formal_review_cycles')}
     FROM formal_review_cycles WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [cyc, cid]
  );
  if (cycle.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (cycle.rows[0].status === FORMAL_REVIEW_CYCLE_STATUS.CLOSED) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }

  const subject = await db.query(
    `SELECT id, job_role_id AS "jobRoleId"
     FROM candidates
     WHERE id = $1 AND company_id = $2 AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [sid, cid]
  );
  if (subject.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };

  const model = cycle.rows[0].model;
  const extName = String(externalName || '').trim().slice(0, LABEL_MAX);
  const extEmail = String(externalEmail || '').trim().toLowerCase().slice(0, 320);
  const extTitle = String(externalTitle || '').trim().slice(0, LABEL_MAX);
  if (model === FORMAL_REVIEW_MODEL.THREE_SIXTY && (!extName || !extEmail)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const roleId = Number(jobRoleId) || subject.rows[0].jobRoleId || null;

  let review;
  try {
    const res = await db.query(
      `INSERT INTO formal_reviews (
         cycle_id, company_id, subject_candidate_id, manager_user_id, job_role_id, status
       ) VALUES ($1, $2, $3, $4, $5, '${FORMAL_REVIEW_STATUS.DRAFT}')
       RETURNING id, cycle_id AS "cycleId", company_id AS "companyId",
                 subject_candidate_id AS "subjectCandidateId",
                 manager_user_id AS "managerUserId", job_role_id AS "jobRoleId",
                 status, finalized_at AS "finalizedAt", sent_at AS "sentAt",
                 archived_at AS "archivedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [cyc, cid, sid, managerUserId || null, roleId]
    );
    review = mapReview(res.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return { ok: false, errorCode: ERR.FORMAL_REVIEW_EXISTS };
    throw err;
  }

  if (cycle.rows[0].questionnaire?.length) {
    await insertReviewItems(db, {
      companyId: cid,
      reviewIds: [review.id],
      items: cycle.rows[0].questionnaire.map(item => ({ ...item, description: item.description || '', selfDescription: item.selfDescription || '' })),
    });
  } else {
    await seedItemsFromJobRole(db, { companyId: cid, reviewId: review.id, jobRoleId: roleId });
  }

  if (model === FORMAL_REVIEW_MODEL.THREE_SIXTY) {
    await db.query(
      `INSERT INTO formal_review_raters (
         review_id, company_id, role, external_name, external_email, external_title, status
       ) VALUES ($1, $2, '${FORMAL_RATER_ROLE.EXTERNAL}', $3, $4, $5, '${FORMAL_RATER_STATUS.PENDING}')
       ON CONFLICT (review_id, role) DO UPDATE
         SET external_name = EXCLUDED.external_name,
             external_email = EXCLUDED.external_email,
             external_title = EXCLUDED.external_title,
             updated_at = NOW()`,
      [review.id, cid, extName, extEmail, extTitle]
    );
  }

  return { ok: true, review: await getFormalReviewDetail(db, { companyId: cid, reviewId: review.id }) };
}

export async function getFormalReviewDetail(dbOrQuery, { companyId, reviewId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  if (!Number.isFinite(cid) || !Number.isFinite(rid)) return null;

  const rev = await db.query(
    `SELECT r.id, r.cycle_id AS "cycleId", r.company_id AS "companyId",
            r.subject_candidate_id AS "subjectCandidateId",
            r.manager_user_id AS "managerUserId", r.job_role_id AS "jobRoleId",
            r.status, r.finalized_at AS "finalizedAt", r.sent_at AS "sentAt",
            r.archived_at AS "archivedAt",
            r.created_at AS "createdAt", r.updated_at AS "updatedAt",
            c.full_name AS "subjectName", c.email AS "subjectEmail",
            cy.status AS "cycleStatus", cy.model, cy.include_self AS "includeSelf", cy.title AS "cycleTitle", ${questionnaireSql('cy')}, cy.instructions, cy.response_scale AS "responseScale",
            cy.period_start AS "periodStart", cy.period_end AS "periodEnd",
            manager.full_name AS "managerName", manager.id AS "managerCandidateId"
     FROM formal_reviews r
     JOIN candidates c ON c.id = r.subject_candidate_id AND c.company_id = r.company_id
     JOIN formal_review_cycles cy ON cy.id = r.cycle_id AND cy.company_id = r.company_id
     LEFT JOIN candidates manager ON manager.id = c.manager_candidate_id AND manager.company_id = r.company_id
     WHERE r.id = $1 AND r.company_id = $2
     LIMIT 1`,
    [rid, cid]
  );
  if (rev.rowCount === 0) return null;
  const row = rev.rows[0];
  const review = { ...mapReview(row), cycleStatus: row.cycleStatus, model: row.model, includeSelf: !!row.includeSelf, cycleTitle: row.cycleTitle,
    responseScale: row.responseScale || 'agreement', openQuestions: await listCycleQuestions(db, row.cycleId),
    questionnaire: row.questionnaire || [], instructions: row.instructions || '', periodStart: row.periodStart, periodEnd: row.periodEnd, managerName: row.managerName, managerCandidateId: row.managerCandidateId };

  const items = await db.query(
    `SELECT id, review_id AS "reviewId", competency_id AS "competencyId",
            label, description, self_description AS "selfDescription", sort_order AS "sortOrder"
     FROM formal_review_items WHERE review_id = $1 AND company_id = $2
     ORDER BY sort_order ASC, id ASC`,
    [rid, cid]
  );
  const raters = await db.query(
    `SELECT id, review_id AS "reviewId", role, user_id AS "userId",
            candidate_id AS "candidateId",
            external_name AS "externalName", external_email AS "externalEmail",
            external_title AS "externalTitle",
            token, token_expires_at AS "tokenExpiresAt",
            status, submitted_at AS "submittedAt", overall_notes AS "overallNotes",
            COALESCE((SELECT jsonb_agg(jsonb_build_object('questionId', a.question_id, 'answer', a.answer)) FROM formal_review_open_answers a WHERE a.rater_id = formal_review_raters.id), '[]'::jsonb) AS "openAnswers"
     FROM formal_review_raters WHERE review_id = $1 AND company_id = $2
     ORDER BY id ASC`,
    [rid, cid]
  );
  const scores = await db.query(
    `SELECT s.rater_id AS "raterId", s.item_id AS "itemId", s.score, s.notes
     FROM formal_review_scores s
     JOIN formal_review_raters rr ON rr.id = s.rater_id
     WHERE rr.review_id = $1 AND s.company_id = $2`,
    [rid, cid]
  );

  return {
    ...review,
    items: items.rows.map(mapItem),
    raters: raters.rows.map(mapRater),
    scores: scores.rows,
  };
}

export async function addFormalReviewItem(dbOrQuery, {
  companyId,
  reviewId,
  label,
  competencyId = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  const safeLabel = normalizeTitle(label, LABEL_MAX);
  if (!safeLabel) return { ok: false, errorCode: ERR.TITLE_REQUIRED };

  const rev = await db.query(
    `SELECT id, status FROM formal_reviews WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [rid, cid]
  );
  if (rev.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (isLockedReviewStatus(rev.rows[0].status) || rev.rows[0].status === FORMAL_REVIEW_STATUS.COLLECTING) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }
  const cycleConfig = await db.query(`SELECT ${questionnaireSql('cy')} FROM formal_review_cycles cy JOIN formal_reviews r ON r.cycle_id = cy.id AND r.company_id = cy.company_id WHERE r.id = $1 AND r.company_id = $2`, [rid, cid]);
  if (cycleConfig.rows[0]?.questionnaire?.length) return { ok: false, errorCode: ERR.INVALID_STATUS };

  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM formal_review_items WHERE review_id = $1`,
    [rid]
  );
  if ((count.rows[0]?.n || 0) >= ITEMS_CAP) return { ok: false, errorCode: ERR.ITEMS_CAP };

  let compId = null;
  let snapshot = { name: safeLabel, description: '', selfDescription: '' };
  if (competencyId != null) {
    const n = Number(competencyId);
    if (Number.isFinite(n) && n > 0) {
      const c = await db.query(
        `SELECT id, name, description, self_description AS "selfDescription" FROM company_competencies WHERE id = $1 AND company_id = $2 AND active = TRUE`,
        [n, cid]
      );
      if (!c.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
      compId = n;
      snapshot = c.rows[0];
    } else {
      return { ok: false, errorCode: ERR.INVALID_ID };
    }
  }

  const maxOrd = await db.query(
    `SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM formal_review_items WHERE review_id = $1`,
    [rid]
  );
  const res = await db.query(
    `INSERT INTO formal_review_items (review_id, company_id, competency_id, label, sort_order, description, self_description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, review_id AS "reviewId", competency_id AS "competencyId",
               label, description, self_description AS "selfDescription", sort_order AS "sortOrder"`,
    [rid, cid, compId, snapshot.name, (maxOrd.rows[0]?.m ?? -1) + 1, snapshot.description, snapshot.selfDescription]
  );
  return { ok: true, item: mapItem(res.rows[0]) };
}

export async function setFormalReviewExternal(dbOrQuery, {
  companyId,
  reviewId,
  externalName,
  externalEmail,
  externalTitle = '',
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  const name = String(externalName || '').trim().slice(0, LABEL_MAX);
  const email = String(externalEmail || '').trim().toLowerCase().slice(0, 320);
  const title = String(externalTitle || '').trim().slice(0, LABEL_MAX);
  if (!name || !email) return { ok: false, errorCode: ERR.INVALID_DATA };

  const rev = await db.query(
    `SELECT r.id, r.status, c.model
     FROM formal_reviews r
     JOIN formal_review_cycles c ON c.id = r.cycle_id
     WHERE r.id = $1 AND r.company_id = $2 LIMIT 1`,
    [rid, cid]
  );
  if (rev.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (rev.rows[0].model !== FORMAL_REVIEW_MODEL.THREE_SIXTY) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (isLockedReviewStatus(rev.rows[0].status)) return { ok: false, errorCode: ERR.INVALID_STATUS };

  await db.query(
    `INSERT INTO formal_review_raters (
       review_id, company_id, role, external_name, external_email, external_title, status
     ) VALUES ($1, $2, '${FORMAL_RATER_ROLE.EXTERNAL}', $3, $4, $5, '${FORMAL_RATER_STATUS.PENDING}')
     ON CONFLICT (review_id, role) DO UPDATE
       SET external_name = EXCLUDED.external_name,
           external_email = EXCLUDED.external_email,
           external_title = EXCLUDED.external_title,
           updated_at = NOW()`,
    [rid, cid, name, email, title]
  );
  return { ok: true, review: await getFormalReviewDetail(db, { companyId: cid, reviewId: rid }) };
}

async function ensureRater(db, { reviewId, companyId, role, userId = null, candidateId = null, withToken = false, external = null }) {
  const token = withToken ? generateToken() : null;
  const expires = withToken ? addDaysIso(TOKEN_TTL_DAYS) : null;
  const res = await db.query(
    `INSERT INTO formal_review_raters (
       review_id, company_id, role, user_id, candidate_id,
       external_name, external_email, external_title,
       token, token_expires_at, status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, '${FORMAL_RATER_STATUS.PENDING}'
     )
     ON CONFLICT (review_id, role) DO UPDATE
       SET user_id = COALESCE(EXCLUDED.user_id, formal_review_raters.user_id),
           candidate_id = COALESCE(EXCLUDED.candidate_id, formal_review_raters.candidate_id),
           external_name = CASE WHEN EXCLUDED.external_name <> '' THEN EXCLUDED.external_name ELSE formal_review_raters.external_name END,
           external_email = CASE WHEN EXCLUDED.external_email <> '' THEN EXCLUDED.external_email ELSE formal_review_raters.external_email END,
           external_title = CASE WHEN EXCLUDED.external_title <> '' THEN EXCLUDED.external_title ELSE formal_review_raters.external_title END,
           token = COALESCE(formal_review_raters.token, EXCLUDED.token),
           token_expires_at = COALESCE(formal_review_raters.token_expires_at, EXCLUDED.token_expires_at),
           updated_at = NOW()
     RETURNING id, token`,
    [
      reviewId,
      companyId,
      role,
      userId,
      candidateId,
      external?.name || '',
      external?.email || '',
      external?.title || '',
      token,
      expires,
    ]
  );
  return res.rows[0];
}

/**
 * Why a draft review cannot open (null = it can). Single rule set for openFormalReview and
 * publishFormalReviewCycle. Dates are 'YYYY-MM-DD'; `today` defaults to the UTC day.
 */
export function formalReviewOpenError({
  status, itemCount, itemsWithoutSelf, includeSelf, hasQuestionnaire, periodStart, periodEnd,
  managerCandidateId, managerIsEmployee, subjectCandidateId, model, externalName, externalEmail,
  today = new Date().toISOString().slice(0, 10),
}) {
  if (status !== FORMAL_REVIEW_STATUS.DRAFT) return ERR.INVALID_STATUS;
  const invalid = !itemCount
    || (includeSelf && itemsWithoutSelf > 0)
    || !hasQuestionnaire
    || !periodStart
    || !periodEnd
    || periodEnd < today
    || !managerCandidateId
    || !managerIsEmployee
    || String(managerCandidateId) === String(subjectCandidateId)
    || (model === FORMAL_REVIEW_MODEL.THREE_SIXTY && (!externalName || !externalEmail));
  return invalid ? ERR.INVALID_DATA : null;
}

/** Open one draft review. The manager respondent is always the subject's manager (by e-mail → panel user). */
export async function openFormalReview(dbOrQuery, { companyId, reviewId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  if (!Number.isFinite(cid) || !Number.isFinite(rid)) return { ok: false, errorCode: ERR.INVALID_ID };

  const cycleLock = await db.query(`SELECT cy.status FROM formal_review_cycles cy JOIN formal_reviews r ON r.cycle_id = cy.id AND r.company_id = cy.company_id WHERE r.id = $1 AND r.company_id = $2 FOR UPDATE OF cy`, [rid, cid]);
  if (!cycleLock.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (cycleLock.rows[0].status === FORMAL_REVIEW_CYCLE_STATUS.CLOSED) return { ok: false, errorCode: ERR.INVALID_STATUS };

  const detail = await getFormalReviewDetail(db, { companyId: cid, reviewId: rid });
  if (!detail) return { ok: false, errorCode: ERR.NOT_FOUND };
  const manager = detail.managerCandidateId
    ? await db.query(`SELECT c.id, u.id AS "userId" FROM candidates c LEFT JOIN users u ON lower(u.email) = lower(c.email) AND u.company_id = c.company_id AND u.active = TRUE WHERE c.id = $1 AND c.company_id = $2 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`, [detail.managerCandidateId, cid])
    : { rowCount: 0, rows: [] };
  const ext = (detail.raters || []).find((r) => r.role === FORMAL_RATER_ROLE.EXTERNAL);
  const openError = formalReviewOpenError({
    status: detail.status,
    itemCount: detail.items?.length || 0,
    itemsWithoutSelf: (detail.items || []).filter(item => !item.selfDescription?.trim()).length,
    includeSelf: detail.includeSelf,
    hasQuestionnaire: detail.questionnaire.length > 0,
    periodStart: dateOrNull(detail.periodStart),
    periodEnd: dateOrNull(detail.periodEnd),
    managerCandidateId: detail.managerCandidateId,
    managerIsEmployee: manager.rowCount > 0,
    subjectCandidateId: detail.subjectCandidateId,
    model: detail.model,
    externalName: ext?.externalName,
    externalEmail: ext?.externalEmail,
  });
  if (openError) return { ok: false, errorCode: openError };
  const managerId = manager.rows[0].userId || null;

  await ensureRater(db, {
    reviewId: rid,
    companyId: cid,
    role: FORMAL_RATER_ROLE.MANAGER,
    userId: managerId,
    candidateId: detail.managerCandidateId,
    withToken: true,
  });

  if (detail.includeSelf) {
    await ensureRater(db, {
      reviewId: rid,
      companyId: cid,
      role: FORMAL_RATER_ROLE.SELF,
      candidateId: detail.subjectCandidateId,
      withToken: true,
    });
  }

  if (
    detail.model === FORMAL_REVIEW_MODEL.ONE_EIGHTY ||
    detail.model === FORMAL_REVIEW_MODEL.THREE_SIXTY
  ) {
    await ensureRater(db, {
      reviewId: rid,
      companyId: cid,
      role: FORMAL_RATER_ROLE.UPWARD,
      candidateId: detail.subjectCandidateId,
      withToken: true,
    });
  }

  if (detail.model === FORMAL_REVIEW_MODEL.THREE_SIXTY) {
    const ext = (detail.raters || []).find((r) => r.role === FORMAL_RATER_ROLE.EXTERNAL);
    await ensureRater(db, {
      reviewId: rid,
      companyId: cid,
      role: FORMAL_RATER_ROLE.EXTERNAL,
      withToken: true,
      external: {
        name: ext.externalName,
        email: ext.externalEmail,
        title: ext.externalTitle,
      },
    });
  }

  await db.query(
    `UPDATE formal_reviews
     SET status = '${FORMAL_REVIEW_STATUS.COLLECTING}',
         manager_user_id = $3,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [rid, cid, managerId]
  );
  await db.query(`UPDATE formal_review_raters SET token_expires_at = $2::date + INTERVAL '1 day' WHERE review_id = $1 AND company_id = $3 AND token IS NOT NULL`, [rid, dateOrNull(detail.periodEnd), cid]);
  await db.query(
    `UPDATE formal_review_cycles
     SET status = CASE WHEN status = '${FORMAL_REVIEW_CYCLE_STATUS.DRAFT}'
                       THEN '${FORMAL_REVIEW_CYCLE_STATUS.OPEN}' ELSE status END,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [detail.cycleId, cid]
  );

  return { ok: true, review: await getFormalReviewDetail(db, { companyId: cid, reviewId: rid }) };
}

export const RESPONDENTS_MATRIX_CAP = 200;

/**
 * Every review of a draft cycle with what the publish confirmation shows: subject, the
 * subject's manager (respondent of the manager row) and the external respondent (360).
 */
export async function listFormalCycleRespondents(dbOrQuery, { companyId, cycleId, limit = RESPONDENTS_MATRIX_CAP }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cyc = Number(cycleId);
  if (!Number.isSafeInteger(cid) || !Number.isSafeInteger(cyc)) return { ok: false, errorCode: ERR.INVALID_ID };
  const cap = Math.min(Math.max(1, Number(limit) || RESPONDENTS_MATRIX_CAP), RESPONDENTS_MATRIX_CAP);
  const cycle = await db.query(
    `SELECT model, include_self AS "includeSelf",
            (SELECT count(*)::int FROM formal_reviews r WHERE r.cycle_id = cy.id AND r.company_id = cy.company_id) AS total
     FROM formal_review_cycles cy WHERE cy.id = $1 AND cy.company_id = $2`,
    [cyc, cid]
  );
  if (!cycle.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const rows = await db.query(
    `SELECT r.id AS "reviewId", c.full_name AS "subjectName", manager.full_name AS "managerName",
            ext.external_name AS "externalName"
     FROM formal_reviews r
     JOIN candidates c ON c.id = r.subject_candidate_id AND c.company_id = r.company_id
     LEFT JOIN candidates manager ON manager.id = c.manager_candidate_id AND manager.company_id = r.company_id
     LEFT JOIN formal_review_raters ext ON ext.review_id = r.id AND ext.role = '${FORMAL_RATER_ROLE.EXTERNAL}'
     WHERE r.cycle_id = $1 AND r.company_id = $2
     ORDER BY r.id
     LIMIT $3`,
    [cyc, cid, cap]
  );
  const { model, includeSelf, total } = cycle.rows[0];
  return { ok: true, model, includeSelf: !!includeSelf, total: Number(total) || 0, items: rows.rows };
}

/**
 * Publish a draft cycle: same checks and writes as openFormalReview on every review, in a
 * fixed number of queries (one validation read, one rater upsert, three updates). Call
 * inside a transaction and roll back on `ok: false` (first failing review by id decides).
 */
export async function publishFormalReviewCycle(dbOrQuery, { companyId, cycleId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cyc = Number(cycleId);
  if (!Number.isSafeInteger(cid) || !Number.isSafeInteger(cyc)) return { ok: false, errorCode: ERR.INVALID_ID };

  const cycleRes = await db.query(
    `SELECT status, model, include_self AS "includeSelf",
            to_char(period_start, 'YYYY-MM-DD') AS "periodStart", to_char(period_end, 'YYYY-MM-DD') AS "periodEnd",
            EXISTS (SELECT 1 FROM formal_cycle_competencies q WHERE q.cycle_id = cy.id AND q.company_id = cy.company_id) AS "hasQuestionnaire"
     FROM formal_review_cycles cy WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [cyc, cid]
  );
  if (!cycleRes.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const cycle = cycleRes.rows[0];
  if (cycle.status !== FORMAL_REVIEW_CYCLE_STATUS.DRAFT) return { ok: false, errorCode: ERR.INVALID_STATUS };
  if (!cycle.periodStart || !cycle.periodEnd || !cycle.hasQuestionnaire) return { ok: false, errorCode: ERR.INVALID_DATA };

  const reviews = await db.query(
    `SELECT r.id, r.status, r.subject_candidate_id AS "subjectId",
            manager.id AS "managerCandidateId", manager.employment_status AS "managerStatus", mu.id AS "managerUserId",
            (SELECT count(*)::int FROM formal_review_items i WHERE i.review_id = r.id AND i.company_id = r.company_id) AS "itemCount",
            (SELECT count(*)::int FROM formal_review_items i WHERE i.review_id = r.id AND i.company_id = r.company_id
               AND btrim(i.self_description) = '') AS "itemsWithoutSelf",
            ext.external_name AS "externalName", ext.external_email AS "externalEmail", ext.external_title AS "externalTitle"
     FROM formal_reviews r
     JOIN candidates c ON c.id = r.subject_candidate_id AND c.company_id = r.company_id
     LEFT JOIN candidates manager ON manager.id = c.manager_candidate_id AND manager.company_id = r.company_id
     LEFT JOIN LATERAL (
       SELECT u.id FROM users u
       WHERE lower(u.email) = lower(manager.email) AND u.company_id = manager.company_id AND u.active = TRUE
       ORDER BY u.id LIMIT 1
     ) mu ON TRUE
     LEFT JOIN formal_review_raters ext ON ext.review_id = r.id AND ext.role = '${FORMAL_RATER_ROLE.EXTERNAL}'
     WHERE r.cycle_id = $1 AND r.company_id = $2
     ORDER BY r.id
     FOR UPDATE OF r`,
    [cyc, cid]
  );
  if (!reviews.rowCount) return { ok: false, errorCode: ERR.INVALID_DATA };

  const is360 = cycle.model === FORMAL_REVIEW_MODEL.THREE_SIXTY;
  const withUpward = cycle.model === FORMAL_REVIEW_MODEL.ONE_EIGHTY || is360;
  for (const r of reviews.rows) {
    const openError = formalReviewOpenError({
      status: r.status,
      itemCount: r.itemCount,
      itemsWithoutSelf: r.itemsWithoutSelf,
      includeSelf: cycle.includeSelf,
      hasQuestionnaire: cycle.hasQuestionnaire,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      managerCandidateId: r.managerCandidateId,
      managerIsEmployee: r.managerStatus === EMPLOYMENT_STATUS.EMPLOYEE,
      subjectCandidateId: r.subjectId,
      model: cycle.model,
      externalName: r.externalName,
      externalEmail: r.externalEmail,
    });
    if (openError) return { ok: false, errorCode: openError };
  }

  const raters = { reviewId: [], role: [], userId: [], candidateId: [], name: [], email: [], title: [], token: [] };
  const addRater = (reviewId, role, { userId = null, candidateId = null, external = null } = {}) => {
    raters.reviewId.push(reviewId);
    raters.role.push(role);
    raters.userId.push(userId);
    raters.candidateId.push(candidateId);
    raters.name.push(external?.name || '');
    raters.email.push(external?.email || '');
    raters.title.push(external?.title || '');
    raters.token.push(generateToken());
  };
  for (const r of reviews.rows) {
    addRater(r.id, FORMAL_RATER_ROLE.MANAGER, { userId: r.managerUserId || null, candidateId: r.managerCandidateId });
    if (cycle.includeSelf) addRater(r.id, FORMAL_RATER_ROLE.SELF, { candidateId: r.subjectId });
    if (withUpward) addRater(r.id, FORMAL_RATER_ROLE.UPWARD, { candidateId: r.subjectId });
    if (is360) addRater(r.id, FORMAL_RATER_ROLE.EXTERNAL, { external: { name: r.externalName, email: r.externalEmail, title: r.externalTitle } });
  }
  await db.query(
    `INSERT INTO formal_review_raters (
       review_id, company_id, role, user_id, candidate_id,
       external_name, external_email, external_title, token, token_expires_at, status
     )
     SELECT u.review_id, $1, u.role, u.user_id, u.candidate_id, u.name, u.email, u.title, u.token,
            $2::date + INTERVAL '1 day', '${FORMAL_RATER_STATUS.PENDING}'
     FROM unnest($3::bigint[], $4::text[], $5::bigint[], $6::bigint[], $7::text[], $8::text[], $9::text[], $10::text[])
          AS u(review_id, role, user_id, candidate_id, name, email, title, token)
     ON CONFLICT (review_id, role) DO UPDATE
       SET user_id = COALESCE(EXCLUDED.user_id, formal_review_raters.user_id),
           candidate_id = COALESCE(EXCLUDED.candidate_id, formal_review_raters.candidate_id),
           external_name = CASE WHEN EXCLUDED.external_name <> '' THEN EXCLUDED.external_name ELSE formal_review_raters.external_name END,
           external_email = CASE WHEN EXCLUDED.external_email <> '' THEN EXCLUDED.external_email ELSE formal_review_raters.external_email END,
           external_title = CASE WHEN EXCLUDED.external_title <> '' THEN EXCLUDED.external_title ELSE formal_review_raters.external_title END,
           token = COALESCE(formal_review_raters.token, EXCLUDED.token),
           token_expires_at = COALESCE(formal_review_raters.token_expires_at, EXCLUDED.token_expires_at),
           updated_at = NOW()`,
    [cid, cycle.periodEnd, raters.reviewId, raters.role, raters.userId, raters.candidateId, raters.name, raters.email, raters.title, raters.token]
  );

  const ids = reviews.rows.map(r => Number(r.id));
  await db.query(
    `UPDATE formal_reviews r
     SET status = '${FORMAL_REVIEW_STATUS.COLLECTING}', manager_user_id = u.manager_user_id, updated_at = NOW()
     FROM unnest($1::bigint[], $2::bigint[]) AS u(id, manager_user_id)
     WHERE r.id = u.id AND r.company_id = $3`,
    [ids, reviews.rows.map(r => r.managerUserId || null), cid]
  );
  await db.query(
    `UPDATE formal_review_raters SET token_expires_at = $2::date + INTERVAL '1 day'
     WHERE review_id = ANY($1::bigint[]) AND company_id = $3 AND token IS NOT NULL`,
    [ids, cycle.periodEnd, cid]
  );
  await db.query(
    `UPDATE formal_review_cycles SET status = '${FORMAL_REVIEW_CYCLE_STATUS.OPEN}', updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [cyc, cid]
  );
  return { ok: true, count: ids.length };
}

export async function submitManagerRatings(dbOrQuery, {
  companyId,
  reviewId,
  managerUserId,
  scores = [],
  overallNotes = '',
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  const cycle = await db.query(`SELECT cy.status, cy.period_start AS "periodStart", cy.period_end AS "periodEnd" FROM formal_review_cycles cy JOIN formal_reviews r ON r.cycle_id = cy.id AND r.company_id = cy.company_id WHERE r.id = $1 AND r.company_id = $2 FOR UPDATE OF cy`, [rid, cid]);
  if (!cycle.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const today = new Date().toISOString().slice(0, 10);
  const start = dateOrNull(cycle.rows[0].periodStart), end = dateOrNull(cycle.rows[0].periodEnd);
  if (cycle.rows[0].status !== 'open' || !start || !end || start > today || end < today) return { ok: false, errorCode: ERR.INVALID_STATUS };
  await db.query("SELECT id FROM formal_review_raters WHERE review_id = $1 AND company_id = $2 AND role = 'manager' FOR UPDATE", [rid, cid]);
  const detail = await getFormalReviewDetail(db, { companyId: cid, reviewId: rid });
  if (!detail) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (detail.status !== FORMAL_REVIEW_STATUS.COLLECTING) return { ok: false, errorCode: ERR.INVALID_STATUS };

  let rater = (detail.raters || []).find((r) => r.role === FORMAL_RATER_ROLE.MANAGER);
  if (!rater) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (detail.questionnaire.length && (!rater.userId || Number(rater.userId) !== Number(managerUserId))) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  if (rater.status === FORMAL_RATER_STATUS.SUBMITTED) return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };

  const itemIds = new Set(detail.items.map((i) => String(i.id)));
  const clean = [];
  for (const row of scores || []) {
    const itemId = Number(row.itemId);
    const score = Number(row.score);
    if (!itemIds.has(String(itemId))) continue;
    if (!Number.isInteger(score) || score < FORMAL_LIKERT_MIN || score > FORMAL_LIKERT_MAX) {
      return { ok: false, errorCode: ERR.INVALID_ANSWER_VALUE };
    }
    clean.push({
      itemId,
      score,
      notes: String(row.notes || '').trim().slice(0, SCORE_NOTES_MAX),
    });
  }
  if (clean.length !== detail.items.length || new Set(clean.map(item => item.itemId)).size !== detail.items.length) return { ok: false, errorCode: ERR.INCOMPLETE_ANSWERS };

  for (const row of clean) {
    await db.query(
      `INSERT INTO formal_review_scores (rater_id, item_id, company_id, score, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (rater_id, item_id) DO UPDATE
         SET score = EXCLUDED.score, notes = EXCLUDED.notes, updated_at = NOW()`,
      [rater.id, row.itemId, cid, row.score, row.notes]
    );
  }
  await db.query(
    `UPDATE formal_review_raters
     SET status = '${FORMAL_RATER_STATUS.SUBMITTED}',
         submitted_at = NOW(),
         user_id = COALESCE(user_id, $3),
         overall_notes = $4,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [rater.id, cid, managerUserId || null, String(overallNotes || '').trim().slice(0, NOTES_MAX)]
  );

  return { ok: true, review: await getFormalReviewDetail(db, { companyId: cid, reviewId: rid }) };
}

export async function finalizeFormalReview(dbOrQuery, { companyId, reviewId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  const detail = await getFormalReviewDetail(db, { companyId: cid, reviewId: rid });
  if (!detail) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (detail.status !== FORMAL_REVIEW_STATUS.COLLECTING) return { ok: false, errorCode: ERR.INVALID_STATUS };

  const required = (detail.raters || []).filter((r) =>
    [FORMAL_RATER_ROLE.MANAGER, FORMAL_RATER_ROLE.UPWARD, FORMAL_RATER_ROLE.SELF, FORMAL_RATER_ROLE.EXTERNAL].includes(
      r.role
    )
  );
  const pending = required.filter((r) => r.status !== FORMAL_RATER_STATUS.SUBMITTED);
  if (pending.length) return { ok: false, errorCode: ERR.INCOMPLETE_ANSWERS };

  await db.query(
    `UPDATE formal_reviews
     SET status = '${FORMAL_REVIEW_STATUS.FINALIZED}', finalized_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [rid, cid]
  );
  return { ok: true, review: await getFormalReviewDetail(db, { companyId: cid, reviewId: rid }) };
}

export async function sendFormalReviewToSubject(dbOrQuery, { companyId, reviewId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  const detail = await getFormalReviewDetail(db, { companyId: cid, reviewId: rid });
  if (!detail) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (detail.status !== FORMAL_REVIEW_STATUS.FINALIZED && detail.status !== FORMAL_REVIEW_STATUS.SENT) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }
  await db.query(
    `UPDATE formal_reviews
     SET status = '${FORMAL_REVIEW_STATUS.SENT}',
         sent_at = COALESCE(sent_at, NOW()),
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [rid, cid]
  );
  return { ok: true, review: await getFormalReviewDetail(db, { companyId: cid, reviewId: rid }) };
}

export async function archiveFormalReview(dbOrQuery, { companyId, reviewId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(reviewId);
  const detail = await getFormalReviewDetail(db, { companyId: cid, reviewId: rid });
  if (!detail) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (
    detail.status !== FORMAL_REVIEW_STATUS.FINALIZED &&
    detail.status !== FORMAL_REVIEW_STATUS.SENT &&
    detail.status !== FORMAL_REVIEW_STATUS.ARCHIVED
  ) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }
  await db.query(
    `UPDATE formal_reviews
     SET status = '${FORMAL_REVIEW_STATUS.ARCHIVED}',
         archived_at = COALESCE(archived_at, NOW()),
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [rid, cid]
  );
  return { ok: true, review: await getFormalReviewDetail(db, { companyId: cid, reviewId: rid }) };
}

// ── Public token ────────────────────────────────────────────────────────────

export async function resolveFormalRaterByToken(dbOrQuery, token) {
  const db = asDb(dbOrQuery);
  const tok = String(token || '').trim();
  if (tok.length < 16) return { ok: false, errorCode: ERR.INVALID_TOKEN };

  const res = await db.query(
    `SELECT rr.id AS "raterId", rr.role, rr.status AS "raterStatus",
            rr.token_expires_at AS "tokenExpiresAt",
            rr.external_name AS "externalName", rr.external_title AS "externalTitle",
            r.id AS "reviewId", r.company_id AS "companyId", r.status AS "reviewStatus",
            r.subject_candidate_id AS "subjectCandidateId",
            c.full_name AS "subjectName",
            cy.id AS "cycleId", cy.title AS "cycleTitle", cy.status AS "cycleStatus", cy.model, cy.instructions, cy.response_scale AS "responseScale", cy.period_start AS "periodStart", cy.period_end AS "periodEnd",
            rr.candidate_id AS "raterCandidateId", mc.full_name AS "managerName"
     FROM formal_review_raters rr
     JOIN formal_reviews r ON r.id = rr.review_id AND r.company_id = rr.company_id
     JOIN formal_review_cycles cy ON cy.id = r.cycle_id
     JOIN candidates c ON c.id = r.subject_candidate_id AND c.company_id = r.company_id
     LEFT JOIN formal_review_raters mr ON mr.review_id = r.id AND mr.company_id = r.company_id AND mr.role = 'manager'
     LEFT JOIN candidates mc ON mc.id = mr.candidate_id AND mc.company_id = r.company_id
     WHERE rr.token = $1
     LIMIT 1`,
    [tok]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.INVALID_TOKEN };
  const row = res.rows[0];
  if (row.cycleStatus === FORMAL_REVIEW_CYCLE_STATUS.CLOSED) return { ok: false, errorCode: ERR.INVALID_STATUS };
  if (row.role === FORMAL_RATER_ROLE.MANAGER && !row.raterCandidateId) return { ok: false, errorCode: ERR.INVALID_TOKEN };
  const today = new Date().toISOString().slice(0, 10);
  const start = row.periodStart ? new Date(row.periodStart).toISOString().slice(0, 10) : null;
  const end = row.periodEnd ? new Date(row.periodEnd).toISOString().slice(0, 10) : null;
  if ((start && today < start) || (end && today > end)) return { ok: false, errorCode: ERR.INVALID_STATUS };
  if (row.reviewStatus !== FORMAL_REVIEW_STATUS.COLLECTING) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }
  if (row.raterStatus === FORMAL_RATER_STATUS.SUBMITTED) {
    return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };
  }
  if (row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() < Date.now()) {
    await db.query(
      `UPDATE formal_review_raters SET status = '${FORMAL_RATER_STATUS.EXPIRED}', updated_at = NOW()
       WHERE id = $1 AND status = '${FORMAL_RATER_STATUS.PENDING}'`,
      [row.raterId]
    );
    return { ok: false, errorCode: ERR.EXPIRED };
  }

  const items = await db.query(
    `SELECT id, label, description, self_description AS "selfDescription", sort_order AS "sortOrder"
     FROM formal_review_items WHERE review_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [row.reviewId]
  );

  return {
    ok: true,
    raterId: row.raterId,
    role: row.role,
    cycleTitle: row.cycleTitle,
    model: row.model,
    subjectName: row.role === FORMAL_RATER_ROLE.UPWARD ? row.managerName : row.subjectName,
    instructions: row.instructions || '',
    responseScale: row.responseScale || 'agreement', openQuestions: await listCycleQuestions(db, row.cycleId),
    externalName: row.externalName || '',
    externalTitle: row.externalTitle || '',
    items: items.rows,
  };
}

export async function submitFormalRaterByToken(dbOrQuery, { token, scores = [], overallNotes = '', openAnswers = [] }) {
  const db = asDb(dbOrQuery);
  // Serialize submissions against cycle edits/closure and token reuse.
  await db.query(`SELECT cy.id FROM formal_review_cycles cy JOIN formal_reviews r ON r.cycle_id = cy.id JOIN formal_review_raters rr ON rr.review_id = r.id WHERE rr.token = $1 FOR UPDATE OF cy`, [String(token || '').trim()]);
  await db.query('SELECT id FROM formal_review_raters WHERE token = $1 FOR UPDATE', [String(token || '').trim()]);
  const resolved = await resolveFormalRaterByToken(db, token);
  if (!resolved.ok) return resolved;
  const questionIds = new Set(resolved.openQuestions.map(question => String(question.id)));
  if (!Array.isArray(scores) || !Array.isArray(openAnswers) || openAnswers.length > questionIds.size || new Set(openAnswers.map(answer => String(answer?.questionId))).size !== openAnswers.length || openAnswers.some(answer => !questionIds.has(String(answer?.questionId)) || typeof answer?.answer !== 'string' || answer.answer.length > 4000)) return { ok: false, errorCode: ERR.INVALID_DATA };

  const itemIds = new Set(resolved.items.map((i) => String(i.id)));
  const clean = [];
  for (const row of scores || []) {
    const itemId = Number(row.itemId);
    const score = Number(row.score);
    if (!itemIds.has(String(itemId))) continue;
    if (!Number.isInteger(score) || score < FORMAL_LIKERT_MIN || score > FORMAL_LIKERT_MAX) {
      return { ok: false, errorCode: ERR.INVALID_ANSWER_VALUE };
    }
    clean.push({
      itemId,
      score,
      notes: String(row.notes || '').trim().slice(0, SCORE_NOTES_MAX),
    });
  }
  if (clean.length !== resolved.items.length || new Set(clean.map(item => item.itemId)).size !== resolved.items.length) return { ok: false, errorCode: ERR.INCOMPLETE_ANSWERS };

  const meta = await db.query(
    `SELECT company_id AS "companyId" FROM formal_review_raters WHERE id = $1`,
    [resolved.raterId]
  );
  const companyId = meta.rows[0].companyId;

  for (const row of clean) {
    await db.query(
      `INSERT INTO formal_review_scores (rater_id, item_id, company_id, score, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (rater_id, item_id) DO UPDATE
         SET score = EXCLUDED.score, notes = EXCLUDED.notes, updated_at = NOW()`,
      [resolved.raterId, row.itemId, companyId, row.score, row.notes]
    );
  }
  for (const answer of openAnswers) {
    await db.query('INSERT INTO formal_review_open_answers (rater_id, question_id, answer) VALUES ($1,$2,$3)', [resolved.raterId, answer.questionId, answer.answer.trim()]);
  }
  await db.query(
    `UPDATE formal_review_raters
     SET status = '${FORMAL_RATER_STATUS.SUBMITTED}',
         submitted_at = NOW(),
         overall_notes = $2,
         updated_at = NOW()
     WHERE id = $1 AND status = '${FORMAL_RATER_STATUS.PENDING}'`,
    [resolved.raterId, String(overallNotes || '').trim().slice(0, NOTES_MAX)]
  );
  return { ok: true };
}

export async function listSentFormalReviewsForEmployee(dbOrQuery, { companyId, candidateId, limit = 10 } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const sid = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(sid)) return [];
  const cap = Math.min(Math.max(1, Number(limit) || 10), 20);
  const res = await db.query(
    `SELECT r.id, r.status, r.sent_at AS "sentAt",
            cy.title AS "cycleTitle", cy.model
     FROM formal_reviews r
     JOIN formal_review_cycles cy ON cy.id = r.cycle_id
     WHERE r.company_id = $1 AND r.subject_candidate_id = $2
       AND r.status = '${FORMAL_REVIEW_STATUS.SENT}'
     ORDER BY r.sent_at DESC NULLS LAST, r.id DESC
     LIMIT $3`,
    [cid, sid, cap]
  );
  return res.rows;
}

/** Subject view after RH sends results (no tokens / external e-mail). */
export async function getSentFormalReviewForEmployee(dbOrQuery, { companyId, candidateId, reviewId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const sid = Number(candidateId);
  const rid = Number(reviewId);
  if (!Number.isFinite(cid) || !Number.isFinite(sid) || !Number.isFinite(rid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const detail = await getFormalReviewDetail(db, { companyId: cid, reviewId: rid });
  if (
    !detail ||
    Number(detail.subjectCandidateId) !== sid ||
    detail.status !== FORMAL_REVIEW_STATUS.SENT
  ) {
    return { ok: false, errorCode: ERR.NOT_FOUND };
  }
  return {
    ok: true,
    review: {
      id: detail.id,
      cycleTitle: detail.cycleTitle,
      model: detail.model,
      includeSelf: detail.includeSelf,
      periodStart: detail.periodStart,
      periodEnd: detail.periodEnd,
      responseScale: detail.responseScale,
      openQuestions: detail.openQuestions,
      sentAt: detail.sentAt,
      items: detail.items,
      raters: (detail.raters || []).map((r) => ({
        id: r.id,
        role: r.role,
        status: r.status,
        submittedAt: r.submittedAt,
        overallNotes: r.overallNotes,
        openAnswers: r.openAnswers,
        externalTitle: r.externalTitle || '',
      })),
      scores: detail.scores,
    },
  };
}

export const FORMAL_REVIEW_CAPS = {
  LIST_CAP,
  ITEMS_CAP,
  TOKEN_TTL_DAYS,
  LIKERT_MIN: FORMAL_LIKERT_MIN,
  LIKERT_MAX: FORMAL_LIKERT_MAX,
};
