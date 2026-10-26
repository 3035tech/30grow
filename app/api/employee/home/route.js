import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import { dismissEmployeeWelcome, getEmployeeHome } from '../../../../lib/employee/employee-home.js';
import { completeLmsLesson, uncompleteLmsLesson } from '../../../../lib/lms.js';
import { updateEmployeePdiItemStatus } from '../../../../lib/employee/employee-pdi.js';
import { submitEmployeeOneOnOnePrep } from '../../../../lib/employee/employee-one-on-one-prep.js';
import { DEVELOPMENT_PLAN_ITEM_STATUS } from '../../../../lib/domain-status.js';
import { getTimeClockAccess } from '../../../../lib/people/time-clock.js';
import { normalizeLocale } from '../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/home — tasks + LMS for logged-in collaborator */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const url = new URL(request.url);
    const locale =
      normalizeLocale(url.searchParams.get('locale') || session.locale);

    const home = await getEmployeeHome(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      locale,
    });
    if (!home.ok) {
      return apiErrorFromResult(request, home, { fallbackCode: ERR.UNAUTHORIZED });
    }
    const timeClock = await getTimeClockAccess(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    return NextResponse.json({
      ...home,
      companyModules: session.companyModules ?? null,
      timeClockEnabled: Boolean(timeClock.ok && timeClock.enabled),
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee home', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/employee/home — LMS lesson or PDI item status */
export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `employee-home:${session.candidateId}:${ip}`,
      60,
      10 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const body = await request.json().catch(() => ({}));

    if (body.action === 'dismissWelcome') {
      const result = await dismissEmployeeWelcome(query, {
        companyId: session.companyId,
        candidateId: session.candidateId,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'submitOneOnOnePrep') {
      const result = await submitEmployeeOneOnOnePrep(query, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        noteToManager: body.noteToManager,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
      }
      return NextResponse.json({
        ok: true,
        oneOnOnePrep: {
          preparedAt: result.preparedAt,
          noteToManager: result.noteToManager,
        },
      });
    }

    if (body.action === 'updatePdiItem') {
      const itemId = parseInt(String(body.itemId || ''), 10);
      const status = String(body.status || '').trim();
      if (!Number.isFinite(itemId)) return apiError(request, ERR.INVALID_DATA, 400);
      const result = await updateEmployeePdiItemStatus(query, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        itemId,
        status:
          status === DEVELOPMENT_PLAN_ITEM_STATUS.DONE ||
          status === DEVELOPMENT_PLAN_ITEM_STATUS.DOING ||
          status === DEVELOPMENT_PLAN_ITEM_STATUS.TODO
            ? status
            : DEVELOPMENT_PLAN_ITEM_STATUS.DONE,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
      }
      return NextResponse.json({ ok: true, item: result.item });
    }

    const lessonId = parseInt(String(body.lessonId || ''), 10);
    if (!Number.isFinite(lessonId)) {
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    const opts = {
      companyId: session.companyId,
      candidateId: session.candidateId,
      lessonId,
    };

    let result;
    if (body.action === 'uncompleteLesson') {
      result = await uncompleteLmsLesson(query, opts);
    } else if (body.action === 'completeLesson') {
      result = await completeLmsLesson(query, opts);
    } else {
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json({
      ok: true,
      lessonId,
      progressPct: result.progressPct,
      isComplete: result.isComplete,
      completedLessons: result.completedLessons,
      totalLessons: result.totalLessons,
      newlyCompleted: Boolean(result.newlyCompleted),
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee home', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
