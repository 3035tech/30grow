import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { query } from '../../../../../lib/db.js';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../lib/permissions.js';
import { updateProductFeedback } from '../../../../../lib/product-feedback.js';
import { PRODUCT_FEEDBACK_SEVERITIES, PRODUCT_FEEDBACK_STATUSES } from '../../../../../lib/domain-status.js';
import { COMPANY_MODULES } from '../../../../../lib/company-modules.js';
import { audit, auditRequestContext } from '../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';

const patchBodySchema = z
  .object({
    status: z.enum(/** @type {[string, ...string[]]} */ (PRODUCT_FEEDBACK_STATUSES)).optional(),
    adminNotes: z.string().max(4000).optional(),
    severity: z.enum(/** @type {[string, ...string[]]} */ (PRODUCT_FEEDBACK_SEVERITIES)).optional(),
    moduleKey: z.enum(/** @type {[string, ...string[]]} */ (COMPANY_MODULES)).nullable().optional(),
    assigneeUserId: zPositiveInt.nullable().optional(),
    duplicateOfId: zPositiveInt.nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'empty_patch',
  });

/**
 * PATCH /api/admin/product-feedback/[id] — super-admin triage (status, notes, impact, module, owner, duplicate).
 */
export const PATCH = withAdminApi(
  {
    cap: CAP.USERS_MANAGE,
    requireCompany: false,
    companyFrom: 'none',
    body: patchBodySchema,
    logLabel: 'product-feedback-patch',
  },
  async ({ request, payload, body, params }) => {
    if (!isSuperAdminPayload(payload) || !requireCapability(payload, CAP.USERS_MANAGE)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const idParsed = zPositiveInt.safeParse(params?.id);
    if (!idParsed.success) {
      return apiError(request, ERR.INVALID_ID, 400);
    }
    const result = await updateProductFeedback({ query }, { id: idParsed.data, ...body });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      action: 'product_feedback_triage',
      actorUserId: payload.userId,
      targetType: 'product_feedback',
      targetId: idParsed.data,
      metadata: {
        fields: Object.keys(body).filter((k) => body[k] !== undefined && k !== 'adminNotes'),
        notesChanged: body.adminNotes !== undefined,
      },
      ...auditRequestContext(request),
    });
    return NextResponse.json({ ok: true, item: result.item });
  }
);
