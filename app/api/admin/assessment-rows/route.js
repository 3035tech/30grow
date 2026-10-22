import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/auth';
import { queryRead } from '../../../../lib/db';
import {
  assessmentListWhereParts,
  PAGE_SIZE_OPTIONS,
  parseNameSearch,
  parseRosterScope,
  sqlWhere,
} from '../../../../lib/assessment-filters';
import { apiError, ERR } from '../../../../lib/api-error';
import { canAccessAnalysisData, isSuperAdminPayload } from '../../../../lib/permissions';

const BASE_JOIN = `
FROM assessments ass
JOIN candidates c ON c.id = ass.candidate_id
JOIN areas ar ON ar.id = ass.area_id
LEFT JOIN vacancies v ON v.id = ass.vacancy_id
`;

/**
 * Lista completa de assessments (filtros iguais ao dashboard) para a aba Comparativo.
 */
export async function GET(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!canAccessAnalysisData(payload)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const url = new URL(request.url);
  const selectedArea = (url.searchParams.get('area') || 'all').toString();
  const selectedVacancy = (url.searchParams.get('vacancy') || 'all').toString();
  const rawCompany = (url.searchParams.get('company') || 'all').toString();
  let scopeCompanyFilter = null;
  // Super-admin may chip a company; tenant-bound admin is forced to home via resolveCohortCompanyId.
  if (isAdmin && rawCompany !== 'all' && companyId == null) {
    const cid = parseInt(rawCompany, 10);
    if (Number.isFinite(cid)) {
      const ok = await queryRead(`SELECT id FROM companies WHERE id = $1 AND deleted = FALSE LIMIT 1`, [cid]);
      if (ok.rowCount > 0) scopeCompanyFilter = cid;
    }
  }

  const enneRaw = String(url.searchParams.get('enneagram') || '').trim();
  const enneagram = /^[1-9]$/.test(enneRaw) ? enneRaw : 'all';

  const pageRaw = parseInt(url.searchParams.get('comparePage') || url.searchParams.get('page') || '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(
    url.searchParams.get('comparePageSize') || url.searchParams.get('pageSize') || '20',
    10
  );
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;

  const { whereParts, params } = assessmentListWhereParts({
    isAdmin,
    companyId,
    scopeCompanyFilter,
    selectedArea,
    selectedVacancy,
    enneagram,
    rosterScope: parseRosterScope(url.searchParams),
  });
  const nameSearch = parseNameSearch(url.searchParams);
  const extWhereParts = nameSearch
    ? [...whereParts, `c.full_name ILIKE $${params.length + 1}`]
    : whereParts;
  const extParams = nameSearch ? [...params, `%${nameSearch}%`] : params;
  const where = sqlWhere(extWhereParts);

  const cntRes = await queryRead(
    `SELECT COUNT(*)::int AS n ${BASE_JOIN} ${where}`,
    extParams
  );
  const total = cntRes.rows[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = total === 0 ? 1 : Math.min(page, totalPages);

  const pageParams = [...extParams];
  pageParams.push(pageSize);
  const limIx = pageParams.length;
  pageParams.push(Math.max(0, (effectivePage - 1) * pageSize));
  const offIx = pageParams.length;

  const result = await queryRead(
    `SELECT
       ass.id AS "assessmentId",
       c.id AS "candidateId",
       c.full_name AS name,
       ar.key AS "areaKey",
       ar.label AS "areaLabel",
       ass.vacancy_id AS "vacancyId",
       v.title AS "vacancyTitle",
       ass.top_type AS "topType",
       ass.scores,
       ass.created_at AS "createdAt"
     ${BASE_JOIN}
     ${where}
     ORDER BY ass.created_at DESC, ass.id DESC
     LIMIT $${limIx} OFFSET $${offIx}`,
    pageParams
  );

  return NextResponse.json({
    rows: result.rows,
    total,
    page: effectivePage,
    pageSize,
    totalPages,
  });
}
