import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit.js';
import {
  FORMAL_LIKERT_MAX,
  FORMAL_LIKERT_MIN,
} from '../../../../../lib/domain-status.js';
import {
  resolveFormalRaterByToken,
  submitFormalRaterByToken,
} from '../../../../../lib/people/formal-competency-reviews.js';

/** GET /api/public/formal-review/[token] */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-formal-review-get:${ip}`, 90, 10 * 60 * 1000);
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
    const resolved = await resolveFormalRaterByToken(query, token);
    if (!resolved.ok) {
      return apiErrorFromResult(request, resolved, {
        fallbackCode: ERR.INVALID_TOKEN,
        fallbackStatus: 404,
      });
    }
    return NextResponse.json({
      ok: true,
      role: resolved.role,
      cycleTitle: resolved.cycleTitle,
      model: resolved.model,
      subjectName: resolved.subjectName,
      scaleMin: FORMAL_LIKERT_MIN,
      scaleMax: FORMAL_LIKERT_MAX,
      items: resolved.items,
      instructions: resolved.instructions,
      responseScale: resolved.responseScale,
      openQuestions: resolved.openQuestions,
    });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET public formal-review', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/public/formal-review/[token] */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-formal-review:${ip}`, 40, 10 * 60 * 1000);
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
    const result = await withTransaction(db => submitFormalRaterByToken(db, {
      token,
      scores: body.scores,
      overallNotes: body.overallNotes,
      openAnswers: body.openAnswers,
    }));
    if (!result.ok) {
      return apiErrorFromResult(request, result, {
        fallbackCode: ERR.INVALID_DATA,
        fallbackStatus: 400,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST public formal-review', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
