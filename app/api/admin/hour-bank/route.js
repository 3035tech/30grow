/**
 * GET   /api/admin/hour-bank — balances | entries | export CSV
 * POST  /api/admin/hour-bank — manual entry | settings
 * PATCH /api/admin/hour-bank — approve/reject pending entry
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { audit } from '../../../../lib/audit.js';
import { CAP } from '../../../../lib/permissions.js';
import {
  HOUR_BANK_ENTRY_KINDS,
  HOUR_BANK_STATUSES,
} from '../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import {
  createHourBankManualEntry,
  decideHourBankEntry,
  exportHourBankCsv,
  listHourBankBalances,
  listHourBankEntries,
} from '../../../../lib/people/hour-bank.js';
import { upsertCompanyTimeSchedule } from '../../../../lib/people/time-clock.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  mode: z.enum(['balances', 'entries', 'export']).optional(),
  status: z.string().max(32).optional(),
  candidateId: zPositiveInt.optional(),
  month: z.string().max(8).optional(),
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
  offset: z.coerce.number().int().min(0).max(100000).optional(),
});

const postBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  action: z.enum(['manual', 'settings']),
  candidateId: zPositiveInt.optional(),
  entryKind: z.enum(/** @type {[string, ...string[]]} */ (HOUR_BANK_ENTRY_KINDS)).optional(),
  minutes: z.coerce.number().int().min(1).max(1440).optional(),
  workOn: z.string().max(16).optional(),
  note: z.string().max(500).optional().nullable(),
  hourBankEnabled: z.boolean().optional(),
  hourBankMaxMinutes: z.coerce.number().int().min(0).max(20000).optional(),
  workdayStart: z.string().max(8).optional(),
  workdayEnd: z.string().max(8).optional(),
  breakMinutes: z.coerce.number().int().min(0).max(240).optional(),
  timezone: z.string().max(64).optional(),
  lateGraceMinutes: z.coerce.number().int().min(0).max(120).optional(),
});

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  entryId: zPositiveInt,
  status: z.enum(['approved', 'rejected']),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: listQuerySchema,
    logLabel: 'hour-bank-list',
  },
  async ({ request, companyId, query }) => {
    const mode = String(query.mode || 'balances');
    if (mode === 'export') {
      const result = await exportHourBankCsv(null, {
        companyId,
        month: query.month || null,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATE });
      }
      return new NextResponse(result.csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="hour-bank-${result.month}.csv"`,
        },
      });
    }
    if (mode === 'entries') {
      const result = await listHourBankEntries(null, {
        companyId,
        candidateId: query.candidateId || null,
        status: query.status && HOUR_BANK_STATUSES.includes(query.status) ? query.status : null,
        month: query.month || null,
        limit: query.limit,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
      }
      return NextResponse.json(result);
    }
    const result = await listHourBankBalances(null, {
      companyId,
      q: query.q || '',
      limit: query.limit,
      offset: query.offset,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
    }
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: postBodySchema,
    logLabel: 'hour-bank-post',
  },
  async ({ request, companyId, body, payload }) => {
    if (body.action === 'settings') {
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
        action: 'hour_bank.settings',
        companyId,
        targetType: 'company',
        targetId: companyId,
        metadata: {
          hourBankEnabled: result.schedule.hourBankEnabled,
          hourBankMaxMinutes: result.schedule.hourBankMaxMinutes,
        },
      });
      return NextResponse.json(result);
    }

    if (!body.candidateId || !body.entryKind || !body.minutes || !body.workOn) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_DATA });
    }
    const result = await createHourBankManualEntry(null, {
      companyId,
      candidateId: body.candidateId,
      entryKind: body.entryKind,
      minutes: body.minutes,
      workOn: body.workOn,
      note: body.note || '',
      createdByUserId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'hour_bank.manual',
      companyId,
      targetType: 'hour_bank_entry',
      targetId: result.entry.id,
      metadata: {
        candidateId: body.candidateId,
        entryKind: body.entryKind,
        minutes: body.minutes,
      },
    });
    return NextResponse.json(result);
  }
);

export const PATCH = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: patchBodySchema,
    logLabel: 'hour-bank-decide',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await decideHourBankEntry(null, {
      companyId,
      entryId: body.entryId,
      status: body.status,
      decidedByUserId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'hour_bank.decide',
      companyId,
      targetType: 'hour_bank_entry',
      targetId: result.entry.id,
      metadata: { status: result.entry.status },
    });
    return NextResponse.json(result);
  }
);
