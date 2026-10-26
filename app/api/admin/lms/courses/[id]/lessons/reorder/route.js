import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../../../lib/validate.js';
import { reorderLmsLessons } from '../../../../../../../../lib/development/lms.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  lessonIds: z.array(zPositiveInt).min(1).max(60),
});

/** PATCH /api/admin/lms/courses/[id]/lessons/reorder */
export const PATCH = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: bodySchema,
    companyFrom: 'body',
    logLabel: 'lms lessons reorder',
  },
  async ({ request, companyId, body, params }) => {
    const courseId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(courseId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await reorderLmsLessons(null, {
      companyId,
      courseId,
      lessonIds: body.lessonIds,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true });
  }
);
