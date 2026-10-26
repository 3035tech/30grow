import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import {
  getSessionPayload,
  getManagerScope,
  CAP, requireCapability,
  resolveScopedCompanyId,
} from '../../../../../lib/ae/require-admin.js';
import { getCompanyHrScoreRollup } from '../../../../../lib/assessment/hr-score.js';

/**
 * GET /api/admin/hr-score/company?companyId=X
 * Company HR Score rollup (overall + top/bottom). Domain in lib/assessment/hr-score.js.
 */
export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.OVERVIEW_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(
      scope,
      new URL(request.url).searchParams.get('companyId')
    );
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const rollup = await getCompanyHrScoreRollup(companyId);
    if (!rollup.ok) {
      return apiError(request, rollup.errorCode || 'INTERNAL', rollup.errorCode === 'COMPANY_NOT_FOUND' ? 404 : 400);
    }

    return NextResponse.json({
      company: rollup.company,
      overall: rollup.overall,
      byArea: rollup.byArea,
      topPerformers: rollup.topPerformers,
      bottomPerformers: rollup.bottomPerformers,
    });
  } catch (err) {
    console.error('[hr-score] GET company error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
