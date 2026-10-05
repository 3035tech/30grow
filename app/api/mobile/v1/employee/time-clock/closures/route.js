import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile-employee-session.js';
import { listEmployeeClosureAcks } from '../../../../../../../lib/people/time-clock-closure-people.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const result = await listEmployeeClosureAcks({ query }, { companyId: session.companyId, candidateId: session.candidateId });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee time closures', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
