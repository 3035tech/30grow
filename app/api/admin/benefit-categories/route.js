import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt, zQueryBool } from '../../../../lib/validate.js';
import {
  listBenefitCategories,
  createBenefitCategory,
} from '../../../../lib/company/company-benefits.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  includeInactive: zQueryBool,
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(100),
});

/**
 * GET /api/admin/benefit-categories — list categories (users.manage)
 * POST /api/admin/benefit-categories — create category (users.manage)
 */

export const GET = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'benefit-categories GET',
  },
  async ({ companyId, query }) => {
    const categories = await listBenefitCategories(null, {
      companyId,
      includeInactive: query.includeInactive,
      limit: query.limit,
    });
    return NextResponse.json({ ok: true, categories }, { status: 200 });
  }
);

export const POST = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'benefit-categories POST',
  },
  async ({ request, payload, companyId, body }) => {
    const result = await createBenefitCategory(null, {
      companyId,
      name: body.name,
      createdByUserId: payload.userId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }
    return NextResponse.json({ ok: true, category: result.category }, { status: 201 });
  }
);
