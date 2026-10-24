import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee-session.js';
import {
  createCompanyKudo,
  listCompanyKudos,
} from '../../../../lib/company-kudos.js';
import { notifyCandidate, EMPLOYEE_NOTIF } from '../../../../lib/employee-notifications.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/kudos */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '15', 10);
    const result = await listCompanyKudos(null, {
      companyId: session.companyId,
      viewerCandidateId: session.candidateId,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 15,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/employee/kudos', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/employee/kudos — send recognition to a colleague */
export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `emp-kudos:${session.candidateId}:${ip}`,
      20,
      60 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const body = await request.json().catch(() => ({}));
    const result = await createCompanyKudo(null, {
      companyId: session.companyId,
      fromCandidateId: session.candidateId,
      toCandidateId: body.toCandidateId,
      message: body.message,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }

    await notifyCandidate(null, {
      companyId: session.companyId,
      candidateId: result.kudo.toCandidateId,
      type: EMPLOYEE_NOTIF.KUDOS_RECEIVED,
      entityType: 'company_kudo',
      entityId: result.kudo.id,
      dedupeKey: `kudos:${result.kudo.id}`,
      payload: {
        fromName: result.kudo.fromName || '—',
        message: result.kudo.message,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('POST /api/employee/kudos', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
