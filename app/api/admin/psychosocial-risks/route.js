import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiErrorFromResult } from '../../../../lib/api-error.js';
import { CAP } from '../../../../lib/permissions.js';
import { query } from '../../../../lib/db.js';
import { audit, auditRequestContext } from '../../../../lib/audit.js';
import { PSYCHOSOCIAL_FACTORS, PSYCHOSOCIAL_RISK_STATUSES } from '../../../../lib/domain-status.js';
import { listActiveCompanyUsers } from '../../../../lib/recruiting-workspace.js';
import {
  PSYCHOSOCIAL_GROUP_MAX,
  PSYCHOSOCIAL_HAZARD_MAX,
  PSYCHOSOCIAL_MEASURES_MAX,
  createPsychosocialRisk,
  getPsychosocialOverview,
} from '../../../../lib/people/psychosocial-risks.js';

const querySchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
  surveyId: z.coerce.number().int().positive().optional(),
  export: z.enum(['1']).optional(),
});

const riskBodySchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
  factor: z.enum(PSYCHOSOCIAL_FACTORS),
  hazard: z.string().trim().min(1).max(PSYCHOSOCIAL_HAZARD_MAX),
  exposedGroup: z.string().trim().max(PSYCHOSOCIAL_GROUP_MAX).optional(),
  probability: z.coerce.number().int().min(1).max(3).optional(),
  severity: z.coerce.number().int().min(1).max(3).optional(),
  measures: z.string().max(PSYCHOSOCIAL_MEASURES_MAX).optional(),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  status: z.enum(PSYCHOSOCIAL_RISK_STATUSES).optional(),
  surveyId: z.coerce.number().int().positive().nullable().optional(),
});

/**
 * GET /api/admin/psychosocial-risks — B-2714 inventory + questionnaire summary (+ owner options).
 * `export=1` = printable report (audited).
 * Depth: app/api/admin/psychosocial-risks → 4× ../ até lib/
 */
export const GET = withAdminApi(
  { cap: CAP.CLIMATE_VIEW, query: querySchema, companyFrom: 'query', logLabel: 'psychosocial-risks GET' },
  async ({ request, payload, companyId, query: q }) => {
    const [overview, owners] = await Promise.all([
      getPsychosocialOverview(query, { companyId, surveyId: q.surveyId ?? null }),
      q.export ? Promise.resolve({ rows: [] }) : listActiveCompanyUsers(companyId),
    ]);
    if (q.export) {
      await audit({
        actorUserId: payload.userId ?? null,
        companyId,
        action: 'psychosocial.report_export',
        targetType: 'company',
        targetId: companyId,
        metadata: { riskCount: overview.risks.length, surveyId: overview.summary.survey?.id ?? null },
        ...auditRequestContext(request),
      });
    }
    return NextResponse.json({
      ok: true,
      ...overview,
      owners: owners.rows.map((u) => ({ id: Number(u.id), name: u.name })),
    });
  }
);

/** POST /api/admin/psychosocial-risks — create inventory item. */
export const POST = withAdminApi(
  { cap: CAP.CLIMATE_VIEW, body: riskBodySchema, companyFrom: 'body', logLabel: 'psychosocial-risks POST' },
  async ({ request, payload, companyId, body }) => {
    const out = await createPsychosocialRisk(query, {
      companyId,
      input: body,
      createdByUserId: payload.userId ?? null,
    });
    if (!out.ok) return apiErrorFromResult(request, out);
    await audit({
      actorUserId: payload.userId ?? null,
      companyId,
      action: 'psychosocial.risk_create',
      targetType: 'psychosocial_risk',
      targetId: out.risk.id,
      metadata: { factor: out.risk.factor, riskScore: out.risk.riskScore, status: out.risk.status },
      ...auditRequestContext(request),
    });
    return NextResponse.json({ ok: true, risk: out.risk }, { status: 201 });
  }
);
