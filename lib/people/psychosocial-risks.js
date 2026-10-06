/**
 * B-2714 — NR-1 riscos psicossociais (versão leve).
 * Questionário = pesquisa de clima anônima com perguntas Likert marcadas por fator;
 * inventário = psychosocial_risks (migration 152). Apoio ao PGR: não substitui SESMT.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import {
  CLIMATE_QUESTION_KIND,
  CLIMATE_SURVEY_STATUS,
  PSYCHOSOCIAL_FACTOR,
  PSYCHOSOCIAL_FACTORS,
  PSYCHOSOCIAL_RISK_STATUS,
  PSYCHOSOCIAL_RISK_STATUSES,
} from '../domain-status.js';
import { contentLocale } from '../i18n.js';
import { resolveRecruiterUserId } from '../recruiting-workspace.js';
import { getClimateSurveyAggregate, normalizePsychosocialFactor } from './climate-surveys.js';

export const PSYCHOSOCIAL_RISKS_CAP = 200;
export const PSYCHOSOCIAL_HAZARD_MAX = 500;
export const PSYCHOSOCIAL_GROUP_MAX = 200;
export const PSYCHOSOCIAL_MEASURES_MAX = 2000;

/** Risk level from probability × severity (1–9). */
export const PSYCHOSOCIAL_RISK_LEVEL = Object.freeze({ LOW: 'low', MODERATE: 'moderate', HIGH: 'high' });

/** Survey signal per factor (favorability %); hedged, not a diagnosis. */
export const PSYCHOSOCIAL_SIGNAL = Object.freeze({ FAVORABLE: 'favorable', ATTENTION: 'attention', CRITICAL: 'critical' });

const FAVORABLE_MIN = 70;
const ATTENTION_MIN = 50;
const STATUS_SET = new Set(PSYCHOSOCIAL_RISK_STATUSES);

export function psychosocialRiskLevel(score) {
  const n = Number(score) || 0;
  if (n >= 6) return PSYCHOSOCIAL_RISK_LEVEL.HIGH;
  if (n >= 3) return PSYCHOSOCIAL_RISK_LEVEL.MODERATE;
  return PSYCHOSOCIAL_RISK_LEVEL.LOW;
}

export function psychosocialSignal(favorability) {
  if (favorability == null) return null;
  if (favorability >= FAVORABLE_MIN) return PSYCHOSOCIAL_SIGNAL.FAVORABLE;
  if (favorability >= ATTENTION_MIN) return PSYCHOSOCIAL_SIGNAL.ATTENTION;
  return PSYCHOSOCIAL_SIGNAL.CRITICAL;
}

const F = PSYCHOSOCIAL_FACTOR;

/** Likert prompts phrased so that a higher score = more favorable condition. */
const SURVEY_PROMPTS = Object.freeze({
  pt: [
    [F.WORKLOAD, 'O volume de trabalho é compatível com o tempo que tenho.'],
    [F.WORKLOAD, 'Consigo cumprir os prazos sem precisar trabalhar além do horário com frequência.'],
    [F.AUTONOMY, 'Tenho autonomia para decidir como organizar o meu trabalho.'],
    [F.AUTONOMY, 'Sou ouvido(a) nas decisões que afetam o meu trabalho.'],
    [F.SUPPORT, 'Quando preciso, recebo apoio da minha liderança.'],
    [F.SUPPORT, 'Posso contar com os colegas quando o trabalho aperta.'],
    [F.RELATIONSHIPS, 'As pessoas da equipe se tratam com respeito.'],
    [F.RELATIONSHIPS, 'Sinto que posso relatar assédio ou conflito sem medo de retaliação.'],
    [F.ROLE_CLARITY, 'Sei com clareza o que se espera de mim.'],
    [F.ROLE_CLARITY, 'As prioridades do meu trabalho raramente entram em conflito.'],
    [F.CHANGE, 'Mudanças na empresa são comunicadas com antecedência e clareza.'],
    [F.CHANGE, 'Tenho espaço para tirar dúvidas quando algo muda no trabalho.'],
    [F.RECOGNITION, 'Meu esforço é reconhecido.'],
    [F.RECOGNITION, 'As decisões sobre pessoas (promoção, distribuição de tarefas) parecem justas.'],
    [F.WORK_LIFE, 'Consigo desconectar do trabalho fora do horário.'],
    [F.WORK_LIFE, 'Minha jornada permite equilibrar trabalho e vida pessoal.'],
  ],
  en: [
    [F.WORKLOAD, 'My workload fits the time I have.'],
    [F.WORKLOAD, 'I can meet deadlines without often working beyond my hours.'],
    [F.AUTONOMY, 'I have autonomy to decide how to organize my work.'],
    [F.AUTONOMY, 'I am heard in decisions that affect my work.'],
    [F.SUPPORT, 'When I need it, I get support from my manager.'],
    [F.SUPPORT, 'I can count on colleagues when work gets tight.'],
    [F.RELATIONSHIPS, 'People on the team treat each other with respect.'],
    [F.RELATIONSHIPS, 'I feel I can report harassment or conflict without fear of retaliation.'],
    [F.ROLE_CLARITY, 'I know clearly what is expected of me.'],
    [F.ROLE_CLARITY, 'My work priorities rarely conflict with each other.'],
    [F.CHANGE, 'Changes in the company are communicated early and clearly.'],
    [F.CHANGE, 'I have room to ask questions when something changes at work.'],
    [F.RECOGNITION, 'My effort is recognized.'],
    [F.RECOGNITION, 'People decisions (promotion, task distribution) seem fair.'],
    [F.WORK_LIFE, 'I can disconnect from work outside working hours.'],
    [F.WORK_LIFE, 'My working hours let me balance work and personal life.'],
  ],
});

const SURVEY_TEXT_PROMPT = Object.freeze({
  pt: 'O que mais pesa no seu trabalho hoje? (opcional, anônimo)',
  en: 'What weighs on you most at work today? (optional, anonymous)',
});

/** Prompts for createClimateSurvey({ prompts }) — 16 Likert by factor + 1 open text. */
export function psychosocialSurveyPrompts(locale = 'pt-BR') {
  const loc = contentLocale(locale) === 'en' ? 'en' : 'pt';
  return [
    ...SURVEY_PROMPTS[loc].map(([factor, prompt]) => ({ prompt, kind: CLIMATE_QUESTION_KIND.LIKERT, factor })),
    { prompt: SURVEY_TEXT_PROMPT[loc], kind: CLIMATE_QUESTION_KIND.TEXT },
  ];
}

/**
 * Group a climate aggregate by factor. Pure (exported for tests).
 * @param {Array<{ id: any, psychosocialFactor?: string|null }>} questions
 * @param {Array<{ questionId: any, mean: number|null, scaleMin: number, scaleMax: number }>} byQuestion
 */
export function summarizePsychosocialFactors(questions, byQuestion) {
  const factorByQuestion = new Map();
  for (const q of questions || []) {
    const factor = normalizePsychosocialFactor(q?.psychosocialFactor);
    if (factor) factorByQuestion.set(String(q.id), factor);
  }
  const acc = new Map();
  for (const row of byQuestion || []) {
    const factor = factorByQuestion.get(String(row?.questionId));
    if (!factor || row.mean == null) continue;
    const span = Number(row.scaleMax) - Number(row.scaleMin);
    if (!(span > 0)) continue;
    const pct = ((Number(row.mean) - Number(row.scaleMin)) / span) * 100;
    const cur = acc.get(factor) || { sum: 0, n: 0 };
    cur.sum += pct;
    cur.n += 1;
    acc.set(factor, cur);
  }
  return PSYCHOSOCIAL_FACTORS.filter((f) => acc.has(f)).map((factor) => {
    const { sum, n } = acc.get(factor);
    const favorability = Math.round(sum / n);
    return { factor, favorability, signal: psychosocialSignal(favorability), questions: n };
  });
}

/** Survey with factor-tagged questions: requested one, else the latest published (draft only as fallback). */
async function findPsychosocialSurvey(db, { companyId, surveyId = null }) {
  const res = await db.query(
    `SELECT s.id, s.title, s.status, s.opens_at AS "opensAt", s.closes_at AS "closesAt"
     FROM climate_surveys s
     WHERE s.company_id = $1 AND s.deleted = FALSE
       AND ($2::bigint IS NULL OR s.id = $2::bigint)
       AND EXISTS (
         SELECT 1 FROM climate_survey_questions q
         WHERE q.survey_id = s.id AND q.company_id = s.company_id
           AND q.active = TRUE AND q.psychosocial_factor IS NOT NULL
       )
     ORDER BY (s.status = '${CLIMATE_SURVEY_STATUS.DRAFT}') ASC, s.updated_at DESC
     LIMIT 1`,
    [companyId, surveyId]
  );
  return res.rows[0] || null;
}

/** Questionnaire block: survey meta + factor favorability (suppressed below the anonymity floor). */
export async function getPsychosocialSurveySummary(dbOrQuery, { companyId, surveyId = null }) {
  const db = asDb(dbOrQuery);
  const survey = await findPsychosocialSurvey(db, { companyId, surveyId });
  if (!survey) return { survey: null, factors: [], suppressed: false, responseCount: 0, minResponses: 0 };
  const agg = await getClimateSurveyAggregate(db, { companyId, surveyId: survey.id });
  if (!agg.ok) return { survey: null, factors: [], suppressed: false, responseCount: 0, minResponses: 0 };
  const questions = await db.query(
    `SELECT id, psychosocial_factor AS "psychosocialFactor"
     FROM climate_survey_questions
     WHERE survey_id = $1 AND company_id = $2 AND active = TRUE AND psychosocial_factor IS NOT NULL`,
    [survey.id, companyId]
  );
  return {
    survey: { ...survey, id: Number(survey.id) },
    responseCount: agg.responseCount,
    minResponses: agg.minResponses,
    suppressed: Boolean(agg.suppressed),
    factors: agg.suppressed ? [] : summarizePsychosocialFactors(questions.rows, agg.byQuestion),
  };
}

function mapRiskRow(r) {
  const score = Number(r.riskScore) || 0;
  return {
    id: Number(r.id),
    factor: r.factor,
    hazard: r.hazard,
    exposedGroup: r.exposedGroup || '',
    probability: Number(r.probability),
    severity: Number(r.severity),
    riskScore: score,
    level: psychosocialRiskLevel(score),
    measures: r.measures || '',
    ownerUserId: r.ownerUserId != null ? Number(r.ownerUserId) : null,
    ownerName: r.ownerName || null,
    dueDate: r.dueDate || null,
    status: r.status,
    surveyId: r.surveyId != null ? Number(r.surveyId) : null,
    updatedAt: r.updatedAt,
  };
}

const RISK_COLS = `r.id, r.factor, r.hazard, r.exposed_group AS "exposedGroup",
  r.probability, r.severity, r.risk_score AS "riskScore", r.measures,
  r.owner_user_id AS "ownerUserId",
  COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) AS "ownerName",
  to_char(r.due_date, 'YYYY-MM-DD') AS "dueDate", r.status, r.survey_id AS "surveyId", r.updated_at AS "updatedAt"`;

export async function listPsychosocialRisks(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT ${RISK_COLS}
     FROM psychosocial_risks r
     LEFT JOIN users u ON u.id = r.owner_user_id AND u.deleted = FALSE
     WHERE r.company_id = $1 AND r.deleted = FALSE
     ORDER BY r.risk_score DESC, r.updated_at DESC
     LIMIT $2`,
    [companyId, PSYCHOSOCIAL_RISKS_CAP]
  );
  return res.rows.map(mapRiskRow);
}

function clampScale(v, fallback) {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 3 ? n : fallback;
}

/** Validate + normalize input; `prev` = existing row on update. */
async function normalizeRiskInput(db, { companyId, input, prev = null }) {
  const pick = (key, fallback) => (input[key] !== undefined ? input[key] : fallback);
  const factor = normalizePsychosocialFactor(pick('factor', prev?.factor));
  if (!factor) return { ok: false, errorCode: ERR.INVALID_DATA };
  const hazard = String(pick('hazard', prev?.hazard) || '').trim().slice(0, PSYCHOSOCIAL_HAZARD_MAX);
  if (!hazard) return { ok: false, errorCode: ERR.REQUIRED_FIELDS_MISSING };
  const status = String(pick('status', prev?.status || PSYCHOSOCIAL_RISK_STATUS.IDENTIFIED));
  if (!STATUS_SET.has(status)) return { ok: false, errorCode: ERR.INVALID_DATA };
  const ownerRaw = pick('ownerUserId', prev?.ownerUserId ?? null);
  const ownerUnchanged = prev && Number(ownerRaw || 0) === Number(prev.ownerUserId || 0);
  const owner = ownerUnchanged
    ? { ok: true, ownerUserId: prev.ownerUserId }
    : await resolveRecruiterUserId(companyId, ownerRaw);
  if (!owner.ok) return { ok: false, errorCode: ERR.INVALID_DATA };
  const dueRaw = pick('dueDate', prev?.dueDate ?? null);
  const dueDate = dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(String(dueRaw)) ? String(dueRaw) : null;
  let surveyId = pick('surveyId', prev?.surveyId ?? null);
  if (surveyId != null && surveyId !== '') {
    const s = await db.query(
      `SELECT id FROM climate_surveys WHERE id = $1 AND company_id = $2 AND deleted = FALSE LIMIT 1`,
      [surveyId, companyId]
    );
    surveyId = s.rowCount ? Number(s.rows[0].id) : null;
  } else {
    surveyId = null;
  }
  return {
    ok: true,
    values: {
      factor,
      hazard,
      exposedGroup: String(pick('exposedGroup', prev?.exposedGroup) || '').trim().slice(0, PSYCHOSOCIAL_GROUP_MAX),
      probability: clampScale(pick('probability', prev?.probability), 2),
      severity: clampScale(pick('severity', prev?.severity), 2),
      measures: String(pick('measures', prev?.measures) || '').trim().slice(0, PSYCHOSOCIAL_MEASURES_MAX),
      ownerUserId: owner.ownerUserId,
      dueDate,
      status,
      surveyId,
    },
  };
}

async function getRisk(db, { companyId, riskId }) {
  const res = await db.query(
    `SELECT ${RISK_COLS}
     FROM psychosocial_risks r
     LEFT JOIN users u ON u.id = r.owner_user_id AND u.deleted = FALSE
     WHERE r.id = $1 AND r.company_id = $2 AND r.deleted = FALSE
     LIMIT 1`,
    [riskId, companyId]
  );
  return res.rows[0] ? mapRiskRow(res.rows[0]) : null;
}

export async function createPsychosocialRisk(dbOrQuery, { companyId, input, createdByUserId = null }) {
  const db = asDb(dbOrQuery);
  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM psychosocial_risks WHERE company_id = $1 AND deleted = FALSE`,
    [companyId]
  );
  if ((Number(count.rows[0]?.n) || 0) >= PSYCHOSOCIAL_RISKS_CAP) return { ok: false, errorCode: ERR.ITEMS_CAP };
  const norm = await normalizeRiskInput(db, { companyId, input: input || {} });
  if (!norm.ok) return norm;
  const v = norm.values;
  const ins = await db.query(
    `INSERT INTO psychosocial_risks (
       company_id, factor, hazard, exposed_group, probability, severity, measures,
       owner_user_id, due_date, status, survey_id, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [companyId, v.factor, v.hazard, v.exposedGroup, v.probability, v.severity, v.measures,
      v.ownerUserId, v.dueDate, v.status, v.surveyId, createdByUserId]
  );
  return { ok: true, risk: await getRisk(db, { companyId, riskId: ins.rows[0].id }) };
}

export async function updatePsychosocialRisk(dbOrQuery, { companyId, riskId, input }) {
  const db = asDb(dbOrQuery);
  const prev = await getRisk(db, { companyId, riskId });
  if (!prev) return { ok: false, errorCode: ERR.NOT_FOUND };
  const norm = await normalizeRiskInput(db, { companyId, input: input || {}, prev });
  if (!norm.ok) return norm;
  const v = norm.values;
  await db.query(
    `UPDATE psychosocial_risks
     SET factor = $3, hazard = $4, exposed_group = $5, probability = $6, severity = $7,
         measures = $8, owner_user_id = $9, due_date = $10, status = $11, survey_id = $12,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE`,
    [riskId, companyId, v.factor, v.hazard, v.exposedGroup, v.probability, v.severity,
      v.measures, v.ownerUserId, v.dueDate, v.status, v.surveyId]
  );
  return { ok: true, risk: await getRisk(db, { companyId, riskId }), previousStatus: prev.status };
}

export async function softDeletePsychosocialRisk(dbOrQuery, { companyId, riskId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `UPDATE psychosocial_risks SET deleted = TRUE, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE
     RETURNING id`,
    [riskId, companyId]
  );
  return res.rowCount ? { ok: true } : { ok: false, errorCode: ERR.NOT_FOUND };
}

/** Full payload for the panel block and the printable report. */
export async function getPsychosocialOverview(dbOrQuery, { companyId, surveyId = null }) {
  const db = asDb(dbOrQuery);
  const [risks, summary, company] = await Promise.all([
    listPsychosocialRisks(db, { companyId }),
    getPsychosocialSurveySummary(db, { companyId, surveyId }),
    db.query(`SELECT name FROM companies WHERE id = $1 LIMIT 1`, [companyId]),
  ]);
  return { companyName: company.rows[0]?.name || '', risks, summary };
}
