/**
 * GET /api/admin/time-clock/requests/[id]/file — authenticated download of the request proof.
 */

import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { apiError, ERR } from '../../../../../../../lib/api-error.js';
import { CAP } from '../../../../../../../lib/permissions.js';
import { dpDownloadResponse } from '../../../../../../../lib/people/dp-download-response.js';
import { downloadTimeRequestAttachment } from '../../../../../../../lib/people/time-clock-requests.js';
import { zPositiveInt } from '../../../../../../../lib/validate.js';

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'time-clock-request-file',
  },
  async ({ request, companyId, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    return dpDownloadResponse(request, `manager:${payload.userId}`, () =>
      downloadTimeRequestAttachment({ companyId, id: parsed.data })
    );
  }
);
