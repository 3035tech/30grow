import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CANDIDATE_ACCESS_CAPS } from '../../../../../../../lib/identity/permissions.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../../lib/api-error.js';
import { getCandidateCvFile } from '../../../../../../../lib/recruiting/candidate-cv.js';

export const runtime = 'nodejs';

export const GET = withAdminApi(
  {
    anyCap: [...CANDIDATE_ACCESS_CAPS],
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'candidate cv file',
  },
  async ({ request, scope, params }) => {
    const candidateId = parseInt(String(params?.id || ''), 10);
    if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await getCandidateCvFile({
      candidateId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    return new NextResponse(result.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="curriculo.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
);
