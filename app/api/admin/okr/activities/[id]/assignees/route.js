/**
 * POST   /api/admin/okr/activities/[id]/assignees — link collaborator
 * DELETE /api/admin/okr/activities/[id]/assignees?candidateId= — unlink
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { audit } from '../../../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import {
  addOkrActivityAssignee,
  removeOkrActivityAssignee,
} from '../../../../../../../lib/development/okr-cycles.js';

const postBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  candidateId: zPositiveInt,
});

const deleteQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  candidateId: zPositiveInt,
});

export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: postBodySchema,
    companyFrom: 'body',
    logLabel: 'okr assignees POST',
  },
  async ({ request, companyId, body, payload, params }) => {
    const activityId = Number(params?.id);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await addOkrActivityAssignee(null, {
      companyId,
      activityId,
      candidateId: body.candidateId,
      assignedByUserId: payload.userId || null,
      notify: true,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    if (result.inserted) {
      await audit({
        actorUserId: payload.userId || null,
        action: 'okr.activity_assignee_add',
        companyId,
        targetType: 'okr_activity',
        targetId: activityId,
        metadata: { candidateId: body.candidateId },
      });
    }
    return NextResponse.json(result);
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    companyFrom: 'query',
    query: deleteQuerySchema,
    logLabel: 'okr assignees DELETE',
  },
  async ({ request, companyId, query, payload, params }) => {
    const activityId = Number(params?.id);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await removeOkrActivityAssignee(null, {
      companyId,
      activityId,
      candidateId: query.candidateId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.activity_assignee_remove',
      companyId,
      targetType: 'okr_activity',
      targetId: activityId,
      metadata: { candidateId: query.candidateId },
    });
    return NextResponse.json({ ok: true });
  }
);
