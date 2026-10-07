import { consumeSecondFactorChallenge } from '../../../../../../../lib/second-factor-challenge.js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, HTTP_STATUS, ERR } from '../../../../../../../lib/api-error.js';
import { verifyEmployee2faLogin } from '../../../../../../../lib/employee-2fa.js';
import {
  completeMobileEmployeeAuthentication,
  verifyMobileEmployeeSecondFactor,
} from '../../../../../../../lib/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/rate-limit.js';
import { parseJsonBody } from '../../../../../../../lib/validate.js';

const verifySchema = z.object({
  challengeToken: z.string().min(1).max(4096),
  code: z.string().trim().regex(/^\d{6}$/),
});

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function POST(request) {
  try {
    const rate = await checkRateLimit(`mobile-employee-2fa:${clientIpFromRequest(request)}`, 15, 15 * 60 * 1000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: NO_STORE });
    const parsed = await parseJsonBody(request, verifySchema);
    if (!parsed.ok) return parsed.response;
    const challenge = await verifyMobileEmployeeSecondFactor(parsed.data.challengeToken);
    if (!challenge) return apiError(request, ERR.TWO_FA_CHALLENGE_INVALID, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const verified = await verifyEmployee2faLogin(challenge.candidateId, challenge.companyId, parsed.data.code);
    if (verified.code === 'RATE_LIMIT') {
      return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, {
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(verified.retryAfterSec) },
      });
    }
    if (!verified.ok) return apiError(request, ERR.TOTP_INVALID, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const challengeVersion = await consumeSecondFactorChallenge(parsed.data.challengeToken);
    if (!challengeVersion) return apiError(request, ERR.TWO_FA_CHALLENGE_INVALID, HTTP_STATUS.UNAUTHORIZED);
    const completed = await completeMobileEmployeeAuthentication({
      candidateId: challenge.candidateId,
      companyId: challenge.companyId,
    }, challenge.contexts, challengeVersion);
    if (!completed.ok) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    return NextResponse.json(completed, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-2fa]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
