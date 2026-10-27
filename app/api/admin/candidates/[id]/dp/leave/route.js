import { NextResponse } from 'next/server';
import { query } from '../../../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import {
  CAP,
  getManagerScope,
  getSessionPayload,
  requireAnyCapability,
} from '../../../../../../../lib/ae/require-admin.js';
import { createLeaveRequest } from '../../../../../../../lib/people/employee-dp.js';
import { notifyCandidate, EMPLOYEE_NOTIF } from '../../../../../../../lib/employee/employee-notifications.js';
import { auditFromRequest } from '../../../../../../../lib/audit.js';

const DP_OR_TEAM = Object.freeze([CAP.DP_VIEW, CAP.TEAM_VIEW]);

async function loadCandidateScope(candidateId, scope) {
  const c = await query(
    `SELECT id, company_id AS "companyId", full_name AS "fullName"
     FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (c.rowCount === 0) return { error: ERR.NOT_FOUND };
  if (!scope.isAdmin && String(c.rows[0].companyId) !== String(scope.companyId)) {
    return { error: ERR.UNAUTHORIZED };
  }
  return { candidate: c.rows[0] };
}

/** POST /api/admin/candidates/[id]/dp/leave */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireAnyCapability(payload, DP_OR_TEAM)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);
    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const body = await request.json().catch(() => ({}));
    const result = await createLeaveRequest({ query }, {
      companyId: loaded.candidate.companyId,
      candidateId,
      leaveType: body.leaveType,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      reason: body.reason,
      requestedBy: 'manager',
      autoApprove: body.autoApprove !== false,
      allowOverBalance: body.allowOverBalance === true,
      userId: payload.userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    await auditFromRequest(request, {
      actorUserId: payload.userId || null,
      companyId: loaded.candidate.companyId,
      action: 'dp.leave.created',
      targetType: 'dp_leave_request',
      targetId: result.item.id,
      metadata: { candidateId: Number(candidateId), status: result.item.status },
    });

    try {
      await notifyCandidate({
        companyId: loaded.candidate.companyId,
        candidateId: Number(candidateId),
        type: EMPLOYEE_NOTIF.DP_LEAVE_UPDATE,
        payload: {
          leaveId: result.item.id,
          status: result.item.status,
          leaveType: result.item.leaveType,
        },
      });
    } catch (e) {
      console.error('[dp] employee leave notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST leave', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
