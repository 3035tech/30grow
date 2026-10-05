/**
 * Collaborator time-request actions shared by the web portal and the mobile API:
 * body validation, create/cancel, audit and manager notification.
 */

import { ERR } from '../api-error-codes.js';
import { AUDIT_ACTOR_KIND, auditFromRequest } from '../audit.js';
import { query } from '../db.js';
import { TIME_PUNCH_KINDS, TIME_REQUEST_EXCUSE_REASONS, TIME_REQUEST_KINDS } from '../domain-status.js';
import { notifyCompanyManagers } from '../manager-notifications.js';
import { NOTIF } from '../manager-notification-catalog.js';
import { z, zPositiveInt } from '../validate.js';
import { TIME_ADJUST_MAX_ADD, TIME_ADJUST_MAX_VOID } from './time-clock-manager.js';
import { TIME_REQUEST_JUSTIFICATION_MAX, cancelTimeRequest, createTimeRequest } from './time-clock-requests.js';

export const TIME_REQUEST_RATE_LIMIT = 20;
export const TIME_REQUEST_RATE_WINDOW_MS = 60 * 60 * 1000;
export const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const hm = z.string().regex(/^\d{1,2}:\d{2}$/);

const timeRequestBodySchema = z.object({
  kind: z.enum(/** @type {[string, ...string[]]} */ (TIME_REQUEST_KINDS)),
  day: z.string().regex(ISO_DAY_PATTERN),
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

/** Validates, creates, audits and notifies managers. `session` = { companyId, candidateId }. */
export async function submitEmployeeTimeRequest(request, session, rawBody) {
  const parsed = timeRequestBodySchema.safeParse(rawBody || {});
  if (!parsed.success) return { ok: false, errorCode: ERR.INVALID_DATA };
  const body = parsed.data;
  const { companyId, candidateId } = session;

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
  if (!result.ok) return result;

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

  return result;
}

/** Withdraws an own pending request and audits it. */
export async function withdrawEmployeeTimeRequest(request, session, id) {
  const result = await cancelTimeRequest({ companyId: session.companyId, candidateId: session.candidateId, id });
  if (!result.ok) return result;
  await auditFromRequest(request, {
    actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
    actorCandidateId: session.candidateId,
    companyId: session.companyId,
    action: 'time_clock.request_cancelled',
    targetType: 'time_request',
    targetId: Number(id),
  });
  return result;
}
