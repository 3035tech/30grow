import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import { searchEmployeeColleagues } from '../../../../lib/company/company-kudos.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/colleagues?q= — peer picker for kudos */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const url = new URL(request.url);
    const result = await searchEmployeeColleagues(null, {
      companyId: session.companyId,
      excludeCandidateId: session.candidateId,
      q: url.searchParams.get('q') || '',
      limit: 20,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    const people = result.people || [];
    return NextResponse.json({
      ok: true,
      people,
      items: people.map((p) => ({
        id: p.id,
        label: p.fullName,
        email: p.email || undefined,
      })),
    });
  } catch (err) {
    console.error('GET /api/employee/colleagues', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
