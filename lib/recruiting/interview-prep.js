/**
 * B-2709 — candidate interview prep (public token).
 * Questions are hedged practice prompts; answers stay on the device.
 * Manager only sees prepared_at (not answer content).
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { query } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { buildInterviewQuestions } from '../people/decision-brief.js';
import { rubricWeightedTypes } from './vacancy-report-shared.js';
import { VACANCY_STATUS } from '../domain-status.js';

const PREP_TTL_DAYS = 30;

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function mapLinkRow(row) {
  return {
    id: row.id,
    token: row.token,
    preparedAt: row.preparedAt,
    expiresAt: row.expiresAt,
    path: `/prep/${row.token}`,
    prepared: Boolean(row.preparedAt),
  };
}

/**
 * Ensure a prep link exists for vacancy+candidate; returns token + url path.
 */
export async function ensureInterviewPrepLink(dbOrQuery, {
  companyId,
  vacancyId,
  candidateId,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const vid = Number(vacancyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(vid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  try {
    const existing = await db.query(
      `SELECT id, token, prepared_at AS "preparedAt", expires_at AS "expiresAt"
       FROM interview_prep_links
       WHERE vacancy_id = $1 AND candidate_id = $2
       LIMIT 1`,
      [vid, cand]
    );
    if (existing.rowCount > 0) {
      return { ok: true, link: mapLinkRow(existing.rows[0]) };
    }

    const token = newToken();
    const uid = Number(createdByUserId);
    const ins = await db.query(
      `INSERT INTO interview_prep_links (
         company_id, vacancy_id, candidate_id, token, created_by_user_id, expires_at
       ) VALUES ($1, $2, $3, $4, $5, NOW() + ($6::int * INTERVAL '1 day'))
       RETURNING id, token, prepared_at AS "preparedAt", expires_at AS "expiresAt"`,
      [cid, vid, cand, token, Number.isFinite(uid) && uid > 0 ? uid : null, PREP_TTL_DAYS]
    );
    return {
      ok: true,
      link: mapLinkRow(ins.rows[0]),
      created: true,
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}

export async function getInterviewPrepStatus(dbOrQuery, {
  companyId,
  vacancyId,
  candidateId,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const vid = Number(vacancyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(vid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  try {
    const params = [vid, cand];
    let companyClause = '';
    if (cid) {
      params.push(cid);
      companyClause = `AND company_id = $${params.length}`;
    }
    const r = await db.query(
      `SELECT id, token, prepared_at AS "preparedAt", expires_at AS "expiresAt"
       FROM interview_prep_links
       WHERE vacancy_id = $1 AND candidate_id = $2 ${companyClause}
       LIMIT 1`,
      params
    );
    if (r.rowCount === 0) {
      return { ok: true, link: null };
    }
    const row = r.rows[0];
    return {
      ok: true,
      link: mapLinkRow(row),
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, link: null };
    throw err;
  }
}

/**
 * Public resolve: vacancy title, candidate first name, hedged questions, prepared flag.
 */
export async function resolveInterviewPrepByToken(dbOrQuery, { token, locale = 'pt-BR' }) {
  const db = asDb(dbOrQuery || query);
  const tok = String(token || '').trim();
  if (tok.length < 16) return { ok: false, errorCode: ERR.INVALID_TOKEN };

  try {
    const r = await db.query(
      `SELECT p.id, p.company_id AS "companyId", p.vacancy_id AS "vacancyId",
              p.candidate_id AS "candidateId", p.token, p.prepared_at AS "preparedAt",
              p.expires_at AS "expiresAt",
              v.title AS "vacancyTitle", v.status AS "vacancyStatus", v.deleted AS "vacancyDeleted",
              c.full_name AS "candidateName"
       FROM interview_prep_links p
       JOIN vacancies v ON v.id = p.vacancy_id AND v.company_id = p.company_id
       JOIN candidates c ON c.id = p.candidate_id AND c.company_id = p.company_id
       WHERE p.token = $1
       LIMIT 1`,
      [tok]
    );
    if (r.rowCount === 0) return { ok: false, errorCode: ERR.INVALID_TOKEN };
    const row = r.rows[0];
    if (row.vacancyDeleted || row.vacancyStatus === VACANCY_STATUS.CLOSED) {
      return { ok: false, errorCode: ERR.EXPIRED_LINK };
    }
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
      return { ok: false, errorCode: ERR.EXPIRED_LINK };
    }

    const profile = await loadPrepProfile(db, {
      companyId: row.companyId,
      vacancyId: row.vacancyId,
      candidateId: row.candidateId,
    });
    const questions = buildInterviewQuestions({
      locale,
      topType: profile.topType,
      motivatorKeys: profile.motivatorKeys,
      preferredTypes: profile.preferredTypes,
    });

    const firstName = String(row.candidateName || '')
      .trim()
      .split(/\s+/)[0] || null;

    return {
      ok: true,
      prep: {
        vacancyTitle: row.vacancyTitle,
        candidateFirstName: firstName,
        preparedAt: row.preparedAt,
        prepared: Boolean(row.preparedAt),
        expiresAt: row.expiresAt,
        questions: questions.map((q) => ({ id: q.id, text: q.text })),
      },
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}

async function loadPrepProfile(db, { companyId, vacancyId, candidateId }) {
  const [ass, rub] = await Promise.all([
    db.query(
      `SELECT a.top_type AS "topType"
       FROM assessments a
       WHERE a.candidate_id = $1 AND a.company_id = $2
         AND a.top_type IS NOT NULL
       ORDER BY a.created_at DESC NULLS LAST, a.id DESC
       LIMIT 1`,
      [candidateId, companyId]
    ),
    db.query(
      `SELECT desired_type_weights AS weights
       FROM vacancy_rubrics WHERE vacancy_id = $1 LIMIT 1`,
      [vacancyId]
    ),
  ]);

  let motivatorKeys = [];
  try {
    const mot = await db.query(
      `SELECT dimension_scores AS "dimensionScores"
       FROM ae_attempts
       WHERE candidate_id = $1 AND company_id = $2
         AND status = 'completed'
         AND dimension_scores IS NOT NULL
       ORDER BY completed_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [candidateId, companyId]
    );
    const scores = mot.rows[0]?.dimensionScores;
    if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
      motivatorKeys = Object.entries(scores)
        .map(([key, val]) => ({ key, n: Number(val) || 0 }))
        .sort((a, b) => b.n - a.n)
        .map((x) => x.key)
        .slice(0, 3);
    }
  } catch {
    motivatorKeys = [];
  }

  const topType = ass.rows[0]?.topType != null ? Number(ass.rows[0].topType) : null;
  const preferredTypes = rubricWeightedTypes(rub.rows[0]?.weights || {})
    .slice(0, 3)
    .map((x) => x.type);

  return {
    topType: Number.isInteger(topType) && topType >= 1 && topType <= 9 ? topType : null,
    preferredTypes,
    motivatorKeys,
  };
}

export async function markInterviewPrepPrepared(dbOrQuery, { token }) {
  const db = asDb(dbOrQuery || query);
  const tok = String(token || '').trim();
  if (tok.length < 16) return { ok: false, errorCode: ERR.INVALID_TOKEN };
  try {
    const r = await db.query(
      `UPDATE interview_prep_links
       SET prepared_at = COALESCE(prepared_at, NOW())
       WHERE token = $1
         AND expires_at > NOW()
       RETURNING id, prepared_at AS "preparedAt"`,
      [tok]
    );
    if (r.rowCount === 0) {
      const exists = await db.query(
        `SELECT id, expires_at AS "expiresAt", prepared_at AS "preparedAt"
         FROM interview_prep_links WHERE token = $1 LIMIT 1`,
        [tok]
      );
      if (exists.rowCount === 0) return { ok: false, errorCode: ERR.INVALID_TOKEN };
      if (exists.rows[0].expiresAt && new Date(exists.rows[0].expiresAt).getTime() < Date.now()) {
        return { ok: false, errorCode: ERR.EXPIRED_LINK };
      }
      return { ok: true, preparedAt: exists.rows[0].preparedAt };
    }
    return { ok: true, preparedAt: r.rows[0].preparedAt };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}
