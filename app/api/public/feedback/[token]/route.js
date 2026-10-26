/**
 * GET  /api/public/feedback/[token]
 * POST /api/public/feedback/[token] — answer via link
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit';
import {
  answerFeedbackRequest,
  resolveFeedbackByToken,
} from '../../../../../lib/people/continuous-feedback';

export async function GET(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-fb-get:${ip}`, 90, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }
    const resolved = await resolveFeedbackByToken(query, params?.token);
    if (!resolved.ok) {
      return apiErrorFromResult(request, resolved, {
        fallbackCode: ERR.INVALID_TOKEN,
        fallbackStatus: 404,
      });
    }
    const r = resolved.request;
    return NextResponse.json({
      status: r.status,
      prompt: r.prompt,
      subjectName: r.subjectName,
      fromName: r.fromName,
      expiresAt: r.expiresAt,
      alreadyAnswered: r.status === 'answered',
    });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET public feedback', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-fb-post:${ip}`, 30, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }
    const body = await request.json().catch(() => ({}));
    const result = await answerFeedbackRequest(query, {
      token: params?.token,
      responseText: body.responseText,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, {
        fallbackCode: ERR.INVALID_DATA,
        fallbackStatus: 400,
      });
    }
    return NextResponse.json({ ok: true, answeredAt: result.answeredAt });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST public feedback', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
