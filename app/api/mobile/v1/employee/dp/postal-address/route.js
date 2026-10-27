import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile/mobile-employee-session.js';
import { lookupCep } from '../../../../../../../lib/br-cep.js';
import { checkRateLimit } from '../../../../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';
const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 60 * 1000;
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const params = new URL(request.url).searchParams;
    const cep = params.get('cep') || '';
    if ([...params.keys()].some((key) => key !== 'cep') || params.getAll('cep').length !== 1 || !/^\d{8}$/.test(cep)) {
      return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    }
    const limit = await checkRateLimit(`mobile-postal:${session.companyId}:${session.candidateId}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const result = await lookupCep(cep);
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ cep: result.cep, street: result.street, neighborhood: result.neighborhood, city: result.city, state: result.state }, { headers: NO_STORE });
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
