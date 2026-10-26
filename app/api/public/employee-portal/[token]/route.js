import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { apiError, ERR } from '../../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit';
import {
  getEmployeePortalView,
  submitEmployeePortalPrep,
  submitEmployeePortalLessonComplete,
  submitEmployeePortalLessonUncomplete,
} from '../../../../../lib/people/employee-portal';

/** GET /api/public/employee-portal/[token] */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-employee-portal-get:${ip}`, 60, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const token = params?.token;
    if (!token) return apiError(request, ERR.NOT_FOUND, 404);
    const url = new URL(request.url);
    const locale = url.searchParams.get('locale') || 'pt-BR';
    const view = await getEmployeePortalView(query, { token, locale });
    if (!view.ok) {
      const code = view.errorCode || 'NOT_FOUND';
      const status = code === 'NOT_FOUND' ? 404 : 410;
      return apiError(request, code, status);
    }
    return NextResponse.json({
      personName: view.personName,
      plans: view.plans,
      recentAgreements: view.recentAgreements,
      oneOnOnePrompts: view.oneOnOnePrompts,
      courses: view.courses || [],
      expiresAt: view.expiresAt,
      preparedAt: view.preparedAt,
      noteToManager: view.noteToManager,
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET public employee-portal', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/public/employee-portal/[token] — prep 1:1 or complete LMS lesson */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-employee-portal:${ip}`, 40, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const token = params?.token;
    if (!token) return apiError(request, ERR.NOT_FOUND, 404);
    const body = await request.json().catch(() => ({}));

    if (body.action === 'uncompleteLesson') {
      const lessonId = parseInt(String(body.lessonId || ''), 10);
      if (!Number.isFinite(lessonId)) return apiError(request, ERR.INVALID_DATA, 400);
      const saved = await submitEmployeePortalLessonUncomplete(query, { token, lessonId });
      if (!saved.ok) {
        const code = saved.errorCode || 'NOT_FOUND';
        const status =
          code === 'UNAUTHORIZED' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'EXPIRED' || code === 'REVOKED' ? 410 : 400;
        return apiError(request, code, status);
      }
      return NextResponse.json({
        ok: true,
        lessonId,
        progressPct: saved.progressPct,
        isComplete: saved.isComplete,
        completedLessons: saved.completedLessons,
        totalLessons: saved.totalLessons,
      });
    }

    if (body.action === 'completeLesson' || (body.lessonId != null && body.action !== 'uncompleteLesson')) {
      const lessonId = parseInt(String(body.lessonId || ''), 10);
      if (!Number.isFinite(lessonId)) return apiError(request, ERR.INVALID_DATA, 400);
      const saved = await submitEmployeePortalLessonComplete(query, { token, lessonId });
      if (!saved.ok) {
        const code = saved.errorCode || 'NOT_FOUND';
        const status =
          code === 'UNAUTHORIZED' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'EXPIRED' || code === 'REVOKED' ? 410 : 400;
        return apiError(request, code, status);
      }
      return NextResponse.json({
        ok: true,
        lessonId,
        progressPct: saved.progressPct,
        isComplete: saved.isComplete,
        completedLessons: saved.completedLessons,
        totalLessons: saved.totalLessons,
        newlyCompleted: Boolean(saved.newlyCompleted),
      });
    }

    if (!body.prepared && body.noteToManager == null) {
      return apiError(request, ERR.INVALID_DATA, 400);
    }
    const saved = await submitEmployeePortalPrep(query, {
      token,
      noteToManager: body.noteToManager,
    });
    if (!saved.ok) {
      const code = saved.errorCode || 'NOT_FOUND';
      const status = code === 'NOT_FOUND' ? 404 : 410;
      return apiError(request, code, status);
    }
    return NextResponse.json({
      ok: true,
      preparedAt: saved.preparedAt,
      noteToManager: saved.noteToManager,
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST public employee-portal', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
