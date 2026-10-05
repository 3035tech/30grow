/**
 * PATCH  /api/admin/time-clock/holidays/[id] — edit name / date / recurrence / unit
 * DELETE /api/admin/time-clock/holidays/[id]
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { CAP } from '../../../../../../lib/permissions.js';
import { HOLIDAY_RECURRENCES } from '../../../../../../lib/domain-status.js';
import { deleteHoliday, saveHoliday } from '../../../../../../lib/people/time-clock-calendar.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().max(120),
  day: z.string().max(16),
  recurrence: z.enum(/** @type {[string, ...string[]]} */ (HOLIDAY_RECURRENCES)),
  orgUnitId: zPositiveInt.optional().nullable(),
});

export const PATCH = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: bodySchema,
    logLabel: 'time-clock-holiday-edit',
  },
  async ({ request, companyId, body, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const result = await saveHoliday(null, {
      companyId,
      id: parsed.data,
      userId: payload.userId || null,
      name: body.name,
      day: body.day,
      recurrence: body.recurrence,
      orgUnitId: body.orgUnitId ?? null,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.holiday_update',
      companyId,
      targetType: 'company_holiday',
      targetId: result.id,
      metadata: { day: result.day, recurrence: result.recurrence, orgUnitId: result.orgUnitId },
    });
    return NextResponse.json(result);
  }
);

export const DELETE = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'time-clock-holiday-delete',
  },
  async ({ request, companyId, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    const result = await deleteHoliday(null, { companyId, id: parsed.data });
    if (!result.ok) return apiErrorFromResult(request, result);
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.holiday_delete',
      companyId,
      targetType: 'company_holiday',
      targetId: result.id,
      metadata: { day: result.day },
    });
    return NextResponse.json(result);
  }
);
