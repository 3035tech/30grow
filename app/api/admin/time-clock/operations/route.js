import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { canManageDigitalCertificate } from '../../../../../lib/rep/certificate-admin.js';
import { timeClockOperations } from '../../../../../lib/rep/operations.js';
import { retryTimePush } from '../../../../../lib/people/time-clock-delivery.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { auditFromRequest } from '../../../../../lib/audit.js';
import { checkRateLimit } from '../../../../../lib/identity/rate-limit.js';
const access = {
  cap: CAP.USERS_MANAGE,
  requireCompany: false,
  companyFrom: 'none',
};
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
export const GET = withAdminApi(access, async ({ request, payload }) => {
  if (!canManageDigitalCertificate(payload))
    return apiError(request, ERR.FORBIDDEN, 403);
  return NextResponse.json(await timeClockOperations(null), { headers });
});
export const POST = withAdminApi(
  { ...access, body: z.object({ id: zPositiveInt }).strict() },
  async ({ request, payload, body }) => {
    if (!canManageDigitalCertificate(payload))
      return apiError(request, ERR.FORBIDDEN, 403);
    const limit = await checkRateLimit(
      `time-push-retry:${payload.userId}`,
      20,
      60000,
    );
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, 429);
    const result = await retryTimePush(null, { id: body.id });
    if (!result.ok) return apiError(request, ERR.NOT_FOUND, 404);
    await auditFromRequest(request, {
      actorUserId: payload.userId,
      action: 'time_clock.push_retry',
      targetType: 'time_clock_push_delivery',
      targetId: body.id,
    });
    return NextResponse.json(result, { headers });
  },
);
