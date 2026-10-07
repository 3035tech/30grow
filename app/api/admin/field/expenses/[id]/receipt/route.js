/**
 * GET /api/admin/field/expenses/[id]/receipt — authenticated download of the receipt.
 */

import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { CAP } from '../../../../../../../lib/permissions.js';
import { dpDownloadResponse } from '../../../../../../../lib/people/dp-download-response.js';
import { downloadFieldExpenseReceipt } from '../../../../../../../lib/people/field-team.js';
import { zPositiveInt } from '../../../../../../../lib/validate.js';

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'field-expense-receipt',
  },
  async ({ request, companyId, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
    return dpDownloadResponse(request, `manager:${payload.userId}`, () =>
      downloadFieldExpenseReceipt({ companyId, id: parsed.data })
    );
  }
);
