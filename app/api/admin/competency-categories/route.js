import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt, zQueryBool } from '../../../../lib/validate.js';
import { withTransaction } from '../../../../lib/db.js';
import { auditFromRequest } from '../../../../lib/audit.js';
import { listCompetencyCategories, mutateCompetencyCategory } from '../../../../lib/people/competency-categories.js';

const company = { companyId: zPositiveInt.optional() };
const name = z.string().trim().min(1).max(200);
export const GET = withAdminApi({
  cap: CAP.PERFORMANCE_VIEW, companyFrom: 'query',
  query: z.object({ ...company, q: z.string().trim().max(100).optional(), includeInactive: zQueryBool,
    page: z.coerce.number().int().min(1).max(100000).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }),
}, async ({ companyId, query }) => NextResponse.json(await listCompetencyCategories(null, { ...query, companyId }), { headers: { 'Cache-Control': 'private, no-store' } }));

function mutation(schema, action, remove = false) {
  return withAdminApi({ cap: CAP.PERFORMANCE_VIEW, body: schema, companyFrom: 'body', logLabel: action }, async ({ companyId, body, request, payload }) => {
    let result;
    try { result = await withTransaction(db => mutateCompetencyCategory(db, { ...body, companyId, remove })); }
    catch (error) {
      if (error.code === '23505') result = { ok: false, errorCode: ERR.COMPETENCY_CATEGORY_NAME_EXISTS };
      else if (error.code === '23503' && remove) result = { ok: false, errorCode: ERR.COMPETENCY_CATEGORY_IN_USE };
      else throw error;
    }
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, { actorUserId: payload.userId, companyId, action, targetType: 'competency_category', targetId: result.category?.id || result.id, metadata: { name: body.name, active: body.active } });
    return NextResponse.json(result, { status: action === 'competency_category.create' ? 201 : 200 });
  });
}
export const POST = mutation(z.object({ ...company, name }).strict(), 'competency_category.create');
export const PATCH = mutation(z.object({ ...company, id: zPositiveInt, name: name.optional(), active: z.boolean().optional() }).strict().refine(body => body.name !== undefined || body.active !== undefined), 'competency_category.update');
export const DELETE = mutation(z.object({ ...company, id: zPositiveInt }).strict(), 'competency_category.delete', true);
