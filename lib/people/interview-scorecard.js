/**
 * Interview scorecard (B-407) — light checklist from buildInterviewQuestions.
 */

import { asDb } from '../ae/as-db.js';
import { buildInterviewQuestions } from './decision-brief.js';
import { ERR } from '../api-error-codes.js';

const RATING_MIN = 1;
const RATING_MAX = 5;
const COMMENT_MAX = 2000;

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 12)
    .map((row) => {
      const questionId = String(row?.questionId || row?.id || '').trim().slice(0, 64);
      const text = String(row?.text || '').trim().slice(0, 500);
      let rating = row?.rating != null ? Number(row.rating) : null;
      if (rating != null && (!Number.isFinite(rating) || rating < RATING_MIN || rating > RATING_MAX)) {
        rating = null;
      } else if (rating != null) {
        rating = Math.round(rating);
      }
      const comment = String(row?.comment || '').trim().slice(0, COMMENT_MAX);
      if (!questionId && !text) return null;
      const item = {
        questionId: questionId || `q-${text.slice(0, 24)}`,
        text,
        rating,
        comment: comment || '',
      };
      for (const key of ['competency', 'candidateEvidence', 'followUp', 'listenFor']) {
        const value = String(row?.[key] || '').trim();
        if (value) item[key] = value.slice(0, key === 'candidateEvidence' ? 280 : key === 'competency' ? 100 : 400);
      }
      if (row?.generatedByAi === true) item.generatedByAi = true;
      return item;
    })
    .filter(Boolean);
}

export function draftScorecardItemsFromBrief(briefOrInput = {}, locale = 'pt-BR') {
  const qs = Array.isArray(briefOrInput?.interviewQuestions)
    ? briefOrInput.interviewQuestions
    : buildInterviewQuestions({
        locale,
        topType: briefOrInput.topType,
        motivatorKeys: briefOrInput.motivatorKeys,
      });
  return qs.map((q) => ({
    questionId: String(q.id || ''),
    text: String(q.text || ''),
    rating: null,
    comment: '',
  }));
}

export async function getInterviewScorecard(dbOrQuery, {
  vacancyId,
  candidateId,
  companyId,
  isAdmin = false,
}) {
  const db = asDb(dbOrQuery);
  const vid = Number(vacancyId);
  const cid = Number(candidateId);
  if (!Number.isFinite(vid) || !Number.isFinite(cid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA, status: 400 };
  }

  const params = [vid, cid];
  let companyClause = '';
  if (!isAdmin) {
    if (companyId == null) return { ok: false, errorCode: ERR.UNAUTHORIZED, status: 401 };
    companyClause = 'AND s.company_id = $3';
    params.push(companyId);
  }

  const res = await db.query(
    `SELECT s.id, s.company_id AS "companyId", s.vacancy_id AS "vacancyId",
            s.candidate_id AS "candidateId", s.items,
            s.updated_at AS "updatedAt"
     FROM interview_scorecards s
     WHERE s.vacancy_id = $1 AND s.candidate_id = $2 ${companyClause}
     LIMIT 1`,
    params
  );

  if (!res.rowCount) {
    return { ok: true, scorecard: null };
  }
  const row = res.rows[0];
  return {
    ok: true,
    scorecard: {
      ...row,
      items: normalizeItems(row.items),
    },
  };
}

export async function upsertInterviewScorecard(dbOrQuery, {
  vacancyId,
  candidateId,
  companyId,
  isAdmin = false,
  items,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const vid = Number(vacancyId);
  const cid = Number(candidateId);
  if (!Number.isFinite(vid) || !Number.isFinite(cid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA, status: 400 };
  }

  const vacParams = [vid];
  let vacCompany = '';
  if (!isAdmin) {
    if (companyId == null) return { ok: false, errorCode: ERR.UNAUTHORIZED, status: 401 };
    vacCompany = 'AND v.company_id = $2';
    vacParams.push(companyId);
  }

  const vac = await db.query(
    `SELECT v.id, v.company_id AS "companyId"
     FROM vacancies v
     WHERE v.id = $1 AND v.deleted = FALSE ${vacCompany}
     LIMIT 1`,
    vacParams
  );
  if (!vac.rowCount) return { ok: false, errorCode: ERR.VACANCY_NOT_FOUND, status: 404 };
  const scopedCompanyId = Number(vac.rows[0].companyId);

  const cand = await db.query(
    `SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [cid, scopedCompanyId]
  );
  if (!cand.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };

  const normalized = normalizeItems(items);
  const createdBy =
    createdByUserId != null && Number.isFinite(Number(createdByUserId))
      ? Number(createdByUserId)
      : null;

  const up = await db.query(
    `INSERT INTO interview_scorecards (
       company_id, vacancy_id, candidate_id, items, created_by_user_id, updated_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
     ON CONFLICT (vacancy_id, candidate_id) DO UPDATE SET
       items = EXCLUDED.items,
       updated_at = NOW()
     RETURNING id, company_id AS "companyId", vacancy_id AS "vacancyId",
               candidate_id AS "candidateId", items, updated_at AS "updatedAt"`,
    [scopedCompanyId, vid, cid, JSON.stringify(normalized), createdBy]
  );

  return {
    ok: true,
    scorecard: {
      ...up.rows[0],
      items: normalizeItems(up.rows[0].items),
    },
  };
}
