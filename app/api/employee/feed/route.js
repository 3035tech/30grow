import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import { listCompanyPosts } from '../../../../lib/company/company-posts.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/feed — company posts (paginated) */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);

    const result = await listCompanyPosts(null, {
      companyId: session.companyId,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 10,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/employee/feed', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
