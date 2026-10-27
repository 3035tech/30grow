import { auditFromRequest } from '../../../../../lib/audit.js';
import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { candidateTagBodySchema } from '../../../../../lib/recruiting/candidate-tags-validation.js';
import { saveCandidateTag } from '../../../../../lib/recruiting/candidate-tags.js';

export const PATCH = withAdminApi(
  { cap: CAP.VACANCIES_MANAGE, body: candidateTagBodySchema, companyFrom: 'body' },
  async ({ request, companyId, body, payload, params }) => {
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return apiError(request, ERR.INVALID_DATA, 400);
    const result = await saveCandidateTag({ ...body, companyId, id, actorId: payload.userId });
    if (result.ok)
      await auditFromRequest(request, {
        actorUserId: payload.userId,
        companyId,
        action: 'candidate.tag.saved',
        targetType: 'candidate_tag',
        targetId: result.tag.id,
        metadata: { active: result.tag.active },
      });
    return result.ok
      ? NextResponse.json(result)
      : apiError(request, result.errorCode, result.status);
  },
);
