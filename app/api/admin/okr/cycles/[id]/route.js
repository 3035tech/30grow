/**
 * PATCH  /api/admin/okr/cycles/[id] — update cycle
 * DELETE /api/admin/okr/cycles/[id] — delete cycle (cascade areas/activities)
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { OKR_CYCLE_STATUSES } from '../../../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { deleteOkrCycle, updateOkrCycle } from '../../../../../../lib/development/okr-cycles.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  startsOn: z.string().min(8).max(10).optional(),
  endsOn: z.string().min(8).max(10).optional(),
  status: z.enum(/** @type {[string, ...string[]]} */ (OKR_CYCLE_STATUSES)).optional(),
});

export const PATCH = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'okr cycles PATCH',
  },
  async ({ request, companyId, body, payload, params }) => {
    const cycleId = Number(params?.id);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await updateOkrCycle(null, {
      companyId,
      cycleId,
      title: body.title,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      status: body.status,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.cycle_update',
      companyId,
      targetType: 'okr_cycle',
      targetId: cycleId,
      metadata: {},
    });
    return NextResponse.json(result);
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    companyFrom: 'query',
    query: z.object({ companyId: zPositiveInt.optional() }),
    logLabel: 'okr cycles DELETE',
  },
  async ({ request, companyId, payload, params }) => {
    const cycleId = Number(params?.id);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await deleteOkrCycle(null, { companyId, cycleId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.cycle_delete',
      companyId,
      targetType: 'okr_cycle',
      targetId: cycleId,
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  }
);
