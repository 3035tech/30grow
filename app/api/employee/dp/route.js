import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { query } from '../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import {
  createLeaveRequest,
  getDpProfile,
  getEmployeeDpHome,
  upsertDpProfile,
} from '../../../../lib/people/employee-dp.js';
import { notifyCompanyManagers } from '../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../lib/manager-notification-catalog.js';
import { checkRateLimit } from '../../../../lib/identity/rate-limit.js';
import { AUDIT_ACTOR_KIND, auditFromRequest } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/dp */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const data = await getEmployeeDpHome({ query }, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!data.ok) return apiErrorFromResult(request, data);
    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/employee/dp', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PATCH emergency contact + address (preserves RH internal notes). */
export async function PATCH(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { candidateId, companyId } = session;
    const body = await request.json().catch(() => ({}));

    const existing = await getDpProfile({ query }, { companyId, candidateId });
    if (!existing.ok) return apiErrorFromResult(request, existing);
    const prev = existing.profile;

    const result = await upsertDpProfile({ query }, {
      companyId,
      candidateId,
      emergencyName: body.emergencyName ?? prev.emergencyName,
      emergencyPhone: body.emergencyPhone ?? prev.emergencyPhone,
      emergencyRelation: body.emergencyRelation ?? prev.emergencyRelation,
      cpf: body.cpf ?? prev.cpf,
      addressLine: body.addressLine ?? prev.addressLine,
      addressNumber: body.addressNumber,
      addressCity: body.addressCity ?? prev.addressCity,
      addressState: body.addressState ?? prev.addressState,
      addressPostal: body.addressPostal ?? prev.addressPostal,
      internalNotes: prev.internalNotes,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    if (result.changes.length) await auditFromRequest(request, {
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
      actorCandidateId: candidateId,
      companyId,
      action: 'dp.profile.updated',
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { changes: result.changes },
    });
    return NextResponse.json({
      ok: true,
      profile: { ...result.profile, internalNotes: undefined },
    });
  } catch (err) {
    console.error('PATCH /api/employee/dp', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST leave request */
export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { candidateId, companyId } = session;

    const rl = await checkRateLimit(`emp-leave:${candidateId}`, 10, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const body = await request.json().catch(() => ({}));
    const result = await createLeaveRequest({ query }, {
      companyId,
      candidateId,
      leaveType: body.leaveType,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      reason: body.reason,
      requestedBy: 'employee',
      autoApprove: false,
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    try {
      await notifyCompanyManagers(query, {
        companyId,
        type: NOTIF.DP_LEAVE_REQUESTED,
        payload: {
          candidateId,
          candidateName: result.item.candidateName,
          leaveId: result.item.id,
        },
      });
    } catch (e) {
      console.error('[dp] manager leave notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST /api/employee/dp', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
