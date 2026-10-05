/**
 * POST /api/employee/time-clock/requests — punch adjustment or excuse request (pending approval).
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { query } from '../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee-session.js';
import { checkRateLimit } from '../../../../../lib/rate-limit.js';
import { AUDIT_ACTOR_KIND, auditFromRequest } from '../../../../../lib/audit.js';
import { notifyCompanyManagers } from '../../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../../lib/manager-notification-catalog.js';
import {
  TIME_PUNCH_KINDS,
  TIME_REQUEST_EXCUSE_REASONS,
  TIME_REQUEST_KINDS,
} from '../../../../../lib/domain-status.js';
import { TIME_ADJUST_MAX_ADD, TIME_ADJUST_MAX_VOID } from '../../../../../lib/people/time-clock-manager.js';
import {
  TIME_REQUEST_JUSTIFICATION_MAX,
  createTimeRequest,
} from '../../../../../lib/people/time-clock-requests.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';

const hm = z.string().regex(/^\d{1,2}:\d{2}$/);

const bodySchema = z.object({
  kind: z.enum(/** @type {[string, ...string[]]} */ (TIME_REQUEST_KINDS)),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  justification: z.string().min(3).max(TIME_REQUEST_JUSTIFICATION_MAX),
  voidPunchIds: z.array(zPositiveInt).max(TIME_ADJUST_MAX_VOID).optional(),
  add: z
    .array(z.object({ time: hm, kind: z.enum(/** @type {[string, ...string[]]} */ (TIME_PUNCH_KINDS)) }))
    .max(TIME_ADJUST_MAX_ADD)
    .optional(),
  excuseReason: z.enum(/** @type {[string, ...string[]]} */ (TIME_REQUEST_EXCUSE_REASONS)).optional().nullable(),
  excuseStart: hm.optional().nullable().or(z.literal('')),
  excuseEnd: hm.optional().nullable().or(z.literal('')),
});

export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { candidateId, companyId } = session;

    const rl = await checkRateLimit(`emp-time-request:${candidateId}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError(request, ERR.INVALID_DATA, 400);
    const body = parsed.data;

    const result = await createTimeRequest({
      companyId,
      candidateId,
      kind: body.kind,
      day: body.day,
      justification: body.justification,
      voidPunchIds: body.voidPunchIds || [],
      add: body.add || [],
      excuseReason: body.excuseReason || null,
      excuseStart: body.excuseStart || null,
      excuseEnd: body.excuseEnd || null,
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    await auditFromRequest(request, {
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
      actorCandidateId: candidateId,
      companyId,
      action: 'time_clock.request_created',
      targetType: 'time_request',
      targetId: result.item.id,
      metadata: { kind: result.item.kind, day: result.item.day, changes: result.item.changes.length },
    });

    try {
      await notifyCompanyManagers(query, {
        companyId,
        type: NOTIF.TIME_REQUEST_SUBMITTED,
        entityType: 'time_request',
        entityId: result.item.id,
        payload: {
          candidateId,
          candidateName: result.item.candidateName,
          requestId: result.item.id,
          kind: result.item.kind,
          day: result.item.day,
        },
      });
    } catch (e) {
      console.error('[time-clock] request notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST /api/employee/time-clock/requests', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
