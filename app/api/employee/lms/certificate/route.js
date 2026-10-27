import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee/employee-session.js';
import { getLmsCertificatePayload } from '../../../../../lib/development/lms.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/lms/certificate?enrollmentId= */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const enrollmentId = Number(new URL(request.url).searchParams.get('enrollmentId'));
    const result = await getLmsCertificatePayload(null, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      enrollmentId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/employee/lms/certificate', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
