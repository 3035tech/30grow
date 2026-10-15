import { auditFromRequest } from '../../../../lib/audit.js';
import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP, requireCapability } from '../../../../lib/ae/require-admin.js';
import { apiError } from '../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { candidateTagBodySchema } from '../../../../lib/candidate-tags-validation.js';
import { listCandidateTags, saveCandidateTag } from '../../../../lib/candidate-tags.js';

export const GET = withAdminApi(
  {
    cap: CAP.VACANCIES_VIEW,
    query: z.object({ companyId: zPositiveInt.optional() }),
    companyFrom: 'query',
  },
  async ({ companyId, payload }) =>
    NextResponse.json({
      tags: await listCandidateTags(companyId),
      canManage: requireCapability(payload, CAP.VACANCIES_MANAGE),
    }),
);

export const POST = withAdminApi(
  { cap: CAP.VACANCIES_MANAGE, body: candidateTagBodySchema, companyFrom: 'body' },
  async ({ request, companyId, body, payload }) => {
    const result = await saveCandidateTag({ ...body, companyId, actorId: payload.userId });
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
      ? NextResponse.json(result, { status: 201 })
      : apiError(request, result.errorCode, result.status);
  },
);
