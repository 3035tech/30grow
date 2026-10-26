/**
 * Vacancy client reports — strong public token + immutable snapshot.
 */

import crypto from 'node:crypto';
import { query, queryRead } from '../db.js';
import { computeAreaScore010 } from '../assessment/area-fit.js';
import { htmlToPlainText, isRichTextEmpty, sanitizeRichTextHtml } from '../sanitize-html.js';
import {
  REPORT_NOTE_MIN_CHARS,
  CONSULTANT_NOTE_MAX_CHARS,
  STRUCTURED_FIELD_MAX_CHARS,
  fitTypeAlignment,
  isExcludedFromClientShortlist,
  normalizeRecommendation,
  normalizeReportWeights,
  recommendationFromStage,
  rubricWeightedTypes,
} from './vacancy-report-shared.js';
import { MOTIVATORS_DIMENSIONS } from '../ae/motivators-dimensions.js';

export {
  REPORT_NOTE_MIN_CHARS,
  CONSULTANT_NOTE_MAX_CHARS,
  STRUCTURED_FIELD_MAX_CHARS,
  REPORT_RECOMMENDATIONS,
  fitTypeAlignment,
  isExcludedFromClientShortlist,
  normalizeRecommendation,
  recommendationFromStage,
  rubricWeightedTypes,
} from './vacancy-report-shared.js';

export const REPORT_EXPIRY_DAYS = [7, 14, 30];
export const DEFAULT_REPORT_EXPIRY_DAYS = 14;

function normalizeScores(scores) {
  if (!scores || typeof scores !== 'object') return {};
  const out = {};
  for (let t = 1; t <= 9; t += 1) {
    const v = scores[t] ?? scores[String(t)];
    const n = typeof v === 'number' ? v : parseFloat(v);
    out[t] = Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }
  return out;
}

function cleanStructuredField(raw, max = STRUCTURED_FIELD_MAX_CHARS) {
  const plain = htmlToPlainText(raw).replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  return plain.slice(0, max);
}

function cleanConsultantNote(raw) {
  return cleanStructuredField(raw, CONSULTANT_NOTE_MAX_CHARS);
}

function topMotivatorsFromAttempt(ranking, dimensionScores, limit = 3) {
  const scores = dimensionScores && typeof dimensionScores === 'object' ? dimensionScores : {};
  let keys = [];
  if (Array.isArray(ranking) && ranking.length) {
    keys = ranking
      .map((item) => (typeof item === 'string' ? item : item?.key))
      .filter(Boolean);
  }
  if (!keys.length) {
    keys = Object.keys(scores).sort((a, b) => Number(scores[b] || 0) - Number(scores[a] || 0));
  }
  const labelByKey = new Map(MOTIVATORS_DIMENSIONS.map((d) => [d.key, d.label]));
  return keys.slice(0, limit).map((key) => ({
    key,
    label: labelByKey.get(key) || key,
    score: Math.round(Number(scores[key]) || 0),
  }));
}

/**
 * Load vacancy + assessed candidates (with fit) for report building.
 */
export async function loadVacancyReportSource(vacancyId, { isAdmin, companyId }) {
  const own = await queryRead(
    `SELECT v.id, v.title, v.positions_count AS "positionsCount", v.status,
            v.description,
            v.client_report_show_salary AS "clientReportShowSalary",
            v.company_id AS "companyId", co.name AS "companyName",
            co.logo_url AS "companyLogoUrl"
     FROM vacancies v
     JOIN companies co ON co.id = v.company_id AND co.deleted = FALSE
     WHERE v.id = $1 AND v.deleted = FALSE ${!isAdmin ? 'AND v.company_id = $2' : ''}
     LIMIT 1`,
    !isAdmin ? [vacancyId, companyId] : [vacancyId]
  );
  if (own.rowCount === 0) return null;
  const vacancy = own.rows[0];

  const rub = await queryRead(
    `SELECT desired_type_weights AS weights, notes
     FROM vacancy_rubrics WHERE vacancy_id = $1 LIMIT 1`,
    [vacancyId]
  );
  const rubricWeights = normalizeReportWeights(
    rub.rows?.[0]?.weights && Object.keys(rub.rows[0].weights).length ? rub.rows[0].weights : {}
  );
  const rubricNotesRaw = rub.rows?.[0]?.notes != null ? String(rub.rows[0].notes).trim() : '';
  const rubricNotes = rubricNotesRaw || null;

  const rows = await queryRead(
    `SELECT
       c.id AS "candidateId",
       c.full_name AS name,
       c.city,
       c.state,
       c.salary_expectation AS "salaryExpectation",
       c.availability,
       ass.top_type AS "topType",
       ass.scores,
       ass.pipeline_stage AS "pipelineStage",
       COALESCE(cps.canonical_key, ass.pipeline_stage) AS "canonicalStage",
       ar.label AS "areaLabel",
       ass.created_at AS "createdAt"
     FROM assessments ass
     JOIN candidates c ON c.id = ass.candidate_id
     JOIN areas ar ON ar.id = ass.area_id
     LEFT JOIN company_pipeline_stages cps
       ON cps.company_id = ass.company_id
      AND cps.stage_key = ass.pipeline_stage
      AND cps.deleted_at IS NULL
     WHERE ass.vacancy_id = $1
       ${!isAdmin ? 'AND ass.company_id = $2' : ''}
     ORDER BY ass.created_at DESC
     LIMIT 500`,
    !isAdmin ? [vacancyId, companyId] : [vacancyId]
  );

  const candidateIds = [...new Set(rows.rows.map((r) => Number(r.candidateId)).filter((n) => Number.isFinite(n)))];
  const motivatorsByCandidate = new Map();
  if (candidateIds.length) {
    const mot = await queryRead(
      `SELECT DISTINCT ON (a.candidate_id)
         a.candidate_id AS "candidateId",
         a.ranking,
         a.dimension_scores AS "dimensionScores"
       FROM ae_attempts a
       JOIN ae_definitions d ON d.id = a.definition_id AND d.slug = 'motivators'
       WHERE a.company_id = $1
         AND a.candidate_id = ANY($2::bigint[])
         AND a.status = 'completed'
       ORDER BY a.candidate_id, a.completed_at DESC NULLS LAST`,
      [vacancy.companyId, candidateIds]
    );
    for (const row of mot.rows) {
      motivatorsByCandidate.set(
        Number(row.candidateId),
        topMotivatorsFromAttempt(row.ranking, row.dimensionScores, 3)
      );
    }
  }

  const people = rows.rows.map((r) => {
    const scores = normalizeScores(r.scores);
    const fit = computeAreaScore010(scores, rubricWeights);
    const align = fitTypeAlignment(scores, rubricWeights);
    const cid = Number(r.candidateId);
    const topMot = motivatorsByCandidate.get(cid) || [];
    return {
      candidateId: cid,
      name: r.name,
      city: r.city || null,
      state: r.state || null,
      salaryExpectation: r.salaryExpectation || null,
      availability: r.availability || null,
      topType: r.topType,
      scores,
      pipelineStage: r.pipelineStage,
      canonicalStage: r.canonicalStage || r.pipelineStage,
      recommendation: recommendationFromStage(r.canonicalStage || r.pipelineStage),
      areaLabel: r.areaLabel || '',
      vacancyFitScore010: fit.score010,
      vacancyFitLabel: fit.label,
      fitAlignedTypes: align.alignedTypes,
      fitGapTypes: align.gapTypes,
      motivatorsTop: topMot,
      createdAt: r.createdAt,
    };
  });

  people.sort((a, b) => {
    const av = a.vacancyFitScore010;
    const bv = b.vacancyFitScore010;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  return { vacancy, people, rubricWeights, rubricNotes };
}

/**
 * @param {object} vacancy
 * @param {object[]} selectedPeople
 * @param {{ executiveNote?: string, rubricWeights?: object, rubricNotes?: string|null, candidateOverrides?: object }} opts
 */
export function buildReportSnapshot(vacancy, selectedPeople, opts = {}) {
  const note = sanitizeRichTextHtml(opts.executiveNote, 8000);
  const weightedTypes = rubricWeightedTypes(opts.rubricWeights || {});
  const description = sanitizeRichTextHtml(vacancy.description, 12000);
  const rubricNotesPlain = opts.rubricNotes
    ? String(opts.rubricNotes).trim().slice(0, 2000) || null
    : null;
  const overrides = opts.candidateOverrides && typeof opts.candidateOverrides === 'object'
    ? opts.candidateOverrides
    : {};
  const hasRubric = weightedTypes.length > 0;
  const showSalary = Boolean(opts.showSalaryExpectation ?? vacancy.clientReportShowSalary);

  return {
    generatedAt: new Date().toISOString(),
    vacancy: {
      id: Number(vacancy.id),
      title: vacancy.title,
      companyName: vacancy.companyName,
      companyLogoUrl: vacancy.companyLogoUrl
        ? String(vacancy.companyLogoUrl).trim() || null
        : null,
      positionsCount: Number(vacancy.positionsCount) || 1,
      status: vacancy.status,
      description: description && !isRichTextEmpty(description) ? description : null,
    },
    privacy: {
      showSalaryExpectation: showSalary,
    },
    rubricSummary: {
      hasRubric,
      weightedTypes,
      notes: rubricNotesPlain,
    },
    executiveNote: note && !isRichTextEmpty(note) ? note : null,
    candidates: selectedPeople.map((p) => {
      const ov = overrides[String(p.candidateId)] || overrides[p.candidateId] || {};
      const baseRec = p.recommendation || recommendationFromStage(p.canonicalStage || p.pipelineStage);
      const why = cleanStructuredField(ov.why ?? ov.whyAdvance);
      const watchOut = cleanStructuredField(ov.watchOut ?? ov.alert);
      const interviewProbe = cleanStructuredField(ov.interviewProbe ?? ov.probe);
      const legacyNote = cleanConsultantNote(ov.note);
      return {
        name: p.name,
        topType: p.topType,
        scores: p.scores,
        pipelineStage: p.pipelineStage,
        recommendation: normalizeRecommendation(ov.recommendation, baseRec),
        why: why || (!watchOut && !interviewProbe ? legacyNote : null),
        watchOut,
        interviewProbe,
        consultantNote: legacyNote,
        city: p.city || null,
        state: p.state || null,
        salaryExpectation: showSalary ? p.salaryExpectation || null : null,
        availability: p.availability || null,
        areaLabel: p.areaLabel || '',
        vacancyFitScore010: hasRubric ? p.vacancyFitScore010 : null,
        vacancyFitLabel: hasRubric ? p.vacancyFitLabel : null,
        fitAlignedTypes: hasRubric && Array.isArray(p.fitAlignedTypes) ? p.fitAlignedTypes : [],
        fitGapTypes: hasRubric && Array.isArray(p.fitGapTypes) ? p.fitGapTypes : [],
        motivatorsTop: Array.isArray(p.motivatorsTop) ? p.motivatorsTop : [],
      };
    }),
  };
}

/**
 * @returns {Promise<{ id: number, token: string, expiresAt: Date, snapshot: object }>}
 */
export async function createReportShare({
  vacancyId,
  companyId,
  userId,
  candidateIds,
  expiresInDays = DEFAULT_REPORT_EXPIRY_DAYS,
  executiveNote = '',
  title = null,
  candidateOverrides = {},
  isAdmin,
  sessionCompanyId,
}) {
  const days = REPORT_EXPIRY_DAYS.includes(Number(expiresInDays))
    ? Number(expiresInDays)
    : DEFAULT_REPORT_EXPIRY_DAYS;

  const plainNote = htmlToPlainText(executiveNote);
  if (plainNote.length < REPORT_NOTE_MIN_CHARS) {
    const err = new Error('NOTE_TOO_SHORT');
    err.code = 'NOTE_TOO_SHORT';
    throw err;
  }

  const ids = [...new Set((candidateIds || []).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n)))];
  if (!ids.length) {
    const err = new Error('NO_CANDIDATES');
    err.code = 'NO_CANDIDATES';
    throw err;
  }

  const source = await loadVacancyReportSource(vacancyId, {
    isAdmin,
    companyId: sessionCompanyId,
  });
  if (!source) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const idSet = new Set(ids);
  const selected = source.people.filter(
    (p) => idSet.has(p.candidateId) && !isExcludedFromClientShortlist(p.canonicalStage || p.pipelineStage)
  );
  if (!selected.length) {
    const err = new Error('NO_CANDIDATES');
    err.code = 'NO_CANDIDATES';
    throw err;
  }

  const snapshot = buildReportSnapshot(source.vacancy, selected, {
    executiveNote,
    rubricWeights: source.rubricWeights,
    rubricNotes: source.rubricNotes,
    candidateOverrides,
    showSalaryExpectation: Boolean(source.vacancy.clientReportShowSalary),
  });
  const token = crypto.randomBytes(32).toString('hex');
  const reportTitle = String(title || source.vacancy.title || '').trim().slice(0, 200) || source.vacancy.title;

  const ins = await query(
    `INSERT INTO vacancy_report_shares (
       vacancy_id, company_id, token, title, executive_note, snapshot,
       active, expires_at, created_by_user_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6::jsonb,
       TRUE, NOW() + ($7::text || ' days')::interval, $8
     )
     RETURNING id, token, expires_at AS "expiresAt", snapshot`,
    [
      vacancyId,
      companyId ?? source.vacancy.companyId,
      token,
      reportTitle,
      snapshot.executiveNote,
      JSON.stringify(snapshot),
      String(days),
      userId || null,
    ]
  );

  return ins.rows[0];
}

export async function listReportShares(vacancyId, { isAdmin, companyId }) {
  const r = await queryRead(
    `SELECT
       s.id,
       s.title,
       s.token,
       s.active,
       s.expires_at AS "expiresAt",
       s.created_at AS "createdAt",
       s.executive_note AS "executiveNote",
       jsonb_array_length(COALESCE(s.snapshot->'candidates', '[]'::jsonb)) AS "candidateCount",
       (s.active AND s.expires_at > NOW()) AS "isLive"
     FROM vacancy_report_shares s
     JOIN vacancies v ON v.id = s.vacancy_id AND v.deleted = FALSE
     WHERE s.vacancy_id = $1
       ${!isAdmin ? 'AND s.company_id = $2 AND v.company_id = $2' : ''}
     ORDER BY s.created_at DESC
     LIMIT 50`,
    !isAdmin ? [vacancyId, companyId] : [vacancyId]
  );
  return r.rows;
}

export async function revokeReportShare(vacancyId, reportId, { isAdmin, companyId }) {
  const r = await query(
    `UPDATE vacancy_report_shares s
     SET active = FALSE, updated_at = NOW()
     FROM vacancies v
     WHERE s.id = $1
       AND s.vacancy_id = $2
       AND v.id = s.vacancy_id
       AND v.deleted = FALSE
       ${!isAdmin ? 'AND s.company_id = $3 AND v.company_id = $3' : ''}
     RETURNING s.id`,
    !isAdmin ? [reportId, vacancyId, companyId] : [reportId, vacancyId]
  );
  return r.rowCount > 0;
}

/**
 * Update live report metadata (title + executive note). Snapshot stays frozen.
 * @returns {Promise<object|null>}
 */
export async function updateReportShareMeta(vacancyId, reportId, { isAdmin, companyId, title, executiveNote }) {
  const nextTitle =
    title !== undefined ? String(title || '').trim().slice(0, 200) || null : undefined;
  const nextNote =
    executiveNote !== undefined
      ? sanitizeRichTextHtml(executiveNote, 8000)
      : undefined;

  if (nextNote !== undefined) {
    const plain = htmlToPlainText(nextNote);
    if (plain.length < REPORT_NOTE_MIN_CHARS) {
      const err = new Error('REPORT_NOTE_TOO_SHORT');
      err.code = 'REPORT_NOTE_TOO_SHORT';
      throw err;
    }
  }

  const sets = [];
  const params = [];
  let i = 1;
  params.push(reportId);
  const idI = i++;
  params.push(vacancyId);
  const vacI = i++;

  if (nextTitle !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(nextTitle);
  }
  if (nextNote !== undefined) {
    sets.push(`executive_note = $${i++}`);
    params.push(nextNote && !isRichTextEmpty(nextNote) ? nextNote : null);
  }
  if (!sets.length) return null;

  sets.push('updated_at = NOW()');
  let companyClause = '';
  if (!isAdmin) {
    companyClause = `AND s.company_id = $${i} AND v.company_id = $${i}`;
    params.push(companyId);
  }

  const r = await query(
    `UPDATE vacancy_report_shares s
     SET ${sets.join(', ')}
     FROM vacancies v
     WHERE s.id = $${idI}
       AND s.vacancy_id = $${vacI}
       AND v.id = s.vacancy_id
       AND v.deleted = FALSE
       AND s.active = TRUE
       AND s.expires_at > NOW()
       ${companyClause}
     RETURNING s.id, s.title, s.executive_note AS "executiveNote",
               s.expires_at AS "expiresAt", s.updated_at AS "updatedAt"`,
    params
  );
  return r.rows[0] || null;
}

/**
 * Public fetch — active + not expired.
 */
export async function getReportByToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 32) return null;

  const r = await queryRead(
    `SELECT
       s.id,
       s.title,
       s.snapshot,
       s.expires_at AS "expiresAt",
       s.created_at AS "createdAt",
       s.executive_note AS "executiveNote"
     FROM vacancy_report_shares s
     JOIN vacancies v ON v.id = s.vacancy_id AND v.deleted = FALSE
     JOIN companies c ON c.id = s.company_id AND c.deleted = FALSE
     WHERE s.token = $1
       AND s.active = TRUE
       AND s.expires_at > NOW()
     LIMIT 1`,
    [raw]
  );
  if (r.rowCount === 0) return null;
  return r.rows[0];
}
