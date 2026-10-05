/**
 * GET /api/employee/time-clock/history?from=&to= — own time history (bounded period).
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { query } from '../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee-session.js';
import { getEmployeeTimeHistory } from '../../../../../lib/people/time-clock-requests.js';
import { ISO_DAY_PATTERN as ISO_DAY } from '../../../../../lib/people/time-clock-request-api.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to))) {
      return apiError(request, ERR.INVALID_DATE, 400);
    }
    const data = await getEmployeeTimeHistory({ query }, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      from,
      to,
    });
    if (!data.ok) return apiErrorFromResult(request, data);
    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/employee/time-clock/history', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
