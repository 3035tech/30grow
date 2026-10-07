import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { zLocale } from '../../../../../../lib/validate.js';
import { getEmployeeProfile, updateEmployeeProfile } from '../../../../../../lib/employee-profile.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }

async function load(session) {
  return getEmployeeProfile(null, { companyId: session.companyId, candidateId: session.candidateId });
}

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const result = await load(session);
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED, init: { headers: NO_STORE } });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee profile', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}

export async function PATCH(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const limit = await checkRateLimit(`mobile-employee-profile:${session.candidateId}:${clientIpFromRequest(request)}`, 20, 10 * 60 * 1000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSec) } });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST, {}, { headers: NO_STORE });
    if (body.preferredLocale !== undefined && !zLocale.safeParse(body.preferredLocale).success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST, {}, { headers: NO_STORE });
    const patch = {
      preferredLocale: body.preferredLocale,
      fullName: body.fullName,
      phone: body.phone,
      linkedinUrl: body.linkedinUrl,
      city: body.city,
      state: body.state,
      birthDate: body.birthDate,
    };
    const result = await updateEmployeeProfile(null, { companyId: session.companyId, candidateId: session.candidateId, patch });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA, init: { headers: NO_STORE } });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('PATCH mobile employee profile', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
