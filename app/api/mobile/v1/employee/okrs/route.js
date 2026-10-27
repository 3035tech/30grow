import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { OKR_CYCLE_STATUS } from '../../../../../../lib/domain-status.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { createOkrActivityCheckin, listOkrActivitiesForCandidate } from '../../../../../../lib/development/okr-cycles.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit.js';
import { listAssignedKeyResults, recordKeyResultCheckin } from '../../../../../../lib/development/okr-hierarchy.js';

export const dynamic = 'force-dynamic';
const OKR_CHECKIN_NOTE_MAX_LENGTH = 500;
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) {
  const result = await listOkrActivitiesForCandidate(null, { companyId: session.companyId, candidateId: session.candidateId });
  const keyResults = await listAssignedKeyResults(null, { companyId:session.companyId, candidateId:session.candidateId });
  return { activities: result.ok ? result.items : [], keyResults };
}

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    return NextResponse.json(await load(session), { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee okrs', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function POST(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-okr:${session.candidateId}:${clientIpFromRequest(request)}`, 30, 60 * 60 * 1000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    if (body.keyResultId !== undefined) {
      if (!Number.isSafeInteger(body.keyResultId) || typeof body.currentValue !== 'number') return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
      const result = await recordKeyResultCheckin(null, { keyResultId:body.keyResultId, currentValue:body.currentValue, note:body.note, companyId:session.companyId, candidateId:session.candidateId });
      if (!result.ok) return apiErrorFromResult(request,result,{fallbackCode:ERR.INVALID_DATA});
      return NextResponse.json(await load(session), {headers:NO_STORE});
    }
    const activityId = Number(body.activityId);
    const progressPct = Number(body.progressPct);
    if (!Number.isInteger(activityId) || activityId < 1 || !Number.isInteger(progressPct) || progressPct < 0 || progressPct > 100) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const current = await load(session);
    const owned = current.activities.find((activity) => activity.id === activityId);
    if (!owned || owned.cycleStatus === OKR_CYCLE_STATUS.CLOSED) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN);
    const result = await createOkrActivityCheckin(null, { companyId: session.companyId, activityId, progressPct, note: String(body.note || '').slice(0, OKR_CHECKIN_NOTE_MAX_LENGTH), createdByCandidateId: session.candidateId });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    return NextResponse.json(await load(session), { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee okrs', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
