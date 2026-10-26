import { NextResponse } from 'next/server';
import { queryRead } from '../../../../../../lib/db.js';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/identity/permissions.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { normalizeLocale } from '../../../../../../lib/i18n.js';
import { buildPersonDossier } from '../../../../../../lib/people/person-dossier.js';

/**
 * GET /api/admin/candidates/[id]/dossier
 * Dossier unificado (B-1901). CAP TEAM_VIEW.
 */
export const GET = withAdminApi(
  {
    cap: CAP.TEAM_VIEW,
    requireCompany: false,
  },
  async ({ request, payload, scope, params, query: q }) => {
    const candidateId = Number(params?.id);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }
    if (!scope.isAdmin && !scope.companyId) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const cand = await queryRead(
      `SELECT id, company_id AS "companyId"
       FROM candidates
       WHERE id = $1
         ${scope.isAdmin ? '' : 'AND company_id = $2'}
       LIMIT 1`,
      scope.isAdmin ? [candidateId] : [candidateId, scope.companyId]
    );
    if (cand.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);
    const tenantCompanyId = Number(cand.rows[0].companyId);

    const locale = normalizeLocale(q?.locale || payload?.locale || 'pt-BR');
    const result = await buildPersonDossier(queryRead, {
      candidateId,
      companyId: tenantCompanyId,
      locale,
      isAdmin: scope.isAdmin,
    });

    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }

    return NextResponse.json(result);
  }
);
