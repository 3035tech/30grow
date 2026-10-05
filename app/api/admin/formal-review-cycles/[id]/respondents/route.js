import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { query } from '../../../../../../lib/db.js';
import { listFormalCycleRespondents } from '../../../../../../lib/people/formal-competency-reviews.js';

/** GET /api/admin/formal-review-cycles/[id]/respondents — matriz para confirmar a publicação. */
export const GET = withAdminApi(
  { cap: CAP.PERFORMANCE_VIEW, query: z.object({ companyId: zPositiveInt.optional() }), companyFrom: 'query', logLabel: 'formal-cycle-respondents' },
  async ({ request, companyId, params }) => {
    const cycleId = Number(params?.id);
    if (!Number.isSafeInteger(cycleId) || cycleId <= 0) return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    const result = await listFormalCycleRespondents(query, { companyId, cycleId });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);
