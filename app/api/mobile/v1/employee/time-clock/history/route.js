import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile-employee-session.js';
import { getEmployeeTimeHistory } from '../../../../../../../lib/people/time-clock-requests.js';
import { parseIsoDay } from '../../../../../../../lib/people/time-day-summary.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && parseIsoDay(from) !== from) || (to && parseIsoDay(to) !== to)) {
      return apiError(request, ERR.INVALID_DATE, HTTP_STATUS.BAD_REQUEST);
    }
    const result = await getEmployeeTimeHistory({ query }, { companyId: session.companyId, candidateId: session.candidateId, from, to });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee time history', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
