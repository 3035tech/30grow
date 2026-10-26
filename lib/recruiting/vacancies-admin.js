/**
 * Vacancy admin domain — list/create/update/delete + candidates list.
 * Routes stay thin: auth + parse + NextResponse/apiError.
 */

import { pool, query, queryRead } from '../db.js';
import { parseVacanciesSort, sqlVacancyOrderBy } from '../assessment/assessment-filters.js';
import { parseVacancyDetailsFromBody } from './vacancy-details.js';
import { ensureActiveVacancyLinkToken } from './vacancy-link.js';
import { slugify } from '../slugify.js';
import { sanitizeInterviewNotesHtml } from '../sanitize-html.js';
import { scheduleVacancyIndexSync } from './job-indexing.js';
import { scheduleJobAlertDispatch } from './job-alerts.js';
import { notifyCompanyManagers, NOTIF } from '../manager-notifications.js';
import { upsertCandidatePreInterview } from '../ae/candidate-upsert.js';
import { normalizeCandidateProfile } from './candidate-profile.js';
import { ERR } from '../api-error-codes.js';
import { getJobRole } from './job-roles.js';
import { measureAsync } from '../monitoring.js';
import { applyPipelineTemplateToVacancy, listPipelineTemplates } from './pipeline-templates.js';
import { VACANCY_LIST_FILTER, VACANCY_STATUS, normalizeVacancyListFilter } from '../domain-status.js';
import { resolveRecruiterUserId } from './recruiting-workspace.js';

/** Open vacancy that cannot receive applications or is past its deadline. Needs `vl` (active link) joined. */
const VACANCY_ATTENTION_SQL = `(v.status = '${VACANCY_STATUS.OPEN}' AND (
  vl.token IS NULL
  OR vl.expires_at <= NOW()
  OR (v.target_date IS NOT NULL AND v.target_date < CURRENT_DATE)
))`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VACANCY_PAGE_SIZES = new Set([10, 20, 30, 40, 50]);

const VACANCY_SELECT = `
  v.id,
  v.company_id AS "companyId",
  c.name AS "companyName",
  c.slug AS "companySlug",
  v.title,
  v.slug,
  v.status,
  v.positions_count AS "positionsCount",
  v.target_date AS "targetDate",
  v.description,
  v.salary_min AS "salaryMin",
  v.salary_max AS "salaryMax",
  v.client_report_show_salary AS "clientReportShowSalary",
  v.employment_type AS "employmentType",
  v.workplace_modality AS "workplaceModality",
  v.workplace_city AS "workplaceCity",
  v.workplace_state AS "workplaceState",
  v.public_page_enabled AS "publicPageEnabled",
  v.public_allow_index AS "publicAllowIndex",
  v.public_show_company_info AS "publicShowCompanyInfo",
  v.public_show_salary AS "publicShowSalary",
  v.job_role_id AS "jobRoleId",
  v.owner_user_id AS "ownerUserId",
  COALESCE(NULLIF(TRIM(owner.display_name), ''), owner.email) AS "ownerName",
  v.created_at AS "createdAt"
`;

/**
 * Resolve optional job_role_id for a company (active role, same tenant).
 * @returns {{ ok: true, jobRoleId: number|null } | { ok: false, errorCode: string }}
 */
async function resolveJobRoleIdForCompany(companyId, raw) {
  if (raw === undefined) return { ok: true, jobRoleId: undefined };
  if (raw === null || raw === '') return { ok: true, jobRoleId: null };
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return { ok: false, errorCode: ERR.JOB_ROLE_NOT_FOUND };
  const role = await getJobRole(id);
  if (!role || !role.active || String(role.companyId) !== String(companyId)) {
    return { ok: false, errorCode: ERR.JOB_ROLE_NOT_FOUND };
  }
  return { ok: true, jobRoleId: id };
}

function indexPayloadFromVacancy(v) {
  return {
    id: v.id,
    slug: v.slug,
    status: v.status,
    publicPageEnabled: v.publicPageEnabled,
    publicAllowIndex: v.publicAllowIndex,
    targetDate: v.targetDate,
    title: v.title,
    employmentType: v.employmentType,
  };
}

/**
 * @param {{
 *   isAdmin: boolean,
 *   companyId: number|null,
 *   companyFilter?: string|null,
 *   vacancyIdFilter?: number|null,
 *   page?: number,
 *   pageSize?: number,
 *   sortParams?: { sort?: string, dir?: string } | null,
 *   searchParams?: URLSearchParams | Record<string, string> | null,
 *   q?: string,
 *   statusFilter?: string,
 * }} opts
 */
export async function listVacancies({
  isAdmin,
  companyId,
  companyFilter = null,
  vacancyIdFilter = null,
  page: pageIn = 1,
  pageSize: pageSizeIn = 20,
  sortParams = null,
  searchParams = null,
  q = '',
  statusFilter = VACANCY_LIST_FILTER.ALL,
}) {
  const whereParts = ['v.deleted = FALSE', 'c.deleted = FALSE'];
  const params = [];

  if (!isAdmin) {
    params.push(companyId);
    whereParts.push(`v.company_id = $${params.length}`);
  } else if (companyFilter && companyFilter !== 'all') {
    const cid = parseInt(companyFilter, 10);
    if (Number.isFinite(cid)) {
      params.push(cid);
      whereParts.push(`v.company_id = $${params.length}`);
    }
  }
  if (vacancyIdFilter != null) {
    params.push(vacancyIdFilter);
    whereParts.push(`v.id = $${params.length}`);
  }
  const term = String(q || '').trim().replace(/^#/, '').slice(0, 120);
  if (term) {
    params.push(`%${term.replace(/[%_\\]/g, '')}%`);
    const likeI = params.length;
    if (/^\d{1,12}$/.test(term)) {
      params.push(Number(term));
      whereParts.push(`(v.title ILIKE $${likeI} OR v.id = $${params.length})`);
    } else {
      whereParts.push(`v.title ILIKE $${likeI}`);
    }
  }
  const scopeWhere = `WHERE ${whereParts.join(' AND ')}`;
  const status = normalizeVacancyListFilter(statusFilter);
  if (status === VACANCY_LIST_FILTER.OPEN || status === VACANCY_LIST_FILTER.CLOSED) {
    whereParts.push(`v.status = '${status}'`);
  } else if (status === VACANCY_LIST_FILTER.ATTENTION) {
    whereParts.push(VACANCY_ATTENTION_SQL);
  }
  const where = `WHERE ${whereParts.join(' AND ')}`;
  const activeLinkJoin = `LEFT JOIN LATERAL (
       SELECT token, expires_at
       FROM vacancy_links
       WHERE vacancy_id = v.id AND active = TRUE
       ORDER BY expires_at DESC NULLS LAST
       LIMIT 1
     ) vl ON TRUE`;

  const page = Math.max(1, parseInt(pageIn, 10) || 1);
  const rawSize = parseInt(pageSizeIn, 10);
  const pageSize = VACANCY_PAGE_SIZES.has(rawSize) ? rawSize : 20;

  let vacSortCol;
  let vacSortDir;
  if (sortParams?.sort) {
    vacSortCol = sortParams.sort;
    vacSortDir = sortParams.dir === 'asc' ? 'asc' : 'desc';
  } else {
    const parsed = parseVacanciesSort(searchParams || {}, { isAdmin });
    vacSortCol = parsed.sort;
    vacSortDir = parsed.dir;
  }
  const vacancyOrderClause = sqlVacancyOrderBy(vacSortCol, vacSortDir);

  const summaryR = await queryRead(
    `SELECT
       COUNT(*)::int AS "${VACANCY_LIST_FILTER.ALL}",
       COUNT(*) FILTER (WHERE v.status = '${VACANCY_STATUS.OPEN}')::int AS "${VACANCY_LIST_FILTER.OPEN}",
       COUNT(*) FILTER (WHERE v.status = '${VACANCY_STATUS.CLOSED}')::int AS "${VACANCY_LIST_FILTER.CLOSED}",
       COUNT(*) FILTER (WHERE ${VACANCY_ATTENTION_SQL})::int AS "${VACANCY_LIST_FILTER.ATTENTION}"
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     ${activeLinkJoin}
     ${scopeWhere}`,
    params
  );
  const summaryRow = summaryR.rows[0] || {};
  const summary = Object.fromEntries(
    Object.values(VACANCY_LIST_FILTER).map((key) => [key, summaryRow[key] ?? 0])
  );
  const total = summary[status];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = total === 0 ? 1 : Math.min(page, totalPages);
  const offset = (effectivePage - 1) * pageSize;

  const listParams = [...params];
  listParams.push(pageSize);
  const limI = listParams.length;
  listParams.push(offset);
  const offI = listParams.length;
  const r = await queryRead(
    `WITH page AS MATERIALIZED (
       SELECT
         ${VACANCY_SELECT},
         vl.token AS "activeToken",
         vl.expires_at AS "activeTokenExpiresAt",
         (${VACANCY_ATTENTION_SQL}) AS "needsAttention",
         ROW_NUMBER() OVER (${vacancyOrderClause}) AS rn
       FROM vacancies v
       JOIN companies c ON c.id = v.company_id
       LEFT JOIN users owner ON owner.id = v.owner_user_id AND owner.deleted = FALSE
       ${activeLinkJoin}
       ${where}
       ${vacancyOrderClause}
       LIMIT $${limI} OFFSET $${offI}
     )
     SELECT
       p.*,
       COALESCE(vc.total, 0) AS "candidatesCount",
       COALESCE(vc.recent, 0) AS "candidatesRecentCount",
       COALESCE(vc.hired, 0) AS "hiredCount"
     FROM page p
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE x.created_at >= NOW() - INTERVAL '7 days')::int AS recent,
         COUNT(*) FILTER (WHERE x.hired_at IS NOT NULL)::int AS hired
       FROM vacancy_candidates x
       WHERE x.vacancy_id = p.id
     ) vc ON TRUE
     ORDER BY p.rn`,
    listParams
  );

  return {
    items: r.rows.map(({ rn: _rn, ...row }) => row),
    summary,
    total,
    page: effectivePage,
    pageSize,
    totalPages,
  };
}

export async function getVacancyById(vacancyId, { companyId: rawCompanyId } = {}) {
  const companyId = Number(rawCompanyId);
  const scoped = Number.isFinite(companyId) && companyId > 0;
  const v = await queryRead(
    `SELECT ${VACANCY_SELECT}
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     LEFT JOIN users owner ON owner.id = v.owner_user_id AND owner.deleted = FALSE
     WHERE v.id = $1
       ${scoped ? 'AND v.company_id = $2' : ''}
       AND v.deleted = FALSE AND c.deleted = FALSE
     LIMIT 1`,
    scoped ? [vacancyId, companyId] : [vacancyId]
  );
  if (v.rowCount === 0) return null;
  return v.rows[0];
}

export async function attachVacancyActiveToken(vacancy) {
  const t = await queryRead(
    `SELECT token, expires_at AS "expiresAt", rotated_at AS "rotatedAt"
     FROM vacancy_links
     WHERE vacancy_id = $1 AND active = TRUE
     LIMIT 1`,
    [vacancy.id]
  );
  return {
    ...vacancy,
    activeToken: t.rows?.[0]?.token || null,
    activeTokenExpiresAt: t.rows?.[0]?.expiresAt || null,
  };
}

export async function getVacancyRubric(vacancyId) {
  const rub = await queryRead(
    `SELECT desired_type_weights AS "vacancyFitWeights", notes AS "vacancyRubricNotes", updated_at AS "vacancyRubricUpdatedAt"
     FROM vacancy_rubrics WHERE vacancy_id = $1 LIMIT 1`,
    [vacancyId]
  );
  if (rub.rowCount > 0) {
    return {
      vacancyFitWeights: rub.rows[0].vacancyFitWeights || {},
      vacancyRubricNotes: rub.rows[0].vacancyRubricNotes ?? null,
      vacancyRubricUpdatedAt: rub.rows[0].vacancyRubricUpdatedAt ?? null,
    };
  }
  return { vacancyFitWeights: {}, vacancyRubricNotes: null, vacancyRubricUpdatedAt: null };
}

/**
 * @returns {{ ok: true, vacancy: object, companyName: string, activeToken: string }
 *         | { ok: false, errorCode: string }}
 */
export async function createVacancy({
  companyId,
  title,
  status,
  slug,
  positionsCount,
  targetDate,
  details,
  jobRoleId: jobRoleIdRaw = null,
  pipelineTemplateId: pipelineTemplateIdRaw = null,
  ownerUserId: ownerUserIdRaw = null,
}) {
  const c = await queryRead(`SELECT id, name FROM companies WHERE id = $1 AND deleted = FALSE LIMIT 1`, [
    companyId,
  ]);
  if (c.rowCount === 0) return { ok: false, errorCode: ERR.INVALID_COMPANY };

  const jobRoleResolved = await resolveJobRoleIdForCompany(companyId, jobRoleIdRaw);
  if (!jobRoleResolved.ok) return jobRoleResolved;
  const jobRoleId = jobRoleResolved.jobRoleId ?? null;
  const templates = await listPipelineTemplates(companyId);
  const requestedTemplateId = Number(pipelineTemplateIdRaw);
  const selectedTemplate = Number.isInteger(requestedTemplateId) && requestedTemplateId > 0
    ? templates.find((item) => item.id === requestedTemplateId)
    : templates.find((item) => item.isDefault) || templates[0];
  if (!selectedTemplate) return { ok: false, errorCode: ERR.NOT_FOUND };
  const ownerResolved = await resolveRecruiterUserId(companyId, ownerUserIdRaw);
  if (!ownerResolved.ok) return ownerResolved;

  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO vacancies (
       company_id, title, slug, status, positions_count, target_date,
       description, salary_min, salary_max, client_report_show_salary, employment_type,
       workplace_modality, workplace_city, workplace_state,
       public_page_enabled, public_allow_index, public_show_company_info, public_show_salary,
       job_role_id, owner_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING id, company_id AS "companyId", title, slug, status,
               positions_count AS "positionsCount", target_date AS "targetDate",
               description, salary_min AS "salaryMin", salary_max AS "salaryMax",
               client_report_show_salary AS "clientReportShowSalary",
               employment_type AS "employmentType",
               workplace_modality AS "workplaceModality",
               workplace_city AS "workplaceCity",
               workplace_state AS "workplaceState",
               public_page_enabled AS "publicPageEnabled",
               public_allow_index AS "publicAllowIndex",
               public_show_company_info AS "publicShowCompanyInfo",
               public_show_salary AS "publicShowSalary",
               job_role_id AS "jobRoleId",
               owner_user_id AS "ownerUserId",
               created_at AS "createdAt"`,
    [
      companyId,
      title,
      slug,
      status,
      positionsCount,
      targetDate,
      details.description,
      details.salaryMin,
      details.salaryMax,
      details.clientReportShowSalary === true,
      details.employmentType ?? null,
      details.workplaceModality ?? null,
      details.workplaceCity ?? null,
      details.workplaceState ?? null,
      details.publicPageEnabled === true,
      details.publicAllowIndex === true,
      details.publicShowCompanyInfo === true,
      details.publicShowSalary === true,
      jobRoleId,
      ownerResolved.ownerUserId,
      ]
    );

    created = ins.rows[0];
    const pipelineApplied = await applyPipelineTemplateToVacancy(
      {
        companyId,
        vacancyId: created.id,
        templateId: selectedTemplate.id,
      },
      client.query.bind(client)
    );
    if (!pipelineApplied.ok) {
      await client.query('ROLLBACK');
      return pipelineApplied;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const activeToken = await ensureActiveVacancyLinkToken(created.id);
  const companyName = c.rows[0].name;
  const payload = indexPayloadFromVacancy(created);
  scheduleVacancyIndexSync({
    previous: null,
    current: payload,
    reason: 'vacancy_create',
  });
  scheduleJobAlertDispatch({
    previous: null,
    current: payload,
    companyName,
  });

  return { ok: true, vacancy: created, companyName, activeToken };
}

/**
 * @returns {{ ok: true, vacancy: object } | { ok: false, errorCode: string }}
 */
export async function updateVacancy({ vacancyId, current, body }) {
  const title = body.title != null ? String(body.title || '').trim() : null;
  const status = body.status != null ? String(body.status || '').trim() : null;
  const slug = body.slug != null ? slugify(body.slug || '') : null;
  const positionsCount =
    body.positionsCount != null ? Math.max(1, parseInt(body.positionsCount, 10) || 1) : null;
  const targetDate =
    body.targetDate !== undefined
      ? /^\d{4}-\d{2}-\d{2}$/.test(String(body.targetDate || ''))
        ? String(body.targetDate)
        : null
      : undefined;

  let details;
  try {
    details = parseVacancyDetailsFromBody(body, { forCreate: false });
  } catch (e) {
    if (
      e?.code === 'INVALID_SALARY_RANGE' ||
      e?.code === 'INVALID_EMPLOYMENT_TYPE' ||
      e?.code === 'INVALID_WORKPLACE_MODALITY' ||
      e?.code === 'INVALID_WORKPLACE_STATE'
    ) {
      return { ok: false, errorCode: e.code };
    }
    throw e;
  }

  const checkMin = details.salaryMin !== undefined ? details.salaryMin : current.salaryMin;
  const checkMax = details.salaryMax !== undefined ? details.salaryMax : current.salaryMax;
  if (checkMin != null && checkMax != null && Number(checkMin) > Number(checkMax)) {
    return { ok: false, errorCode: ERR.INVALID_SALARY_RANGE };
  }

  if (status !== null && !['open', 'closed'].includes(status)) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }
  if (slug !== null && !slug) return { ok: false, errorCode: ERR.INVALID_SLUG };

  const nextTitle = title !== null ? title : current.title;
  const nextStatus = status !== null ? status : current.status;
  const nextSlug = slug !== null ? slug : current.slug;
  const nextPositions = positionsCount !== null ? positionsCount : current.positionsCount ?? 1;
  const nextTargetDate = targetDate !== undefined ? targetDate : current.targetDate ?? null;
  const nextDescription =
    details.description !== undefined ? details.description : current.description ?? null;
  const nextSalaryMin = details.salaryMin !== undefined ? details.salaryMin : current.salaryMin ?? null;
  const nextSalaryMax = details.salaryMax !== undefined ? details.salaryMax : current.salaryMax ?? null;
  const nextShowSalary =
    details.clientReportShowSalary !== undefined
      ? details.clientReportShowSalary
      : Boolean(current.clientReportShowSalary);
  const nextEmploymentType =
    details.employmentType !== undefined ? details.employmentType : current.employmentType ?? null;
  const nextWorkplaceModality =
    details.workplaceModality !== undefined
      ? details.workplaceModality
      : current.workplaceModality ?? null;
  const nextWorkplaceCity =
    details.workplaceCity !== undefined ? details.workplaceCity : current.workplaceCity ?? null;
  const nextWorkplaceState =
    details.workplaceState !== undefined ? details.workplaceState : current.workplaceState ?? null;
  const nextPublicPageEnabled =
    details.publicPageEnabled !== undefined
      ? details.publicPageEnabled
      : Boolean(current.publicPageEnabled);
  const nextPublicAllowIndex =
    details.publicAllowIndex !== undefined
      ? details.publicAllowIndex
      : Boolean(current.publicAllowIndex);
  const nextPublicShowCompanyInfo =
    details.publicShowCompanyInfo !== undefined
      ? details.publicShowCompanyInfo
      : Boolean(current.publicShowCompanyInfo);
  const nextPublicShowSalary =
    details.publicShowSalary !== undefined
      ? details.publicShowSalary
      : Boolean(current.publicShowSalary);
  if (!nextTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };

  let nextJobRoleId = current.jobRoleId ?? null;
  if (body.jobRoleId !== undefined || body.job_role_id !== undefined) {
    const raw = body.jobRoleId !== undefined ? body.jobRoleId : body.job_role_id;
    const jobRoleResolved = await resolveJobRoleIdForCompany(current.companyId, raw);
    if (!jobRoleResolved.ok) return jobRoleResolved;
    nextJobRoleId = jobRoleResolved.jobRoleId;
  }
  let nextOwnerUserId = current.ownerUserId ?? null;
  if (body.ownerUserId !== undefined) {
    const ownerResolved = await resolveRecruiterUserId(current.companyId, body.ownerUserId);
    if (!ownerResolved.ok) return ownerResolved;
    nextOwnerUserId = ownerResolved.ownerUserId;
  }

  const up = await query(
    `UPDATE vacancies
     SET title = $2, slug = $3, status = $4, positions_count = $5, target_date = $6,
         description = $7, salary_min = $8, salary_max = $9, client_report_show_salary = $10,
         employment_type = $11,
         workplace_modality = $12, workplace_city = $13, workplace_state = $14,
         public_page_enabled = $15, public_allow_index = $16,
         public_show_company_info = $17, public_show_salary = $18,
         job_role_id = $19, owner_user_id = $20
     WHERE id = $1 AND deleted = FALSE
     RETURNING id, company_id AS "companyId", title, slug, status,
               positions_count AS "positionsCount", target_date AS "targetDate",
               description, salary_min AS "salaryMin", salary_max AS "salaryMax",
               client_report_show_salary AS "clientReportShowSalary",
               employment_type AS "employmentType",
               workplace_modality AS "workplaceModality",
               workplace_city AS "workplaceCity",
               workplace_state AS "workplaceState",
               public_page_enabled AS "publicPageEnabled",
               public_allow_index AS "publicAllowIndex",
               public_show_company_info AS "publicShowCompanyInfo",
               public_show_salary AS "publicShowSalary",
               job_role_id AS "jobRoleId",
               owner_user_id AS "ownerUserId",
               created_at AS "createdAt"`,
    [
      vacancyId,
      nextTitle,
      nextSlug,
      nextStatus,
      nextPositions,
      nextTargetDate,
      nextDescription,
      nextSalaryMin,
      nextSalaryMax,
      nextShowSalary,
      nextEmploymentType,
      nextWorkplaceModality,
      nextWorkplaceCity,
      nextWorkplaceState,
      nextPublicPageEnabled,
      nextPublicAllowIndex,
      nextPublicShowCompanyInfo,
      nextPublicShowSalary,
      nextJobRoleId,
      nextOwnerUserId,
    ]
  );

  if (body.vacancyFitWeights != null || body.vacancyRubricNotes !== undefined) {
    const curRub = await queryRead(
      `SELECT desired_type_weights AS weights, notes FROM vacancy_rubrics WHERE vacancy_id = $1 LIMIT 1`,
      [vacancyId]
    );
    const prevW = curRub.rows[0]?.weights || {};
    const prevN = curRub.rows[0]?.notes ?? null;

    const w = body.vacancyFitWeights != null ? body.vacancyFitWeights : prevW;
    if (typeof w !== 'object' || Array.isArray(w)) {
      return { ok: false, errorCode: ERR.INVALID_FIT_WEIGHTS };
    }
    const notes =
      body.vacancyRubricNotes !== undefined
        ? body.vacancyRubricNotes == null
          ? null
          : sanitizeInterviewNotesHtml(body.vacancyRubricNotes)
        : prevN;
    await query(
      `INSERT INTO vacancy_rubrics (vacancy_id, desired_type_weights, notes, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (vacancy_id) DO UPDATE SET
         desired_type_weights = EXCLUDED.desired_type_weights,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [vacancyId, JSON.stringify(w), notes]
    );
  }

  const rubric = await getVacancyRubric(vacancyId);

  const closedNow =
    String(current.status || '') !== 'closed' && String(up.rows[0]?.status || '') === 'closed';
  if (closedNow) {
    await notifyCompanyManagers(query, {
      companyId: up.rows[0].companyId,
      type: NOTIF.VACANCY_CLOSED,
      entityType: 'vacancy',
      entityId: up.rows[0].id,
      dedupeKey: `vacancy_closed:${up.rows[0].id}:${new Date().toISOString().slice(0, 10)}`,
      payload: {
        vacancyId: up.rows[0].id,
        vacancyTitle: up.rows[0].title,
      },
    });
  }

  const updated = up.rows[0];
  const previousPayload = indexPayloadFromVacancy(current);
  const currentPayload = indexPayloadFromVacancy(updated);
  scheduleVacancyIndexSync({
    previous: previousPayload,
    current: currentPayload,
    reason: closedNow ? 'vacancy_close' : 'vacancy_update',
  });
  scheduleJobAlertDispatch({
    previous: previousPayload,
    current: currentPayload,
    companyName: current.companyName,
  });

  const vacancy = await attachVacancyActiveToken({ ...updated, companyName: current.companyName });
  return { ok: true, vacancy: { ...vacancy, ...rubric } };
}

/**
 * @returns {{ ok: true } | { ok: false, errorCode: string }}
 */
export async function softDeleteVacancy({ vacancyId, beforeDelete }) {
  await query(
    `UPDATE vacancy_links SET active = FALSE, rotated_at = NOW() WHERE vacancy_id = $1 AND active = TRUE`,
    [vacancyId]
  );
  const del = await query(
    `UPDATE vacancies SET deleted = TRUE WHERE id = $1 AND deleted = FALSE RETURNING id`,
    [vacancyId]
  );
  if (del.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  scheduleVacancyIndexSync({
    previous: {
      id: beforeDelete.id,
      slug: beforeDelete.slug,
      status: beforeDelete.status,
      publicPageEnabled: beforeDelete.publicPageEnabled,
      publicAllowIndex: beforeDelete.publicAllowIndex,
      targetDate: beforeDelete.targetDate,
    },
    current: {
      id: beforeDelete.id,
      slug: beforeDelete.slug,
      status: 'closed',
      publicPageEnabled: false,
      publicAllowIndex: false,
      targetDate: beforeDelete.targetDate,
    },
    reason: 'vacancy_delete',
  });

  return { ok: true };
}

/** @returns {boolean} */
export function assertVacancyAccess(vacancy, { isAdmin, companyId }) {
  if (!vacancy) return false;
  if (isAdmin) return true;
  if (companyId == null) return false;
  return String(vacancy.companyId) === String(companyId);
}

export async function listVacancyCandidates(vacancyId, opts = {}) {
  return measureAsync('vacancies.listCandidates', () => listVacancyCandidatesUnmetered(vacancyId, opts));
}

async function listVacancyCandidatesUnmetered(vacancyId, opts = {}) {
  const pageRaw = parseInt(opts.page, 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(opts.pageSize, 10);
  /** Hard cap — kanban/list must not load unbounded funnels. */
  const VACANCY_CANDIDATES_CAP = 300;
  const pageSize = Math.min(
    VACANCY_CANDIDATES_CAP,
    Number.isFinite(sizeRaw) && sizeRaw >= 1 ? sizeRaw : VACANCY_CANDIDATES_CAP
  );
  const offset = (page - 1) * pageSize;

  const countRes = await query(
    `SELECT COUNT(*)::int AS n FROM vacancy_candidates WHERE vacancy_id = $1`,
    [vacancyId]
  );
  const total = countRes.rows[0]?.n ?? 0;

  const rows = await query(
    `SELECT
       vc.id,
       vc.vacancy_id AS "vacancyId",
       vc.candidate_id AS "candidateId",
       vc.interview_notes AS "interviewNotes",
       vc.offer_salary AS "offerSalary",
       vc.offer_start_date AS "offerStartDate",
       vc.offer_status AS "offerStatus",
       vc.offer_notes AS "offerNotes",
       vc.created_at AS "createdAt",
       vc.updated_at AS "updatedAt",
       c.full_name AS "fullName",
       c.email,
       c.phone,
       c.linkedin_url AS "linkedinUrl",
       c.city,
       c.state,
       c.salary_expectation AS "salaryExpectation",
       c.availability,
       c.source,
       inv.id AS "inviteId",
       inv.status AS "inviteStatus",
       inv.sent_at AS "inviteSentAt",
       inv.opened_at AS "inviteOpenedAt",
       inv.completed_at AS "inviteCompletedAt",
       ass.id AS "assessmentId",
       ass.pipeline_stage AS "pipelineStage",
       ass.top_type AS "topType",
       mot_inv.id AS "motivatorsInviteId",
       mot_inv.status AS "motivatorsInviteStatus",
       mot_inv.sent_at AS "motivatorsInviteSentAt",
       mot_inv.completed_at AS "motivatorsInviteCompletedAt",
       mot_att.id AS "motivatorsAttemptId",
       mot_att.completed_at AS "motivatorsCompletedAt"
     FROM vacancy_candidates vc
     JOIN candidates c ON c.id = vc.candidate_id
     LEFT JOIN LATERAL (
       SELECT ci.id, ci.status, ci.sent_at, ci.opened_at, ci.completed_at
       FROM candidate_invites ci
       WHERE ci.vacancy_id = vc.vacancy_id
         AND (
           ci.candidate_id = vc.candidate_id
           OR (c.email IS NOT NULL AND LOWER(ci.candidate_email) = LOWER(c.email))
         )
         AND ci.status <> 'cancelled'
       ORDER BY ci.sent_at DESC NULLS LAST, ci.id DESC
       LIMIT 1
     ) inv ON TRUE
     LEFT JOIN LATERAL (
       SELECT a.id, a.pipeline_stage, a.top_type
       FROM assessments a
       WHERE a.candidate_id = vc.candidate_id AND a.vacancy_id = vc.vacancy_id
       ORDER BY a.created_at DESC
       LIMIT 1
     ) ass ON TRUE
     LEFT JOIN LATERAL (
       SELECT ai.id, ai.status, ai.sent_at, ai.completed_at
       FROM ae_invites ai
       JOIN ae_definitions d ON d.id = ai.definition_id AND LOWER(d.slug) = 'motivators'
       WHERE ai.company_id = c.company_id
         AND (
           ai.candidate_id = vc.candidate_id
           OR (c.email IS NOT NULL AND LOWER(ai.candidate_email) = LOWER(c.email))
         )
         AND ai.status <> 'cancelled'
       ORDER BY
         CASE ai.status WHEN 'completed' THEN 0 ELSE 1 END,
         ai.completed_at DESC NULLS LAST,
         ai.sent_at DESC NULLS LAST,
         ai.id DESC
       LIMIT 1
     ) mot_inv ON TRUE
     LEFT JOIN LATERAL (
       SELECT a.id, a.completed_at
       FROM ae_attempts a
       JOIN ae_definitions d ON d.id = a.definition_id AND LOWER(d.slug) = 'motivators'
       WHERE a.company_id = c.company_id
         AND a.candidate_id = vc.candidate_id
         AND a.status = 'completed'
       ORDER BY a.completed_at DESC NULLS LAST, a.id DESC
       LIMIT 1
     ) mot_att ON TRUE
     WHERE vc.vacancy_id = $1
     ORDER BY vc.created_at DESC
     LIMIT $2 OFFSET $3`,
    [vacancyId, pageSize, offset]
  );

  return {
    items: rows.rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    capped: total > pageSize,
  };
}

/**
 * Link (or upsert) a candidate on a vacancy after interview.
 * @returns {{ ok: true, status: number, body: object } | { ok: false, errorCode: string, status?: number }}
 */
export async function linkVacancyCandidate({
  vacancy,
  body,
  createdByUserId = null,
}) {
  const existingCandidateId =
    body.candidateId != null && Number.isFinite(Number(body.candidateId))
      ? Number(body.candidateId)
      : null;

  let up;
  if (existingCandidateId) {
    const existing = await query(
      `SELECT id, full_name AS "fullName", email, phone, linkedin_url AS "linkedinUrl",
              city, state, salary_expectation AS "salaryExpectation",
              availability, source
       FROM candidates
       WHERE id = $1 AND company_id = $2
       LIMIT 1`,
      [existingCandidateId, vacancy.companyId]
    );
    if (!existing.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };
    const row = existing.rows[0];
    up = {
      ok: true,
      candidateId: row.id,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      linkedinUrl: row.linkedinUrl,
      city: row.city,
      state: row.state,
      salaryExpectation: row.salaryExpectation,
      availability: row.availability,
      source: row.source,
    };
  } else {
    const fullName = String(body.fullName || body.name || body.candidateName || '').trim();
    const email = String(body.email || body.candidateEmail || '').trim().toLowerCase();

    if (!fullName || fullName.length > 200) {
      return { ok: false, errorCode: ERR.CANDIDATE_NAME_REQUIRED, status: 400 };
    }
    if (!email || !EMAIL_RE.test(email)) {
      return { ok: false, errorCode: ERR.INVALID_CANDIDATE_EMAIL, status: 400 };
    }

    up = await upsertCandidatePreInterview({
      companyId: vacancy.companyId,
      fullName,
      email,
      profile: normalizeCandidateProfile(body),
      createdByUserId: createdByUserId ?? null,
    });
    if (!up.ok) return { ok: false, errorCode: up.errorCode || 'INTERNAL', status: 400 };
  }

  const notes = sanitizeInterviewNotesHtml(body.interviewNotes ?? body.notes ?? null);
  const createdBy = createdByUserId != null ? Number(createdByUserId) : null;
  const createdBySql = Number.isFinite(createdBy) ? createdBy : null;

  const prior = await query(
    `SELECT id FROM vacancy_candidates WHERE vacancy_id = $1 AND candidate_id = $2 LIMIT 1`,
    [vacancy.id, up.candidateId]
  );
  const alreadyLinked = prior.rowCount > 0;

  const link = await query(
    `INSERT INTO vacancy_candidates (
       vacancy_id, candidate_id, company_id, interview_notes, pipeline_stage, created_by_user_id
     ) VALUES ($1, $2, $3, $4, 'interview', $5)
     ON CONFLICT (vacancy_id, candidate_id)
     DO UPDATE SET
       interview_notes = COALESCE(EXCLUDED.interview_notes, vacancy_candidates.interview_notes),
       pipeline_stage = COALESCE(vacancy_candidates.pipeline_stage, 'interview'),
       updated_at = NOW()
     RETURNING id, vacancy_id AS "vacancyId", candidate_id AS "candidateId",
               interview_notes AS "interviewNotes", pipeline_stage AS "pipelineStage",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [vacancy.id, up.candidateId, vacancy.companyId, notes, createdBySql]
  );

  return {
    ok: true,
    status: alreadyLinked ? 200 : 201,
    body: {
      ...link.rows[0],
      alreadyLinked,
      fullName: up.fullName,
      email: up.email,
      phone: up.phone,
      linkedinUrl: up.linkedinUrl,
      city: up.city,
      state: up.state,
      salaryExpectation: up.salaryExpectation,
      availability: up.availability,
      source: up.source,
    },
  };
}

/**
 * @returns {{ ok: true, vacancy: object } | { ok: false, errorCode: string }}
 */
export async function loadVacancyForActor({ vacancyId, isAdmin, companyId }) {
  if (!isAdmin && !companyId) return { ok: false, errorCode: ERR.UNAUTHORIZED };

  if (!isAdmin) {
    const owned = await query(
      `SELECT v.id, v.company_id AS "companyId", v.title, v.status
       FROM vacancies v
       JOIN companies c ON c.id = v.company_id
       WHERE v.id = $1 AND v.company_id = $2 AND v.deleted = FALSE AND c.deleted = FALSE
       LIMIT 1`,
      [vacancyId, companyId]
    );
    if (owned.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
    return { ok: true, vacancy: owned.rows[0] };
  }

  const exists = await query(
    `SELECT v.id, v.company_id AS "companyId", v.title, v.status
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     WHERE v.id = $1 AND v.deleted = FALSE AND c.deleted = FALSE
     LIMIT 1`,
    [vacancyId]
  );
  if (exists.rowCount === 0) return { ok: false, errorCode: ERR.VACANCY_NOT_FOUND };
  return { ok: true, vacancy: exists.rows[0] };
}
