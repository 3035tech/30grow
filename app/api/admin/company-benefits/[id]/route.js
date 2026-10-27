import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  getCompanyBenefit,
  updateCompanyBenefit,
  deactivateCompanyBenefit,
} from '../../../../../lib/company/company-benefits.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  categoryId: zPositiveInt.optional().nullable(),
  /** @deprecated prefer categoryId */
  category: z.string().trim().max(100).optional().nullable(),
  benefitType: z.string().trim().max(80).optional().nullable(),
  active: z.boolean().optional(),
});

function parseBenefitId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * GET /api/admin/company-benefits/[id]
 * PATCH /api/admin/company-benefits/[id]
 * DELETE /api/admin/company-benefits/[id] — soft deactivate
 */

export const GET = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    query: z.object({ companyId: zPositiveInt.optional() }),
    companyFrom: 'query',
    logLabel: 'company-benefits/[id] GET',
  },
  async ({ request, companyId, params }) => {
    const benefitId = parseBenefitId(params);
    if (!benefitId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const benefit = await getCompanyBenefit(null, { companyId, benefitId });
    if (!benefit) {
      return apiError(request, ERR.NOT_FOUND, httpStatusForError(ERR.NOT_FOUND));
    }
    return NextResponse.json({ ok: true, benefit }, { status: 200 });
  }
);

export const PATCH = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'company-benefits/[id] PATCH',
  },
  async ({ request, companyId, params, body }) => {
    const benefitId = parseBenefitId(params);
    if (!benefitId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await updateCompanyBenefit(null, {
      companyId,
      benefitId,
      name: body.name,
      description: body.description,
      categoryId: body.categoryId,
      category: body.category,
      benefitType: body.benefitType,
      active: body.active,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UPDATE_FAILED });
    }
    return NextResponse.json({ ok: true, benefit: result.benefit }, { status: 200 });
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    query: z.object({ companyId: zPositiveInt.optional() }),
    companyFrom: 'query',
    logLabel: 'company-benefits/[id] DELETE',
  },
  async ({ request, companyId, params }) => {
    const benefitId = parseBenefitId(params);
    if (!benefitId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await deactivateCompanyBenefit(null, { companyId, benefitId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.DELETE_FAILED });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }
);
