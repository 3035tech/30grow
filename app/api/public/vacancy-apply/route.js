import { NextResponse } from 'next/server';
import { applyToPublicVacancy } from '../../../../lib/public-vacancy-apply';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

/**
 * POST /api/public/vacancy-apply
 * Soft apply from /jobs/… (name, email, consent). Does not start assessment.
 * Body: { vacancyId, fullName, email, consent, phone? }
 */
export async function POST(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`vacancy-apply:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const body = await request.json().catch(() => ({}));
  const result = await applyToPublicVacancy({
    vacancyId: body.vacancyId,
    fullName: body.fullName ?? body.name,
    email: body.email,
    consent: Boolean(body.consent),
    phone: body.phone,
  });

  if (!result.ok) {
    return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
  }

  return NextResponse.json(
    {
      ok: true,
      alreadyLinked: result.alreadyLinked,
      vacancyId: result.vacancyId,
    },
    { status: result.alreadyLinked ? 200 : 201 }
  );
}
