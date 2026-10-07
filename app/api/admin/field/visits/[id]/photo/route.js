/**
 * GET /api/admin/field/visits/[id]/photo — authenticated download of the check-in photo.
 */

import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { CAP } from '../../../../../../../lib/permissions.js';
import { dpDownloadResponse } from '../../../../../../../lib/people/dp-download-response.js';
import { downloadFieldVisitPhoto } from '../../../../../../../lib/people/field-team.js';
import { zPositiveInt } from '../../../../../../../lib/validate.js';

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'field-visit-photo',
  },
  async ({ request, companyId, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
    return dpDownloadResponse(request, `manager:${payload.userId}`, () =>
      downloadFieldVisitPhoto({ companyId, id: parsed.data })
    );
  }
);
