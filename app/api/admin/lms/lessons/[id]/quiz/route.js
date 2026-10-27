import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { CAP } from '../../../../../../../lib/identity/permissions.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import { getLessonQuiz, replaceLessonQuiz, LMS_QUIZ_MAX_QUESTIONS } from '../../../../../../../lib/development/lms-quiz.js';
import { audit } from '../../../../../../../lib/audit.js';

const putBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  questions: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(500),
        correctChoiceId: z.string().trim().min(1).max(40),
        choices: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(40),
              text: z.string().trim().min(1).max(200),
            })
          )
          .min(2)
          .max(4),
      })
    )
    .max(LMS_QUIZ_MAX_QUESTIONS),
});

/** GET /api/admin/lms/lessons/[id]/quiz */
export const GET = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'lms quiz GET',
  },
  async ({ request, companyId, params }) => {
    const lessonId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(lessonId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await getLessonQuiz(null, {
      companyId,
      lessonId,
      includeAnswer: true,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);

/** PUT /api/admin/lms/lessons/[id]/quiz — replace questions (empty = clear) */
export const PUT = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: putBodySchema,
    companyFrom: 'body',
    logLabel: 'lms quiz PUT',
  },
  async ({ request, payload, companyId, body, params }) => {
    const lessonId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(lessonId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await replaceLessonQuiz(null, {
      companyId,
      lessonId,
      questions: body.questions || [],
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await audit({
      actorUserId: payload.userId,
      companyId,
      action: 'lms.quiz.replace',
      targetType: 'lms_lesson',
      targetId: lessonId,
      metadata: { questionCount: (result.questions || []).length },
    });
    return NextResponse.json(result);
  }
);
