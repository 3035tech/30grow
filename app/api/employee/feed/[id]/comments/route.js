import { NextResponse } from 'next/server';
import { getEmployeeSessionPayload } from '../../../../../../lib/employee/employee-session.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { COMPANY_MODULE, companyHasModule } from '../../../../../../lib/company/company-modules.js';
import { createPostComment, listPostComments } from '../../../../../../lib/company/company-post-interactions.js';
import { checkRateLimit } from '../../../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';

async function scope(request, params) {
  const session = await getEmployeeSessionPayload();
  if (!session) return { response: apiError(request, ERR.UNAUTHORIZED, 401) };
  if (!companyHasModule(session.companyModules, COMPANY_MODULE.COMPANY_FEED)) return { response: apiError(request, ERR.FORBIDDEN, 403) };
  const parsed = z.object({ id: zPositiveInt }).safeParse(await params);
  if (!parsed.success) return { response: apiError(request, ERR.INVALID_ID, 400) };
  return { companyId: session.companyId, postId: parsed.data.id, candidateId: session.candidateId };
}

export async function GET(request, { params }) {
  try {
    const target = await scope(request, params);
    if (target.response) return target.response;
    const offset = new URL(request.url).searchParams.get('offset') || 0;
    const result = await listPostComments({ ...target, offset });
    return result.ok ? NextResponse.json(result) : apiErrorFromResult(request, result);
  } catch (error) {
    console.error('GET employee post comments', error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request, { params }) {
  try {
    const target = await scope(request, params);
    if (target.response) return target.response;
    const limit = await checkRateLimit(`post-comment:${target.companyId}:${target.candidateId}`, 30, 60000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(limit.retryAfterSec) } });
    const body = await request.json().catch(() => ({}));
    const result = await createPostComment({ ...target, body: body.body });
    return result.ok ? NextResponse.json(result, { status: 201 }) : apiErrorFromResult(request, result);
  } catch (error) {
    console.error('POST employee post comments', error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
