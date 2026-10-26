import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import {
  getEmployeeOnboardingJourney,
  employeeAckOnboardingItem,
} from '../../../../lib/people/employee-onboarding-journey.js';
import { ONBOARDING_ACK_KIND } from '../../../../lib/domain-status.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/onboarding — jornada D1 + D30/D60/D90 */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const journey = await getEmployeeOnboardingJourney(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!journey.ok) {
      return apiErrorFromResult(request, journey, { fallbackCode: ERR.UNAUTHORIZED });
    }
    return NextResponse.json(journey);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee onboarding', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PATCH /api/employee/onboarding — confirmação do colaborador */
export async function PATCH(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `employee-onboarding:${session.candidateId}:${ip}`,
      30,
      10 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const body = await request.json().catch(() => ({}));
    const kind =
      body.kind === ONBOARDING_ACK_KIND.CHECKIN
        ? ONBOARDING_ACK_KIND.CHECKIN
        : body.kind === ONBOARDING_ACK_KIND.PRE
          ? ONBOARDING_ACK_KIND.PRE
          : null;
    const itemId = Number(body.itemId || body.id);
    if (!kind || !Number.isFinite(itemId)) {
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    const result = await employeeAckOnboardingItem(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      kind,
      itemId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }

    const journey = await getEmployeeOnboardingJourney(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    return NextResponse.json({ ok: true, journey: journey.ok ? journey : null });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('PATCH employee onboarding', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
