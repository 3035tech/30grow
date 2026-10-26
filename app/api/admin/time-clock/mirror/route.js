/**
 * GET  /api/admin/time-clock/mirror — per-person mirror for a period
 * POST /api/admin/time-clock/mirror — day actions: adjust | justify | unjustify
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import {
  TIME_DAY_JUSTIFICATIONS,
  TIME_PUNCH_KINDS,
} from '../../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  TIME_ADJUST_MAX_ADD,
  TIME_ADJUST_MAX_VOID,
  adjustTimeDay,
  deleteTimeDayJustification,
  getEmployeeTimeMirror,
  upsertTimeDayJustification,
} from '../../../../../lib/people/time-clock-manager.js';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  candidateId: zPositiveInt,
  from: isoDay.optional(),
  to: isoDay.optional(),
});

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  action: z.enum(['adjust', 'justify', 'unjustify']),
  candidateId: zPositiveInt,
  day: isoDay,
  voidPunchIds: z.array(zPositiveInt).max(TIME_ADJUST_MAX_VOID).optional(),
  add: z
    .array(
      z.object({
        time: z.string().regex(/^\d{1,2}:\d{2}$/),
        kind: z.enum(/** @type {[string, ...string[]]} */ (TIME_PUNCH_KINDS)),
      })
    )
    .max(TIME_ADJUST_MAX_ADD)
    .optional(),
  reason: z.string().max(500).optional(),
  justification: z.enum(/** @type {[string, ...string[]]} */ (TIME_DAY_JUSTIFICATIONS)).optional(),
  note: z.string().max(500).optional().nullable(),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'time-clock-mirror',
  },
  async ({ request, companyId, query }) => {
    const result = await getEmployeeTimeMirror(null, {
      companyId,
      candidateId: query.candidateId, includeFormer:true,
      from: query.from || null,
      to: query.to || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: bodySchema,
    logLabel: 'time-clock-mirror-action',
  },
  async ({ request, companyId, body, payload }) => {
    const userId = payload.userId || null;
    let result;
    if (body.action === 'adjust') {
      result = await adjustTimeDay({
        companyId,
        candidateId: body.candidateId,
        day: body.day,
        voidPunchIds: body.voidPunchIds || [],
        add: body.add || [],
        reason: body.reason || '',
        userId,
      });
    } else if (body.action === 'justify') {
      if (!body.justification) {
        return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_DATA });
      }
      result = await upsertTimeDayJustification({
        companyId,
        candidateId: body.candidateId,
        day: body.day,
        reason: body.justification,
        note: body.note || '',
        userId,
      });
    } else {
      result = await deleteTimeDayJustification({
        companyId,
        candidateId: body.candidateId,
        day: body.day,
      });
    }
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: userId,
      action: `time_clock.day_${body.action}`,
      companyId,
      targetType: 'candidate',
      targetId: body.candidateId,
      metadata: {
        day: body.day,
        ...(body.action === 'adjust'
          ? { voided: result.voided, inserted: result.insertedIds?.length || 0 }
          : {}),
        ...(body.action === 'justify' ? { justification: body.justification } : {}),
      },
    });
    return NextResponse.json(result);
  }
);
