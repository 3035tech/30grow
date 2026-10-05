/**
 * GET   /api/admin/time-clock/closures — list period closures
 * POST  /api/admin/time-clock/closures — close a past period (locks adjustments)
 * PATCH /api/admin/time-clock/closures — cancel a concluded closure
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { CAP } from '../../../../../lib/permissions.js';
import { TIME_CLOCK_CLOSURE_STATUSES } from '../../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  cancelTimeClockClosure,
  createTimeClockClosure,
  listTimeClockClosures,
} from '../../../../../lib/people/time-clock-manager.js';
import { notifyClosureMirrorsReady } from '../../../../../lib/people/time-clock-closure-people.js';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  status: z.enum(/** @type {[string, ...string[]]} */ (TIME_CLOCK_CLOSURE_STATUSES)).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(5).max(50).optional(),
});

const createSchema = z.object({
  companyId: zPositiveInt.optional(),
  periodStart: isoDay,
  periodEnd: isoDay,
  orgUnitId: zPositiveInt.optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

const cancelSchema = z.object({
  companyId: zPositiveInt.optional(),
  closureId: zPositiveInt,
  reason: z.string().min(3).max(500),
});

const ACCESS = { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], requireCompany: true };

export const GET = withAdminApi(
  { ...ACCESS, companyFrom: 'query', query: querySchema, logLabel: 'time-clock-closures' },
  async ({ request, companyId, query }) => {
    const result = await listTimeClockClosures(null, {
      companyId,
      status: query.status || null,
      q: query.q || '',
      page: query.page,
      pageSize: query.pageSize,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
    }
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  { ...ACCESS, companyFrom: 'body', body: createSchema, logLabel: 'time-clock-closure-create' },
  async ({ request, companyId, body, payload }) => {
    const result = await createTimeClockClosure({
      companyId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      orgUnitId: body.orgUnitId || null,
      note: body.note || '',
      userId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.closure_create',
      companyId,
      targetType: 'time_clock_closure',
      targetId: result.id,
      metadata: {
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        orgUnitId: result.orgUnitId,
      },
    });
    const { summaryCandidateIds, ...out } = result;
    try {
      await notifyClosureMirrorsReady(null, {
        companyId,
        closureId: result.id,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        candidateIds: summaryCandidateIds,
      });
    } catch (e) {
      console.error('[time-clock] mirror notif', e?.message || e);
    }
    return NextResponse.json(out);
  }
);

export const PATCH = withAdminApi(
  { ...ACCESS, companyFrom: 'body', body: cancelSchema, logLabel: 'time-clock-closure-cancel' },
  async ({ request, companyId, body, payload }) => {
    const result = await cancelTimeClockClosure({
      companyId,
      closureId: body.closureId,
      reason: body.reason,
      userId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.closure_cancel',
      companyId,
      targetType: 'time_clock_closure',
      targetId: result.id,
      metadata: { periodStart: result.periodStart, periodEnd: result.periodEnd },
    });
    return NextResponse.json(result);
  }
);
