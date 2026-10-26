/**
 * Talent bank — candidates who already applied / linked to a vacancy (rehire pool).
 * Hub remains `candidates`; no second person table.
 */

import { queryRead } from '../db.js';
import { candidateTagFilterSql, candidateTagsSelectSql } from './candidate-tags-core.js';
import { asDb } from '../ae/as-db.js';
import { PAGE_SIZE_OPTIONS } from '../assessment-filters.js';
import { PIPELINE_STAGE_SET } from './pipeline.js';

const PAGE_SIZE_CAP = 50;
const SORT_KEYS = new Set(['name', 'email', 'lastActivityAt', 'stage', 'vacancy', 'type']);

/**
 * @param {unknown} pageSizeIn
 * @returns {number}
 */
function clampPageSize(pageSizeIn) {
  const sizeRaw = parseInt(pageSizeIn, 10);
  if (PAGE_SIZE_OPTIONS.includes(sizeRaw) && sizeRaw <= PAGE_SIZE_CAP) return sizeRaw;
  if (Number.isFinite(sizeRaw) && sizeRaw >= 1) return Math.min(sizeRaw, PAGE_SIZE_CAP);
  return 20;
}

/**
 * @param {string} sort
 * @param {'asc'|'desc'} dir
 */
function orderSql(sort, dir) {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'name':
      return `ORDER BY c.full_name ${d} NULLS LAST, c.id DESC`;
    case 'email':
      return `ORDER BY LOWER(COALESCE(c.email, '')) ${d}, c.id DESC`;
    case 'stage':
      return `ORDER BY latest.stage ${d} NULLS LAST, latest.activity_at DESC NULLS LAST, c.id DESC`;
    case 'vacancy':
      return `ORDER BY latest.vacancy_title ${d} NULLS LAST, latest.activity_at DESC NULLS LAST, c.id DESC`;
    case 'type':
      return `ORDER BY latest.top_type ${d} NULLS LAST, latest.activity_at DESC NULLS LAST, c.id DESC`;
    case 'lastActivityAt':
    default:
      return `ORDER BY latest.activity_at ${d} NULLS LAST, c.id DESC`;
  }
}

/**
 * List talent-bank candidates for a company (paginated).
 *
 * @param {import('pg').Pool|Function|null} dbOrQuery
 * @param {{
 *   companyId: number,
 *   q?: string,
 *   vacancyId?: number|string|null,
 *   stage?: string|null,
 *   topType?: number|string|null,
 *   page?: number,
 *   pageSize?: number,
 *   sort?: string,
 *   sortDir?: string,
 * }} opts
 */
export async function listTalentBank(dbOrQuery, opts = {}) {
  const db =
    dbOrQuery != null
      ? asDb(dbOrQuery)
      : { query: queryRead };

  const companyId = Number(opts.companyId);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
  }

  const pageRaw = parseInt(opts.page, 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = clampPageSize(opts.pageSize);
  const sortRaw = String(opts.sort || 'lastActivityAt');
  const sort = SORT_KEYS.has(sortRaw) ? sortRaw : 'lastActivityAt';
  const sortDir = opts.sortDir === 'asc' ? 'asc' : 'desc';

  const q = String(opts.q || '')
    .trim()
    .slice(0, 120)
    .toLowerCase();
  const vacancyIdRaw = opts.vacancyId != null && opts.vacancyId !== '' ? Number(opts.vacancyId) : null;
  const vacancyId = Number.isFinite(vacancyIdRaw) && vacancyIdRaw > 0 ? vacancyIdRaw : null;
  const stageRaw = opts.stage != null && opts.stage !== '' && opts.stage !== 'all' ? String(opts.stage).trim() : null;
  const stage = stageRaw && PIPELINE_STAGE_SET.has(stageRaw) ? stageRaw : null;
  const topTypeRaw = opts.topType != null && opts.topType !== '' && opts.topType !== 'all' ? Number(opts.topType) : null;
  const topType =
    Number.isFinite(topTypeRaw) && topTypeRaw >= 1 && topTypeRaw <= 9 ? topTypeRaw : null;

  const params = [companyId];
  const whereParts = [`c.company_id = $1`];

  // Membership: vacancy_candidates OR assessments with vacancy_id (same tenant).
  let vacancyParamIdx = null;
  let stageParamIdx = null;
  let topTypeParamIdx = null;
  if (vacancyId != null) {
    params.push(vacancyId);
    vacancyParamIdx = params.length;
  }
  if (stage != null) {
    params.push(stage);
    stageParamIdx = params.length;
  }
  if (topType != null) {
    params.push(topType);
    topTypeParamIdx = params.length;
  }

  const vcFilter = [];
  const assFilter = [`a.vacancy_id IS NOT NULL`];
  if (vacancyParamIdx != null) {
    vcFilter.push(`vc.vacancy_id = $${vacancyParamIdx}`);
    assFilter.push(`a.vacancy_id = $${vacancyParamIdx}`);
  }
  if (stageParamIdx != null) {
    vcFilter.push(`vc.pipeline_stage = $${stageParamIdx}`);
    assFilter.push(`a.pipeline_stage = $${stageParamIdx}`);
  }

  const vcExtra = vcFilter.length ? ` AND ${vcFilter.join(' AND ')}` : '';
  const assExtra = assFilter.length ? ` AND ${assFilter.join(' AND ')}` : '';

  whereParts.push(`(
    EXISTS (
      SELECT 1 FROM vacancy_candidates vc
      WHERE vc.candidate_id = c.id
        AND vc.company_id = c.company_id
        ${vcExtra}
    )
    OR EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.candidate_id = c.id
        AND a.company_id = c.company_id
        ${assExtra}
    )
  )`);

  if (q) {
    params.push(`%${q}%`);
    const qi = params.length;
    whereParts.push(`(
      LOWER(COALESCE(c.full_name, '')) LIKE $${qi}
      OR LOWER(COALESCE(c.email, '')) LIKE $${qi}
    )`);
  }

  if (topTypeParamIdx != null) {
    whereParts.push(`(
      SELECT a.top_type
      FROM assessments a
      WHERE a.candidate_id = c.id
        AND a.company_id = c.company_id
        AND a.top_type IS NOT NULL
      ORDER BY a.created_at DESC NULLS LAST, a.id DESC
      LIMIT 1
    ) = $${topTypeParamIdx}`);
  }

  whereParts.push(candidateTagFilterSql('c', opts, params));
  const where = `WHERE ${whereParts.join(' AND ')}`;

  // Latest application row for display (same soft vacancy/stage filter as membership).
  const latestAssParts = ['a.vacancy_id IS NOT NULL'];
  if (vacancyParamIdx != null) latestAssParts.push(`a.vacancy_id = $${vacancyParamIdx}`);
  if (stageParamIdx != null) latestAssParts.push(`a.pipeline_stage = $${stageParamIdx}`);
  const latestVcParts = [];
  if (vacancyParamIdx != null) latestVcParts.push(`vc.vacancy_id = $${vacancyParamIdx}`);
  if (stageParamIdx != null) latestVcParts.push(`vc.pipeline_stage = $${stageParamIdx}`);
  const latestVcSql = latestVcParts.length ? ` AND ${latestVcParts.join(' AND ')}` : '';
  const latestAssSql = ` AND ${latestAssParts.join(' AND ')}`;

  const latestJoin = `
    LEFT JOIN LATERAL (
      SELECT
        x.vacancy_id,
        v.title AS vacancy_title,
        x.stage,
        x.activity_at,
        x.top_type
      FROM (
        SELECT
          vc.vacancy_id,
          vc.pipeline_stage AS stage,
          COALESCE(vc.updated_at, vc.created_at) AS activity_at,
          NULL::int AS top_type
        FROM vacancy_candidates vc
        WHERE vc.candidate_id = c.id
          AND vc.company_id = c.company_id
          ${latestVcSql}
        UNION ALL
        SELECT
          a.vacancy_id,
          a.pipeline_stage AS stage,
          a.created_at AS activity_at,
          a.top_type
        FROM assessments a
        WHERE a.candidate_id = c.id
          AND a.company_id = c.company_id
          ${latestAssSql}
      ) x
      LEFT JOIN vacancies v ON v.id = x.vacancy_id AND v.deleted = FALSE
      ORDER BY x.activity_at DESC NULLS LAST
      LIMIT 1
    ) latest ON TRUE
  `;

  const cnt = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM candidates c
     ${where}`,
    params
  );
  const total = cnt.rows[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = total === 0 ? 1 : Math.min(page, totalPages);
  const offset = (effectivePage - 1) * pageSize;

  const listParams = [...params, pageSize, offset];
  const limI = params.length + 1;
  const offI = params.length + 2;

  const r = await db.query(
    `SELECT
       c.id,
       ${candidateTagsSelectSql('c')} AS tags,
       c.full_name AS "fullName",
       c.email,
       c.employment_status AS "employmentStatus",
       latest.vacancy_id AS "vacancyId",
       latest.vacancy_title AS "vacancyTitle",
       latest.stage,
       latest.activity_at AS "lastActivityAt",
       COALESCE(
         latest.top_type,
         (
           SELECT a.top_type
           FROM assessments a
           WHERE a.candidate_id = c.id
             AND a.company_id = c.company_id
             AND a.top_type IS NOT NULL
           ORDER BY a.created_at DESC
           LIMIT 1
         )
       ) AS "topType"
     FROM candidates c
     ${latestJoin}
     ${where}
     ${orderSql(sort, sortDir)}
     LIMIT $${limI} OFFSET $${offI}`,
    listParams
  );

  return {
    items: r.rows.map((row) => ({
      id: Number(row.id),
      fullName: row.fullName || null,
      tags: row.tags || [],
      email: row.email || null,
      employmentStatus: row.employmentStatus || null,
      vacancyId: row.vacancyId != null ? Number(row.vacancyId) : null,
      vacancyTitle: row.vacancyTitle || null,
      stage: row.stage || null,
      lastActivityAt: row.lastActivityAt || null,
      topType: row.topType != null ? Number(row.topType) : null,
    })),
    total,
    page: effectivePage,
    pageSize,
    totalPages,
  };
}

export const TALENT_BANK_PAGE_SIZE_CAP = PAGE_SIZE_CAP;
export const TALENT_BANK_SORT_KEYS = SORT_KEYS;
