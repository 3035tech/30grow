/**
 * GET  /api/admin/okr/cycles — list OKR cycles (areas + activities + rollup)
 * POST /api/admin/okr/cycles — create cycle
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { OKR_CYCLE_STATUSES } from '../../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { createOkrCycle, listOkrCycles } from '../../../../../lib/development/okr-cycles.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(200),
  startsOn: z.string().min(8).max(10),
  endsOn: z.string().min(8).max(10),
  status: z.enum(/** @type {[string, ...string[]]} */ (OKR_CYCLE_STATUSES)).optional(),
});

export const GET = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'okr cycles GET',
  },
  async ({ request, companyId, query }) => {
    const result = await listOkrCycles(null, { companyId, limit: query.limit });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
    }
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'okr cycles POST',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await createOkrCycle(null, {
      companyId,
      title: body.title,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      status: body.status,
      createdByUserId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.cycle_create',
      companyId,
      targetType: 'okr_cycle',
      targetId: result.cycle.id,
      metadata: { title: result.cycle.title },
    });
    return NextResponse.json(result);
  }
);
