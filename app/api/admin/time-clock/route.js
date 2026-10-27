/**
 * GET   /api/admin/time-clock — day mirror / flagged punches
 * PATCH /api/admin/time-clock — review a punch OR upsert schedule (action)
 * POST  /api/admin/time-clock — manager adjust punch
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { audit } from '../../../../lib/audit.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import {
  TIME_PUNCH_KINDS,
  TIME_PUNCH_SOURCE,
} from '../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import {
  createTimePunch,
  exportTimePunchesCsv,
  listCompanyTimePunches,
  reviewTimePunch,
  upsertCompanyTimeSchedule,
} from '../../../../lib/people/time-clock.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  day: z.string().max(16).optional(),
  reviewStatus: z.string().max(32).optional(),
  q: z.string().max(80).optional(),
  mode: z.string().max(16).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const reviewBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  action: z.enum(['review', 'schedule']),
  punchId: zPositiveInt.optional(),
  reviewStatus: z.enum(['ok', 'flagged', 'adjusted']).optional(),
  workdayStart: z.string().max(8).optional(),
  workdayEnd: z.string().max(8).optional(),
  breakMinutes: z.coerce.number().int().min(0).max(240).optional(),
  timezone: z.string().max(64).optional(),
  lateGraceMinutes: z.coerce.number().int().min(0).max(120).optional(),
  hourBankEnabled: z.boolean().optional(),
  hourBankMaxMinutes: z.coerce.number().int().min(0).max(20000).optional(),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  candidateId: zPositiveInt,
  punchKind: z.enum(/** @type {[string, ...string[]]} */ (TIME_PUNCH_KINDS)),
  punchedAt: z.string().max(40).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: listQuerySchema,
    logLabel: 'time-clock-list',
  },
  async ({ request, companyId, query }) => {
    if (String(query.mode || '') === 'export') {
      const result = await exportTimePunchesCsv(null, {
        companyId,
        day: query.day || null,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
      }
      return new NextResponse(result.csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="time-clock-${result.day}.csv"`,
        },
      });
    }
    const result = await listCompanyTimePunches(null, {
      companyId,
      day: query.day || null,
      reviewStatus: query.reviewStatus || null,
      q: query.q || '',
      limit: query.limit,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
    }
    return NextResponse.json(result);
  }
);

export const PATCH = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: reviewBodySchema,
    logLabel: 'time-clock-patch',
  },
  async ({ request, companyId, body, payload }) => {
    if (body.action === 'schedule') {
      const result = await upsertCompanyTimeSchedule(null, {
        companyId,
        workdayStart: body.workdayStart,
        workdayEnd: body.workdayEnd,
        breakMinutes: body.breakMinutes,
        timezone: body.timezone,
        lateGraceMinutes: body.lateGraceMinutes,
        hourBankEnabled: body.hourBankEnabled,
        hourBankMaxMinutes: body.hourBankMaxMinutes,
        updatedByUserId: payload.userId || null,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
      }
      await audit({
        actorUserId: payload.userId || null,
        action: 'time_clock.schedule_upsert',
        companyId,
        targetType: 'company',
        targetId: companyId,
        metadata: { workdayStart: result.schedule.workdayStart, workdayEnd: result.schedule.workdayEnd },
      });
      return NextResponse.json(result);
    }

    if (!body.punchId || !body.reviewStatus) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_DATA });
    }
    const result = await reviewTimePunch(null, {
      companyId,
      punchId: body.punchId,
      reviewStatus: body.reviewStatus,
      reviewedByUserId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.review',
      companyId,
      targetType: 'time_punch',
      targetId: result.punch.id,
      metadata: { reviewStatus: result.punch.reviewStatus },
    });
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: createBodySchema,
    logLabel: 'time-clock-manager-punch',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await createTimePunch(null, {
      companyId,
      candidateId: body.candidateId,
      punchKind: body.punchKind,
      source: TIME_PUNCH_SOURCE.MANAGER,
      punchedAt: body.punchedAt || null,
      notes: body.notes || '',
      createdByUserId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.manager_punch',
      companyId,
      targetType: 'time_punch',
      targetId: result.punch.id,
      metadata: { candidateId: body.candidateId, punchKind: body.punchKind },
    });
    return NextResponse.json(result);
  }
);
