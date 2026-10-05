/**
 * DELETE /api/employee/time-clock/requests/[id] — withdraw an own pending request.
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../../lib/employee-session.js';
import { AUDIT_ACTOR_KIND, auditFromRequest } from '../../../../../../lib/audit.js';
import { cancelTimeRequest } from '../../../../../../lib/people/time-clock-requests.js';
import { zPositiveInt } from '../../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';

export async function DELETE(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const parsed = zPositiveInt.safeParse((await params)?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const result = await cancelTimeRequest({
      companyId: session.companyId,
      candidateId: session.candidateId,
      id: parsed.data,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
      actorCandidateId: session.candidateId,
      companyId: session.companyId,
      action: 'time_clock.request_cancelled',
      targetType: 'time_request',
      targetId: parsed.data,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('DELETE /api/employee/time-clock/requests/[id]', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
