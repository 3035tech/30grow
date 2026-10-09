import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { requestEmployeeMagicLink } from '../../../../../../lib/employee-auth.js';
import { checkRateLimit, clientIpFromRequest, accountRateLimitKey } from '../../../../../../lib/rate-limit.js';
import { verifyTurnstileToken } from '../../../../../../lib/turnstile.js';
import { zLocale, parseJsonBody } from '../../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const schema = z.object({
  email: z.string().trim().email().max(254),
  companySlug: z.string().trim().min(1).max(200).optional(),
  locale: zLocale.optional(),
  turnstileToken: z.string().max(4096).optional(),
}).strict();

export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rate = await checkRateLimit(`mobile-employee-magic:${ip}`, 8, 15 * 60 * 1000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(rate.retryAfterSec) } });
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.ok) {
      parsed.response.headers.set('Cache-Control', 'no-store');
      return parsed.response;
    }
    const captcha = await verifyTurnstileToken({ token: parsed.data.turnstileToken, remoteIp: ip });
    if (!captcha.ok) return apiError(request, ERR.TURNSTILE_FAILED, HTTP_STATUS.BAD_REQUEST, {}, { headers: NO_STORE });
    const account = await checkRateLimit(accountRateLimitKey('employee-magic', parsed.data.email), 6, 15 * 60 * 1000);
    if (!account.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(account.retryAfterSec) } });
    const result = await requestEmployeeMagicLink(query, { email: parsed.data.email, companySlug: parsed.data.companySlug, locale: parsed.data.locale, requireMail: true, mobile: true });
    if (!result.ok) return apiErrorFromResult(request, result, { init: { headers: NO_STORE } });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
