import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiError, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { queryRead } from '../../../../lib/db.js';
import { CAP, isSuperAdminPayload } from '../../../../lib/permissions.js';
import { getOnboardingFunnel } from '../../../../lib/onboarding-funnel.js';
import { z } from '../../../../lib/validate.js';

const querySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional(),
});

/**
 * GET /api/admin/onboarding-funnel — cross-tenant wizard funnel + first value (MVP-08). Super admin only.
 * Depth: app/api/admin/onboarding-funnel → 4× ../ até lib/
 */
export const GET = withAdminApi(
  {
    cap: CAP.COMPANIES_MANAGE,
    query: querySchema,
    requireCompany: false,
    companyFrom: 'none',
    logLabel: 'onboarding-funnel GET',
  },
  async ({ request, payload, query }) => {
    if (!isSuperAdminPayload(payload)) {
      return apiError(request, ERR.UNAUTHORIZED, httpStatusForError(ERR.UNAUTHORIZED));
    }
    const funnel = await getOnboardingFunnel({ query: queryRead }, { days: query?.days });
    return NextResponse.json({ ok: true, ...funnel });
  }
);
