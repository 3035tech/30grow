import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../../lib/api-error.js';
import {
  CAP,
  getSessionPayload,
  getManagerScope,
  requireCapability,
} from '../../../../../../lib/ae/require-admin.js';
import { getVacancyRanking } from '../../../../../../lib/recruiting/vacancy-ranking.js';
import { z, parseSearchParams } from '../../../../../../lib/validate.js';
import { candidateTagFilterShape } from '../../../../../../lib/recruiting/candidate-tags-validation.js';
import { contentLocale } from '../../../../../../lib/i18n.js';

/** GET /api/admin/vacancies/[id]/ranking — fit ranking for vacancy pipeline. */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.VACANCIES_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const filters = parseSearchParams(request, z.object(candidateTagFilterShape));
    if (!filters.ok) return filters.response;
    const url = new URL(request.url);
    const qLocale = url.searchParams.get('locale');
    const locale = contentLocale(qLocale);

    const result = await getVacancyRanking({
      vacancyId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
      locale,
      ...filters.data,
    });
    if (!result.ok) {
      const status = result.errorCode === 'NOT_FOUND' ? 404 : 400;
      return apiError(request, result.errorCode || 'INVALID_DATA', status);
    }

    return NextResponse.json({
      vacancyId: result.vacancyId,
      ranking: result.ranking,
      nucleusSize: result.nucleusSize,
      companyId: result.companyId,
      total: result.total,
      truncated: result.truncated,
      rankingCap: result.rankingCap,
    });
  } catch (e) {
    console.error(e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
