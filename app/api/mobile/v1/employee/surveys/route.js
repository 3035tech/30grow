import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { listEmployeeSurveyInbox, submitEmployeeClimateSurvey, submitEmployeeTeamPulse } from '../../../../../../lib/employee/employee-surveys.js';
import { mobileSurveyInbox } from '../../../../../../lib/mobile-employee-payload.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const SURVEY_KIND = Object.freeze({ CLIMATE: 'climate', PULSE: 'pulse' });
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) {
  return mobileSurveyInbox(await listEmployeeSurveyInbox(null, { companyId: session.companyId, candidateId: session.candidateId, locale: 'pt-BR' }));
}

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    return NextResponse.json({ ok: true, ...(await load(session)) }, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee surveys', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function POST(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-surveys:${session.candidateId}:${clientIpFromRequest(request)}`, 30, 10 * 60 * 1000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    const options = { companyId: session.companyId, candidateId: session.candidateId, token: String(body.token || ''), answers: body.answers };
    const result = body.kind === SURVEY_KIND.CLIMATE
      ? await submitEmployeeClimateSurvey(null, options)
      : body.kind === SURVEY_KIND.PULSE
        ? await submitEmployeeTeamPulse(null, options)
        : { ok: false, errorCode: ERR.INVALID_DATA };
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    return NextResponse.json({ ok: true, ...(await load(session)) }, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee surveys', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
