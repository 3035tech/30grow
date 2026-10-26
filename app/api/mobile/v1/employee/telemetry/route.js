import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit.js';
import { parseJsonBody } from '../../../../../../lib/validate.js';

const TELEMETRY_EVENT = Object.freeze({ REQUEST_FAILED: 'request_failed', SLOW_REQUEST: 'slow_request' });
const telemetrySchema = z.object({
  event: z.enum(TELEMETRY_EVENT),
  route: z.string().trim().startsWith('/api/mobile/v1/').max(160),
  durationMs: z.number().int().nonnegative().max(120000),
  status: z.number().int().min(100).max(599).optional(),
  failure: z.enum(['network', 'timeout']).optional(),
  errorCode: z.string().trim().max(80).optional(),
});
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const NO_CONTENT_STATUS = 204;

export async function POST(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const rate = await checkRateLimit(`mobile-employee-telemetry:${session.candidateId}:${clientIpFromRequest(request)}`, 60, 60 * 1000);
    if (!rate.ok) return new NextResponse(null, { status: NO_CONTENT_STATUS, headers: NO_STORE });
    const parsed = await parseJsonBody(request, telemetrySchema);
    if (!parsed.ok) return parsed.response;
    console.info('[mobile-employee-telemetry]', JSON.stringify({ ...parsed.data, candidateId: session.candidateId, companyId: session.companyId }));
    return new NextResponse(null, { status: NO_CONTENT_STATUS, headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-telemetry]', error);
    return new NextResponse(null, { status: NO_CONTENT_STATUS, headers: NO_STORE });
  }
}
