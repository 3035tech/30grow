/**
 * GET /api/employee/time-clock/closures — own mirrors of concluded closures (sign / dispute).
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { query } from '../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee-session.js';
import { listEmployeeClosureAcks } from '../../../../../lib/people/time-clock-closure-people.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const data = await listEmployeeClosureAcks({ query }, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!data.ok) return apiErrorFromResult(request, data);
    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/employee/time-clock/closures', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
