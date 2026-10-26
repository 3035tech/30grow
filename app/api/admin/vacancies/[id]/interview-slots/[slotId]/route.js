import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import {
  apiError,
  apiErrorFromResult,
  ERR,
  httpStatusForError,
} from '../../../../../../../lib/api-error.js';
import { cancelInterviewSlot, updateInterviewSlot } from '../../../../../../../lib/recruiting/interview-slots.js';
import { audit } from '../../../../../../../lib/audit.js';
import { INTERVIEW_SLOT_STATUSES } from '../../../../../../../lib/domain-status.js';

const patchBodySchema = z.object({
  startsAt: z.string().optional(),
  endsAt: z.string().optional().nullable(),
  meetUrl: z.string().optional(),
  notes: z.string().optional().nullable(),
  status: z.enum(/** @type {[string, ...string[]]} */ (INTERVIEW_SLOT_STATUSES)).optional(),
});

/** PATCH /api/admin/vacancies/[id]/interview-slots/[slotId] */
export const PATCH = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    body: patchBodySchema,
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'interview-slots patch',
  },
  async ({ request, payload, scope, params, body }) => {
    const vacancyId = parseInt(String(params?.id || ''), 10);
    const slotId = parseInt(String(params?.slotId || ''), 10);
    if (!Number.isFinite(vacancyId) || !Number.isFinite(slotId)) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }

    const result = await updateInterviewSlot({
      slotId,
      vacancyId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
      body,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INTERVIEW_SLOT_NOT_FOUND });
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'interview_slot.update',
      targetType: 'interview_slot',
      targetId: String(slotId),
      metadata: { vacancyId },
    });

    return NextResponse.json({ ok: true, slot: result.slot });
  }
);

/** DELETE /api/admin/vacancies/[id]/interview-slots/[slotId] — cancel slot */
export const DELETE = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'interview-slots delete',
  },
  async ({ request, payload, scope, params }) => {
    const vacancyId = parseInt(String(params?.id || ''), 10);
    const slotId = parseInt(String(params?.slotId || ''), 10);
    if (!Number.isFinite(vacancyId) || !Number.isFinite(slotId)) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }

    const result = await cancelInterviewSlot({
      slotId,
      vacancyId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INTERVIEW_SLOT_NOT_FOUND });
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'interview_slot.cancel',
      targetType: 'interview_slot',
      targetId: String(slotId),
      metadata: { vacancyId },
    });

    return NextResponse.json({ ok: true, slot: result.slot });
  }
);
