import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { mobileReviewDetail, mobileReviewList } from '../../../../../../lib/mobile/mobile-employee-payload.js';
import { getSentFormalReviewForEmployee, listSentFormalReviewsForEmployee } from '../../../../../../lib/people/formal-competency-reviews.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store, private' });

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const reviewId = new URL(request.url).searchParams.get('id');
    if (reviewId) {
      const result = await getSentFormalReviewForEmployee(null, { companyId: session.companyId, candidateId: session.candidateId, reviewId });
      if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
      return NextResponse.json({ review: mobileReviewDetail(result.review) }, { headers: NO_STORE });
    }
    const reviews = await listSentFormalReviewsForEmployee(null, { companyId: session.companyId, candidateId: session.candidateId });
    return NextResponse.json({ reviews: mobileReviewList(reviews) }, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee reviews', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
