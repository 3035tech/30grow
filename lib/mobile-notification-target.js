import { EMPLOYEE_NOTIF } from './employee/employee-notification-catalog.js';
import { DP_DOCUMENT_KEYS } from './domain-status.js';

export const MOBILE_NOTIFICATION_TARGET = Object.freeze({ COURSE: 'course', ENROLLMENT: 'enrollment', PLAN: 'plan', OKR: 'okr', FEEDBACK: 'feedback', LEAVE: 'leave', DOCUMENT: 'document', KUDO: 'kudo', INVITE: 'invite' });
const ENTITY = Object.freeze({ COURSE: 'lms_course', ENROLLMENT: 'lms_enrollment', PLAN: 'development_plan', OKR: 'okr_activity', KUDO: 'company_kudo', INVITE: 'ae_invite' });
function reference(kind, value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,17}$/.test(id)) return null;
  if (kind !== MOBILE_NOTIFICATION_TARGET.INVITE && !Number.isSafeInteger(Number(id))) return null;
  return { kind, id };
}
// A navigation hint only; destination services authorize the resource independently.
export function mobileNotificationTarget(item) {
  const p = item.payload || {};
  const entity = (type) => item.entityType === type ? item.entityId : null;
  switch (item.type) {
    case EMPLOYEE_NOTIF.LMS_ENROLLED: return reference(MOBILE_NOTIFICATION_TARGET.COURSE, entity(ENTITY.COURSE) ?? p.courseId);
    case EMPLOYEE_NOTIF.LMS_OVERDUE: return entity(ENTITY.ENROLLMENT) ? reference(MOBILE_NOTIFICATION_TARGET.ENROLLMENT, item.entityId) : reference(MOBILE_NOTIFICATION_TARGET.COURSE, p.courseId);
    case EMPLOYEE_NOTIF.PDI_UPDATED: return reference(MOBILE_NOTIFICATION_TARGET.PLAN, entity(ENTITY.PLAN) ?? p.planId);
    case EMPLOYEE_NOTIF.OKR_ACTIVITY_ASSIGNED: return reference(MOBILE_NOTIFICATION_TARGET.OKR, entity(ENTITY.OKR));
    case EMPLOYEE_NOTIF.FEEDBACK_REQUESTED: return reference(MOBILE_NOTIFICATION_TARGET.FEEDBACK, p.requestId);
    case EMPLOYEE_NOTIF.DP_LEAVE_UPDATE: return reference(MOBILE_NOTIFICATION_TARGET.LEAVE, p.leaveId);
    case EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED:
    case EMPLOYEE_NOTIF.DP_DOC_REMINDER: return DP_DOCUMENT_KEYS.includes(p.docKey) ? { kind: MOBILE_NOTIFICATION_TARGET.DOCUMENT, id: p.docKey } : null;
    case EMPLOYEE_NOTIF.KUDOS_RECEIVED: return reference(MOBILE_NOTIFICATION_TARGET.KUDO, entity(ENTITY.KUDO));
    case EMPLOYEE_NOTIF.MOTIVATORS_INVITE: return reference(MOBILE_NOTIFICATION_TARGET.INVITE, entity(ENTITY.INVITE) ?? p.inviteId);
    default: return null;
  }
}
