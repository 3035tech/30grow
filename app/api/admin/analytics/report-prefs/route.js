import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  getAnalyticsReportPrefs,
  upsertAnalyticsReportPrefs,
} from '../../../../../lib/analytics/analytics-report-prefs.js';

const patchSchema = z.object({
  companyId: zPositiveInt.optional(),
  frequency: z.enum(['weekly', 'monthly', 'off']).optional(),
  recipientUserIds: z.array(zPositiveInt).max(50).optional(),
  attachPdf: z.boolean().optional(),
});

/**
 * GET/PATCH /api/admin/analytics/report-prefs
 */
export const GET = withAdminApi(
  { anyCap: [CAP.OVERVIEW_VIEW, CAP.USERS_MANAGE], logLabel: 'analytics-report-prefs-get' },
  async ({ request, companyId }) => {
    const result = await getAnalyticsReportPrefs(undefined, companyId);
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json({ ok: true, prefs: result.prefs });
  }
);

export const PATCH = withAdminApi(
  {
    anyCap: [CAP.OVERVIEW_VIEW, CAP.USERS_MANAGE],
    body: patchSchema,
    logLabel: 'analytics-report-prefs-patch',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await upsertAnalyticsReportPrefs(undefined, companyId, {
      frequency: body.frequency,
      recipientUserIds: body.recipientUserIds,
      attachPdf: body.attachPdf,
      updatedBy: payload?.sub != null ? Number(payload.sub) : null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_INPUT });
    }
    return NextResponse.json({ ok: true, prefs: result.prefs });
  }
);
