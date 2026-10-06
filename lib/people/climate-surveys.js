/**
 * Climate surveys — company campaigns; anonymous responses via invite token.
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { CLIMATE_QUESTION_KIND, CLIMATE_QUESTION_KINDS, CLIMATE_SURVEY_STATUS } from '../domain-status.js';
import { isMailConfigured, sendTransactionalMail } from '../mail.js';
import { MAIL_SEND_CONCURRENCY, mapWithConcurrency } from '../concurrency.js';
import { extractClimateThemes } from './climate-themes.js';
import { isRichTextEmpty, sanitizeRichTextHtml } from '../sanitize-html.js';
import { t as i18nT } from '../i18n.js';

export { climateMeanLevel, buildClimateTrendChart } from './climate-viz.js';

const TITLE_MAX = 200;
const DESC_MAX = 4000;
const PROMPT_MAX = 500;
const LIST_CAP = 40;
const QUESTIONS_CAP = 20;
const INVITE_TTL_DAYS = 45;
const INVITE_BATCH_CAP = 50;
const TEXT_ANSWER_MAX = 1500;
const TEXT_ANSWER_MIN = 5;
const TEXT_ANSWERS_CAP = 200;
/** Max responses per survey used in aggregate / benchmark (hot path cap). */
const AGGREGATE_RESPONSE_CAP = 5000;
const QUESTION_KINDS = new Set(CLIMATE_QUESTION_KINDS);
/** B-506 — hide means until this many responses (override via CLIMATE_MIN_RESPONSES). */
export function climateMinResponses() {
  const n = parseInt(String(process.env.CLIMATE_MIN_RESPONSES || '5'), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : 5;
}

/** Default Likert prompts (pt-BR) for new drafts — hedged workplace climate. */

const SURVEY_STATUSES = new Set(Object.values(CLIMATE_SURVEY_STATUS));

/** Default Likert prompts (pt-BR) for new drafts — hedged workplace climate. */
export const DEFAULT_CLIMATE_PROMPTS_PT = Object.freeze([
  'Em geral, sinto que posso contribuir com o meu melhor no dia a dia.',
  'Tenho clareza sobre o que se espera do meu trabalho.',
  'Sinto que há espaço para falar sobre dificuldades sem retaliação.',
  'Percebo reconhecimento quando entrego resultados relevantes.',
  'O ritmo e a carga de trabalho tendem a ser sustentáveis para mim.',
]);

/** Default open-text prompts (pt-BR) — qualitative insights beyond Likert. */
export const DEFAULT_CLIMATE_TEXT_PROMPTS_PT = Object.freeze([
  'Se quiser, conte em poucas palavras o que mais ajuda você a trabalhar bem por aqui.',
  'O que tende a dificultar o seu dia a dia no trabalho, se houver algo relevante?',
]);

function normalizeQuestionKind(raw, fallback = CLIMATE_QUESTION_KIND.LIKERT) {
  const k = String(raw || '').trim().toLowerCase();
  return QUESTION_KINDS.has(k) ? k : fallback;
}

/** Scale bounds per question kind (enps fixed 0–10). */
function scaleBoundsForKind(kind) {
  if (kind === CLIMATE_QUESTION_KIND.ENPS) return { scaleMin: 0, scaleMax: 10 };
  return { scaleMin: 1, scaleMax: 5 };
}

/**
 * Classic eNPS: (% promoters 9–10 − % detractors 0–6), range −100…100.
 * @param {number[]} values
 */
export function computeEnpsScore(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
  if (!nums.length) return null;
  const promoters = nums.filter((n) => n >= 9).length;
  const detractors = nums.filter((n) => n <= 6).length;
  const pctProm = (promoters / nums.length) * 100;
  const pctDet = (detractors / nums.length) * 100;
  return Math.round((pctProm - pctDet) * 10) / 10;
}

function mapQuestionRow(row) {
  return {
    id: row.id,
    surveyId: row.surveyId,
    companyId: row.companyId,
    prompt: row.prompt,
    sortOrder: row.sortOrder,
    scaleMin: row.scaleMin,
    scaleMax: row.scaleMax,
    active: row.active,
    questionKind: normalizeQuestionKind(row.questionKind, CLIMATE_QUESTION_KIND.LIKERT),
  };
}

function shuffleCopy(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function roundClimateMean(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function overallMeanFromByQuestion(byQuestion) {
  const means = (byQuestion || [])
    .filter((q) => String(q.questionKind || '').toLowerCase() !== CLIMATE_QUESTION_KIND.ENPS)
    .map((q) => q.mean)
    .filter((m) => m != null);
  return means.length > 0
    ? roundClimateMean(means.reduce((a, b) => a + b, 0) / means.length)
    : null;
}

function enpsScoreFromCounts({ responses, promoters, detractors }) {
  const n = Number(responses) || 0;
  if (n <= 0) return null;
  const pctProm = ((Number(promoters) || 0) / n) * 100;
  const pctDet = ((Number(detractors) || 0) / n) * 100;
  return Math.round((pctProm - pctDet) * 10) / 10;
}

function mapLikertAggregateRows(rows) {
  return (rows || []).map((r) => {
    const kind = normalizeQuestionKind(r.questionKind, CLIMATE_QUESTION_KIND.LIKERT);
    const responses = Number(r.responses) || 0;
    const base = {
      questionId: r.questionId,
      prompt: r.prompt,
      questionKind: kind,
      scaleMin: r.scaleMin,
      scaleMax: r.scaleMax,
      responses,
    };
    if (kind === CLIMATE_QUESTION_KIND.ENPS) {
      return {
        ...base,
        mean: null,
        enpsScore: enpsScoreFromCounts({
          responses,
          promoters: r.promoters,
          detractors: r.detractors,
        }),
      };
    }
    return {
      ...base,
      mean: roundClimateMean(r.meanRaw),
      enpsScore: null,
    };
  });
}

/** SQL: Likert means for one survey (capped responses). */
async function fetchSurveyLikertAggregateSql(db, { companyId, surveyId }) {
  const res = await db.query(
    `WITH capped AS (
       SELECT answers
       FROM climate_survey_responses
       WHERE survey_id = $1 AND company_id = $2
       ORDER BY submitted_at DESC
       LIMIT $3
     ),
     response_count AS (
       SELECT COUNT(*)::int AS n FROM capped
     )
     SELECT
       q.id AS "questionId",
       q.prompt,
       q.scale_min AS "scaleMin",
       q.scale_max AS "scaleMax",
       COALESCE(q.question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') AS "questionKind",
       COUNT(*) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
       )::int AS responses,
       AVG((c.answers ->> q.id::text)::numeric) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
       ) AS "meanRaw",
       COUNT(*) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
           AND (c.answers ->> q.id::text)::numeric >= 9
       )::int AS promoters,
       COUNT(*) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
           AND (c.answers ->> q.id::text)::numeric <= 6
       )::int AS detractors,
       rc.n AS "responseCount"
     FROM climate_survey_questions q
     CROSS JOIN response_count rc
     LEFT JOIN capped c ON TRUE
     WHERE q.survey_id = $1 AND q.company_id = $2 AND q.active = TRUE
       AND COALESCE(q.question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') <> '${CLIMATE_QUESTION_KIND.TEXT}'
     GROUP BY q.id, q.prompt, q.sort_order, q.scale_min, q.scale_max, q.question_kind, rc.n
     ORDER BY q.sort_order ASC, q.id ASC`,
    [surveyId, companyId, AGGREGATE_RESPONSE_CAP]
  );
  const responseCount = Number(res.rows[0]?.responseCount) || 0;
  return { responseCount, byQuestion: mapLikertAggregateRows(res.rows) };
}

/** Mean eNPS across enps questions in one survey (null if none). */
function overallEnpsFromByQuestion(byQuestion) {
  const scores = (byQuestion || [])
    .filter((q) => String(q.questionKind || '').toLowerCase() === CLIMATE_QUESTION_KIND.ENPS)
    .map((q) => q.enpsScore)
    .filter((s) => s != null);
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

/** SQL: open-text answers for one survey (capped); shuffle/sample in Node. */
async function fetchSurveyTextAnswersSql(db, { companyId, surveyId }) {
  const res = await db.query(
    `WITH capped AS (
       SELECT answers
       FROM climate_survey_responses
       WHERE survey_id = $1 AND company_id = $2
       ORDER BY submitted_at DESC
       LIMIT $3
     )
     SELECT
       q.id AS "questionId",
       q.prompt,
       COALESCE(
         array_agg(
           LEFT(trim(c.answers ->> q.id::text), $5)
         ) FILTER (
           WHERE jsonb_typeof(c.answers -> q.id::text) = 'string'
             AND length(trim(c.answers ->> q.id::text)) >= $4
         ),
         ARRAY[]::text[]
       ) AS texts
     FROM climate_survey_questions q
     LEFT JOIN capped c ON TRUE
     WHERE q.survey_id = $1 AND q.company_id = $2 AND q.active = TRUE
       AND q.question_kind = '${CLIMATE_QUESTION_KIND.TEXT}'
     GROUP BY q.id, q.prompt, q.sort_order
     ORDER BY q.sort_order ASC, q.id ASC`,
    [surveyId, companyId, AGGREGATE_RESPONSE_CAP, TEXT_ANSWER_MIN, TEXT_ANSWER_MAX]
  );
  return res.rows.map((r) => {
    const shuffled = shuffleCopy(Array.isArray(r.texts) ? r.texts : []).slice(0, TEXT_ANSWERS_CAP);
    return {
      questionId: r.questionId,
      prompt: r.prompt,
      questionKind: CLIMATE_QUESTION_KIND.TEXT,
      responses: shuffled.length,
      answers: shuffled,
    };
  });
}

/**
 * Batch Likert aggregates for multiple surveys — one query (benchmark hot path).
 * @returns {Map<number, { responseCount: number, byQuestion: object[], overallMean: number|null }>}
 */
async function fetchBatchLikertAggregatesSql(db, { companyId, surveyIds }) {
  const ids = [...new Set(
    (Array.isArray(surveyIds) ? surveyIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];
  const out = new Map();
  if (!ids.length) return out;

  const res = await db.query(
    `WITH capped AS (
       SELECT survey_id, answers
       FROM (
         SELECT r.survey_id, r.answers,
                ROW_NUMBER() OVER (
                  PARTITION BY r.survey_id ORDER BY r.submitted_at DESC
                ) AS rn
         FROM climate_survey_responses r
         WHERE r.company_id = $1 AND r.survey_id = ANY($2::bigint[])
       ) sub
       WHERE rn <= $3
     ),
     counts AS (
       SELECT survey_id AS "surveyId", COUNT(*)::int AS n
       FROM capped
       GROUP BY survey_id
     )
     SELECT
       q.survey_id AS "surveyId",
       q.id AS "questionId",
       q.prompt,
       q.scale_min AS "scaleMin",
       q.scale_max AS "scaleMax",
       COALESCE(q.question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') AS "questionKind",
       COALESCE(cnt.n, 0)::int AS "responseCount",
       COUNT(*) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
       )::int AS responses,
       AVG((c.answers ->> q.id::text)::numeric) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
       ) AS "meanRaw",
       COUNT(*) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
           AND (c.answers ->> q.id::text)::numeric >= 9
       )::int AS promoters,
       COUNT(*) FILTER (
         WHERE jsonb_typeof(c.answers -> q.id::text) = 'number'
           AND (c.answers ->> q.id::text)::numeric <= 6
       )::int AS detractors
     FROM climate_survey_questions q
     LEFT JOIN counts cnt ON cnt."surveyId" = q.survey_id
     LEFT JOIN capped c ON c.survey_id = q.survey_id
     WHERE q.company_id = $1 AND q.survey_id = ANY($2::bigint[])
       AND q.active = TRUE
       AND COALESCE(q.question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') <> '${CLIMATE_QUESTION_KIND.TEXT}'
     GROUP BY q.survey_id, q.id, q.prompt, q.sort_order, q.scale_min, q.scale_max, q.question_kind, cnt.n
     ORDER BY q.survey_id, q.sort_order ASC, q.id ASC`,
    [companyId, ids, AGGREGATE_RESPONSE_CAP]
  );

  for (const sid of ids) {
    out.set(sid, { responseCount: 0, byQuestion: [], overallMean: null });
  }
  const bySurvey = new Map();
  for (const row of res.rows) {
    const sid = Number(row.surveyId);
    if (!bySurvey.has(sid)) {
      bySurvey.set(sid, {
        responseCount: Number(row.responseCount) || 0,
        rows: [],
      });
    }
    bySurvey.get(sid).rows.push(row);
  }
  for (const [sid, bucket] of bySurvey) {
    const byQuestion = mapLikertAggregateRows(bucket.rows);
    out.set(sid, {
      responseCount: bucket.responseCount,
      byQuestion,
      overallMean: overallMeanFromByQuestion(byQuestion),
    });
  }
  return out;
}

function normalizeTitle(raw) {
  const title = String(raw || '').trim().slice(0, TITLE_MAX);
  return title.length >= 1 ? title : null;
}

function normalizeStatus(raw, fallback = CLIMATE_SURVEY_STATUS.DRAFT) {
  const s = String(raw || '').trim().toLowerCase();
  return SURVEY_STATUSES.has(s) ? s : fallback;
}

function mapSurveyRow(row) {
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    description: row.description,
    status: row.status,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    sourceSurveyId: row.sourceSurveyId != null ? row.sourceSurveyId : null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    questionCount: row.questionCount != null ? Number(row.questionCount) : undefined,
    responseCount: row.responseCount != null ? Number(row.responseCount) : undefined,
  };
}

/** Questions are editable only while draft (B-RH2-16). */
export function climateQuestionsEditable(status) {
  return status === CLIMATE_SURVEY_STATUS.DRAFT;
}

export async function listClimateSurveys(dbOrQuery, {
  companyId,
  limit = LIST_CAP,
  includeArchived = false,
  status = null,
}) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const params = [companyId];
  const where = ['s.company_id = $1', 's.deleted = FALSE'];
  if (status && SURVEY_STATUSES.has(String(status))) {
    params.push(String(status));
    where.push(`s.status = $${params.length}`);
  } else if (!includeArchived) {
    where.push(`s.status <> '${CLIMATE_SURVEY_STATUS.ARCHIVED}'`);
  }
  params.push(cap);
  const res = await db.query(
    `SELECT s.id, s.company_id AS "companyId", s.title, s.description, s.status,
            s.opens_at AS "opensAt", s.closes_at AS "closesAt",
            s.source_survey_id AS "sourceSurveyId",
            s.created_by_user_id AS "createdByUserId",
            s.created_at AS "createdAt", s.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM climate_survey_questions q
              WHERE q.survey_id = s.id AND q.active = TRUE) AS "questionCount",
            (SELECT COUNT(*)::int FROM climate_survey_responses r
              WHERE r.survey_id = s.id) AS "responseCount"
     FROM climate_surveys s
     WHERE ${where.join(' AND ')}
     ORDER BY s.updated_at DESC, s.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map(mapSurveyRow);
}

export async function getClimateSurvey(dbOrQuery, { companyId, surveyId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT s.id, s.company_id AS "companyId", s.title, s.description, s.status,
            s.opens_at AS "opensAt", s.closes_at AS "closesAt",
            s.source_survey_id AS "sourceSurveyId",
            s.created_by_user_id AS "createdByUserId",
            s.created_at AS "createdAt", s.updated_at AS "updatedAt"
     FROM climate_surveys s
     WHERE s.id = $1 AND s.company_id = $2 AND s.deleted = FALSE
     LIMIT 1`,
    [surveyId, companyId]
  );
  if (res.rowCount === 0) return null;
  const survey = mapSurveyRow(res.rows[0]);
  const q = await db.query(
    `SELECT id, survey_id AS "surveyId", company_id AS "companyId",
            prompt, sort_order AS "sortOrder",
            scale_min AS "scaleMin", scale_max AS "scaleMax", active,
            COALESCE(question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') AS "questionKind"
     FROM climate_survey_questions
     WHERE survey_id = $1 AND company_id = $2 AND active = TRUE
     ORDER BY sort_order ASC, id ASC
     LIMIT $3`,
    [surveyId, companyId, QUESTIONS_CAP]
  );
  const counts = await db.query(
    `SELECT COUNT(*)::int AS n FROM climate_survey_responses
     WHERE survey_id = $1 AND company_id = $2`,
    [surveyId, companyId]
  );
  const invites = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE used_at IS NOT NULL)::int AS used,
            COUNT(*) FILTER (WHERE used_at IS NULL AND expires_at > NOW())::int AS pending
     FROM climate_survey_invites
     WHERE survey_id = $1 AND company_id = $2`,
    [surveyId, companyId]
  );
  const inv = invites.rows[0] || {};
  return {
    ...survey,
    questions: q.rows.map(mapQuestionRow),
    responseCount: Number(counts.rows[0]?.n) || 0,
    questionsEditable: climateQuestionsEditable(survey.status),
    inviteStats: {
      total: Number(inv.total) || 0,
      used: Number(inv.used) || 0,
      pending: Number(inv.pending) || 0,
    },
  };
}

async function insertQuestions(db, { surveyId, companyId, items }) {
  const list = (Array.isArray(items) ? items : [])
    .map((raw) => {
      if (raw && typeof raw === 'object') {
        return {
          prompt: String(raw.prompt || '').trim().slice(0, PROMPT_MAX),
          kind: normalizeQuestionKind(raw.kind || raw.questionKind, CLIMATE_QUESTION_KIND.LIKERT),
        };
      }
      return {
        prompt: String(raw || '').trim().slice(0, PROMPT_MAX),
        kind: CLIMATE_QUESTION_KIND.LIKERT,
      };
    })
    .filter((x) => x.prompt)
    .slice(0, QUESTIONS_CAP);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const kind = list[i].kind;
    const { scaleMin, scaleMax } = scaleBoundsForKind(kind);
    const r = await db.query(
      `INSERT INTO climate_survey_questions (
         survey_id, company_id, prompt, sort_order, scale_min, scale_max, question_kind
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, survey_id AS "surveyId", company_id AS "companyId",
                 prompt, sort_order AS "sortOrder",
                 scale_min AS "scaleMin", scale_max AS "scaleMax", active,
                 COALESCE(question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') AS "questionKind"`,
      [surveyId, companyId, list[i].prompt, i, scaleMin, scaleMax, kind]
    );
    out.push(mapQuestionRow(r.rows[0]));
  }
  return out;
}

export async function createClimateSurvey(dbOrQuery, {
  companyId,
  title,
  description = '',
  status = CLIMATE_SURVEY_STATUS.DRAFT,
  createdByUserId = null,
  seedDefaultQuestions = true,
  prompts = null,
}) {
  const db = asDb(dbOrQuery);
  const safeTitle = normalizeTitle(title);
  if (!safeTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const safeDesc = (() => {
    const html = sanitizeRichTextHtml(description || '', DESC_MAX) || '';
    return isRichTextEmpty(html) ? '' : html;
  })();
  const safeStatus = normalizeStatus(status, CLIMATE_SURVEY_STATUS.DRAFT);

  const res = await db.query(
    `INSERT INTO climate_surveys (
       company_id, title, description, status, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id AS "companyId", title, description, status,
               opens_at AS "opensAt", closes_at AS "closesAt",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [companyId, safeTitle, safeDesc, safeStatus, createdByUserId || null]
  );
  const survey = mapSurveyRow(res.rows[0]);
  let seedItems;
  if (Array.isArray(prompts) && prompts.length) {
    seedItems = prompts;
  } else if (seedDefaultQuestions) {
    seedItems = [
      ...DEFAULT_CLIMATE_PROMPTS_PT.map((prompt) => ({ prompt, kind: CLIMATE_QUESTION_KIND.LIKERT })),
      ...DEFAULT_CLIMATE_TEXT_PROMPTS_PT.map((prompt) => ({ prompt, kind: CLIMATE_QUESTION_KIND.TEXT })),
    ];
  } else {
    seedItems = [];
  }
  const questions = await insertQuestions(db, {
    surveyId: survey.id,
    companyId,
    items: seedItems,
  });
  return { ok: true, survey: { ...survey, questions, responseCount: 0 } };
}

export async function updateClimateSurvey(dbOrQuery, {
  companyId,
  surveyId,
  title,
  description,
  status,
  opensAt,
  closesAt,
}) {
  const db = asDb(dbOrQuery);
  const existing = await getClimateSurvey(db, { companyId, surveyId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  const nextTitle = title !== undefined ? normalizeTitle(title) : existing.title;
  if (!nextTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const nextDesc =
    description !== undefined
      ? (() => {
          const html = sanitizeRichTextHtml(description || '', DESC_MAX) || '';
          return isRichTextEmpty(html) ? '' : html;
        })()
      : existing.description;
  const nextStatus =
    status !== undefined ? normalizeStatus(status, existing.status) : existing.status;

  if (existing.status === CLIMATE_SURVEY_STATUS.ARCHIVED && nextStatus !== CLIMATE_SURVEY_STATUS.ARCHIVED) {
    return { ok: false, errorCode: ERR.SURVEY_ARCHIVED };
  }

  let nextOpens =
    opensAt != null && opensAt !== '' ? opensAt : null;
  let nextCloses =
    closesAt != null && closesAt !== '' ? closesAt : null;
  // Stamp campaign window on status transitions so managers can compare over time.
  if (status !== undefined && nextStatus === CLIMATE_SURVEY_STATUS.OPEN && existing.status !== CLIMATE_SURVEY_STATUS.OPEN && !existing.opensAt) {
    nextOpens = nextOpens || new Date().toISOString();
  }
  if (
    status !== undefined
    && (nextStatus === CLIMATE_SURVEY_STATUS.CLOSED || nextStatus === CLIMATE_SURVEY_STATUS.ARCHIVED)
    && existing.status !== CLIMATE_SURVEY_STATUS.CLOSED
    && existing.status !== CLIMATE_SURVEY_STATUS.ARCHIVED
    && !existing.closesAt
  ) {
    nextCloses = nextCloses || new Date().toISOString();
  }

  const res = await db.query(
    `UPDATE climate_surveys
     SET title = $3, description = $4, status = $5,
         opens_at = COALESCE($6::timestamptz, opens_at),
         closes_at = COALESCE($7::timestamptz, closes_at),
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE
     RETURNING id, company_id AS "companyId", title, description, status,
               opens_at AS "opensAt", closes_at AS "closesAt",
               source_survey_id AS "sourceSurveyId",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      surveyId,
      companyId,
      nextTitle,
      nextDesc,
      nextStatus,
      nextOpens,
      nextCloses,
    ]
  );
  const fresh = await getClimateSurvey(db, { companyId, surveyId });
  return {
    ok: true,
    survey: fresh || {
      ...mapSurveyRow(res.rows[0]),
      questions: existing.questions,
      responseCount: existing.responseCount,
      questionsEditable: climateQuestionsEditable(nextStatus),
    },
  };
}

/** B-RH2-16: archive keeps the row visible under status=archived (not soft-deleted). */
export async function archiveClimateSurvey(dbOrQuery, { companyId, surveyId }) {
  const db = asDb(dbOrQuery);
  const existing = await getClimateSurvey(db, { companyId, surveyId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (existing.status === CLIMATE_SURVEY_STATUS.ARCHIVED) {
    return { ok: true, survey: existing };
  }
  const res = await db.query(
    `UPDATE climate_surveys
     SET status = '${CLIMATE_SURVEY_STATUS.ARCHIVED}',
         closes_at = COALESCE(closes_at, NOW()),
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE
     RETURNING id`,
    [surveyId, companyId]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const survey = await getClimateSurvey(db, { companyId, surveyId });
  return { ok: true, survey };
}

/**
 * B-RH2-16: archive (or close) the current survey and create a draft copy of its questions.
 * Use when the form must change after publish.
 */
export async function versionClimateSurvey(dbOrQuery, {
  companyId,
  surveyId,
  createdByUserId = null,
  title = null,
}) {
  const db = asDb(dbOrQuery);
  const source = await getClimateSurvey(db, { companyId, surveyId });
  if (!source) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (source.status === CLIMATE_SURVEY_STATUS.DRAFT) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  if (source.status !== CLIMATE_SURVEY_STATUS.ARCHIVED) {
    const archived = await archiveClimateSurvey(db, { companyId, surveyId });
    if (!archived.ok) return archived;
  }

  const nextTitle = normalizeTitle(
    title
      || (source.title.length + 6 <= TITLE_MAX
        ? `${source.title} (v2)`
        : source.title)
  );
  if (!nextTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };

  const created = await createClimateSurvey(db, {
    companyId,
    title: nextTitle,
    description: source.description || '',
    status: CLIMATE_SURVEY_STATUS.DRAFT,
    createdByUserId,
    seedDefaultQuestions: false,
    prompts: (source.questions || []).map((q) => ({
      prompt: q.prompt,
      kind: q.questionKind || CLIMATE_QUESTION_KIND.LIKERT,
    })),
  });
  if (!created.ok) return created;

  await db.query(
    `UPDATE climate_surveys
     SET source_survey_id = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE`,
    [created.survey.id, companyId, surveyId]
  );

  const survey = await getClimateSurvey(db, { companyId, surveyId: created.survey.id });
  return { ok: true, survey, sourceSurveyId: surveyId };
}

export async function softDeleteClimateSurvey(dbOrQuery, { companyId, surveyId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `UPDATE climate_surveys
     SET deleted = TRUE, status = '${CLIMATE_SURVEY_STATUS.ARCHIVED}', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE
     RETURNING id`,
    [surveyId, companyId]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

/** B-503 / B-RH2-16 — add question only while draft. */
export async function addClimateSurveyQuestion(dbOrQuery, {
  companyId,
  surveyId,
  prompt,
  sortOrder = null,
  questionKind = CLIMATE_QUESTION_KIND.LIKERT,
}) {
  const db = asDb(dbOrQuery);
  const survey = await getClimateSurvey(db, { companyId, surveyId });
  if (!survey) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (!climateQuestionsEditable(survey.status)) {
    return { ok: false, errorCode: ERR.SURVEY_QUESTIONS_LOCKED };
  }
  if (survey.questions.length >= QUESTIONS_CAP) return { ok: false, errorCode: ERR.QUESTIONS_CAP };
  const text = String(prompt || '').trim().slice(0, PROMPT_MAX);
  if (!text) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const kind = normalizeQuestionKind(questionKind, CLIMATE_QUESTION_KIND.LIKERT);
  const { scaleMin, scaleMax } = scaleBoundsForKind(kind);
  const order =
    sortOrder != null && Number.isFinite(Number(sortOrder))
      ? Number(sortOrder)
      : survey.questions.length;
  const r = await db.query(
    `INSERT INTO climate_survey_questions (
       survey_id, company_id, prompt, sort_order, scale_min, scale_max, question_kind
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, survey_id AS "surveyId", company_id AS "companyId",
               prompt, sort_order AS "sortOrder",
               scale_min AS "scaleMin", scale_max AS "scaleMax", active,
               COALESCE(question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') AS "questionKind"`,
    [surveyId, companyId, text, order, scaleMin, scaleMax, kind]
  );
  await db.query(`UPDATE climate_surveys SET updated_at = NOW() WHERE id = $1`, [surveyId]);
  return { ok: true, question: mapQuestionRow(r.rows[0]) };
}

export async function updateClimateSurveyQuestion(dbOrQuery, {
  companyId,
  surveyId,
  questionId,
  prompt,
  sortOrder,
  active,
}) {
  const db = asDb(dbOrQuery);
  const survey = await getClimateSurvey(db, { companyId, surveyId });
  if (!survey) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (!climateQuestionsEditable(survey.status)) {
    return { ok: false, errorCode: ERR.SURVEY_QUESTIONS_LOCKED };
  }
  const owned = await db.query(
    `SELECT q.id, q.prompt, q.sort_order AS "sortOrder", q.active
     FROM climate_survey_questions q
     JOIN climate_surveys s ON s.id = q.survey_id
     WHERE q.id = $1 AND q.survey_id = $2 AND q.company_id = $3 AND s.deleted = FALSE
     LIMIT 1`,
    [questionId, surveyId, companyId]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const cur = owned.rows[0];
  const nextPrompt =
    prompt !== undefined ? String(prompt || '').trim().slice(0, PROMPT_MAX) : cur.prompt;
  if (!nextPrompt) return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  const nextOrder =
    sortOrder !== undefined && Number.isFinite(Number(sortOrder))
      ? Number(sortOrder)
      : cur.sortOrder;
  const nextActive = active !== undefined ? Boolean(active) : cur.active;
  const r = await db.query(
    `UPDATE climate_survey_questions
     SET prompt = $2, sort_order = $3, active = $4
     WHERE id = $1
     RETURNING id, survey_id AS "surveyId", company_id AS "companyId",
               prompt, sort_order AS "sortOrder",
               scale_min AS "scaleMin", scale_max AS "scaleMax", active,
               COALESCE(question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') AS "questionKind"`,
    [questionId, nextPrompt, nextOrder, nextActive]
  );
  await db.query(`UPDATE climate_surveys SET updated_at = NOW() WHERE id = $1`, [surveyId]);
  return { ok: true, question: mapQuestionRow(r.rows[0]) };
}

/**
 * Create anonymous invite token (one response per invite).
 */
export async function createClimateSurveyInvite(dbOrQuery, {
  companyId,
  surveyId,
  ttlDays = INVITE_TTL_DAYS,
}) {
  const batch = await createClimateSurveyInviteBatch(dbOrQuery, { companyId, surveyId, count: 1, ttlDays });
  if (!batch.ok) return batch;
  return { ok: true, invite: batch.invites[0], survey: batch.survey };
}

/** Why a survey cannot take invites, or null. */
export function climateSurveyInviteError(survey) {
  if (!survey) return ERR.NOT_FOUND;
  if (survey.status === CLIMATE_SURVEY_STATUS.CLOSED) return ERR.SURVEY_CLOSED;
  if (survey.status === CLIMATE_SURVEY_STATUS.ARCHIVED) return ERR.SURVEY_ARCHIVED;
  if (survey.status !== CLIMATE_SURVEY_STATUS.OPEN) return ERR.SURVEY_NOT_OPEN;
  if (!survey.questions?.length) return ERR.NO_QUESTIONS;
  return null;
}

/**
 * B-504 — create up to INVITE_BATCH_CAP anonymous invites: survey checked once, one insert.
 * Nothing is inserted when the survey cannot take invites.
 */
export async function createClimateSurveyInviteBatch(dbOrQuery, {
  companyId,
  surveyId,
  count = 1,
  ttlDays = INVITE_TTL_DAYS,
}) {
  const db = asDb(dbOrQuery);
  const survey = await getClimateSurvey(db, { companyId, surveyId });
  const inviteError = climateSurveyInviteError(survey);
  if (inviteError) return { ok: false, errorCode: inviteError };

  const n = Math.min(Math.max(1, Number(count) || 1), INVITE_BATCH_CAP);
  const days = Math.min(Math.max(1, Number(ttlDays) || INVITE_TTL_DAYS), 90);
  const tokens = Array.from({ length: n }, () => crypto.randomBytes(24).toString('hex'));
  const res = await db.query(
    `INSERT INTO climate_survey_invites (survey_id, company_id, token, expires_at)
     SELECT $1::bigint, $2::bigint, t.token, NOW() + ($4::int * INTERVAL '1 day')
     FROM unnest($3::text[]) AS t(token)
     RETURNING id, survey_id AS "surveyId", company_id AS "companyId",
               token, expires_at AS "expiresAt", used_at AS "usedAt", created_at AS "createdAt"`,
    [surveyId, companyId, tokens, days]
  );
  const invites = res.rows.sort((a, b) => Number(a.id) - Number(b.id));
  return { ok: true, invites, surveyId, survey };
}

/**
 * B-504 — email anonymous unique links (one invite per address). Never includes identity in survey.
 * @returns {{ ok: true, sent: number, skipped: number, invites: object[] } | { ok: false, errorCode: string }}
 */
export async function emailClimateSurveyInvites(dbOrQuery, {
  companyId,
  surveyId,
  emails,
  appOrigin,
  locale = 'pt-BR',
  ttlDays = INVITE_TTL_DAYS,
}) {
  const list = [...new Set(
    (Array.isArray(emails) ? emails : [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  )].slice(0, INVITE_BATCH_CAP);
  if (!list.length) return { ok: false, errorCode: ERR.INVALID_DATA };
  if (!isMailConfigured()) return { ok: false, errorCode: ERR.MAIL_NOT_CONFIGURED };

  const batch = await createClimateSurveyInviteBatch(dbOrQuery, {
    companyId,
    surveyId,
    count: list.length,
    ttlDays,
  });
  if (!batch.ok) return batch;

  const title = batch.survey?.title || 'Climate';
  const subject = i18nT(locale, 'ui.climateSurveys.anonymousClimateSurvey', { title });
  const origin = String(appOrigin || '').replace(/\/$/, '');
  const delivered = await mapWithConcurrency(list, MAIL_SEND_CONCURRENCY, async (to, i) => {
    const invite = batch.invites[i];
    if (!invite?.token) return false;
    const url = `${origin}/clima/${invite.token}`;
    const text = i18nT(locale, 'ui.climateSurveys.pleaseAnswerThisAnonymousClimate', { url });
    try {
      await sendTransactionalMail({ to, subject, text });
      return true;
    } catch (e) {
      console.error('[climate] invite email failed', e?.message);
      return false;
    }
  });
  const sent = delivered.filter(Boolean).length;
  return { ok: true, sent, skipped: list.length - sent, invites: batch.invites };
}

/**
 * Public resolve — no session. Never returns PII.
 */
export async function resolveClimateInviteByToken(dbOrQuery, tokenRaw) {
  const db = asDb(dbOrQuery);
  const token = String(tokenRaw || '').trim();
  if (token.length < 16) return { ok: false, errorCode: ERR.INVALID_TOKEN };

  const res = await db.query(
    `SELECT i.id AS "inviteId", i.token, i.expires_at AS "expiresAt", i.used_at AS "usedAt",
            s.id AS "surveyId", s.company_id AS "companyId", s.title, s.description, s.status,
            s.deleted, c.deleted AS "companyDeleted"
     FROM climate_survey_invites i
     JOIN climate_surveys s ON s.id = i.survey_id
     JOIN companies c ON c.id = s.company_id
     WHERE i.token = $1
     LIMIT 1`,
    [token]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.INVALID_TOKEN };
  const row = res.rows[0];
  if (row.deleted || row.companyDeleted) return { ok: false, errorCode: ERR.EXPIRED_LINK };
  if (row.usedAt) return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return { ok: false, errorCode: ERR.EXPIRED_LINK };
  }
  if (row.status !== CLIMATE_SURVEY_STATUS.OPEN) return { ok: false, errorCode: ERR.SURVEY_NOT_OPEN };

  const q = await db.query(
    `SELECT id, prompt, sort_order AS "sortOrder",
            scale_min AS "scaleMin", scale_max AS "scaleMax",
            COALESCE(question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') AS "questionKind"
     FROM climate_survey_questions
     WHERE survey_id = $1 AND company_id = $2 AND active = TRUE
     ORDER BY sort_order ASC, id ASC
     LIMIT $3`,
    [row.surveyId, row.companyId, QUESTIONS_CAP]
  );
  return {
    ok: true,
    inviteId: row.inviteId,
    surveyId: row.surveyId,
    companyId: row.companyId,
    title: row.title,
    description: row.description,
    questions: q.rows.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      sortOrder: r.sortOrder,
      scaleMin: r.scaleMin,
      scaleMax: r.scaleMax,
      questionKind: normalizeQuestionKind(r.questionKind, CLIMATE_QUESTION_KIND.LIKERT),
    })),
  };
}

/**
 * Submit anonymous answers: { [questionId]: number | string }.
 */
export async function submitClimateResponse(dbOrQuery, { token, answers }) {
  const db = asDb(dbOrQuery);
  const resolved = await resolveClimateInviteByToken(db, token);
  if (!resolved.ok) return resolved;

  const allowed = new Map(resolved.questions.map((q) => [String(q.id), q]));
  const clean = {};
  for (const [k, v] of Object.entries(answers && typeof answers === 'object' ? answers : {})) {
    const q = allowed.get(String(k));
    if (!q) continue;
    if (q.questionKind === CLIMATE_QUESTION_KIND.TEXT) {
      const text = String(v ?? '')
        .trim()
        .slice(0, TEXT_ANSWER_MAX);
      if (text.length < TEXT_ANSWER_MIN) continue;
      clean[String(q.id)] = text;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (q.questionKind === CLIMATE_QUESTION_KIND.ENPS) {
      if (n < 0 || n > 10) continue;
      clean[String(q.id)] = Math.round(n);
      continue;
    }
    if (n < q.scaleMin || n > q.scaleMax) continue;
    clean[String(q.id)] = Math.round(n);
  }
  if (Object.keys(clean).length !== allowed.size) {
    return { ok: false, errorCode: ERR.INCOMPLETE_ANSWERS };
  }

  try {
    await db.query('BEGIN');
    const ins = await db.query(
      `INSERT INTO climate_survey_responses (survey_id, company_id, invite_id, answers)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, submitted_at AS "submittedAt"`,
      [resolved.surveyId, resolved.companyId, resolved.inviteId, JSON.stringify(clean)]
    );
    await db.query(
      `UPDATE climate_survey_invites SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`,
      [resolved.inviteId]
    );
    await db.query('COMMIT');
    return { ok: true, responseId: ins.rows[0].id, submittedAt: ins.rows[0].submittedAt };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') return { ok: false, errorCode: ERR.ALREADY_SUBMITTED };
    throw err;
  }
}

/**
 * Aggregated means per question (no raw rows). B-506: suppress until min responses.
 */
export async function getClimateSurveyAggregate(dbOrQuery, { companyId, surveyId }) {
  const db = asDb(dbOrQuery);
  const survey = await getClimateSurvey(db, { companyId, surveyId });
  if (!survey) return { ok: false, errorCode: ERR.NOT_FOUND };

  const min = climateMinResponses();
  const hasText = survey.questions.some((q) => q.questionKind === CLIMATE_QUESTION_KIND.TEXT);

  const { responseCount, byQuestion } = await fetchSurveyLikertAggregateSql(db, {
    companyId,
    surveyId,
  });

  if (responseCount < min) {
    return {
      ok: true,
      surveyId: survey.id,
      responseCount,
      minResponses: min,
      suppressed: true,
      overallMean: null,
      byQuestion: [],
      textByQuestion: [],
      themes: [],
    };
  }

  const textByQuestion = hasText
    ? await fetchSurveyTextAnswersSql(db, { companyId, surveyId })
    : [];
  const overallMean = overallMeanFromByQuestion(byQuestion);
  const overallEnps = overallEnpsFromByQuestion(byQuestion);
  let themes = [];
  try {
    themes = extractClimateThemes(textByQuestion).themes || [];
  } catch {
    themes = [];
  }
  return {
    ok: true,
    surveyId: survey.id,
    responseCount,
    minResponses: min,
    suppressed: false,
    overallMean,
    overallEnps,
    byQuestion,
    textByQuestion,
    themes,
  };
}

/**
 * B-505 — benchmark: closed/open surveys with enough responses, means keyed by prompt text.
 */
export async function getClimateCompanyBenchmark(dbOrQuery, { companyId, limit = 8 }) {
  const db = asDb(dbOrQuery);
  const min = climateMinResponses();
  const cap = Math.min(Math.max(1, Number(limit) || 8), LIST_CAP);
  const surveys = await listClimateSurveys(db, { companyId, limit: LIST_CAP });
  const eligible = surveys
    .filter((s) => (s.responseCount || 0) >= min)
    .slice(0, cap);

  const aggBySurvey = await fetchBatchLikertAggregatesSql(db, {
    companyId,
    surveyIds: eligible.map((s) => s.id),
  });

  const series = [];
  for (const s of eligible) {
    const agg = aggBySurvey.get(Number(s.id));
    if (!agg || agg.responseCount < min) continue;
    const byPrompt = Object.fromEntries(
      (agg.byQuestion || []).map((q) => [String(q.prompt).trim().toLowerCase(), q.mean])
    );
    series.push({
      surveyId: s.id,
      title: s.title,
      status: s.status,
      responseCount: agg.responseCount,
      overallMean: agg.overallMean ?? null,
      createdAt: s.createdAt,
      opensAt: s.opensAt,
      closesAt: s.closesAt,
      updatedAt: s.updatedAt,
      byPrompt,
      byQuestion: agg.byQuestion,
    });
  }
  // Newest first already from list — delta vs previous eligible survey
  for (let i = 0; i < series.length; i += 1) {
    const prev = series[i + 1];
    const cur = series[i].overallMean;
    const p = prev?.overallMean;
    series[i].deltaVsPrevious =
      cur != null && p != null ? Math.round((cur - p) * 10) / 10 : null;
  }
  const promptSet = new Set();
  for (const row of series) {
    for (const k of Object.keys(row.byPrompt)) promptSet.add(k);
  }
  const prompts = [...promptSet].slice(0, QUESTIONS_CAP);
  return {
    ok: true,
    minResponses: min,
    surveys: series.map(({ byPrompt: _bp, byQuestion: _bq, ...rest }) => rest),
    prompts: prompts.map((p) => {
      const label =
        series.flatMap((s) => s.byQuestion || []).find((q) => String(q.prompt).trim().toLowerCase() === p)
          ?.prompt || p;
      return {
        key: p,
        prompt: label,
        means: series.map((s) => ({
          surveyId: s.surveyId,
          title: s.title,
          mean: s.byPrompt[p] ?? null,
        })),
      };
    }),
  };
}

/**
 * Company-wide mean of Likert answers from recent closed surveys.
 * Climate responses are anonymous (no candidate_id) — company signal only.
 *
 * Cap: last 5000 responses in the window (same order of magnitude as aggregate UI).
 *
 * @param {object} dbOrQuery
 * @param {{ companyId: number, days?: number }} opts
 * @returns {Promise<number|null>}
 */
export async function getCompanyRecentLikertMean(dbOrQuery, { companyId, days = 180 } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const dayCount = Math.min(Math.max(1, Number(days) || 180), 730);

  const res = await db.query(
    `SELECT AVG((r.answers ->> q.id::text)::numeric) AS avg_score
     FROM (
       SELECT r.survey_id, r.answers
       FROM climate_survey_responses r
       INNER JOIN climate_surveys s
         ON s.id = r.survey_id AND s.company_id = r.company_id
       WHERE r.company_id = $1
         AND s.company_id = $1
         AND s.deleted = FALSE
         AND s.status = $2
         AND r.submitted_at > NOW() - ($3::int * INTERVAL '1 day')
       ORDER BY r.submitted_at DESC
       LIMIT $4
     ) r
     INNER JOIN climate_survey_questions q
       ON q.survey_id = r.survey_id
      AND q.active = TRUE
      AND COALESCE(q.question_kind, '${CLIMATE_QUESTION_KIND.LIKERT}') <> '${CLIMATE_QUESTION_KIND.TEXT}'
     WHERE jsonb_typeof(r.answers -> q.id::text) = 'number'`,
    [cid, CLIMATE_SURVEY_STATUS.CLOSED, dayCount, AGGREGATE_RESPONSE_CAP]
  );

  const raw = res.rows[0]?.avg_score;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Company eNPS pulse — latest open/closed survey with enps question(s) and enough responses.
 */
export async function getCompanyEnpsPulse(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const min = climateMinResponses();
  try {
    const surveyRes = await db.query(
      `SELECT s.id AS "surveyId", s.status,
              (SELECT COUNT(*)::int FROM climate_survey_responses r
               WHERE r.survey_id = s.id AND r.company_id = s.company_id) AS "responseCount"
       FROM climate_surveys s
       WHERE s.company_id = $1 AND s.deleted = FALSE
         AND s.status IN ('${CLIMATE_SURVEY_STATUS.OPEN}', '${CLIMATE_SURVEY_STATUS.CLOSED}')
         AND EXISTS (
           SELECT 1 FROM climate_survey_questions q
           WHERE q.survey_id = s.id AND q.company_id = s.company_id
             AND q.active = TRUE AND q.question_kind = '${CLIMATE_QUESTION_KIND.ENPS}'
         )
       ORDER BY
         CASE WHEN s.status = '${CLIMATE_SURVEY_STATUS.OPEN}' THEN 0 ELSE 1 END,
         s.updated_at DESC,
         s.id DESC
       LIMIT 1`,
      [cid]
    );
    if (surveyRes.rowCount === 0) {
      return { score: null, responseCount: 0, suppressed: true, surveyId: null, minResponses: min };
    }
    const row = surveyRes.rows[0];
    const surveyId = Number(row.surveyId);
    const responseCount = Number(row.responseCount) || 0;
    if (responseCount < min) {
      return { score: null, responseCount, suppressed: true, surveyId, minResponses: min };
    }
    const { byQuestion } = await fetchSurveyLikertAggregateSql(db, {
      companyId: cid,
      surveyId,
    });
    const score = overallEnpsFromByQuestion(byQuestion);
    return {
      score,
      responseCount,
      suppressed: score == null,
      surveyId,
      minResponses: min,
    };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return null;
    throw err;
  }
}

/**
 * Company pulse for Overview — open campaigns + response progress.
 */
export async function getCompanyClimatePulse(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const min = climateMinResponses();
  try {
    const res = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE s.status = '${CLIMATE_SURVEY_STATUS.OPEN}' AND s.deleted = FALSE)::int AS "openSurveys",
         COUNT(*) FILTER (WHERE s.status = '${CLIMATE_SURVEY_STATUS.DRAFT}' AND s.deleted = FALSE)::int AS "draftSurveys",
         COALESCE((
           SELECT COUNT(*)::int FROM climate_survey_responses r
           JOIN climate_surveys s2 ON s2.id = r.survey_id
           WHERE s2.company_id = $1 AND s2.status = '${CLIMATE_SURVEY_STATUS.OPEN}' AND s2.deleted = FALSE
         ), 0) AS "openResponses"
       FROM climate_surveys s
       WHERE s.company_id = $1`,
      [cid]
    );
    const row = res.rows[0] || {};
    let latestMean = null;
    let deltaVsPrevious = null;
    try {
      const bench = await getClimateCompanyBenchmark(db, { companyId: cid, limit: 2 });
      const latest = Array.isArray(bench?.surveys) ? bench.surveys[0] : null;
      if (latest) {
        latestMean = latest.overallMean ?? null;
        deltaVsPrevious = latest.deltaVsPrevious ?? null;
      }
    } catch {
      /* optional enrichment */
    }
    return {
      openSurveys: Number(row.openSurveys) || 0,
      draftSurveys: Number(row.draftSurveys) || 0,
      openResponses: Number(row.openResponses) || 0,
      minResponses: min,
      latestMean,
      deltaVsPrevious,
    };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return null;
    throw err;
  }
}

export const CLIMATE_SURVEY_CAPS = {
  LIST_CAP,
  QUESTIONS_CAP,
  SURVEY_STATUSES,
  INVITE_BATCH_CAP,
};
