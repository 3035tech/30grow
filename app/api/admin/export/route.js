import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../lib/identity/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/identity/auth';
import { queryRead } from '../../../../lib/db';
import { audit } from '../../../../lib/audit';
import {
  parsePipelineFilter,
  parseDateFilter,
  parseNameSearch,
  parseRosterScope,
} from '../../../../lib/assessment/assessment-filters';
import { apiError, ERR } from '../../../../lib/api-error';
import { canAccessAnalysisData, isSuperAdminPayload } from '../../../../lib/identity/permissions';
import {
  assessmentsCsvStream,
  exportMaxRows,
  fetchAssessmentsForExport,
} from '../../../../lib/assessment/export-assessments-csv';

export async function GET(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  const allowed = canAccessAnalysisData(payload);
  if (!allowed) return apiError(request, ERR.UNAUTHORIZED, 401);
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const { searchParams } = new URL(request.url);
  const area = (searchParams.get('area') || 'all').toString();
  // Filename vai em Content-Disposition; restringe a chars seguros de nome de arquivo
  // (o `area` real segue como parâmetro para filtragem; isto é só o rótulo do CSV).
  const safeAreaTag = area.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'all';
  const rawExportCompany = (searchParams.get('company') || 'all').toString();
  const rawVacancy = String(searchParams.get('vacancy') || 'all').trim();
  const pipelineStage = parsePipelineFilter(searchParams);
  const { dateFrom, dateTo } = parseDateFilter(searchParams);
  const nameSearch = parseNameSearch(searchParams);
  const rosterScope = parseRosterScope(searchParams);
  const maxRows = exportMaxRows();

  let scopeCompanyFilter = null;
  if (isAdmin && rawExportCompany !== 'all') {
    const cid = parseInt(rawExportCompany, 10);
    if (Number.isFinite(cid)) {
      const ok = await queryRead(`SELECT id FROM companies WHERE id = $1 AND deleted = FALSE LIMIT 1`, [cid]);
      if (ok.rowCount > 0) scopeCompanyFilter = cid;
    }
  }

  const { rows, truncated } = await fetchAssessmentsForExport({
    isAdmin,
    companyId,
    scopeCompanyFilter,
    area,
    vacancy: rawVacancy,
    pipelineStage,
    dateFrom,
    dateTo,
    rosterScope,
    nameSearch,
    maxRows,
  });

  await audit({
    actorUserId: payload.userId || null,
    action: 'admin.export_csv',
    targetType: 'assessments',
    targetId: area,
    metadata: { area, rows: rows.length, truncated, maxRows },
  });

  const headers = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="candidatos_${safeAreaTag}.csv"`,
    'X-Export-Max-Rows': String(maxRows),
    'X-Export-Row-Count': String(rows.length),
    'X-Export-Truncated': truncated ? '1' : '0',
  };

  return new NextResponse(assessmentsCsvStream(rows), { status: 200, headers });
}
