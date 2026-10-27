/**
 * GET  /api/employee/feedback — inbox + requested
 * POST /api/employee/feedback — create request
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit.js';
import {
  createFeedbackRequest,
  listFeedbackInbox,
  listFeedbackForSubject,
} from '../../../../lib/people/continuous-feedback.js';
import { notifyCandidate, EMPLOYEE_NOTIF } from '../../../../lib/employee/employee-notifications.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const inbox = await listFeedbackInbox(null, {
      companyId: session.companyId,
      toCandidateId: session.candidateId,
      status: 'pending',
    });
    const aboutMe = await listFeedbackForSubject(null, {
      companyId: session.companyId,
      subjectCandidateId: session.candidateId,
      limit: 20,
    });
    if (!inbox.ok || !aboutMe.ok) {
      return apiErrorFromResult(request, inbox.ok ? aboutMe : inbox);
    }
    return NextResponse.json({
      inbox: inbox.items,
      aboutMe: aboutMe.items,
    });
  } catch (err) {
    console.error('GET /api/employee/feedback', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `emp-feedback:${session.candidateId}:${ip}`,
      20,
      60 * 60 * 1000
    );
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
    const result = await createFeedbackRequest(null, {
      companyId: session.companyId,
      fromCandidateId: session.candidateId,
      toCandidateId: body.toCandidateId,
      subjectCandidateId: body.subjectCandidateId || session.candidateId,
      prompt: body.prompt,
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    try {
      await notifyCandidate({
        companyId: session.companyId,
        candidateId: Number(body.toCandidateId),
        type: EMPLOYEE_NOTIF.FEEDBACK_REQUESTED,
        payload: {
          requestId: result.request.id,
          publicPath: result.request.publicPath,
        },
      });
    } catch {
      /* best-effort */
    }

    return NextResponse.json({ request: result.request });
  } catch (err) {
    console.error('POST /api/employee/feedback', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
