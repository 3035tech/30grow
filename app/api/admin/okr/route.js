/**
 * GET  /api/admin/okr — list light OKR tree
 * POST /api/admin/okr — create objective
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { audit } from '../../../../lib/audit.js';
import { OKR_OBJECTIVE_LEVELS } from '../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { createOkrObjective, listOkrTree } from '../../../../lib/development/okr.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).optional(),
  level: z.enum(/** @type {[string, ...string[]]} */ (OKR_OBJECTIVE_LEVELS)).optional(),
  parentId: zPositiveInt.optional().nullable(),
  teamGroupId: zPositiveInt.optional().nullable(),
  candidateId: zPositiveInt.optional().nullable(),
  periodStart: z.string().optional().nullable(),
  periodEnd: z.string().optional().nullable(),
});

/** GET OKR tree */
export const GET = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'okr GET',
  },
  async ({ request, companyId, query }) => {
    const result = await listOkrTree(null, { companyId, limit: query.limit });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
    }
    return NextResponse.json(result);
  }
);

/** POST create objective */
export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'okr POST',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await createOkrObjective(null, {
      companyId,
      title: body.title,
      description: body.description,
      level: body.level,
      parentId: body.parentId,
      teamGroupId: body.teamGroupId,
      candidateId: body.candidateId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      createdByUserId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.objective_create',
      companyId,
      targetType: 'okr_objective',
      targetId: result.objective.id,
      metadata: { title: result.objective.title, level: result.objective.level },
    });
    return NextResponse.json(result);
  }
);
