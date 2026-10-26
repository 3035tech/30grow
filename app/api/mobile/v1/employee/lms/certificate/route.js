import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../../lib/api-error.js';
import { getLmsCertificatePayload } from '../../../../../../../lib/development/lms.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile/mobile-employee-session.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store, private' });

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const enrollmentId = Number(new URL(request.url).searchParams.get('enrollmentId'));
    if (!Number.isInteger(enrollmentId) || enrollmentId < 1) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await getLmsCertificatePayload(null, { companyId: session.companyId, candidateId: session.candidateId, enrollmentId });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_ACTION });
    return NextResponse.json({ certificate: result.certificate }, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee lms certificate', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
