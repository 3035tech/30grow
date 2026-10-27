import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import { createLmsLesson } from '../../../../../../../lib/development/lms.js';
import { audit } from '../../../../../../../lib/audit.js';

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(8000).optional().nullable(),
  contentUrl: z.string().trim().min(1).max(2000),
  contentKind: z.enum(['link', 'youtube', 'vimeo', 'pdf']).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional().nullable(),
});

/** POST /api/admin/lms/courses/[id]/lessons */
export const POST = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'lms lessons POST',
  },
  async ({ request, payload, companyId, body, params }) => {
    const courseId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(courseId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await createLmsLesson(null, {
      companyId,
      courseId,
      title: body.title,
      description: body.description,
      contentUrl: body.contentUrl,
      contentKind: body.contentKind,
      sortOrder: body.sortOrder,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'lms.lesson.create',
      targetType: 'lms_lesson',
      targetId: String(result.lesson.id),
    });
    return NextResponse.json({ ok: true, lesson: result.lesson }, { status: 201 });
  }
);
