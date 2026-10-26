import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import {
  listCandidateLmsCourses,
  completeLmsLesson,
  uncompleteLmsLesson,
  upsertLmsWatchProgress,
} from '../../../../lib/development/lms.js';
import {
  getLessonQuiz,
  submitLessonQuiz,
} from '../../../../lib/development/lms-quiz.js';

export const dynamic = 'force-dynamic';

function continuePayload(courses) {
  const continueCourse =
    courses.find((c) => !c.isComplete && c.continueLessonId) ||
    courses.find((c) => c.continueLessonId) ||
    null;
  if (!continueCourse) return null;
  const lesson = (continueCourse.lessons || []).find(
    (l) => Number(l.id) === Number(continueCourse.continueLessonId)
  );
  return {
    enrollmentId: continueCourse.enrollmentId,
    courseId: continueCourse.courseId,
    courseTitle: continueCourse.title,
    lessonId: continueCourse.continueLessonId,
    overdue: continueCourse.overdue,
    daysLeft: continueCourse.daysLeft,
    dueDate: continueCourse.dueDate,
    watchPositionSec: lesson?.watchPositionSec || continueCourse.continueWatchPositionSec || 0,
  };
}

/** GET /api/employee/lms — courses for dedicated LMS page */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const courses = await listCandidateLmsCourses(null, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    return NextResponse.json({
      ok: true,
      courses,
      continue: continuePayload(courses),
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET /api/employee/lms', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/employee/lms — complete/uncomplete lesson, quiz, or watch progress */
export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const ip = clientIpFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');

    const rlKey =
      action === 'saveWatchProgress'
        ? `employee-lms-watch:${session.candidateId}:${ip}`
        : `employee-lms:${session.candidateId}:${ip}`;
    const rlLimit = action === 'saveWatchProgress' ? 90 : 60;
    const rl = await checkRateLimit(rlKey, rlLimit, 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT));

    if (action === 'saveWatchProgress') {
      const result = await upsertLmsWatchProgress(null, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        lessonId: Number(body.lessonId),
        positionSec: body.positionSec,
        durationSec: body.durationSec,
      });
      if (!result.ok) return apiErrorFromResult(request, result);
      return NextResponse.json(result);
    }

    if (action === 'getQuiz') {
      const lessonId = Number(body.lessonId);
      const quiz = await getLessonQuiz(null, {
        companyId: session.companyId,
        lessonId,
        includeAnswer: false,
      });
      if (!quiz.ok) return apiErrorFromResult(request, quiz);
      return NextResponse.json(quiz);
    }

    if (action === 'submitQuiz') {
      const result = await submitLessonQuiz(null, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        lessonId: Number(body.lessonId),
        answers: body.answers || {},
      });
      if (!result.ok) {
        const code = result.errorCode || ERR.LMS_QUIZ_FAILED;
        const status = httpStatusForError(code);
        return NextResponse.json(
          {
            ok: false,
            errorCode: code,
            correctCount: result.correctCount,
            totalCount: result.totalCount,
            passed: false,
          },
          { status }
        );
      }
      return NextResponse.json(result);
    }

    if (action === 'completeLesson' || action === 'uncompleteLesson') {
      const fn = action === 'completeLesson' ? completeLmsLesson : uncompleteLmsLesson;
      const result = await fn(null, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        lessonId: Number(body.lessonId),
      });
      if (!result.ok) return apiErrorFromResult(request, result);
      const courses = await listCandidateLmsCourses(null, {
        companyId: session.companyId,
        candidateId: session.candidateId,
      });
      return NextResponse.json({ ok: true, ...result, courses });
    }

    return apiError(request, ERR.INVALID_DATA, 400);
  } catch (err) {
    console.error('POST /api/employee/lms', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
