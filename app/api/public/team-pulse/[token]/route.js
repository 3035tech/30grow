import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit';
import {
  getPublicTeamPulseByToken,
  submitPublicTeamPulse,
} from '../../../../../lib/people/team-pulses';

/** GET /api/public/team-pulse/[token] */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-team-pulse-get:${ip}`, 90, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const token = params?.token;
    if (!token) return apiError(request, ERR.NOT_FOUND, httpStatusForError(ERR.NOT_FOUND));
    const loaded = await getPublicTeamPulseByToken(query, token);
    if (!loaded.ok) {
      return apiErrorFromResult(request, loaded, {
        fallbackCode: ERR.NOT_FOUND,
        fallbackStatus: 404,
      });
    }
    return NextResponse.json({
      title: loaded.pulse.title,
      questions: loaded.pulse.questions,
    });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET public team-pulse', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/public/team-pulse/[token] */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-team-pulse:${ip}`, 40, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const token = params?.token;
    if (!token) return apiError(request, ERR.NOT_FOUND, httpStatusForError(ERR.NOT_FOUND));
    const body = await request.json().catch(() => ({}));
    const submitted = await submitPublicTeamPulse(query, {
      token,
      answers: body.answers,
    });
    if (!submitted.ok) {
      return apiErrorFromResult(request, submitted, {
        fallbackCode: ERR.INVALID_DATA,
        fallbackStatus: 400,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST public team-pulse', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
