/**
 * Clima / pulso autenticados para colaborador (B-2501).
 * Respostas permanecem anônimas nos agregados; o colaborador vê histórico próprio.
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { CLIMATE_SURVEY_STATUS, TEAM_PULSE_STATUS } from '../domain-status.js';
import { submitClimateResponse } from '../people/climate-surveys.js';
import { submitPublicTeamPulse } from '../people/team-pulses.js';

const INVITE_TTL_DAYS = 45;

async function latestAssessmentId(db, { companyId, candidateId }) {
  const res = await db.query(
    `SELECT a.id
     FROM assessments a
     JOIN candidates c ON c.id = a.candidate_id
     WHERE a.candidate_id = $1 AND c.company_id = $2
     ORDER BY a.created_at DESC NULLS LAST, a.id DESC
     LIMIT 1`,
    [candidateId, companyId]
  );
  return res.rows[0]?.id ?? null;
}

async function eligiblePulseGroupIds(db, { companyId, teamGroupIds, assessmentId }) {
  const ids = [...new Set((teamGroupIds || []).map(Number).filter(Number.isFinite))];
  if (!assessmentId || ids.length === 0) return new Set();
  const res = await db.query(
    `SELECT g.id AS "teamGroupId"
     FROM team_groups g
     WHERE g.company_id = $1 AND g.deleted = FALSE
       AND g.id = ANY($2::bigint[])
       AND (
         g.base_assessment_id = $3
         OR $3 = ANY(COALESCE(g.member_assessment_ids, '{}'::bigint[]))
       )`,
    [companyId, ids, assessmentId]
  );
  return new Set(res.rows.map((r) => Number(r.teamGroupId)));
}

function groupRowsByKey(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    const id = Number(row[key]);
    if (!Number.isFinite(id)) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

async function batchIssueMissingClimateInvites(db, { companyId, candidateId }) {
  const missing = await db.query(
    `SELECT s.id
     FROM climate_surveys s
     WHERE s.company_id = $1 AND s.deleted = FALSE AND s.status = $3
       AND NOT EXISTS (
         SELECT 1 FROM climate_survey_invites i
         WHERE i.survey_id = s.id AND i.company_id = $1 AND i.candidate_id = $2
       )
     ORDER BY s.opens_at DESC NULLS LAST, s.id DESC
     LIMIT 10`,
    [companyId, candidateId, CLIMATE_SURVEY_STATUS.OPEN]
  );
  const ids = (missing.rows || []).map((r) => Number(r.id)).filter(Number.isFinite);
  if (!ids.length) return;
  const tokens = ids.map(() => crypto.randomBytes(24).toString('hex'));
  await db.query(
    `INSERT INTO climate_survey_invites (survey_id, company_id, token, expires_at, candidate_id)
     SELECT u.survey_id, $1, u.token, NOW() + ($3::int * INTERVAL '1 day'), $2
     FROM unnest($4::bigint[], $5::text[]) AS u(survey_id, token)
     ON CONFLICT DO NOTHING`,
    [companyId, candidateId, INVITE_TTL_DAYS, ids, tokens]
  );
}

async function batchIssueMissingPulseInvites(db, { companyId, candidateId, pulseIds }) {
  const ids = [...new Set((pulseIds || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return;
  const missing = await db.query(
    `SELECT p.id
     FROM team_pulses p
     WHERE p.company_id = $1 AND p.id = ANY($3::bigint[])
       AND p.deleted = FALSE AND p.status = $4
       AND NOT EXISTS (
         SELECT 1 FROM team_pulse_invites i
         WHERE i.pulse_id = p.id AND i.company_id = $1 AND i.candidate_id = $2
       )`,
    [companyId, candidateId, ids, TEAM_PULSE_STATUS.OPEN]
  );
  const need = (missing.rows || []).map((r) => Number(r.id)).filter(Number.isFinite);
  if (!need.length) return;
  const tokens = need.map(() => crypto.randomBytes(24).toString('hex'));
  await db.query(
    `INSERT INTO team_pulse_invites (pulse_id, company_id, token, expires_at, candidate_id)
     SELECT u.pulse_id, $1, u.token, NOW() + ($3::int * INTERVAL '1 day'), $2
     FROM unnest($4::bigint[], $5::text[]) AS u(pulse_id, token)
     ON CONFLICT DO NOTHING`,
    [companyId, candidateId, 21, need, tokens]
  );
}

/**
 * Inbox: at most one batch upsert of missing personal invites, then batched reads (no N+1).
 * @returns {Promise<{ openClimate: object[], openPulse: object[], history: object[] }>}
 */
export async function listEmployeeSurveyInbox(dbOrQuery, { companyId, candidateId, locale = 'pt-BR' }) {
  const db = asDb(dbOrQuery);
  void locale;
  const assessmentId = await latestAssessmentId(db, { companyId, candidateId });

  await batchIssueMissingClimateInvites(db, { companyId, candidateId });

  const openClimate = [];
  const climateRes = await db.query(
    `SELECT s.id, s.title, s.description, i.token
     FROM climate_surveys s
     INNER JOIN climate_survey_invites i
       ON i.survey_id = s.id
      AND i.company_id = s.company_id
      AND i.candidate_id = $2
     WHERE s.company_id = $1 AND s.deleted = FALSE
       AND s.status = $3
       AND i.used_at IS NULL
       AND (i.expires_at IS NULL OR i.expires_at > NOW())
     ORDER BY s.opens_at DESC NULLS LAST, s.id DESC
     LIMIT 10`,
    [companyId, candidateId, CLIMATE_SURVEY_STATUS.OPEN]
  );
  const climateSurveyIds = (climateRes.rows || []).map((r) => Number(r.id)).filter(Number.isFinite);
  let climateQuestionsBySurvey = new Map();
  if (climateSurveyIds.length > 0) {
    const qRes = await db.query(
      `SELECT id, survey_id AS "surveyId", prompt, sort_order AS "sortOrder",
              scale_min AS "scaleMin", scale_max AS "scaleMax",
              COALESCE(question_kind, 'likert') AS "questionKind"
       FROM climate_survey_questions
       WHERE survey_id = ANY($1::bigint[]) AND company_id = $2 AND active = TRUE
       ORDER BY survey_id, sort_order ASC, id ASC`,
      [climateSurveyIds, companyId]
    );
    climateQuestionsBySurvey = groupRowsByKey(qRes.rows, 'surveyId');
  }
  for (const row of climateRes.rows || []) {
    const questions = (climateQuestionsBySurvey.get(Number(row.id)) || []).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      scaleMin: q.scaleMin,
      scaleMax: q.scaleMax,
      questionKind: q.questionKind || 'likert',
    }));
    if (questions.length === 0) continue;
    openClimate.push({
      kind: 'climate',
      surveyId: row.id,
      title: row.title,
      description: row.description || '',
      token: row.token,
      questions,
    });
  }

  const openPulse = [];
  const openPulses = await db.query(
    `SELECT p.id, p.title, p.team_group_id AS "teamGroupId"
     FROM team_pulses p
     WHERE p.company_id = $1 AND p.deleted = FALSE AND p.status = $2
     ORDER BY p.opens_at DESC NULLS LAST, p.id DESC
     LIMIT 10`,
    [companyId, TEAM_PULSE_STATUS.OPEN]
  );
  const eligibleGroups = await eligiblePulseGroupIds(db, {
    companyId,
    teamGroupIds: (openPulses.rows || []).map((r) => r.teamGroupId),
    assessmentId,
  });
  const eligiblePulseIds = (openPulses.rows || [])
    .filter((r) => eligibleGroups.has(Number(r.teamGroupId)))
    .map((r) => Number(r.id))
    .filter(Number.isFinite);

  await batchIssueMissingPulseInvites(db, {
    companyId,
    candidateId,
    pulseIds: eligiblePulseIds,
  });

  const pulseRes = await db.query(
    `SELECT p.id, p.title, p.team_group_id AS "teamGroupId", i.token
     FROM team_pulses p
     INNER JOIN team_pulse_invites i
       ON i.pulse_id = p.id
      AND i.company_id = p.company_id
      AND i.candidate_id = $2
     WHERE p.company_id = $1 AND p.id = ANY($3::bigint[])
       AND i.used_at IS NULL
       AND (i.expires_at IS NULL OR i.expires_at > NOW())
     ORDER BY p.opens_at DESC NULLS LAST, p.id DESC`,
    [companyId, candidateId, eligiblePulseIds.length ? eligiblePulseIds : [0]]
  );
  let pulseQuestionsByPulse = new Map();
  const pulseIds = (pulseRes.rows || []).map((r) => Number(r.id)).filter(Number.isFinite);
  if (pulseIds.length > 0) {
    const qRes = await db.query(
      `SELECT id, pulse_id AS "pulseId", prompt, sort_order AS "sortOrder",
              scale_min AS "scaleMin", scale_max AS "scaleMax"
       FROM team_pulse_questions
       WHERE pulse_id = ANY($1::bigint[]) AND company_id = $2 AND active = TRUE
       ORDER BY pulse_id, sort_order ASC, id ASC`,
      [pulseIds, companyId]
    );
    pulseQuestionsByPulse = groupRowsByKey(qRes.rows, 'pulseId');
  }
  for (const row of pulseRes.rows || []) {
    const questions = (pulseQuestionsByPulse.get(Number(row.id)) || []).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      scaleMin: q.scaleMin,
      scaleMax: q.scaleMax,
    }));
    if (questions.length === 0) continue;
    openPulse.push({
      kind: 'pulse',
      pulseId: row.id,
      title: row.title,
      token: row.token,
      questions,
    });
  }

  const history = [];
  const histClimate = await db.query(
    `SELECT s.title, i.used_at AS "submittedAt"
     FROM climate_survey_invites i
     JOIN climate_surveys s ON s.id = i.survey_id
     WHERE i.company_id = $1 AND i.candidate_id = $2 AND i.used_at IS NOT NULL
     ORDER BY i.used_at DESC
     LIMIT 15`,
    [companyId, candidateId]
  );
  for (const r of histClimate.rows || []) {
    history.push({
      kind: 'climate',
      title: r.title,
      submittedAt: r.submittedAt,
    });
  }
  const histPulse = await db.query(
    `SELECT p.title, i.used_at AS "submittedAt"
     FROM team_pulse_invites i
     JOIN team_pulses p ON p.id = i.pulse_id
     WHERE i.company_id = $1 AND i.candidate_id = $2 AND i.used_at IS NOT NULL
     ORDER BY i.used_at DESC
     LIMIT 15`,
    [companyId, candidateId]
  );
  for (const r of histPulse.rows || []) {
    history.push({
      kind: 'pulse',
      title: r.title,
      submittedAt: r.submittedAt,
    });
  }
  history.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  return { openClimate, openPulse, history };
}

export async function submitEmployeeClimateSurvey(dbOrQuery, { companyId, candidateId, token, answers }) {
  const db = asDb(dbOrQuery);
  const check = await db.query(
    `SELECT i.id FROM climate_survey_invites i
     WHERE i.token = $1 AND i.company_id = $2 AND i.candidate_id = $3
     LIMIT 1`,
    [token, companyId, candidateId]
  );
  if (check.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  return submitClimateResponse(db, { token, answers });
}

export async function submitEmployeeTeamPulse(dbOrQuery, { companyId, candidateId, token, answers }) {
  const db = asDb(dbOrQuery);
  const check = await db.query(
    `SELECT i.id FROM team_pulse_invites i
     WHERE i.token = $1 AND i.company_id = $2 AND i.candidate_id = $3
     LIMIT 1`,
    [token, companyId, candidateId]
  );
  if (check.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  return submitPublicTeamPulse(db, { token, answers });
}
