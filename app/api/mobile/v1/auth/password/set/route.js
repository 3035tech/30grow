import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, ERR, httpStatusForError, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { completeEmployeePasswordSetup, peekEmployeePasswordSetupToken } from '../../../../../../../lib/employee/employee-auth.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/identity/rate-limit.js';
import { parseJsonBody } from '../../../../../../../lib/validate.js';

const passwordSchema = z.object({ token: z.string().trim().min(16).max(512), password: z.string().min(8).max(1024) });
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function GET(request) {
  try {
    const rate = await checkRateLimit(`mobile-employee-set-password-peek:${clientIpFromRequest(request)}`, 30, 15 * 60 * 1000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: NO_STORE });
    const token = new URL(request.url).searchParams.get('token') || '';
    const result = await peekEmployeePasswordSetupToken(query, token);
    if (!result.ok) return apiError(request, result.errorCode || ERR.INVALID_TOKEN, httpStatusForError(result.errorCode || ERR.INVALID_TOKEN), {}, { headers: NO_STORE });
    return NextResponse.json({ email: result.maskedEmail, ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-set-password-peek]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}

export async function POST(request) {
  try {
    const rate = await checkRateLimit(`mobile-employee-set-password:${clientIpFromRequest(request)}`, 20, 15 * 60 * 1000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: NO_STORE });
    const parsed = await parseJsonBody(request, passwordSchema);
    if (!parsed.ok) return parsed.response;
    const result = await completeEmployeePasswordSetup(query, parsed.data);
    if (!result.ok) return apiError(request, result.errorCode || ERR.INVALID_TOKEN, httpStatusForError(result.errorCode || ERR.INVALID_TOKEN), {}, { headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-set-password]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
