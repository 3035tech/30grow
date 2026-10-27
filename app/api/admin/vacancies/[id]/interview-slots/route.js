import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import {
  apiError,
  apiErrorFromResult,
  ERR,
  httpStatusForError,
} from '../../../../../../lib/api-error.js';
import { createInterviewSlot, listInterviewSlots } from '../../../../../../lib/recruiting/interview-slots.js';
import { audit } from '../../../../../../lib/audit.js';

const listQuerySchema = z.object({
  weekStart: z.string().optional(),
  weekEnd: z.string().optional(),
});

const createBodySchema = z.object({
  candidateId: z.union([z.number(), z.string()]),
  startsAt: z.string().min(1),
  endsAt: z.string().optional().nullable(),
  meetUrl: z.string().min(1),
  notes: z.string().optional().nullable(),
});

/** GET /api/admin/vacancies/[id]/interview-slots */
export const GET = withAdminApi(
  {
    cap: CAP.VACANCIES_VIEW,
    query: listQuerySchema,
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'interview-slots list',
  },
  async ({ request, scope, params, query }) => {
    const vacancyId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(vacancyId)) {
      return apiError(request, ERR.INVALID_VACANCY, httpStatusForError(ERR.INVALID_VACANCY));
    }
    const result = await listInterviewSlots({
      vacancyId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
      weekStart: query.weekStart,
      weekEnd: query.weekEnd,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json({ items: result.items, truncated: result.truncated });
  }
);

/** POST /api/admin/vacancies/[id]/interview-slots */
export const POST = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    body: createBodySchema,
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'interview-slots create',
  },
  async ({ request, payload, scope, params, body }) => {
    const vacancyId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(vacancyId)) {
      return apiError(request, ERR.INVALID_VACANCY, httpStatusForError(ERR.INVALID_VACANCY));
    }

    const result = await createInterviewSlot({
      vacancyId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
      body,
      actorUserId: payload.userId,
      request,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'interview_slot.create',
      targetType: 'interview_slot',
      targetId: String(result.slot.id),
      metadata: { vacancyId, candidateId: result.slot.candidateId },
    });

    return NextResponse.json({ ok: true, slot: result.slot });
  }
);
