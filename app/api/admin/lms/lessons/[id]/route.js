import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { updateLmsLesson } from '../../../../../../lib/development/lms.js';
import { audit } from '../../../../../../lib/audit.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(8000).optional().nullable(),
  contentUrl: z.string().trim().min(1).max(2000).optional(),
  contentKind: z.enum(['link', 'youtube', 'vimeo', 'pdf']).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
});

/** PATCH /api/admin/lms/lessons/[id] */
export const PATCH = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'lms lesson PATCH',
  },
  async ({ request, payload, companyId, body, params }) => {
    const lessonId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(lessonId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await updateLmsLesson(null, {
      companyId,
      lessonId,
      title: body.title,
      description: body.description,
      contentUrl: body.contentUrl,
      contentKind: body.contentKind,
      sortOrder: body.sortOrder,
      active: body.active,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'lms.lesson.update',
      targetType: 'lms_lesson',
      targetId: String(lessonId),
    });
    return NextResponse.json({ ok: true, lesson: result.lesson });
  }
);
