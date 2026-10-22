import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import {
  getSessionPayload,
  getManagerScope,
  isSuperAdminPayload,
  CAP,
  requireCapability,
} from '../../../../../lib/ae/require-admin.js';
import { getCompanyTurnoverRisks } from '../../../../../lib/turnover-radar.js';

/**
 * GET /api/admin/turnover-radar/company?companyId=X
 *
 * Retorna lista de colaboradores em risco de rotatividade (Overview intel).
 */
export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.OVERVIEW_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isSuperAdminPayload(payload);
    const { searchParams } = new URL(request.url);

    let companyId;
    if (isAdmin) {
      const qCompanyId = searchParams.get('companyId');
      companyId = qCompanyId ? parseInt(qCompanyId) : null;
      if (!companyId) {
        return apiError(request, ERR.COMPANY_REQUIRED, 400);
      }
    } else {
      companyId = payload.companyId;
      if (!companyId) {
        return apiError(request, ERR.COMPANY_REQUIRED, 400);
      }
    }

    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const minRisk = searchParams.get('minRisk') || 'medium';

    const result = await getCompanyTurnoverRisks(companyId, {
      limit: Math.min(Number.isFinite(limit) ? limit : 20, 100),
      minRisk,
    });

    return NextResponse.json({
      companyId,
      total: result.risks.length,
      risks: result.risks,
      truncated: result.truncated,
      scanned: result.scanned,
      scanCap: result.scanCap,
      distribution: result.distribution || { low: 0, medium: 0, high: 0 },
    });
  } catch (err) {
    console.error('[turnover-radar] GET company error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
