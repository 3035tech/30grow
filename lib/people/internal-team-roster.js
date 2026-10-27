import { candidateNameSearchClause } from '../assessment/assessment-filters.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

/** Team roster is a list of people; an assessment is optional for employees. */
export async function loadInternalTeamRoster(query, { companyId, nameSearch = '', orgUnitFilter = null, page = 1, pageSize = 20, sort = 'createdAt', dir = 'desc' }) {
  const params = [companyId];
  const where = [
    'c.company_id = $1',
    'co.deleted = FALSE',
    `(c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}' OR (c.employment_status <> '${EMPLOYMENT_STATUS.ALUMNI}' AND EXISTS (
      SELECT 1 FROM assessments linked
      WHERE linked.candidate_id = c.id AND linked.company_id = c.company_id
        AND linked.vacancy_id IS NULL
    )))`,
  ];
  if (nameSearch) {
    params.push(`%${nameSearch}%`);
    where.push(candidateNameSearchClause('c', params.length));
  }
  if (orgUnitFilter === 'none') where.push('c.org_unit_id IS NULL');
  else if (orgUnitFilter != null) {
    params.push(orgUnitFilter);
    where.push(`c.org_unit_id = $${params.length}`);
  }
  const from = `FROM candidates c JOIN companies co ON co.id = c.company_id WHERE ${where.join(' AND ')}`;
  const totalResult = await query(`SELECT COUNT(*)::int AS total ${from}`, params);
  const total = Number(totalResult.rows[0]?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = total ? Math.min(page, totalPages) : 1;
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const order = sort === 'name'
    ? `ORDER BY LOWER(c.full_name) ${direction}, c.id DESC`
    : `ORDER BY c.created_at ${direction}, c.id DESC`;
  const pageParams = [...params, pageSize, (effectivePage - 1) * pageSize];
  const rows = await query(
    `SELECT ass.id AS "assessmentId", c.id AS "candidateId", c.company_id AS "companyId",
            c.full_name AS name, ar.key AS "areaKey", ar.label AS "areaLabel",
            ass.vacancy_id AS "vacancyId", v.title AS "vacancyTitle",
            ass.top_type AS "topType", ass.scores,
            ass.created_at AS "createdAt", ass.created_at AS "stageEnteredAt",
            ass.pipeline_stage AS "pipelineStage", ass.invite_id AS "inviteId",
            c.employment_status AS "employmentStatus", NULL::date AS "exitDate"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id
     LEFT JOIN LATERAL (
       SELECT a.id, a.area_id, a.vacancy_id, a.top_type, a.scores,
              a.created_at, a.pipeline_stage, a.invite_id
       FROM assessments a
       WHERE a.candidate_id = c.id AND a.company_id = c.company_id
         AND (c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}' OR a.vacancy_id IS NULL)
       ORDER BY a.created_at DESC, a.id DESC LIMIT 1
     ) ass ON TRUE
     LEFT JOIN areas ar ON ar.id = ass.area_id
     LEFT JOIN vacancies v ON v.id = ass.vacancy_id AND v.company_id = c.company_id
     WHERE ${where.join(' AND ')}
     ${order}
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows: rows.rows, total, page: effectivePage, pageSize, totalPages };
}
