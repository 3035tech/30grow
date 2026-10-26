import { webSessionMaxAge } from '../../../../lib/session-ttl.js';
import { EMPLOYEE_SESSION_MAX_AGE } from '../../../../lib/employee/employee-auth-constants.js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import {
  getEmployeeProfile,
  updateEmployeeProfile,
} from '../../../../lib/employee/employee-profile.js';
import {
  EMPLOYEE_COOKIE_NAME,
  employeeSessionCookieOptions,
  signEmployeeToken,
} from '../../../../lib/employee/employee-auth.js';
import { LOCALE_COOKIE, normalizeLocale } from '../../../../lib/i18n.js';
import { sessionCookieSecure } from '../../../../lib/auth.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/me */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const result = await getEmployeeProfile(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    return NextResponse.json(result);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee me', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PATCH /api/employee/me — profile + locale */
export async function PATCH(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const body = await request.json().catch(() => ({}));
    const result = await updateEmployeeProfile(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      patch: body,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }

    const locale = normalizeLocale(result.person.preferredLocale || session.locale || 'pt-BR');
    const jwt = signEmployeeToken({
      candidateId: session.candidateId,
      companyId: session.companyId,
      email: result.person.email || session.email,
      locale,
      sv: session.sv,
      rememberUntil: session.rememberUntil,
    });
    const jar = await cookies();
    jar.set(EMPLOYEE_COOKIE_NAME, jwt, employeeSessionCookieOptions({ maxAge: webSessionMaxAge(session, EMPLOYEE_SESSION_MAX_AGE) }));
    jar.set(LOCALE_COOKIE, locale, {
      httpOnly: false,
      secure: sessionCookieSecure(),
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('PATCH employee me', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
