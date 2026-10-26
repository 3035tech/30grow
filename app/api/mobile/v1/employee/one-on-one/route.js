import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { getEmployeeOneOnOne } from '../../../../../../lib/employee/employee-home.js';
import { mobileOneOnOneBody } from '../../../../../../lib/mobile/mobile-employee-payload.js';
import { submitEmployeeOneOnOnePrep } from '../../../../../../lib/employee/employee-one-on-one-prep.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit.js';
import { normalizeLocale } from '../../../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const NOTE_MAX_LENGTH = 2000;
const PREP_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const inputSchema = z.object({ noteToManager: z.string().max(NOTE_MAX_LENGTH) }).strict();

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'));
    const result = await getEmployeeOneOnOne(null, { ...session, locale });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    return NextResponse.json(mobileOneOnOneBody(result), { headers: NO_STORE });
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function POST(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-one-on-one:${session.companyId}:${session.candidateId}:${clientIpFromRequest(request)}`, PREP_RATE_LIMIT, RATE_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await submitEmployeeOneOnOnePrep(null, { ...session, noteToManager: input.data.noteToManager });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    return NextResponse.json({ preparedAt: result.preparedAt, noteToManager: result.noteToManager }, { headers: NO_STORE });
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
