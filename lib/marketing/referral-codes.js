/**
 * Códigos referral (?ref=) — CRUD admin + analytics por código.
 */

import { query, queryRead } from '../db.js';
import { ERR } from '../api-error-codes.js';

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

/**
 * Normaliza código digitado (slug uppercase).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeReferralCode(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!s || !CODE_RE.test(s)) return null;
  return s;
}

function randomCode(len = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * @param {{ companyId: number, vacancyId?: number|null, code?: string|null, label?: string|null, ownerUserId?: number|null, ownerCandidateId?: number|null }} input
 */
export async function createReferralCode(input) {
  const companyId = Number(input.companyId);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_COMPANY };
  }

  let vacancyId = null;
  if (input.vacancyId != null && input.vacancyId !== '') {
    vacancyId = Number(input.vacancyId);
    if (!Number.isFinite(vacancyId) || vacancyId <= 0) {
      return { ok: false, errorCode: ERR.INVALID_VACANCY };
    }
    const vac = await queryRead(
      `SELECT id FROM vacancies
       WHERE id = $1 AND company_id = $2 AND deleted = FALSE
       LIMIT 1`,
      [vacancyId, companyId]
    );
    if (vac.rowCount === 0) return { ok: false, errorCode: ERR.INVALID_VACANCY };
  }

  let code = input.code ? normalizeReferralCode(input.code) : null;
  if (input.code && !code) return { ok: false, errorCode: ERR.INVALID_DATA };

  const label = input.label ? String(input.label).trim().slice(0, 120) || null : null;
  const ownerUserId =
    input.ownerUserId != null && Number.isFinite(Number(input.ownerUserId))
      ? Number(input.ownerUserId)
      : null;
  const ownerCandidateId =
    input.ownerCandidateId != null && Number.isFinite(Number(input.ownerCandidateId))
      ? Number(input.ownerCandidateId)
      : null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const tryCode = code || randomCode(8);
    try {
      const ins = await query(
        `INSERT INTO referral_codes (
           company_id, vacancy_id, code, label, owner_user_id, owner_candidate_id
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, company_id AS "companyId", vacancy_id AS "vacancyId",
                   code, label, active, owner_user_id AS "ownerUserId",
                   owner_candidate_id AS "ownerCandidateId",
                   created_at AS "createdAt"`,
        [companyId, vacancyId, tryCode, label, ownerUserId, ownerCandidateId]
      );
      return { ok: true, code: ins.rows[0] };
    } catch (err) {
      if (err?.code === '23505') {
        if (code) return { ok: false, errorCode: ERR.DUPLICATE_REFERRAL_CODE };
        continue;
      }
      throw err;
    }
  }
  return { ok: false, errorCode: ERR.DUPLICATE_REFERRAL_CODE };
}

/**
 * @param {{ companyId?: number|null, isAdmin?: boolean, vacancyId?: number|null, activeOnly?: boolean, limit?: number }} opts
 */
export async function listReferralCodes(opts = {}) {
  const limitRaw = Number(opts.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50;

  const params = [];
  const where = [];

  if (!opts.isAdmin) {
    const companyId = Number(opts.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return { ok: false, errorCode: ERR.UNAUTHORIZED };
    }
    params.push(companyId);
    where.push(`rc.company_id = $${params.length}`);
  } else if (opts.companyId != null) {
    const companyId = Number(opts.companyId);
    if (Number.isFinite(companyId) && companyId > 0) {
      params.push(companyId);
      where.push(`rc.company_id = $${params.length}`);
    }
  }

  if (opts.vacancyId != null) {
    const vacancyId = Number(opts.vacancyId);
    if (Number.isFinite(vacancyId) && vacancyId > 0) {
      params.push(vacancyId);
      where.push(`(rc.vacancy_id IS NULL OR rc.vacancy_id = $${params.length})`);
    }
  }

  if (opts.activeOnly) {
    where.push('rc.active = TRUE');
  }

  params.push(limit);
  const sql = `
    SELECT rc.id, rc.company_id AS "companyId", rc.vacancy_id AS "vacancyId",
           rc.code, rc.label, rc.active,
           rc.owner_user_id AS "ownerUserId",
           rc.owner_candidate_id AS "ownerCandidateId",
           rc.created_at AS "createdAt",
           v.title AS "vacancyTitle",
           c.name AS "companyName"
    FROM referral_codes rc
    JOIN companies c ON c.id = rc.company_id AND c.deleted = FALSE
    LEFT JOIN vacancies v ON v.id = rc.vacancy_id AND v.deleted = FALSE
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY rc.created_at DESC
    LIMIT $${params.length}`;

  const r = await queryRead(sql, params);
  return { ok: true, items: r.rows || [] };
}

/**
 * @param {{ id: number, companyId?: number|null, isAdmin?: boolean, active?: boolean, label?: string|null }} input
 */
export async function updateReferralCode(input) {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, errorCode: ERR.INVALID_ID };

  const sets = [];
  const params = [];

  if (typeof input.active === 'boolean') {
    params.push(input.active);
    sets.push(`active = $${params.length}`);
  }
  if (input.label !== undefined) {
    const label = input.label == null ? null : String(input.label).trim().slice(0, 120) || null;
    params.push(label);
    sets.push(`label = $${params.length}`);
  }
  if (!sets.length) return { ok: false, errorCode: ERR.INVALID_DATA };

  params.push(id);
  const idIdx = params.length;
  let tenantSql = '';
  if (!input.isAdmin) {
    const companyId = Number(input.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return { ok: false, errorCode: ERR.UNAUTHORIZED };
    }
    params.push(companyId);
    tenantSql = `AND company_id = $${params.length}`;
  }

  const r = await query(
    `UPDATE referral_codes
     SET ${sets.join(', ')}
     WHERE id = $${idIdx} ${tenantSql}
     RETURNING id, company_id AS "companyId", vacancy_id AS "vacancyId",
               code, label, active, owner_user_id AS "ownerUserId",
               owner_candidate_id AS "ownerCandidateId",
               created_at AS "createdAt"`,
    params
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, code: r.rows[0] };
}

/**
 * Lookup ativo por código (público / validação).
 * @param {string} rawCode
 * @param {{ companyId?: number|null, vacancyId?: number|null }} [scope]
 */
export async function findActiveReferralCode(rawCode, scope = {}) {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;

  const r = await queryRead(
    `SELECT id, company_id AS "companyId", vacancy_id AS "vacancyId", code, active
     FROM referral_codes
     WHERE LOWER(code) = LOWER($1) AND active = TRUE
     LIMIT 1`,
    [code]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];

  if (scope.companyId != null) {
    const companyId = Number(scope.companyId);
    if (Number.isFinite(companyId) && companyId > 0 && Number(row.companyId) !== companyId) {
      return null;
    }
  }
  if (scope.vacancyId != null && row.vacancyId != null) {
    const vacancyId = Number(scope.vacancyId);
    if (Number.isFinite(vacancyId) && vacancyId > 0 && Number(row.vacancyId) !== vacancyId) {
      return null;
    }
  }
  return row;
}

/**
 * Analytics agregado por código referral (eventos do funil).
 * @param {{ companyId?: number|null, isAdmin?: boolean, vacancyId?: number|null, limit?: number }} opts
 */
export async function getReferralAnalytics(opts = {}) {
  const limitRaw = Number(opts.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 40;

  const params = [];
  const where = [`e.referral_code IS NOT NULL`, `TRIM(e.referral_code) <> ''`];

  if (!opts.isAdmin) {
    const companyId = Number(opts.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return { ok: false, errorCode: ERR.UNAUTHORIZED };
    }
    params.push(companyId);
    where.push(`e.company_id = $${params.length}`);
  } else if (opts.companyId != null) {
    const companyId = Number(opts.companyId);
    if (Number.isFinite(companyId) && companyId > 0) {
      params.push(companyId);
      where.push(`e.company_id = $${params.length}`);
    }
  }

  if (opts.vacancyId != null) {
    const vacancyId = Number(opts.vacancyId);
    if (!Number.isFinite(vacancyId) || vacancyId <= 0) {
      return { ok: false, errorCode: ERR.INVALID_VACANCY };
    }
    params.push(vacancyId);
    where.push(`e.vacancy_id = $${params.length}`);

    if (!opts.isAdmin) {
      const owned = await queryRead(
        `SELECT 1 FROM vacancies
         WHERE id = $1 AND company_id = $2 AND deleted = FALSE
         LIMIT 1`,
        [vacancyId, opts.companyId]
      );
      if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    }
  }

  params.push(limit);
  const agg = await queryRead(
    `SELECT
       UPPER(TRIM(e.referral_code)) AS code,
       COUNT(*) FILTER (WHERE e.event_type = 'job_view')::int AS views,
       COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_type = 'job_view')::int AS "uniqueViews",
       COUNT(*) FILTER (WHERE e.event_type = 'apply_start')::int AS "applyStarts",
       COUNT(*) FILTER (WHERE e.event_type = 'apply_complete')::int AS applications,
       COUNT(*) FILTER (WHERE e.event_type = 'interview')::int AS interviews,
       COUNT(*) FILTER (WHERE e.event_type = 'hired')::int AS hires,
       COUNT(*) FILTER (WHERE e.event_type = 'rejected')::int AS rejected
     FROM job_funnel_events e
     WHERE ${where.join(' AND ')}
     GROUP BY 1
     ORDER BY applications DESC, views DESC, code ASC
     LIMIT $${params.length}`,
    params
  );

  const codes = (agg.rows || []).map((r) => r.code);
  let metaByCode = {};
  if (codes.length) {
    const meta = await queryRead(
      `SELECT code, label, active, vacancy_id AS "vacancyId", company_id AS "companyId"
       FROM referral_codes
       WHERE UPPER(code) = ANY($1::text[])`,
      [codes]
    );
    metaByCode = Object.fromEntries((meta.rows || []).map((m) => [String(m.code).toUpperCase(), m]));
  }

  return {
    ok: true,
    items: (agg.rows || []).map((r) => {
      const meta = metaByCode[r.code] || null;
      const views = r.uniqueViews || r.views || 0;
      const applications = r.applications || 0;
      return {
        code: r.code,
        label: meta?.label || null,
        registered: Boolean(meta),
        active: meta ? Boolean(meta.active) : null,
        vacancyId: meta?.vacancyId ?? null,
        views,
        applyStarts: r.applyStarts || 0,
        applications,
        interviews: r.interviews || 0,
        hires: r.hires || 0,
        rejected: r.rejected || 0,
        conversionRate: views > 0 ? Math.round((applications / views) * 1000) / 1000 : null,
      };
    }),
  };
}
