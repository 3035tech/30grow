import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { searchEmployeeColleagues } from '../../../../../../lib/company/company-kudos.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { checkRateLimit } from '../../../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 20;
const MAX_PAGE = 10000;
const SEARCH_LIMIT = 60;
const SEARCH_WINDOW_MS = 60 * 1000;
const schema = z.object({ q: z.string().trim().max(80).default(''), page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(MAX_PAGE)).default(1) }).strict();
export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const input = schema.safeParse(Object.fromEntries(params));
    if (!input.success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const rate = await checkRateLimit(`mobile-colleagues:${session.companyId}:${session.candidateId}`, SEARCH_LIMIT, SEARCH_WINDOW_MS);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const { q, page } = input.data;
    const result = await searchEmployeeColleagues(null, { companyId: session.companyId, excludeCandidateId: session.candidateId, q, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ people: result.people.slice(0, PAGE_SIZE).map((person) => ({ id: Number(person.id), fullName: person.fullName })), page, hasMore: page < MAX_PAGE && result.people.length > PAGE_SIZE }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR); }
}
