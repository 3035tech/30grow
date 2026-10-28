import { NextResponse } from 'next/server';
import { applyToPublicVacancy } from '../../../../lib/public-vacancy-apply';
import { apiError, apiErrorFromResult, ERR, localeFromRequest } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';
import { CV_PDF_MAX_BYTES } from '../../../../lib/recruiting/candidate-cv';

/**
 * POST /api/public/vacancy-apply
 * Soft apply from /jobs/… (name, email, consent). Does not start assessment.
 * Body: multipart form for the public page, or legacy JSON for existing consumers.
 */
export async function POST(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`vacancy-apply:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const multipart = request.headers.get('content-type')?.includes('multipart/form-data');
  let body;
  let cvFile = null;
  if (multipart) {
    const form = await request.formData().catch(() => null);
    if (!form) return apiError(request, ERR.INVALID_DATA, 400);
    const file = form.get('cv');
    if (!file || typeof file.arrayBuffer !== 'function') return apiError(request, ERR.INVALID_CV_FILE_TYPE, 400);
    if (!file.size || file.size > CV_PDF_MAX_BYTES) return apiError(request, ERR.INVALID_CV_FILE_SIZE, 400);
    cvFile = { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, size: file.size };
    body = Object.fromEntries(form.entries());
  } else {
    body = await request.json().catch(() => ({}));
  }
  const result = await applyToPublicVacancy({
    vacancyId: body.vacancyId,
    fullName: body.fullName ?? body.name,
    email: body.email,
    consent: body.consent === true || body.consent === 'true',
    phone: body.phone,
    linkedinUrl: body.linkedinUrl,
    cvFile,
    locale: localeFromRequest(request),
  });

  if (!result.ok) {
    return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
  }

  return NextResponse.json(
    {
      ok: true,
      alreadyLinked: result.alreadyLinked,
      vacancyId: result.vacancyId,
      confirmationSent: result.confirmationSent,
    },
    { status: result.alreadyLinked ? 200 : 201 }
  );
}
