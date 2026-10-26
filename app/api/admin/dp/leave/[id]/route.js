import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { query } from '../../../../../../lib/db.js';
import { CAP } from '../../../../../../lib/identity/permissions.js';
import { updateLeaveRequest } from '../../../../../../lib/people/employee-dp.js';
import { notifyCandidate, EMPLOYEE_NOTIF } from '../../../../../../lib/employee/employee-notifications.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { DP_LEAVE_STATUSES } from '../../../../../../lib/domain-status.js';

const patchBodySchema = z.object({
  status: z.enum(/** @type {[string, ...string[]]} */ (DP_LEAVE_STATUSES)).optional(),
  managerNotes: z.string().max(2000).optional(),
  companyId: zPositiveInt.optional(),
});

/** PATCH /api/admin/dp/leave/[id] */
export const PATCH = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: patchBodySchema,
    logLabel: 'dp-leave-patch',
  },
  async ({ request, payload, body, params, companyId }) => {
    const idParsed = zPositiveInt.safeParse(params?.id);
    if (!idParsed.success) return apiError(request, ERR.INVALID_ID, 400);

    const result = await updateLeaveRequest({ query }, {
      id: idParsed.data,
      companyId,
      status: body.status,
      managerNotes: body.managerNotes,
      userId: payload.userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    try {
      await notifyCandidate({
        companyId,
        candidateId: result.item.candidateId,
        type: EMPLOYEE_NOTIF.DP_LEAVE_UPDATE,
        payload: {
          leaveId: result.item.id,
          status: result.item.status,
          leaveType: result.item.leaveType,
        },
      });
    } catch (e) {
      console.error('[dp] leave decide notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item });
  }
);
