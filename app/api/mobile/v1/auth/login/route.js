import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { loginEmployeeWithPassword } from '../../../../../../lib/employee-auth.js';
import {
  completeMobileEmployeeAuthentication,
  MOBILE_EMPLOYEE_AUTH_OUTCOME,
  mobileEmployeeSelectionResponse,
  signMobileEmployeeSecondFactor,
} from '../../../../../../lib/mobile-employee-session.js';
import { query } from '../../../../../../lib/db.js';
import {
  accountRateLimitKey,
  checkRateLimit,
  clientIpFromRequest,
} from '../../../../../../lib/rate-limit.js';
import { parseJsonBody } from '../../../../../../lib/validate.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
});

const INVALID_CREDENTIAL_DELAY_MS = 500;
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

async function invalidCredentials(request) {
  await new Promise((resolve) => setTimeout(resolve, INVALID_CREDENTIAL_DELAY_MS));
  return apiError(request, ERR.INVALID_CREDENTIALS, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
}

export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rate = await checkRateLimit(`mobile-employee-login:${ip}`, 20, 15 * 60 * 1000);
    if (!rate.ok) {
      return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, {
        headers: { ...NO_STORE, 'Retry-After': String(rate.retryAfterSec) },
      });
    }
    const parsed = await parseJsonBody(request, loginSchema);
    if (!parsed.ok) return parsed.response;
    const accountRate = await checkRateLimit(
      accountRateLimitKey('employee-login', parsed.data.email),
      12,
      15 * 60 * 1000
    );
    if (!accountRate.ok) {
      return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, {
        headers: { ...NO_STORE, 'Retry-After': String(accountRate.retryAfterSec) },
      });
    }

    const result = await loginEmployeeWithPassword(query, parsed.data);
    if (!result.ok) return invalidCredentials(request);
    if (result.needsCompanyPick) {
      return NextResponse.json(
        mobileEmployeeSelectionResponse(parsed.data.email, result.pickToken, result.companies),
        { headers: NO_STORE }
      );
    }
    const contexts = [{ candidateId: result.candidateId, companyId: result.companyId }];
    if (result.requires2fa) {
      return NextResponse.json({
        outcome: MOBILE_EMPLOYEE_AUTH_OUTCOME.REQUIRES_SECOND_FACTOR,
        challengeToken: await signMobileEmployeeSecondFactor(result, contexts),
      }, { headers: NO_STORE });
    }
    const completed = await completeMobileEmployeeAuthentication(result, contexts);
    if (!completed.ok) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    return NextResponse.json(completed, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-login]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
