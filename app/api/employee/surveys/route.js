import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import {
  listEmployeeSurveyInbox,
  submitEmployeeClimateSurvey,
  submitEmployeeTeamPulse,
} from '../../../../lib/employee/employee-surveys.js';
import { normalizeLocale } from '../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/surveys — open climate/pulse + history */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const url = new URL(request.url);
    const locale =
      normalizeLocale(url.searchParams.get('locale') || session.locale);

    const inbox = await listEmployeeSurveyInbox(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      locale,
    });
    return NextResponse.json({ ok: true, ...inbox });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee surveys', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/employee/surveys — submit climate or pulse (authenticated) */
export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `employee-surveys:${session.candidateId}:${ip}`,
      30,
      10 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || '').trim();
    const token = String(body.token || '').trim();
    const answers = body.answers;

    let result;
    if (kind === 'climate') {
      result = await submitEmployeeClimateSurvey(query, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        token,
        answers,
      });
    } else if (kind === 'pulse') {
      result = await submitEmployeeTeamPulse(query, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        token,
        answers,
      });
    } else {
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    return NextResponse.json({ ok: true, submittedAt: result.submittedAt || new Date().toISOString() });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee surveys', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
