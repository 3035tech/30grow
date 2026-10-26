import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { listEmployeeVisibleCompensation } from '../../../../../../lib/people/variable-pay.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'private, no-store' });

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const result = await listEmployeeVisibleCompensation(null, { companyId: session.companyId, candidateId: session.candidateId });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee compensation', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
