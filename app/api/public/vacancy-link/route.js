import { NextResponse } from 'next/server';
import { resolveVacancyLinkByToken } from '../../../../lib/public-vacancy-link';
import { apiError, localeFromRequest, ERR } from '../../../../lib/api-error';
import { t } from '../../../../lib/i18n';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

export async function GET(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`public-vacancy-link:${ip}`, 60, 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const { searchParams } = new URL(request.url);
  const token = String(searchParams.get('token') || '').trim();
  const email = searchParams.get('email');
  const result = await resolveVacancyLinkByToken(token, { email });

  if (!result.ok) {
    if (result.errorCode === 'DUPLICATE_VACANCY_SUBMISSION') {
      const locale = localeFromRequest(request);
      return NextResponse.json(
        {
          errorCode: ERR.DUPLICATE_VACANCY_SUBMISSION,
          error: t(locale, 'errors.DUPLICATE_VACANCY_SUBMISSION'),
          alreadySubmitted: true,
        },
        { status: 409 }
      );
    }
    const status = result.errorCode === 'INVALID_TOKEN' ? 400 : 404;
    return apiError(request, result.errorCode, status);
  }

  const { vacancyId: _v, companyId: _c, ...publicVacancy } = result.vacancy;
  return NextResponse.json(publicVacancy, {
    headers: {
      'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
