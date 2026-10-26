import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { query } from '../../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../../lib/employee/employee-session.js';
import { cancelEmployeeLeaveRequest, getEmployeeDisplayName } from '../../../../../../lib/people/employee-dp.js';
import { notifyCompanyManagers } from '../../../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../../../lib/manager-notification-catalog.js';
import { checkRateLimit } from '../../../../../../lib/rate-limit.js';
import { zPositiveInt } from '../../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';

/** PATCH /api/employee/dp/leave/[id] — cancel own requested leave */
export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const idParsed = zPositiveInt.safeParse(params?.id);
    if (!idParsed.success) return apiError(request, ERR.INVALID_ID, 400);

    const rl = await checkRateLimit(
      `emp-leave-cancel:${session.candidateId}`,
      20,
      60 * 60 * 1000
    );
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || body.status || 'cancelled').toLowerCase();
    if (action !== 'cancelled' && action !== 'cancel') {
      return apiError(request, ERR.INVALID_ACTION, 400);
    }

    const result = await cancelEmployeeLeaveRequest(
      { query },
      {
        id: idParsed.data,
        companyId: session.companyId,
        candidateId: session.candidateId,
      }
    );
    if (!result.ok) return apiErrorFromResult(request, result);

    try {
      const name = await getEmployeeDisplayName(
        { query },
        { companyId: session.companyId, candidateId: session.candidateId }
      );
      await notifyCompanyManagers(query, {
        companyId: session.companyId,
        type: NOTIF.DP_LEAVE_CANCELLED,
        entityType: 'leave',
        entityId: result.item.id,
        dedupeKey: `dp_leave_cancel:${result.item.id}`,
        payload: {
          candidateId: session.candidateId,
          candidateName: name,
          leaveId: result.item.id,
        },
      });
    } catch (e) {
      console.error('[dp] leave cancel notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('PATCH /api/employee/dp/leave/[id]', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
