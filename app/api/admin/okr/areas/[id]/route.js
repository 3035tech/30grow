/**
 * PATCH  /api/admin/okr/areas/[id] — rename area
 * DELETE /api/admin/okr/areas/[id]
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { deleteOkrArea, updateOkrArea } from '../../../../../../lib/development/okr-cycles.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(200),
});

function parseAreaId(params) {
  const areaId = Number(params?.id);
  return Number.isFinite(areaId) && areaId > 0 ? areaId : null;
}

export const PATCH = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'okr areas PATCH',
  },
  async ({ request, companyId, body, payload, params }) => {
    const areaId = parseAreaId(params);
    if (!areaId) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await updateOkrArea(null, { companyId, areaId, title: body.title });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.area_update',
      companyId,
      targetType: 'okr_area',
      targetId: areaId,
      metadata: { title: result.area.title },
    });
    return NextResponse.json(result);
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    companyFrom: 'query',
    query: z.object({ companyId: zPositiveInt.optional() }),
    logLabel: 'okr areas DELETE',
  },
  async ({ request, companyId, payload, params }) => {
    const areaId = parseAreaId(params);
    if (!areaId) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await deleteOkrArea(null, { companyId, areaId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.area_delete',
      companyId,
      targetType: 'okr_area',
      targetId: areaId,
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  }
);
