import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  getBenefitCategory,
  updateBenefitCategory,
  deactivateBenefitCategory,
} from '../../../../../lib/company/company-benefits.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
});

function parseCategoryId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * GET /api/admin/benefit-categories/[id]
 * PATCH /api/admin/benefit-categories/[id]
 * DELETE /api/admin/benefit-categories/[id] — soft deactivate
 */

export const GET = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    query: z.object({ companyId: zPositiveInt.optional() }),
    companyFrom: 'query',
    logLabel: 'benefit-categories/[id] GET',
  },
  async ({ request, companyId, params }) => {
    const categoryId = parseCategoryId(params);
    if (!categoryId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const category = await getBenefitCategory(null, { companyId, categoryId });
    if (!category) {
      return apiError(request, ERR.BENEFIT_CATEGORY_NOT_FOUND, httpStatusForError(ERR.BENEFIT_CATEGORY_NOT_FOUND));
    }
    return NextResponse.json({ ok: true, category }, { status: 200 });
  }
);

export const PATCH = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'benefit-categories/[id] PATCH',
  },
  async ({ request, companyId, params, body }) => {
    const categoryId = parseCategoryId(params);
    if (!categoryId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await updateBenefitCategory(null, {
      companyId,
      categoryId,
      name: body.name,
      active: body.active,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UPDATE_FAILED });
    }
    return NextResponse.json({ ok: true, category: result.category }, { status: 200 });
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.BENEFITS_VIEW,
    query: z.object({ companyId: zPositiveInt.optional() }),
    companyFrom: 'query',
    logLabel: 'benefit-categories/[id] DELETE',
  },
  async ({ request, companyId, params }) => {
    const categoryId = parseCategoryId(params);
    if (!categoryId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await deactivateBenefitCategory(null, { companyId, categoryId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.DELETE_FAILED });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }
);
