import { NextResponse } from 'next/server';
import { apiError, HTTP_STATUS, ERR } from '../../../../../../../lib/api-error.js';
import { beginEmployee2faSetup, disableEmployee2fa, enableEmployee2fa, loadEmployee2faState } from '../../../../../../../lib/employee-2fa.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store, private' });
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function limited(request, session) { return checkRateLimit(`mobile-employee-2fa:${session.candidateId}:${clientIpFromRequest(request)}`, 10, 15 * 60 * 1000); }

export async function GET(request) {
  const session = await auth(request);
  if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
  const state = await loadEmployee2faState(session.candidateId, session.companyId);
  if (!state) return apiError(request, ERR.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  return NextResponse.json({ enabled: state.enabled }, { headers: NO_STORE });
}

export async function POST(request) {
  const session = await auth(request);
  if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
  if (!(await limited(request, session)).ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
  const result = await beginEmployee2faSetup(session.candidateId, session.companyId);
  if (!result.ok) return apiError(request, result.code === 'ALREADY_ENABLED' ? ERR.TWO_FA_ALREADY_ENABLED : ERR.TWO_FA_FORBIDDEN, HTTP_STATUS.BAD_REQUEST);
  return NextResponse.json({ enabled: false, setup: { secret: result.secret, otpauthUrl: result.otpauthUrl } }, { headers: NO_STORE });
}

export async function PATCH(request) {
  const session = await auth(request);
  if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
  if (!(await limited(request, session)).ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
  const body = await request.json().catch(() => ({}));
  const result = await enableEmployee2fa(session.candidateId, session.companyId, body.code);
  if (!result.ok) return apiError(request, result.code === 'TOTP_INVALID' ? ERR.TOTP_INVALID : ERR.TWO_FA_SETUP_REQUIRED, HTTP_STATUS.BAD_REQUEST);
  return NextResponse.json({ enabled: true, setup: null }, { headers: NO_STORE });
}

export async function DELETE(request) {
  const session = await auth(request);
  if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
  if (!(await limited(request, session)).ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
  const body = await request.json().catch(() => ({}));
  const result = await disableEmployee2fa(session.candidateId, session.companyId, { code: body.code, password: body.password });
  if (!result.ok) {
    if (result.code === 'RATE_LIMIT') {
      return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, {
        headers: { 'Retry-After': String(result.retryAfterSec) },
      });
    }
    const code = result.code === 'TOTP_INVALID' ? ERR.TOTP_INVALID : result.code === 'INVALID_CREDENTIALS' ? ERR.INVALID_CREDENTIALS : ERR.TWO_FA_NOT_ENABLED;
    return apiError(request, code, HTTP_STATUS.BAD_REQUEST);
  }
  return NextResponse.json({ enabled: false, sessionRevoked: true, setup: null }, { headers: NO_STORE });
}
