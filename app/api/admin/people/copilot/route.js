/**
 * POST /api/admin/people/copilot — B-3011 people copilot.
 * Body: { question: 'radar' | 'person', candidateId? (person), explain?, locale? }.
 * Company always comes from the session (admin may pass companyId); typed server tools only.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../lib/api-error.js';
import { audit, auditRequestContext } from '../../../../../lib/audit.js';
import { queryRead } from '../../../../../lib/db.js';
import { normalizeLocale } from '../../../../../lib/i18n.js';
import { CAP } from '../../../../../lib/permissions.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit.js';
import {
  COPILOT_QUESTION,
  COPILOT_QUESTIONS,
  buildCopilotPerson,
  buildCopilotRadar,
  copilotAuditMetadata,
  draftCopilotAgendas,
} from '../../../../../lib/people/people-copilot.js';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60 * 1000;

const bodySchema = z.object({
  question: z.enum(/** @type {[string, ...string[]]} */ (COPILOT_QUESTIONS)),
  candidateId: z.coerce.number().int().positive().optional(),
  explain: z.boolean().optional(),
  locale: z.string().trim().max(10).optional(),
  companyId: z.coerce.number().int().positive().optional(),
});

export const POST = withAdminApi(
  {
    cap: CAP.OVERVIEW_VIEW,
    body: bodySchema,
    requireCompany: true,
    companyFrom: 'body',
    logLabel: 'people-copilot',
  },
  async ({ request, payload, companyId, body }) => {
    const rl = await checkRateLimit(`people-copilot:${payload.userId || clientIpFromRequest(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (rl && !rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }
    if (body.question === COPILOT_QUESTION.PERSON && !body.candidateId) {
      return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
    }

    const result = body.question === COPILOT_QUESTION.PERSON
      ? await buildCopilotPerson(queryRead, { companyId, candidateId: body.candidateId })
      : await buildCopilotRadar(queryRead, { companyId });
    if (!result.ok) return apiErrorFromResult(request, result);

    const ai = body.explain === true
      ? await draftCopilotAgendas({
        people: result.people,
        locale: normalizeLocale(body.locale || payload?.locale || 'pt-BR'),
        usage: { companyId, userId: payload.userId ?? null },
      })
      : null;

    await audit({
      actorUserId: payload.userId ?? null,
      companyId,
      action: 'people.copilot_query',
      targetType: body.question === COPILOT_QUESTION.PERSON ? 'candidate' : 'company',
      targetId: body.question === COPILOT_QUESTION.PERSON ? body.candidateId : companyId,
      metadata: copilotAuditMetadata(result, { explain: body.explain, aiOk: Boolean(ai) }),
      ...auditRequestContext(request),
    });

    return NextResponse.json({
      ok: true,
      question: result.question,
      people: result.people,
      tools: result.tools,
      staleDays: result.staleDays,
      ai,
    });
  }
);
