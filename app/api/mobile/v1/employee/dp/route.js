import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { query } from '../../../../../../lib/db.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { getDpProfile, getEmployeeDpHome, upsertDpProfile } from '../../../../../../lib/people/employee-dp.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit.js';
import { AUDIT_ACTOR_KIND, auditFromRequest } from '../../../../../../lib/audit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const PROFILE_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) { return getEmployeeDpHome({ query }, { companyId: session.companyId, candidateId: session.candidateId }); }

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const result = await load(session);
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee dp', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function PATCH(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-dp:${session.candidateId}:${clientIpFromRequest(request)}`, PROFILE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    const existing = await getDpProfile({ query }, session);
    if (!existing.ok) return apiErrorFromResult(request, existing);
    const previous = existing.profile;
    const result = await upsertDpProfile({ query }, {
      companyId: session.companyId, candidateId: session.candidateId,
      emergencyName: body.emergencyName ?? previous.emergencyName,
      emergencyPhone: body.emergencyPhone ?? previous.emergencyPhone,
      emergencyRelation: body.emergencyRelation ?? previous.emergencyRelation,
      cpf: body.cpf ?? previous.cpf, addressLine: body.addressLine ?? previous.addressLine,
      addressNumber: body.addressNumber,
      addressCity: body.addressCity ?? previous.addressCity, addressState: body.addressState ?? previous.addressState,
      addressPostal: body.addressPostal ?? previous.addressPostal, internalNotes: previous.internalNotes,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    if (result.changes.length) await auditFromRequest(request, {
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
      actorCandidateId: session.candidateId,
      companyId: session.companyId,
      action: 'dp.profile.updated',
      targetType: 'candidate',
      targetId: session.candidateId,
      metadata: { changes: result.changes },
    });
    const home = await load(session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: NO_STORE });
  } catch (error) {
    console.error('PATCH mobile employee dp', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
