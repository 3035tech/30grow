import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { getLmsCourse, updateLmsCourse } from '../../../../../../lib/development/lms.js';
import { audit } from '../../../../../../lib/audit.js';

const idParams = z.object({
  id: zPositiveInt,
});

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(8000).optional().nullable(),
  active: z.boolean().optional(),
  completionPct: z.coerce.number().int().min(1).max(100).optional(),
  includeInactiveLessons: z.boolean().optional(),
});

/** GET /api/admin/lms/courses/[id] */
export const GET = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    companyFrom: 'query',
    logLabel: 'lms course GET',
  },
  async ({ request, companyId, params, query }) => {
    const parsed = idParams.safeParse({ id: params?.id });
    if (!parsed.success) return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    const includeInactiveLessons =
      String(query?.includeInactiveLessons || '') === '1' ||
      String(query?.includeInactiveLessons || '') === 'true';
    const result = await getLmsCourse(null, {
      companyId,
      courseId: parsed.data.id,
      includeInactiveLessons,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json({ ok: true, course: result.course, lessons: result.lessons });
  }
);

/** PATCH /api/admin/lms/courses/[id] */
export const PATCH = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'lms course PATCH',
  },
  async ({ request, payload, companyId, body, params }) => {
    const parsed = idParams.safeParse({ id: params?.id });
    if (!parsed.success) return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    const result = await updateLmsCourse(null, {
      companyId,
      courseId: parsed.data.id,
      title: body.title,
      description: body.description,
      active: body.active,
      completionPct: body.completionPct,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'lms.course.update',
      targetType: 'lms_course',
      targetId: String(parsed.data.id),
    });
    return NextResponse.json({ ok: true, course: result.course });
  }
);
