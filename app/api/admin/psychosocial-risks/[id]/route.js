import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/permissions.js';
import { query } from '../../../../../lib/db.js';
import { audit, auditRequestContext } from '../../../../../lib/audit.js';
import { PSYCHOSOCIAL_FACTORS, PSYCHOSOCIAL_RISK_STATUSES } from '../../../../../lib/domain-status.js';
import {
  PSYCHOSOCIAL_GROUP_MAX,
  PSYCHOSOCIAL_HAZARD_MAX,
  PSYCHOSOCIAL_MEASURES_MAX,
  softDeletePsychosocialRisk,
  updatePsychosocialRisk,
} from '../../../../../lib/people/psychosocial-risks.js';

const patchSchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
  factor: z.enum(PSYCHOSOCIAL_FACTORS).optional(),
  hazard: z.string().trim().min(1).max(PSYCHOSOCIAL_HAZARD_MAX).optional(),
  exposedGroup: z.string().trim().max(PSYCHOSOCIAL_GROUP_MAX).optional(),
  probability: z.coerce.number().int().min(1).max(3).optional(),
  severity: z.coerce.number().int().min(1).max(3).optional(),
  measures: z.string().max(PSYCHOSOCIAL_MEASURES_MAX).optional(),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  status: z.enum(PSYCHOSOCIAL_RISK_STATUSES).optional(),
  surveyId: z.coerce.number().int().positive().nullable().optional(),
});

const deleteQuerySchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
});

function riskIdFrom(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * PATCH /api/admin/psychosocial-risks/[id] — B-2714 update inventory item.
 * Depth: app/api/admin/psychosocial-risks/[id] → 5× ../ até lib/
 */
export const PATCH = withAdminApi(
  { cap: CAP.CLIMATE_VIEW, body: patchSchema, companyFrom: 'body', logLabel: 'psychosocial-risks PATCH' },
  async ({ request, payload, companyId, body, params }) => {
    const riskId = riskIdFrom(params);
    if (!riskId) return apiError(request, ERR.INVALID_PARAMS, 400);
    const out = await updatePsychosocialRisk(query, { companyId, riskId, input: body });
    if (!out.ok) return apiErrorFromResult(request, out);
    await audit({
      actorUserId: payload.userId ?? null,
      companyId,
      action: 'psychosocial.risk_update',
      targetType: 'psychosocial_risk',
      targetId: riskId,
      metadata: {
        fields: Object.keys(body).filter((k) => k !== 'companyId'),
        status: out.risk.status,
        previousStatus: out.previousStatus,
        riskScore: out.risk.riskScore,
      },
      ...auditRequestContext(request),
    });
    return NextResponse.json({ ok: true, risk: out.risk });
  }
);

/** DELETE /api/admin/psychosocial-risks/[id] — soft delete. */
export const DELETE = withAdminApi(
  { cap: CAP.CLIMATE_VIEW, query: deleteQuerySchema, companyFrom: 'query', logLabel: 'psychosocial-risks DELETE' },
  async ({ request, payload, companyId, params }) => {
    const riskId = riskIdFrom(params);
    if (!riskId) return apiError(request, ERR.INVALID_PARAMS, 400);
    const out = await softDeletePsychosocialRisk(query, { companyId, riskId });
    if (!out.ok) return apiErrorFromResult(request, out);
    await audit({
      actorUserId: payload.userId ?? null,
      companyId,
      action: 'psychosocial.risk_delete',
      targetType: 'psychosocial_risk',
      targetId: riskId,
      ...auditRequestContext(request),
    });
    return NextResponse.json({ ok: true });
  }
);
