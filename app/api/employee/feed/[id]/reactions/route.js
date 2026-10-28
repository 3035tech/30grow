import { NextResponse } from 'next/server';
import { getEmployeeSessionPayload } from '../../../../../../lib/employee/employee-session.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { COMPANY_MODULE, companyHasModule } from '../../../../../../lib/company/company-modules.js';
import { setPostReaction } from '../../../../../../lib/company/company-post-interactions.js';
import { checkRateLimit } from '../../../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';

async function handle(request, { params }, emoji) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    if (!companyHasModule(session.companyModules, COMPANY_MODULE.COMPANY_FEED)) return apiError(request, ERR.FORBIDDEN, 403);
    const parsed = z.object({ id: zPositiveInt }).safeParse(await params);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const limit = await checkRateLimit(`post-reaction:${session.companyId}:${session.candidateId}`, 120, 60000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(limit.retryAfterSec) } });
    const result = await setPostReaction({ companyId: session.companyId, postId: parsed.data.id, candidateId: session.candidateId, emoji });
    return result.ok ? NextResponse.json(result) : apiErrorFromResult(request, result);
  } catch (error) {
    console.error('Employee post reaction', error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function PUT(request, context) {
  const body = await request.json().catch(() => ({}));
  return handle(request, context, body.emoji);
}

export async function DELETE(request, context) {
  return handle(request, context, null);
}
