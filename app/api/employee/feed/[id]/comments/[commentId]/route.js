import { NextResponse } from 'next/server';
import { getEmployeeSessionPayload } from '../../../../../../../lib/employee/employee-session.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import { COMPANY_MODULE, companyHasModule } from '../../../../../../../lib/company/company-modules.js';
import { deleteOwnPostComment } from '../../../../../../../lib/company/company-post-interactions.js';

export const dynamic = 'force-dynamic';

export async function DELETE(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    if (!companyHasModule(session.companyModules, COMPANY_MODULE.COMPANY_FEED)) return apiError(request, ERR.FORBIDDEN, 403);
    const parsed = z.object({ id: zPositiveInt, commentId: zPositiveInt }).safeParse(await params);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const result = await deleteOwnPostComment({ companyId: session.companyId, postId: parsed.data.id, candidateId: session.candidateId, commentId: parsed.data.commentId });
    return result.ok ? NextResponse.json(result) : apiErrorFromResult(request, result);
  } catch (error) {
    console.error('DELETE employee post comment', error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
