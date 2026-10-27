import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import {
  listCandidateNotifications,
  markCandidateNotificationRead,
} from '../../../../lib/employee/employee-notifications.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/notifications */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const result = await listCandidateNotifications(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      limit,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    return NextResponse.json(result);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee notifications', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PATCH /api/employee/notifications — mark one or all read */
export async function PATCH(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const body = await request.json().catch(() => ({}));
    const result = await markCandidateNotificationRead(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      id: body.id,
      markAll: body.markAll === true,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    return NextResponse.json(result);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('PATCH employee notifications', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
