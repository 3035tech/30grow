import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { auditFromRequest } from '../../../../lib/audit.js';
import { checkRateLimit } from '../../../../lib/identity/rate-limit.js';
import { ORG_UNIT_TYPES } from '../../../../lib/org-position-constants.js';
import { ORG_UNIT } from '../../../../lib/org-unit-constants.js';
import { listOrgUnits, getCandidateOrgUnit, saveOrgUnit, assignOrgUnit } from '../../../../lib/people/org-units.js';

const company = { companyId: zPositiveInt.optional() };
const querySchema = z.object({ ...company, candidateId: zPositiveInt.optional() });
const unitSchema = z.object({
  ...company, unitType:z.enum(ORG_UNIT_TYPES).optional(), name: z.string().trim().min(1).max(ORG_UNIT.MAX_NAME), parentId: zPositiveInt.nullable(),
});
export const GET = withAdminApi({ cap: CAP.TEAM_VIEW, query: querySchema }, async ({ request, companyId, query }) => {
  const result = query.candidateId
    ? await getCandidateOrgUnit(companyId, query.candidateId)
    : await listOrgUnits(companyId);
  return result.ok ? NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } }) : apiErrorFromResult(request, result);
});

function mutation(schema, action, work) {
  return withAdminApi({ cap: CAP.TEAM_VIEW, body: schema, companyFrom: 'body', logLabel: action }, async (ctx) => {
    const { request, companyId, payload, body } = ctx;
    const limit = await checkRateLimit(`org-units:${companyId}:${payload.userId}`, ORG_UNIT.WRITE_LIMIT, ORG_UNIT.WINDOW_MS);
    if (!limit.ok) return apiErrorFromResult(request, { errorCode: ERR.RATE_LIMIT });
    const result = await work({ ...body, companyId });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorUserId: payload.userId, companyId, action,
      targetType: body.candidateId ? 'candidate' : 'org_unit',
      targetId: body.candidateId || result.id,
      metadata: { parentId: body.parentId, orgUnitId: body.orgUnitId, active: body.active },
    });
    return NextResponse.json(result);
  });
}
export const POST = mutation(unitSchema, 'org_units.create', saveOrgUnit);
export const PATCH = mutation(z.object({ ...company, id: zPositiveInt, unitType:z.enum(ORG_UNIT_TYPES).optional(), active: z.boolean().default(true), name: z.string().trim().min(1).max(ORG_UNIT.MAX_NAME).optional(), parentId: zPositiveInt.nullable().optional() }), 'org_units.update', saveOrgUnit);
export const PUT = mutation(z.object({ ...company, candidateId: zPositiveInt, orgUnitId: zPositiveInt.nullable() }), 'org_units.assign', assignOrgUnit);
