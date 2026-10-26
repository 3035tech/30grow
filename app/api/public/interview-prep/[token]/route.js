import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit.js';
import {
  markInterviewPrepPrepared,
  resolveInterviewPrepByToken,
} from '../../../../../lib/recruiting/interview-prep.js';
import { normalizeLocale } from '../../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

/** GET /api/public/interview-prep/[token] */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const token = params?.token || '';
    const url = new URL(request.url);
    const locale = normalizeLocale(url.searchParams.get('locale'));
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`prep-get:${ip}`, 60, 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }
    const result = await resolveInterviewPrepByToken(null, { token, locale });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_TOKEN });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/public/interview-prep/[token]', err);
    return apiError(request, ERR.INTERNAL, httpStatusForError(ERR.INTERNAL));
  }
}

/** POST /api/public/interview-prep/[token] — mark prepared */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const token = params?.token || '';
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`prep-post:${ip}`, 20, 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }
    const result = await markInterviewPrepPrepared(null, { token });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_TOKEN });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('POST /api/public/interview-prep/[token]', err);
    return apiError(request, ERR.INTERNAL, httpStatusForError(ERR.INTERNAL));
  }
}
