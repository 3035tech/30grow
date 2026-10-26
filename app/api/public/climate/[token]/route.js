import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit';
import {
  resolveClimateInviteByToken,
  submitClimateResponse,
} from '../../../../../lib/people/climate-surveys';
import { CLIMATE_QUESTION_KIND } from '../../../../../lib/domain-status';

/** GET /api/public/climate/[token] — anonymous survey form (no PII). */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-climate-get:${ip}`, 90, 10 * 60 * 1000);
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
    const resolved = await resolveClimateInviteByToken(query, token);
    if (!resolved.ok) {
      return apiErrorFromResult(request, resolved, {
        fallbackCode: ERR.INVALID_TOKEN,
        fallbackStatus: 404,
      });
    }
    return NextResponse.json({
      title: resolved.title,
      description: resolved.description,
      questions: resolved.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        scaleMin: q.scaleMin,
        scaleMax: q.scaleMax,
        questionKind: q.questionKind || CLIMATE_QUESTION_KIND.LIKERT,
      })),
    });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET public climate', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/public/climate/[token] — submit anonymous answers. */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-climate:${ip}`, 40, 10 * 60 * 1000);
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
    const body = await request.json().catch(() => ({}));
    const result = await submitClimateResponse(query, {
      token,
      answers: body.answers,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, {
        fallbackCode: ERR.INVALID_DATA,
        fallbackStatus: 404,
      });
    }
    return NextResponse.json({ ok: true, submittedAt: result.submittedAt });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST public climate', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
