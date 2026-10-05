/**
 * GET  /api/admin/time-clock/holidays — holidays of a year (paginated, yearly ones included)
 * POST /api/admin/time-clock/holidays — create | import national holidays of a year
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { CAP } from '../../../../../lib/permissions.js';
import { HOLIDAY_RECURRENCES } from '../../../../../lib/domain-status.js';
import {
  importNationalHolidays,
  listHolidays,
  saveHoliday,
} from '../../../../../lib/people/time-clock-calendar.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';

const zYear = z.coerce.number().int().min(2000).max(2100);

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  year: zYear.optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(5).max(50).optional(),
});

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  action: z.enum(['create', 'import']).optional(),
  year: zYear.optional(),
  name: z.string().max(120).optional(),
  day: z.string().max(16).optional(),
  recurrence: z.enum(/** @type {[string, ...string[]]} */ (HOLIDAY_RECURRENCES)).optional(),
  orgUnitId: zPositiveInt.optional().nullable(),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'time-clock-holidays',
  },
  async ({ request, companyId, query }) => {
    const result = await listHolidays(null, {
      companyId,
      year: query.year ?? new Date().getFullYear(),
      q: query.q || '',
      page: query.page,
      pageSize: query.pageSize,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: bodySchema,
    logLabel: 'time-clock-holidays-write',
  },
  async ({ request, companyId, body, payload }) => {
    const userId = payload.userId || null;
    if (body.action === 'import') {
      const result = await importNationalHolidays(null, {
        companyId,
        year: body.year ?? new Date().getFullYear(),
        userId,
      });
      if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
      await audit({
        actorUserId: userId,
        action: 'time_clock.holidays_import',
        companyId,
        targetType: 'company',
        targetId: companyId,
        metadata: { year: result.year, inserted: result.inserted, closed: result.closed },
      });
      return NextResponse.json(result);
    }

    const result = await saveHoliday(null, {
      companyId,
      userId,
      name: body.name,
      day: body.day,
      recurrence: body.recurrence,
      orgUnitId: body.orgUnitId ?? null,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    await audit({
      actorUserId: userId,
      action: 'time_clock.holiday_create',
      companyId,
      targetType: 'company_holiday',
      targetId: result.id,
      metadata: { day: result.day, recurrence: result.recurrence, orgUnitId: result.orgUnitId },
    });
    return NextResponse.json(result);
  }
);
