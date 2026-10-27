import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import {
  removeLmsEnrollment,
  resetLmsEnrollmentProgress,
  updateLmsEnrollment,
} from '../../../../../../lib/development/lms.js';
import { audit } from '../../../../../../lib/audit.js';

const patchSchema = z.object({
  companyId: zPositiveInt.optional(),
  dueDate: z.string().trim().max(10).optional().nullable(),
  mandatory: z.boolean().optional(),
  resetProgress: z.boolean().optional(),
});

/** PATCH /api/admin/lms/enrollments/[id] — due/mandatory or resetProgress */
export const PATCH = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: patchSchema,
    companyFrom: 'body',
    logLabel: 'lms enrollment PATCH',
  },
  async ({ request, payload, companyId, body, params }) => {
    const enrollmentId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(enrollmentId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    if (body.resetProgress === true) {
      const result = await resetLmsEnrollmentProgress(null, { companyId, enrollmentId });
      if (!result.ok) return apiErrorFromResult(request, result);
      await audit({
        actorUserId: payload.userId || null,
        action: 'lms.enrollment.reset',
        targetType: 'lms_enrollment',
        targetId: String(enrollmentId),
        metadata: {},
      });
      return NextResponse.json({ ok: true, reset: true });
    }
    const result = await updateLmsEnrollment(null, {
      companyId,
      enrollmentId,
      dueDate: body.dueDate,
      mandatory: body.mandatory,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UPDATE_FAILED });
    }
    return NextResponse.json({ ok: true, enrollment: result.enrollment });
  }
);

/** DELETE /api/admin/lms/enrollments/[id]?companyId= */
export const DELETE = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    companyFrom: 'query',
    logLabel: 'lms enrollment DELETE',
  },
  async ({ request, payload, companyId, params }) => {
    const enrollmentId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(enrollmentId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await removeLmsEnrollment(null, { companyId, enrollmentId });
    if (!result.ok) return apiErrorFromResult(request, result);
    await audit({
      actorUserId: payload.userId || null,
      action: 'lms.enrollment.remove',
      targetType: 'lms_enrollment',
      targetId: String(enrollmentId),
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  }
);
