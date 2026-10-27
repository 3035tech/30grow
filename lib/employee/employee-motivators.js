import { asDb } from '../ae/as-db.js';
import { drawMotivatorsQuestions } from '../ae/draw-questions.js';
import { loadQuestionsForScoring } from '../ae/load-questions-for-scoring.js';
import { toPublicQuestions } from '../ae/to-public-questions.js';
import { computeMotivatorScores } from '../ae/scoring.js';
import { resolveResultTextsFromDb } from '../ae/templates.js';
import { AE_SCORING_ENGINE_VERSION } from '../ae/ae-id.js';
import { formatScoringFailure, summarizeScoringInput } from '../ae/scoring-diagnostics.js';
import { notifyCompanyManagers, NOTIF } from '../manager-notifications.js';
import { buildManagementHypotheses } from '../people/management-hypotheses.js';
import { ERR } from '../api-error-codes.js';
import { t } from '../i18n.js';

export const MotivatorsAction = Object.freeze({ Start: 'start', Submit: 'submit' });
const AttemptStatus = Object.freeze({ Progress: 'in_progress', Completed: 'completed' });
const INVITE_LIMIT = 10;
const unavailable = () => ({ ok: false, errorCode: ERR.NOT_FOUND });

export async function listEmployeeMotivators(dbOrQuery, { companyId, candidateId, locale }) {
  const db = asDb(dbOrQuery);
  const [invites, areas] = await Promise.all([
    db.query(`SELECT i.id, d.name AS title, i.expires_at AS "expiresAt"
      FROM ae_invites i JOIN ae_definitions d ON d.id = i.definition_id AND d.active = TRUE
      WHERE i.company_id = $1 AND i.candidate_id = $2 AND i.status IN ('sent', 'opened')
        AND (i.expires_at IS NULL OR i.expires_at > NOW())
      ORDER BY i.created_at DESC, i.id DESC LIMIT $3`, [companyId, candidateId, INVITE_LIMIT]),
    db.query('SELECT key, label FROM areas ORDER BY label ASC'),
  ]);
  return { invites: invites.rows.map((item) => ({ ...item, id: String(item.id) })), areas: areas.rows, consent: t(locale, 'motivators.consent') };
}

// Caller supplies one transaction. Lock order is invite then attempt for both actions.
export async function changeEmployeeMotivators(dbOrQuery, scope, input) {
  const db = asDb(dbOrQuery);
  const { companyId, candidateId } = scope;
  const invite = await db.query(`SELECT i.id, i.status, i.definition_id AS "definitionId", d.slug, d.version,
      (i.expires_at IS NOT NULL AND i.expires_at <= NOW()) AS expired
    FROM ae_invites i JOIN ae_definitions d ON d.id = i.definition_id AND d.active = TRUE
    WHERE i.company_id = $1 AND i.candidate_id = $2
      AND i.id = ${input.action === MotivatorsAction.Start ? '$3' : '(SELECT invite_id FROM ae_attempts WHERE id = $3 AND company_id = $1 AND candidate_id = $2)'}
    FOR UPDATE OF i`, [companyId, candidateId, input.action === MotivatorsAction.Start ? input.inviteId : input.attemptId]);
  const row = invite.rows[0];
  if (!row || row.status === 'cancelled' || row.expired) return unavailable();
  if (input.action === MotivatorsAction.Start) {
    if (row.status !== 'sent' && row.status !== 'opened') return unavailable();
    const area = await db.query('SELECT id FROM areas WHERE key = $1 LIMIT 1', [input.areaKey]);
    if (!area.rowCount || input.consent !== true) return { ok: false, errorCode: ERR.INVALID_DATA };
    const current = await db.query(`SELECT id, question_ids AS "questionIds" FROM ae_attempts
      WHERE invite_id = $1 AND company_id = $2 AND candidate_id = $3 AND status = $4
      ORDER BY id DESC LIMIT 1 FOR UPDATE`, [row.id, companyId, candidateId, AttemptStatus.Progress]);
    if (current.rowCount) {
      const questions = await loadQuestionsForScoring(db, current.rows[0].questionIds);
      return { ok: true, attemptId: String(current.rows[0].id), questions: toPublicQuestions(questions, input.locale) };
    }
    const drawn = await drawMotivatorsQuestions(db, row.slug);
    if (!drawn.ok) return drawn;
    const attempt = await db.query(`INSERT INTO ae_attempts
      (invite_id, definition_id, company_id, candidate_id, area_id, status, question_ids, algorithm_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [row.id, row.definitionId, companyId, candidateId, area.rows[0].id, AttemptStatus.Progress, drawn.questions.map((q) => q.id), String(row.version || '1')]);
    await db.query(`UPDATE ae_invites SET status = 'opened', opened_at = COALESCE(opened_at, NOW()) WHERE id = $1 AND company_id = $2 AND candidate_id = $3`, [row.id, companyId, candidateId]);
    return { ok: true, attemptId: String(attempt.rows[0].id), questions: toPublicQuestions(drawn.questions, input.locale) };
  }
  const attempts = await db.query(`SELECT id, status, question_ids AS "questionIds" FROM ae_attempts
    WHERE id = $1 AND company_id = $2 AND candidate_id = $3 AND invite_id = $4 FOR UPDATE`, [input.attemptId, companyId, candidateId, row.id]);
  const attempt = attempts.rows[0];
  if (!attempt) return unavailable();
  if (attempt.status === AttemptStatus.Completed) return { ok: true, completed: true };
  if (row.status === AttemptStatus.Completed || attempt.status !== AttemptStatus.Progress) return unavailable();
  const questions = await loadQuestionsForScoring(db, attempt.questionIds);
  const scored = computeMotivatorScores({ questions, answers: input.answers });
  if (!scored.ok || formatScoringFailure(scored, summarizeScoringInput(questions, input.answers))) return { ok: false, errorCode: ERR.INVALID_DATA };
  const texts = await resolveResultTextsFromDb(db, row.definitionId, scored, input.locale);
  await db.query(`UPDATE ae_attempts SET status = $2, completed_at = NOW(), dimension_scores = $3::jsonb,
    ranking = $4::jsonb, profile_summary = $5, manager_recommendations = $6::jsonb, answers = $7::jsonb, algorithm_version = $8
    WHERE id = $1 AND company_id = $9 AND candidate_id = $10`,
  [attempt.id, AttemptStatus.Completed, JSON.stringify(scored.dimensionScores), JSON.stringify(scored.ranking), texts.profileSummary,
    JSON.stringify(texts.managerRecommendations), JSON.stringify(input.answers), AE_SCORING_ENGINE_VERSION, companyId, candidateId]);
  await db.query(`UPDATE ae_invites SET status = 'completed', completed_at = NOW() WHERE id = $1 AND company_id = $2 AND candidate_id = $3`, [row.id, companyId, candidateId]);
  await notifyCompanyManagers(db, { companyId, type: NOTIF.MOTIVATORS_COMPLETED, entityType: 'candidate', entityId: candidateId,
    dedupeKey: `motivators_completed:${attempt.id}`, payload: { candidateId, attemptId: attempt.id } });
  const signals = buildManagementHypotheses({ locale: input.locale, motivators: { dimensionScores: scored.dimensionScores, ranking: scored.ranking } }).retentionSignals || [];
  if (signals.length) await notifyCompanyManagers(db, { companyId, type: NOTIF.RETENTION_WATCH, entityType: 'candidate', entityId: candidateId,
    dedupeKey: `retention_watch:attempt:${attempt.id}`, payload: { candidateId, attemptId: attempt.id, signalLabels: signals.map((s) => s.label || s.key).filter(Boolean).join(', '), signalKeys: signals.map((s) => s.key) } });
  return { ok: true, completed: true };
}
