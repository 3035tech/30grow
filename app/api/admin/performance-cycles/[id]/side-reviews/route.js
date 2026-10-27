/**
 * GET  /api/admin/performance-cycles/[id]/side-reviews?candidateId=X — list side reviews
 * POST /api/admin/performance-cycles/[id]/side-reviews — create self/peer invite
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import {
  getSessionPayload,
  getManagerScope,
  resolveScopedCompanyId,
  CAP,
  requireCapability,
} from '../../../../../../lib/ae/require-admin.js';
import { getPerformanceCycle } from '../../../../../../lib/development/performance-reviews.js';
import {
  createSideReviewInvite,
  listSideReviewsForCandidate,
} from '../../../../../../lib/development/performance-side-reviews.js';
import { audit } from '../../../../../../lib/audit.js';

export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(scope, new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const cycleId = Number(params.id);
    const candidateId = Number(new URL(request.url).searchParams.get('candidateId'));
    if (!Number.isFinite(cycleId) || cycleId <= 0 || !Number.isFinite(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    const cycle = await getPerformanceCycle(null, { companyId, cycleId });
    if (!cycle) return apiError(request, ERR.NOT_FOUND, 404);

    const sideReviews = await listSideReviewsForCandidate(null, { companyId, cycleId, candidateId });
    return NextResponse.json({ sideReviews, cycle });
  } catch (err) {
    console.error('GET performance-cycles side-reviews error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

export async function POST(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const body = await request.json().catch(() => ({}));
    const companyId = resolveScopedCompanyId(scope, body.companyId);
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const cycleId = Number(params.id);
    const candidateId = Number(body.candidateId);
    if (!Number.isFinite(cycleId) || cycleId <= 0 || !Number.isFinite(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    const result = await createSideReviewInvite(null, {
      cycleId,
      companyId,
      candidateId,
      role: body.role,
      reviewerLabel: body.reviewerLabel,
      ttlDays: body.ttlDays,
    });

    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA, fallbackStatus: 400 });
    }

    const origin = new URL(request.url).origin;
    const publicUrl = `${origin}${result.sideReview.publicPath}`;

    await audit({
      action: 'performance_side_review_invite',
      actorUserId: payload.userId,
      companyId,
      targetType: 'performance_side_review',
      targetId: result.sideReview.id,
      metadata: {
        cycleId,
        candidateId,
        role: result.sideReview.role,
      },
    });

    return NextResponse.json(
      { ...result.sideReview, publicUrl, cycleTitle: result.cycleTitle },
      { status: 201 }
    );
  } catch (err) {
    console.error('POST performance-cycles side-reviews error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
