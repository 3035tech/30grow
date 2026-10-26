/**
 * GET  /api/admin/okr/activities/[id]/checkins — list check-ins
 * POST /api/admin/okr/activities/[id]/checkins — manager check-in (+ update %)
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { audit } from '../../../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import {
  createOkrActivityCheckin,
  listOkrActivityCheckins,
} from '../../../../../../../lib/development/okr-cycles.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  progressPct: z.coerce.number().int().min(0).max(100),
  note: z.string().trim().max(500).optional().nullable(),
});

export const GET = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'okr checkins GET',
  },
  async ({ request, companyId, query, params }) => {
    const activityId = Number(params?.id);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await listOkrActivityCheckins(null, {
      companyId,
      activityId,
      limit: query.limit,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'okr checkins POST',
  },
  async ({ request, companyId, body, payload, params }) => {
    const activityId = Number(params?.id);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await createOkrActivityCheckin(null, {
      companyId,
      activityId,
      progressPct: body.progressPct,
      note: body.note,
      createdByUserId: payload.userId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.activity_checkin',
      companyId,
      targetType: 'okr_activity',
      targetId: activityId,
      metadata: { progressPct: result.activity.progressPct },
    });
    return NextResponse.json(result, { status: 201 });
  }
);
