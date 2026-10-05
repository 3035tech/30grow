/**
 * GET    /api/admin/time-clock/people/[candidateId]/schedule — schedule history + company default
 * POST   /api/admin/time-clock/people/[candidateId]/schedule — new schedule from a date
 * DELETE /api/admin/time-clock/people/[candidateId]/schedule?id= — remove one version
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { audit } from '../../../../../../../lib/audit.js';
import { CAP } from '../../../../../../../lib/permissions.js';
import {
  deleteEmployeeSchedule,
  listEmployeeScheduleHistory,
  saveEmployeeSchedule,
} from '../../../../../../../lib/people/time-clock-calendar.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';

const zHm = z.string().max(5);

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  validFrom: z.string().max(16),
  followsCompany: z.boolean().optional(),
  workdayStart: zHm.optional().nullable(),
  workdayEnd: zHm.optional().nullable(),
  breakStart: zHm.optional().nullable(),
  breakEnd: zHm.optional().nullable(),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional().nullable(),
});

const deleteQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  id: zPositiveInt,
});

function candidateFrom(params) {
  const parsed = zPositiveInt.safeParse(params?.candidateId);
  return parsed.success ? parsed.data : null;
}

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'time-clock-schedule',
  },
  async ({ request, companyId, params }) => {
    const candidateId = candidateFrom(params);
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);
    const result = await listEmployeeScheduleHistory(null, { companyId, candidateId });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: bodySchema,
    logLabel: 'time-clock-schedule-save',
  },
  async ({ request, companyId, body, params, payload }) => {
    const candidateId = candidateFrom(params);
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);
    const result = await saveEmployeeSchedule(null, {
      companyId,
      candidateId,
      validFrom: body.validFrom,
      userId: payload.userId || null,
      followsCompany: Boolean(body.followsCompany),
      workdayStart: body.workdayStart,
      workdayEnd: body.workdayEnd,
      breakStart: body.breakStart,
      breakEnd: body.breakEnd,
      weekdays: body.weekdays,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.schedule_save',
      companyId,
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { validFrom: result.item.validFrom, followsCompany: result.item.followsCompany },
    });
    return NextResponse.json(result);
  }
);

export const DELETE = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: deleteQuerySchema,
    logLabel: 'time-clock-schedule-delete',
  },
  async ({ request, companyId, params, query, payload }) => {
    const candidateId = candidateFrom(params);
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);
    const result = await deleteEmployeeSchedule(null, { companyId, candidateId, id: query.id });
    if (!result.ok) return apiErrorFromResult(request, result);
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.schedule_delete',
      companyId,
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { scheduleId: result.id },
    });
    return NextResponse.json(result);
  }
);
