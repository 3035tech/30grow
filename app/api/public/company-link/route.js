import { NextResponse } from 'next/server';
import { resolveCompanyLinkByToken } from '../../../../lib/public-company-link';
import { apiError, ERR } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

export async function GET(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`public-company-link:${ip}`, 60, 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const { searchParams } = new URL(request.url);
  const token = String(searchParams.get('token') || '').trim();
  const result = await resolveCompanyLinkByToken(token);
  if (!result.ok) {
    const status = result.errorCode === 'INVALID_TOKEN' ? 400 : 404;
    return apiError(request, result.errorCode, status);
  }
  const { companyId: _id, ...publicCompany } = result.company;
  return NextResponse.json(publicCompany, {
    headers: {
      'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
