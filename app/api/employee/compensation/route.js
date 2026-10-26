/**
 * GET /api/employee/compensation — proposed/approved bonuses for logged-in collaborator
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import { listEmployeeVisibleCompensation } from '../../../../lib/people/variable-pay.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/compensation */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const result = await listEmployeeVisibleCompensation(null, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/employee/compensation', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
