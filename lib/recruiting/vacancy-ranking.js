import { rejectionReasonsSql } from './pipeline.js';
/**
 * Vacancy candidate ranking (fit vs rubric + optional company nucleus).
 */

import { queryRead } from '../db.js';
import { candidateTagFilterSql, candidateTagsSelectSql } from './candidate-tags-core.js';
import { computeAreaScore010 } from '../assessment/area-fit.js';
import { loadCompanyInternalNucleus } from '../people/company-nucleus.js';
import { scorePersonAgainstNucleus } from '../people/decision-brief.js';
import { scoreCvTextAgainstVacancy } from './candidate-cv.js';
import { ERR } from '../api-error-codes.js';
import { OFFER_STATUS } from '../domain-status.js';
import { measureAsync } from '../monitoring.js';
import { contentLocale } from '../i18n.js';

const RANKING_CAP = 200;

/**
 * @param {{ vacancyId: number, companyId: number|null, isAdmin: boolean, locale?: string }} opts
 */
export async function getVacancyRanking(opts) {
  return measureAsync('vacancies.ranking', () => getVacancyRankingUnmetered(opts));
}

async function getVacancyRankingUnmetered({ vacancyId, companyId, isAdmin, locale = 'pt-BR', tagIds = [], tagMode = 'any' }) {
  const vid = Number(vacancyId);
  if (!Number.isFinite(vid) || vid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_VACANCY };
  }

  const own = await queryRead(
    `SELECT v.id, v.company_id AS "companyId", v.description AS "vacancyDescription"
     FROM vacancies v
     WHERE v.id = $1 AND v.deleted = FALSE ${!isAdmin ? 'AND v.company_id = $2' : ''}
     LIMIT 1`,
    !isAdmin ? [vid, companyId] : [vid]
  );
  if (own.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const vacCompanyId = Number(own.rows[0].companyId);
  const vacancyDescription = own.rows[0].vacancyDescription || '';

  const rub = await queryRead(
    `SELECT desired_type_weights AS weights FROM vacancy_rubrics WHERE vacancy_id = $1 LIMIT 1`,
    [vid]
  );
  const weights =
    rub.rows?.[0]?.weights && Object.keys(rub.rows[0].weights).length ? rub.rows[0].weights : {};

  const briefLocale = contentLocale(locale);

  const nucleus = Number.isFinite(vacCompanyId)
    ? await loadCompanyInternalNucleus(queryRead, { companyId: vacCompanyId })
    : [];

  const rankingParams = [vid, vacCompanyId];
  const tagWhere = candidateTagFilterSql('tag_candidate', { tagIds, tagMode }, rankingParams);
  const rows = await queryRead(
    `SELECT ranking.*, COUNT(*) OVER()::int AS "matchingTotal" FROM (
       SELECT
         ass.id AS "assessmentId",
         vc.id AS "vacancyCandidateId",
         c.id AS "candidateId",
         ${candidateTagsSelectSql('c')} AS tags,
         c.full_name AS "name",
         c.email AS "email",
         assignment.owner_user_id AS "ownerUserId",
         COALESCE(NULLIF(TRIM(owner.display_name), ''), owner.email) AS "ownerName",
         c.cv_extracted_text AS "cvExtractedText",
         ass.top_type AS "topType",
         ass.scores,
         ass.pipeline_stage AS "pipelineStage",
         ass.rejection_reason AS "rejectionReason", ${rejectionReasonsSql('ass')} AS "rejectionReasons",
         ass.start_date AS "startDate",
         ass.created_at AS "createdAt",
         COALESCE(stg.changed_at, ass.created_at) AS "stageEnteredAt",
         FALSE AS "pendingTest",
         inv.status AS "inviteStatus",
         inv.sent_at AS "inviteSentAt",
         CASE
           WHEN vc.interview_notes IS NULL THEN FALSE
           WHEN TRIM(regexp_replace(vc.interview_notes, '<[^>]*>', '', 'g')) = '' THEN FALSE
           ELSE TRUE
         END AS "hasNotes",
         COALESCE(NULLIF(vc.offer_status, ''), NULLIF(ass.offer_status, ''), '${OFFER_STATUS.NONE}') AS "offerStatus",
         COALESCE(NULLIF(vc.offer_salary, ''), ass.offer_salary, '') AS "offerSalary",
         COALESCE(vc.offer_start_date, ass.offer_start_date) AS "offerStartDate",
         COALESCE(NULLIF(vc.offer_notes, ''), ass.offer_notes, '') AS "offerNotes"
       FROM assessments ass
       JOIN candidates c ON c.id = ass.candidate_id
       LEFT JOIN recruiting_candidate_assignments assignment
         ON assignment.vacancy_id = ass.vacancy_id AND assignment.candidate_id = ass.candidate_id
       LEFT JOIN users owner ON owner.id = assignment.owner_user_id AND owner.deleted = FALSE
       LEFT JOIN vacancy_candidates vc
         ON vc.vacancy_id = ass.vacancy_id AND vc.candidate_id = ass.candidate_id
       LEFT JOIN LATERAL (
         SELECT h.changed_at
         FROM assessment_pipeline_history h
         WHERE h.assessment_id = ass.id
         ORDER BY h.changed_at DESC NULLS LAST, h.id DESC
         LIMIT 1
       ) stg ON TRUE
       LEFT JOIN LATERAL (
         SELECT ci.status, ci.sent_at
         FROM candidate_invites ci
         WHERE ci.vacancy_id = ass.vacancy_id
           AND ci.status <> 'cancelled'
           AND (
             ci.candidate_id = ass.candidate_id
             OR (c.email IS NOT NULL AND LOWER(ci.candidate_email) = LOWER(c.email))
           )
         ORDER BY ci.sent_at DESC NULLS LAST, ci.id DESC
         LIMIT 1
       ) inv ON TRUE
       WHERE ass.vacancy_id = $1 AND ass.company_id = $2 AND c.company_id = $2

       UNION ALL

       SELECT
         NULL::bigint AS "assessmentId",
         vc.id AS "vacancyCandidateId",
         c.id AS "candidateId",
         ${candidateTagsSelectSql('c')} AS tags,
         c.full_name AS "name",
         c.email AS "email",
         assignment.owner_user_id AS "ownerUserId",
         COALESCE(NULLIF(TRIM(owner.display_name), ''), owner.email) AS "ownerName",
         c.cv_extracted_text AS "cvExtractedText",
         NULL::integer AS "topType",
         NULL::jsonb AS scores,
         COALESCE(vc.pipeline_stage, 'new') AS "pipelineStage",
         vc.rejection_reason AS "rejectionReason", ${rejectionReasonsSql('vc')} AS "rejectionReasons",
         vc.start_date AS "startDate",
         vc.created_at AS "createdAt",
         COALESCE(stg.changed_at, vc.created_at) AS "stageEnteredAt",
         TRUE AS "pendingTest",
         inv.status AS "inviteStatus",
         inv.sent_at AS "inviteSentAt",
         CASE
           WHEN vc.interview_notes IS NULL THEN FALSE
           WHEN TRIM(regexp_replace(vc.interview_notes, '<[^>]*>', '', 'g')) = '' THEN FALSE
           ELSE TRUE
         END AS "hasNotes",
         COALESCE(NULLIF(vc.offer_status, ''), '${OFFER_STATUS.NONE}') AS "offerStatus",
         COALESCE(vc.offer_salary, '') AS "offerSalary",
         vc.offer_start_date AS "offerStartDate",
         COALESCE(vc.offer_notes, '') AS "offerNotes"
       FROM vacancy_candidates vc
       JOIN candidates c ON c.id = vc.candidate_id
       LEFT JOIN recruiting_candidate_assignments assignment
         ON assignment.vacancy_id = vc.vacancy_id AND assignment.candidate_id = vc.candidate_id
       LEFT JOIN users owner ON owner.id = assignment.owner_user_id AND owner.deleted = FALSE
       LEFT JOIN LATERAL (
         SELECT h.changed_at
         FROM vacancy_candidate_pipeline_history h
         WHERE h.vacancy_candidate_id = vc.id
         ORDER BY h.changed_at DESC NULLS LAST, h.id DESC
         LIMIT 1
       ) stg ON TRUE
       LEFT JOIN LATERAL (
         SELECT ci.status, ci.sent_at
         FROM candidate_invites ci
         WHERE ci.vacancy_id = vc.vacancy_id
           AND ci.status <> 'cancelled'
           AND (
             ci.candidate_id = vc.candidate_id
             OR (c.email IS NOT NULL AND LOWER(ci.candidate_email) = LOWER(c.email))
           )
         ORDER BY ci.sent_at DESC NULLS LAST, ci.id DESC
         LIMIT 1
       ) inv ON TRUE
       WHERE vc.vacancy_id = $1
         AND (
           vc.pipeline_stage IS NOT NULL
           OR inv.status IS NOT NULL
         )
         AND vc.company_id = $2 AND c.company_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM assessments a
           WHERE a.vacancy_id = vc.vacancy_id AND a.candidate_id = vc.candidate_id
         )
     ) ranking
     JOIN candidates tag_candidate ON tag_candidate.id = ranking."candidateId" AND tag_candidate.company_id = $2
     WHERE ${tagWhere}
     ORDER BY "createdAt" DESC
     LIMIT ${RANKING_CAP}`,
    rankingParams
  );

  const ranked = rows.rows.map((r) => {
    const fit = computeAreaScore010(r.scores, weights, { withBreakdown: true });
    let nucleusFit = null;
    if (r.topType != null && nucleus.length > 0) {
      const scored = scorePersonAgainstNucleus({
        locale: briefLocale,
        person: { id: r.candidateId, topType: r.topType },
        nucleus,
      });
      nucleusFit = {
        synergy: scored.synergy,
        tension: scored.tension,
        net: scored.net,
        summary: scored.summary,
        highlights: scored.highlights,
        empty: scored.empty,
      };
    }
    const textMatch =
      r.cvExtractedText && vacancyDescription
        ? scoreCvTextAgainstVacancy({
            cvText: r.cvExtractedText,
            vacancyDescription,
          })
        : { textMatchScore: null, textMatchLabel: null };
    return {
      ...r,
      cvExtractedText: undefined,
      matchingTotal: undefined,
      vacancyFitScore010: fit.score010,
      vacancyFitLabel: fit.label,
      fitBreakdown: fit.breakdown || null,
      nucleusFit,
      textMatchScore: textMatch.textMatchScore,
      textMatchLabel: textMatch.textMatchLabel,
    };
  });

  ranked.sort((a, b) => {
    const av = a.vacancyFitScore010;
    const bv = b.vacancyFitScore010;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  return {
    ok: true,
    vacancyId: vid,
    companyId: vacCompanyId,
    ranking: ranked,
    nucleusSize: nucleus.length,
    total: rows.rows[0]?.matchingTotal ?? 0,
    truncated: (rows.rows[0]?.matchingTotal ?? 0) > RANKING_CAP,
    rankingCap: RANKING_CAP,
  };
}
