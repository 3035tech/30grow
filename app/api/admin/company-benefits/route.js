import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt, zQueryBool } from '../../../../lib/validate.js';
import {
  listCompanyBenefits,
  createCompanyBenefit,
  getCompanyBenefitCategories,
} from '../../../../lib/company/company-benefits.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  includeInactive: zQueryBool,
  categoryId: zPositiveInt.optional().nullable(),
  /** @deprecated prefer categoryId */
  category: z.string().trim().max(100).optional().nullable(),
  categories: zQueryBool,
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  categoryId: zPositiveInt.optional().nullable(),
  /** @deprecated prefer categoryId */
  category: z.string().trim().max(100).optional().nullable(),
  benefitType: z.string().trim().max(80).optional().nullable(),
});

/**
 * GET /api/admin/company-benefits — list benefits (users.manage)
 * POST /api/admin/company-benefits — create benefit (users.manage)
 */

export const GET = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'company-benefits GET',
  },
  async ({ companyId, query }) => {
    if (query.categories) {
      const categoriesList = await getCompanyBenefitCategories(null, { companyId });
      return NextResponse.json({ ok: true, categories: categoriesList }, { status: 200 });
    }

    const benefits = await listCompanyBenefits(null, {
      companyId,
      includeInactive: query.includeInactive,
      categoryId: query.categoryId || null,
      category: query.category || null,
      limit: query.limit,
    });
    return NextResponse.json({ ok: true, benefits }, { status: 200 });
  }
);

export const POST = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'company-benefits POST',
  },
  async ({ request, payload, companyId, body }) => {
    const result = await createCompanyBenefit(null, {
      companyId,
      name: body.name,
      description: body.description,
      categoryId: body.categoryId,
      category: body.category,
      benefitType: body.benefitType,
      createdByUserId: payload.userId,
    });

    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }

    return NextResponse.json({ ok: true, benefit: result.benefit }, { status: 201 });
  }
);
