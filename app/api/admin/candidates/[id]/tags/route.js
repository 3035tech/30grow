import { auditFromRequest } from '../../../../../../lib/audit.js';
import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiError, ERR } from '../../../../../../lib/api-error.js';
import { candidateTagAssignmentSchema } from '../../../../../../lib/candidate-tags-validation.js';
import { replaceCandidateTags } from '../../../../../../lib/candidate-tags.js';

export const PUT = withAdminApi(
  { cap: CAP.VACANCIES_MANAGE, body: candidateTagAssignmentSchema, companyFrom: 'body' },
  async ({ request, companyId, body, payload, params }) => {
    const candidateId = Number(params.id);
    if (!Number.isSafeInteger(candidateId) || candidateId <= 0)
      return apiError(request, ERR.INVALID_DATA, 400);
    const result = await replaceCandidateTags({
      companyId,
      candidateId,
      tagIds: body.tagIds,
      actorId: payload.userId,
    });
    if (result.ok)
      await auditFromRequest(request, {
        actorUserId: payload.userId,
        companyId,
        action: 'candidate.tags.updated',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: { tagIds: body.tagIds },
      });
    return result.ok
      ? NextResponse.json(result)
      : apiError(request, result.errorCode, result.status);
  },
);
