/**
 * DELETE /api/employee/time-clock/requests/[id] — withdraw an own pending request.
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../../lib/employee-session.js';
import { withdrawEmployeeTimeRequest } from '../../../../../../lib/people/time-clock-request-api.js';
import { zPositiveInt } from '../../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';

export async function DELETE(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const parsed = zPositiveInt.safeParse((await params)?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const result = await withdrawEmployeeTimeRequest(request, session, parsed.data);
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('DELETE /api/employee/time-clock/requests/[id]', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
