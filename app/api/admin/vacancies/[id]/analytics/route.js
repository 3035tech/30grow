import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api';
import { apiError, ERR, httpStatusForError } from '../../../../../../lib/api-error';
import { CAP } from '../../../../../../lib/identity/permissions';
import { getVacancyFunnelAnalytics } from '../../../../../../lib/recruiting/job-funnel';

/**
 * GET /api/admin/vacancies/[id]/analytics
 */
export const GET = withAdminApi(
  { cap: CAP.VACANCIES_VIEW, requireCompany: false, companyFrom: 'none', logLabel: 'vacancy analytics GET' },
  async ({ request, params, scope }) => {
  const vacancyId = Number(params?.id);
  if (!Number.isFinite(vacancyId) || vacancyId <= 0) {
    return apiError(request, ERR.INVALID_VACANCY, httpStatusForError(ERR.INVALID_VACANCY));
  }

  const stats = await getVacancyFunnelAnalytics({
    vacancyId,
    companyId: scope.companyId,
    isAdmin: scope.isAdmin,
  });
  if (!stats.ok) {
    const code = stats.errorCode || ERR.NOT_FOUND;
    return apiError(request, code, httpStatusForError(code));
  }

  return NextResponse.json({
    vacancyId: stats.vacancyId,
    title: stats.title,
    views: stats.views,
    applyStarts: stats.applyStarts,
    applications: stats.applications,
    interviews: stats.interviews,
    hires: stats.hires,
    conversionRate: stats.conversionRate,
    sources: stats.sources,
    byType: stats.byType,
    stagePerformance: stats.stagePerformance,
    bottlenecks: stats.bottlenecks,
  });
  }
);
