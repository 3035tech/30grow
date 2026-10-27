/**
 * Dossier unificado da pessoa (B-1901) — empacota sinais já medidos
 * (Eneagrama, Motivadores, briefing, PDI, performance, retenção, check-ins, HR Score).
 * Clima permanece sinal de empresa (anônimo) — só contexto.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { DEVELOPMENT_PLAN_STATUS, PERFORMANCE_GOAL_OUTCOME, PERFORMANCE_REVIEW_STATUS } from '../domain-status.js';
import { getHrScore } from '../assessment/hr-score.js';
import { buildCandidatePeopleBrief } from './candidate-people-brief.js';
import { listDevelopmentPlans } from './development-plans.js';
import { listOnboardingCheckins } from './onboarding-checkins.js';
import { listRetentionFollowUps } from './retention-followups.js';
import { getCompanyClimatePulse } from './climate-surveys.js';

const BRIEF_ALERTS_CAP = 5;

/**
 * Última review de desempenho do candidato (qualquer ciclo da empresa).
 */
async function loadLatestPerformanceSnapshot(db, { companyId, candidateId }) {
  try {
    const res = await db.query(
      `SELECT r.id, r.status, r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
              r.cycle_id AS "cycleId", c.title AS "cycleTitle", r.outcomes,
              (SELECT COUNT(*)::int FROM performance_goals g
                WHERE g.cycle_id = r.cycle_id AND g.candidate_id = r.candidate_id) AS "goalCount"
       FROM performance_reviews r
       JOIN performance_cycles c ON c.id = r.cycle_id AND c.company_id = r.company_id
       WHERE r.company_id = $1 AND r.candidate_id = $2
       ORDER BY r.submitted_at DESC NULLS LAST, r.updated_at DESC, r.id DESC
       LIMIT 1`,
      [companyId, candidateId]
    );
    if (!res.rowCount) return null;
    const row = res.rows[0];
    const outcomes = row.outcomes && typeof row.outcomes === 'object' ? row.outcomes : {};
    const developCount = Object.values(outcomes).filter(
      (o) => o && typeof o === 'object' && o.outcome === PERFORMANCE_GOAL_OUTCOME.DEVELOP
    ).length;
    let sideReviewCount = 0;
    let sideReviewSubmitted = 0;
    try {
      const side = await db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted
         FROM performance_side_reviews
         WHERE company_id = $1 AND candidate_id = $2 AND cycle_id = $3`,
        [companyId, candidateId, row.cycleId]
      );
      sideReviewCount = Number(side.rows[0]?.total) || 0;
      sideReviewSubmitted = Number(side.rows[0]?.submitted) || 0;
    } catch {
      /* optional table */
    }
    return {
      id: row.id,
      status: row.status,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
      cycleId: row.cycleId,
      cycleTitle: row.cycleTitle,
      goalCount: row.goalCount,
      developCount,
      sideReviewCount,
      sideReviewSubmitted,
    };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return null;
    throw err;
  }
}

/**
 * @param {{ query: Function } | Function} dbOrQuery
 * @param {{
 *   candidateId: number,
 *   companyId: number,
 *   locale?: string,
 *   isAdmin?: boolean,
 * }} opts
 */
export async function buildPersonDossier(dbOrQuery, opts) {
  const candidateId = Number(opts.candidateId);
  const companyId = Number(opts.companyId);
  const locale = opts.locale || 'pt-BR';
  const isAdmin = Boolean(opts.isAdmin);

  if (!Number.isFinite(candidateId) || candidateId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_PARAMS };
  }
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }

  const db = asDb(dbOrQuery);

  const candRes = await db.query(
    `SELECT id, full_name AS "fullName", email, company_id AS "companyId",
            employment_status AS "employmentStatus"
     FROM candidates
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [candidateId, companyId]
  );
  if (candRes.rowCount === 0) {
    return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  }
  const candidate = candRes.rows[0];

  const [people, plans, checkins, followUps, performance, hrScore, climatePulse] =
    await Promise.all([
      buildCandidatePeopleBrief(db, { candidateId, companyId, locale, isAdmin }),
      listDevelopmentPlans(db, { companyId, candidateId, limit: 3 }).catch((err) => {
        if (err?.code === '42P01') return [];
        throw err;
      }),
      listOnboardingCheckins(db, { companyId, candidateId }).catch((err) => {
        if (err?.code === '42P01') return [];
        throw err;
      }),
      listRetentionFollowUps(db, { companyId, candidateId, limit: 5 }).catch((err) => {
        if (err?.code === '42P01') return [];
        throw err;
      }),
      loadLatestPerformanceSnapshot(db, { companyId, candidateId }),
      getHrScore(candidateId).catch(() => null),
      getCompanyClimatePulse(db, { companyId }),
    ]);

  const activePlan =
    (Array.isArray(plans) ? plans : []).find((p) => p.status === DEVELOPMENT_PLAN_STATUS.ACTIVE) ||
    (Array.isArray(plans) ? plans[0] : null) ||
    null;

  const checkinList = Array.isArray(checkins) ? checkins : [];
  const concernCheckins = checkinList.filter(
    (c) => String(c.outcome || '').toLowerCase() === 'concern'
  );
  const openFollowUps = (Array.isArray(followUps) ? followUps : []).filter((f) => !f.reviewedAt);

  const brief = people?.decisionBrief || null;
  const alerts = Array.isArray(brief?.alerts) ? brief.alerts.slice(0, BRIEF_ALERTS_CAP) : [];
  const doItems = Array.isArray(brief?.actionsDo) ? brief.actionsDo.slice(0, 4) : [];
  const avoidItems = Array.isArray(brief?.actionsAvoid) ? brief.actionsAvoid.slice(0, 4) : [];

  const hasEnneagram = Boolean(brief?.hasAny || people?.management?.hypotheses?.length);
  const hasMotivators = Boolean(people?.motivatorsAttempt);
  const signalCount = [
    hasEnneagram,
    hasMotivators,
    Boolean(activePlan),
    Boolean(performance),
    Boolean(hrScore),
    openFollowUps.length > 0,
    concernCheckins.length > 0,
  ].filter(Boolean).length;

  return {
    ok: true,
    candidate: {
      id: candidate.id,
      fullName: candidate.fullName,
      email: candidate.email,
      employmentStatus: candidate.employmentStatus,
    },
    meta: {
      signalCount,
      locale,
      climateIsCompanyLevel: true,
    },
    profile: {
      hasEnneagram,
      hasMotivators,
      topType: people?.management?.enneagram?.topType ?? null,
      motivatorsCompletedAt: people?.motivatorsAttempt?.completedAt || null,
      motivatorsTop:
        Array.isArray(people?.motivatorsAttempt?.ranking)
          ? people.motivatorsAttempt.ranking.slice(0, 3)
          : [],
    },
    briefing: {
      alerts,
      do: doItems,
      avoid: avoidItems,
      interviewCount: Array.isArray(brief?.interviewQuestions) ? brief.interviewQuestions.length : 0,
      teamHintCount: brief?.team && !brief.team.empty ? 1 : 0,
      nucleusFit: people?.nucleusFit || null,
    },
    pdi: activePlan
      ? {
          id: activePlan.id,
          title: activePlan.title,
          status: activePlan.status,
          itemCount: activePlan.itemCount ?? null,
          doneCount: activePlan.doneCount ?? null,
          periodEnd: activePlan.periodEnd || null,
        }
      : null,
    performance: performance
      ? {
          id: performance.id,
          cycleId: performance.cycleId,
          cycleTitle: performance.cycleTitle,
          status: performance.status,
          submittedAt: performance.submittedAt,
          goalCount: performance.goalCount,
          developCount: performance.developCount,
          sideReviewCount: performance.sideReviewCount || 0,
          sideReviewSubmitted: performance.sideReviewSubmitted || 0,
          isSubmitted: performance.status === PERFORMANCE_REVIEW_STATUS.SUBMITTED,
        }
      : null,
    retention: {
      openFollowUpCount: openFollowUps.length,
      latest: openFollowUps[0]
        ? {
            id: openFollowUps[0].id,
            reviewDue: openFollowUps[0].reviewDue || null,
            suggestedQuestion: openFollowUps[0].suggestedQuestion || null,
          }
        : null,
    },
    onboarding: {
      checkinCount: checkinList.length,
      concernCount: concernCheckins.length,
      latestConcern: concernCheckins[0]
        ? {
            id: concernCheckins[0].id,
            milestoneDays: concernCheckins[0].milestoneDays ?? null,
            dueDate: concernCheckins[0].dueDate || null,
          }
        : null,
    },
    hrScore: hrScore
      ? {
          score: hrScore.score,
          turnoverRisk: hrScore.turnoverRisk,
          turnoverReasons: Array.isArray(hrScore.turnoverReasons)
            ? hrScore.turnoverReasons.slice(0, 4)
            : [],
          pdiGapAreas: Array.isArray(hrScore.pdiGapAreas) ? hrScore.pdiGapAreas.slice(0, 4) : [],
          calculatedAt: hrScore.calculatedAt,
        }
      : null,
    climateCompany: climatePulse
      ? {
          latestMean: climatePulse.latestMean,
          deltaVsPrevious: climatePulse.deltaVsPrevious,
          openSurveys: climatePulse.openSurveys,
        }
      : null,
  };
}
