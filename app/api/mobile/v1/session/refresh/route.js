import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { refreshMobileEmployeeSession } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit.js';
import { parseJsonBody } from '../../../../../../lib/validate.js';

const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) });
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function POST(request) {
  try {
    const rate = await checkRateLimit(`mobile-employee-refresh:${clientIpFromRequest(request)}`, 60, 15 * 60 * 1000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: NO_STORE });
    const parsed = await parseJsonBody(request, refreshSchema);
    if (!parsed.ok) return parsed.response;
    const result = await refreshMobileEmployeeSession(parsed.data.refreshToken);
    if (!result.ok) return apiError(request, ERR.INVALID_TOKEN, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-refresh]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
