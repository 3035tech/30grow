/**
 * GET  /api/admin/feedback — list for subject
 * POST /api/admin/feedback — create request (manager on behalf / from employee id)
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { audit, auditRequestContext } from '../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import {
  createFeedbackRequest,
  listFeedbackForSubject,
} from '../../../../lib/people/continuous-feedback.js';
import { notifyCandidate, EMPLOYEE_NOTIF } from '../../../../lib/employee/employee-notifications.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  subjectCandidateId: zPositiveInt,
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  fromCandidateId: zPositiveInt,
  toCandidateId: zPositiveInt,
  subjectCandidateId: zPositiveInt.optional(),
  prompt: z.string().max(500).optional(),
});

export const GET = withAdminApi(
  {
    cap: CAP.TEAM_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'feedback GET',
  },
  async ({ request, companyId, query }) => {
    const result = await listFeedbackForSubject(null, {
      companyId,
      subjectCandidateId: query.subjectCandidateId,
      limit: query.limit,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  {
    cap: CAP.TEAM_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'feedback POST',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await createFeedbackRequest(null, {
      companyId,
      fromCandidateId: body.fromCandidateId,
      toCandidateId: body.toCandidateId,
      subjectCandidateId: body.subjectCandidateId || body.fromCandidateId,
      prompt: body.prompt,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    try {
      await notifyCandidate({
        companyId,
        candidateId: body.toCandidateId,
        type: EMPLOYEE_NOTIF.FEEDBACK_REQUESTED,
        payload: {
          requestId: result.request.id,
          publicPath: result.request.publicPath,
        },
      });
    } catch {
      /* best-effort */
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'feedback.request_create',
      companyId,
      targetType: 'feedback_request',
      targetId: result.request.id,
      metadata: {
        toCandidateId: body.toCandidateId,
        subjectCandidateId: body.subjectCandidateId || body.fromCandidateId,
      },
      ...auditRequestContext(request),
    });
    return NextResponse.json({ request: result.request });
  }
);
