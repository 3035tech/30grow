import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee/employee-session.js';
import { changeEmployeePassword } from '../../../../../lib/employee/employee-profile.js';

export const dynamic = 'force-dynamic';

/** POST /api/employee/me/password — change password while logged in */
export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `employee-pwd:${session.candidateId}:${ip}`,
      10,
      15 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const body = await request.json().catch(() => ({}));
    const result = await changeEmployeePassword(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee me password', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
