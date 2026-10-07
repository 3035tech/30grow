/**
 * Field team actions shared by the web portal, the mobile API and the admin routes:
 * body validation, audit and notifications around lib/people/field-team.js.
 */

import { ERR } from '../api-error-codes.js';
import { AUDIT_ACTOR_KIND, audit, auditFromRequest } from '../audit.js';
import { query } from '../db.js';
import { FIELD_EXPENSE_CATEGORIES, TIME_REQUEST_DECISION } from '../domain-status.js';
import { EMPLOYEE_NOTIF, notifyCandidate } from '../employee-notifications.js';
import { mobileIdempotencyKey } from '../mobile-idempotency.js';
import { notifyCompanyManagers } from '../manager-notifications.js';
import { NOTIF } from '../manager-notification-catalog.js';
import { z, zPositiveInt } from '../validate.js';
import { getEmployeeDisplayName } from './employee-dp.js';
import {
  FIELD_EXPENSE_MAX_CENTS,
  FIELD_TEXT,
  cancelFieldExpense,
  cancelFieldVisit,
  createFieldExpense,
  createFieldVisit,
  decideFieldExpense,
  updateEmployeeFieldVisit,
} from './field-team.js';

export const FIELD_WRITE_RATE_LIMIT = 60;
export const FIELD_WRITE_RATE_WINDOW_MS = 60 * 60 * 1000;
export const FIELD_FILE_RATE_LIMIT = 30;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const fieldVisitBodySchema = z.object({
  day: isoDay,
  plannedTime: hm.optional().nullable().or(z.literal('')),
  title: z.string().trim().min(1).max(FIELD_TEXT.TITLE),
  address: z.string().max(FIELD_TEXT.ADDRESS).optional().nullable(),
  notes: z.string().max(FIELD_TEXT.NOTES).optional().nullable(),
});

const visitActionSchema = z.object({
  action: z.enum(['check_in', 'complete']),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().min(0).optional().nullable(),
  note: z.string().max(FIELD_TEXT.NOTES).optional().nullable(),
});

const expenseBodySchema = z.object({
  day: isoDay,
  category: z.enum(/** @type {[string, ...string[]]} */ (FIELD_EXPENSE_CATEGORIES)),
  amountCents: z.number().int().positive().max(FIELD_EXPENSE_MAX_CENTS),
  description: z.string().trim().min(3).max(FIELD_TEXT.DESCRIPTION),
  visitId: zPositiveInt.optional().nullable(),
});

export const fieldDecisionBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  decision: z.enum(/** @type {[string, ...string[]]} */ (Object.values(TIME_REQUEST_DECISION))),
  note: z.string().max(FIELD_TEXT.DECISION).optional().nullable(),
});

/** Collaborator logs an unplanned visit for the day (managers plan the rest). */
export async function submitEmployeeFieldVisit(request, session, rawBody) {
  const parsed = fieldVisitBodySchema.safeParse(rawBody || {});
  if (!parsed.success) return { ok: false, errorCode: ERR.INVALID_DATA };
  const b = parsed.data;
  const result = await createFieldVisit(null, {
    companyId: session.companyId,
    candidateId: session.candidateId,
    day: b.day,
    plannedTime: b.plannedTime || '',
    title: b.title,
    address: b.address || '',
    notes: b.notes || '',
  });
  if (!result.ok) return result;
  await auditFromRequest(request, {
    actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
    actorCandidateId: session.candidateId,
    companyId: session.companyId,
    action: 'field.visit_logged',
    targetType: 'field_visit',
    targetId: result.item.id,
    metadata: { day: result.item.day },
  });
  return result;
}

/** Check-in (with location) or complete an own visit. */
export async function actOnEmployeeFieldVisit(request, session, id, rawBody) {
  const parsed = visitActionSchema.safeParse(rawBody || {});
  if (!parsed.success) return { ok: false, errorCode: ERR.INVALID_DATA };
  const b = parsed.data;
  const result = await updateEmployeeFieldVisit(null, {
    companyId: session.companyId,
    candidateId: session.candidateId,
    id,
    action: b.action,
    latitude: b.latitude,
    longitude: b.longitude,
    accuracy: b.accuracy ?? null,
    note: b.note || '',
  });
  if (!result.ok || result.replayed) return result;
  await auditFromRequest(request, {
    actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
    actorCandidateId: session.candidateId,
    companyId: session.companyId,
    action: b.action === 'check_in' ? 'field.visit_checked_in' : 'field.visit_completed',
    targetType: 'field_visit',
    targetId: result.item.id,
    metadata: { day: result.item.day },
  });
  return result;
}

/** Creates a pending reimbursement, audits it and notifies the company managers. */
export async function submitEmployeeFieldExpense(request, session, rawBody) {
  const parsed = expenseBodySchema.safeParse(rawBody || {});
  if (!parsed.success) return { ok: false, errorCode: ERR.INVALID_DATA };
  const b = parsed.data;
  const { companyId, candidateId } = session;
  const result = await createFieldExpense(null, {
    companyId,
    candidateId,
    day: b.day,
    category: b.category,
    amountCents: b.amountCents,
    description: b.description,
    visitId: b.visitId ?? null,
    idempotencyKey: mobileIdempotencyKey(request),
  });
  if (!result.ok || result.replayed) return result;

  await auditFromRequest(request, {
    actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
    actorCandidateId: candidateId,
    companyId,
    action: 'field.expense_created',
    targetType: 'field_expense',
    targetId: result.item.id,
    metadata: { category: result.item.category, amountCents: result.item.amountCents, day: result.item.day },
  });
  try {
    await notifyCompanyManagers(query, {
      companyId,
      type: NOTIF.FIELD_EXPENSE_SUBMITTED,
      entityType: 'field_expense',
      entityId: result.item.id,
      payload: {
        candidateId,
        candidateName: result.item.candidateName || (await getEmployeeDisplayName({ query }, { companyId, candidateId })),
        expenseId: result.item.id,
        day: result.item.day,
      },
    });
  } catch (e) {
    console.error('[field] expense notif', e?.message || e);
  }
  return result;
}

export async function withdrawEmployeeFieldExpense(request, session, id) {
  const result = await cancelFieldExpense({ companyId: session.companyId, candidateId: session.candidateId, id });
  if (!result.ok) return result;
  await auditFromRequest(request, {
    actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
    actorCandidateId: session.candidateId,
    companyId: session.companyId,
    action: 'field.expense_cancelled',
    targetType: 'field_expense',
    targetId: Number(id),
  });
  return result;
}

/** Manager plans a visit; the collaborator gets one notification per planned day. */
export async function planFieldVisit({ companyId, userId, candidateId, body }) {
  const result = await createFieldVisit(null, {
    companyId,
    candidateId,
    day: body.day,
    plannedTime: body.plannedTime || '',
    title: body.title,
    address: body.address || '',
    notes: body.notes || '',
    createdByUserId: userId,
  });
  if (!result.ok) return result;
  await audit({
    actorUserId: userId,
    action: 'field.visit_planned',
    companyId,
    targetType: 'field_visit',
    targetId: result.item.id,
    metadata: { candidateId: Number(candidateId), day: result.item.day },
  });
  try {
    await notifyCandidate({
      companyId,
      candidateId: Number(candidateId),
      type: EMPLOYEE_NOTIF.FIELD_VISITS_ASSIGNED,
      entityType: 'field_visit',
      entityId: result.item.id,
      payload: { day: result.item.day },
      dedupeKey: `field_visits:${Number(candidateId)}:${result.item.day}`,
    });
  } catch (e) {
    console.error('[field] visit notif', e?.message || e);
  }
  return result;
}

export async function cancelPlannedFieldVisit({ companyId, userId, id }) {
  const result = await cancelFieldVisit(null, { companyId, id });
  if (!result.ok) return result;
  await audit({
    actorUserId: userId,
    action: 'field.visit_cancelled',
    companyId,
    targetType: 'field_visit',
    targetId: result.id,
    metadata: { candidateId: result.candidateId },
  });
  return result;
}

export async function decideFieldExpenseWithNotice({ companyId, userId, id, decision, note }) {
  const result = await decideFieldExpense(null, { companyId, id, decision, note: note || '', userId });
  if (!result.ok) return result;
  await audit({
    actorUserId: userId,
    action: `field.expense_${result.status}`,
    companyId,
    targetType: 'field_expense',
    targetId: result.id,
    metadata: { candidateId: result.candidateId, amountCents: result.amountCents, category: result.category },
  });
  try {
    await notifyCandidate({
      companyId,
      candidateId: result.candidateId,
      type: EMPLOYEE_NOTIF.FIELD_EXPENSE_DECIDED,
      entityType: 'field_expense',
      entityId: result.id,
      payload: { expenseId: result.id, status: result.status, day: result.day },
    });
  } catch (e) {
    console.error('[field] expense decide notif', e?.message || e);
  }
  return result;
}
