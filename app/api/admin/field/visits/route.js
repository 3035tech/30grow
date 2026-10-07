/**
 * GET  /api/admin/field/visits — team visits of a day (paginated)
 * POST /api/admin/field/visits — plan a visit for a collaborator
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult } from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/permissions.js';
import { listCompanyFieldVisits } from '../../../../../lib/people/field-team.js';
import { fieldVisitBodySchema, planFieldVisit } from '../../../../../lib/people/field-team-api.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  candidateId: zPositiveInt.optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(5).max(50).optional(),
});

const bodySchema = fieldVisitBodySchema.extend({
  companyId: zPositiveInt.optional(),
  candidateId: zPositiveInt,
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'field-visits',
  },
  async ({ request, companyId, query }) => {
    const result = await listCompanyFieldVisits(null, {
      companyId,
      day: query.day || '',
      candidateId: query.candidateId ?? null,
      page: query.page,
      pageSize: query.pageSize,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: bodySchema,
    logLabel: 'field-visit-plan',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await planFieldVisit({ companyId, userId: payload.userId || null, candidateId: body.candidateId, body });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, item: result.item });
  }
);
