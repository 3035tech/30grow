import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { softDeleteCompanyKudo } from '../../../../../../lib/company/company-kudos.js';

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** DELETE /api/admin/company-feed/kudos/[id] */
export const DELETE = withAdminApi(
  {
    cap: CAP.COMPANY_FEED_VIEW,
    companyFrom: 'query',
    query: z.object({ companyId: zPositiveInt.optional() }),
    logLabel: 'company-feed kudos DELETE',
  },
  async ({ request, companyId, params }) => {
    const kudoId = parseId(params);
    if (!kudoId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await softDeleteCompanyKudo(null, { companyId, kudoId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json({ ok: true });
  }
);
