import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import {
  apiError,
  apiErrorFromResult,
  ERR,
} from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { remindTimeClosing } from '../../../../../lib/people/time-clock-reminders.js';
import { checkRateLimit } from '../../../../../lib/identity/rate-limit.js';
import { auditFromRequest } from '../../../../../lib/audit.js';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.object({
  companyId: zPositiveInt.optional(),
  periodStart: day,
  periodEnd: day,
  orgUnitId: zPositiveInt.optional().nullable(),
  deadline: day,
});
export const POST = withAdminApi(
  { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], companyFrom: 'body', body },
  async ({ request, companyId, body, payload }) => {
    const limit = await checkRateLimit(
      `time-closing-reminders:${companyId}:${payload.userId}`,
      3,
      60 * 60 * 1000,
    );
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, 429);
    const result = await remindTimeClosing(null, { ...body, companyId });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorUserId: payload.userId,
      companyId,
      action: 'time_clock.closing_reminders',
      targetType: 'time_clock_period',
      metadata: {
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        deadline: body.deadline,
        inserted: result.inserted,
      },
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
