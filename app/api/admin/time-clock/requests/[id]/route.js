/**
 * GET  /api/admin/time-clock/requests/[id] — request + the day as recorded today
 * POST /api/admin/time-clock/requests/[id] — approve | reject (optional note)
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { CAP } from '../../../../../../lib/permissions.js';
import { EMPLOYEE_NOTIF, notifyCandidate } from '../../../../../../lib/employee-notifications.js';
import { TIME_REQUEST_DECISION } from '../../../../../../lib/domain-status.js';
import { decideTimeRequest, getTimeRequestDetail } from '../../../../../../lib/people/time-clock-requests.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  decision: z.enum(/** @type {[string, ...string[]]} */ (Object.values(TIME_REQUEST_DECISION))),
  note: z.string().max(500).optional().nullable(),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'time-clock-request-detail',
  },
  async ({ request, companyId, params }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const result = await getTimeRequestDetail(null, { companyId, id: parsed.data });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: bodySchema,
    logLabel: 'time-clock-request-decide',
  },
  async ({ request, companyId, body, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const userId = payload.userId || null;
    const result = await decideTimeRequest({
      companyId,
      id: parsed.data,
      decision: body.decision,
      note: body.note || '',
      userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });

    await audit({
      actorUserId: userId,
      action: `time_clock.request_${result.status}`,
      companyId,
      targetType: 'time_request',
      targetId: result.id,
      metadata: { candidateId: result.candidateId, day: result.day, kind: result.kind },
    });
    try {
      await notifyCandidate({
        companyId,
        candidateId: result.candidateId,
        type: EMPLOYEE_NOTIF.TIME_REQUEST_DECIDED,
        entityType: 'time_request',
        entityId: result.id,
        payload: { requestId: result.id, status: result.status, kind: result.kind, day: result.day },
      });
    } catch (e) {
      console.error('[time-clock] request decide notif', e?.message || e);
    }
    return NextResponse.json({ ok: true, id: result.id, status: result.status });
  }
);
