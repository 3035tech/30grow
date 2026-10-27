import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { auditFromRequest } from '../../../../lib/audit.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import {
  assignRecruitingCandidate,
  deleteRecruitingView,
  getRecruitingWorkspace,
  saveRecruitingView,
} from '../../../../lib/recruiting/recruiting-workspace.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  vacancyId: zPositiveInt,
  viewId: zPositiveInt.optional(),
});

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('assign_candidate'),
    companyId: zPositiveInt.optional(),
    vacancyId: zPositiveInt,
    candidateId: zPositiveInt,
    ownerUserId: zPositiveInt.nullable(),
  }),
  z.object({
    action: z.literal('save_view'),
    companyId: zPositiveInt.optional(),
    vacancyId: zPositiveInt,
    name: z.string().trim().min(1).max(60),
    filters: z.record(z.string(), z.unknown()),
  }),
]);

export const GET = withAdminApi(
  { cap: CAP.VACANCIES_VIEW, query: querySchema, companyFrom: 'query', logLabel: 'recruiting workspace GET' },
  async ({ request, companyId, query, payload }) => {
    const result = await getRecruitingWorkspace({
      companyId,
      userId: payload?.userId || payload?.id,
      vacancyId: query.vacancyId,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  { cap: CAP.VACANCIES_MANAGE, body: bodySchema, companyFrom: 'body', logLabel: 'recruiting workspace POST' },
  async ({ request, companyId, body, payload }) => {
    const userId = payload?.userId || payload?.id;
    const result = body.action === 'assign_candidate'
      ? await assignRecruitingCandidate({
          companyId,
          vacancyId: body.vacancyId,
          candidateId: body.candidateId,
          ownerUserId: body.ownerUserId,
          updatedByUserId: userId,
        })
      : await saveRecruitingView({
          companyId,
          userId,
          vacancyId: body.vacancyId,
          name: body.name,
          filters: body.filters,
        });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    await auditFromRequest(request, {
      actorUserId: userId,
      companyId,
      action: body.action === 'assign_candidate' ? 'recruiting.candidate.assigned' : 'recruiting.view.saved',
      targetType: body.action === 'assign_candidate' ? 'candidate' : 'recruiting_saved_view',
      targetId: body.action === 'assign_candidate' ? body.candidateId : result.view?.id,
      metadata: { vacancyId: body.vacancyId, ownerUserId: result.ownerUserId || null },
    });
    return NextResponse.json(result, { status: body.action === 'save_view' ? 201 : 200 });
  }
);

export const DELETE = withAdminApi(
  { cap: CAP.VACANCIES_MANAGE, query: querySchema, companyFrom: 'query', logLabel: 'recruiting workspace DELETE' },
  async ({ request, companyId, query, payload }) => {
    const result = await deleteRecruitingView({
      companyId,
      userId: payload?.userId || payload?.id,
      viewId: query.viewId,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    return NextResponse.json(result);
  }
);
