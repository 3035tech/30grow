import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { requestEmployeePasswordReset } from '../../../../../../../lib/employee/employee-auth.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/identity/rate-limit.js';
import { parseJsonBody } from '../../../../../../../lib/validate.js';

const forgotSchema = z.object({ email: z.string().trim().email().max(254) });
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const MOBILE_PASSWORD_SETUP_URL = 'team30://set-password';

export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rate = await checkRateLimit(`mobile-employee-forgot:${ip}`, 8, 15 * 60 * 1000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(rate.retryAfterSec) } });
    const parsed = await parseJsonBody(request, forgotSchema);
    if (!parsed.ok) return parsed.response;
    const emailRate = await checkRateLimit(`mobile-employee-forgot-email:${parsed.data.email.toLowerCase()}`, 6, 15 * 60 * 1000);
    if (!emailRate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(emailRate.retryAfterSec) } });
    const result = await requestEmployeePasswordReset(query, { email: parsed.data.email, locale: 'pt-BR', setupUrlPrefix: MOBILE_PASSWORD_SETUP_URL });
    if (!result.ok && ![ERR.INVALID_EMAIL, ERR.NOT_FOUND].includes(result.errorCode)) console.error('[mobile-employee-forgot-password]', result.errorCode);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-forgot-password]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
