import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../../../../lib/db.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { consumeEmployeeMagicToken } from '../../../../../../../lib/employee-auth.js';
import { employee2faRequired } from '../../../../../../../lib/employee-2fa.js';
import { completeMobileEmployeeAuthentication, MOBILE_EMPLOYEE_AUTH_OUTCOME, signMobileEmployeeSecondFactor } from '../../../../../../../lib/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/rate-limit.js';
import { parseJsonBody } from '../../../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const schema = z.object({ token: z.string().trim().min(20).max(512) }).strict();

export async function POST(request) {
  try {
    const rate = await checkRateLimit(`mobile-employee-magic-exchange:${clientIpFromRequest(request)}`, 20, 15 * 60 * 1000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(rate.retryAfterSec) } });
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.ok) {
      parsed.response.headers.set('Cache-Control', 'no-store');
      return parsed.response;
    }
    const result = await consumeEmployeeMagicToken(query, parsed.data);
    if (!result.ok) return apiError(request, ERR.INVALID_TOKEN, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    // A link proves only this employee/company, never other accounts with the same email.
    const contexts = [{ candidateId: result.candidateId, companyId: result.companyId }];
    if (await employee2faRequired(result.candidateId, result.companyId)) {
      return NextResponse.json({ outcome: MOBILE_EMPLOYEE_AUTH_OUTCOME.REQUIRES_SECOND_FACTOR, challengeToken: await signMobileEmployeeSecondFactor(result, contexts) }, { headers: NO_STORE });
    }
    const completed = await completeMobileEmployeeAuthentication(result, contexts);
    if (!completed.ok) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    return NextResponse.json(completed, { headers: NO_STORE });
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
