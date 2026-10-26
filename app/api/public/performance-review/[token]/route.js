import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit';
import {
  getSideReviewByToken,
  submitSideReviewByToken,
} from '../../../../../lib/development/performance-side-reviews.js';

/** GET /api/public/performance-review/[token] — side review form (goals + meta). */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-side-review-get:${ip}`, 90, 10 * 60 * 1000);
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
    const resolved = await getSideReviewByToken(query, token);
    if (!resolved.ok) {
      return apiErrorFromResult(request, resolved, {
        fallbackCode: ERR.INVITE_NOT_FOUND,
        fallbackStatus: 404,
      });
    }

    return NextResponse.json({
      cycleTitle: resolved.cycleTitle,
      candidateName: resolved.candidateName,
      role: resolved.sideReview.role,
      reviewerLabel: resolved.sideReview.reviewerLabel,
      goals: (resolved.goals || []).map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        weight: g.weight,
      })),
    });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET public performance-review', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/public/performance-review/[token] — submit side review. */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-side-review:${ip}`, 40, 10 * 60 * 1000);
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
    const result = await submitSideReviewByToken(query, {
      token,
      outcomes: body.outcomes,
      overallNotes: body.overallNotes,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, {
        fallbackCode: ERR.INVALID_DATA,
        fallbackStatus: 404,
      });
    }
    return NextResponse.json({ ok: true, submittedAt: result.sideReview.submittedAt });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST public performance-review', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
