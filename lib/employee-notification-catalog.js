/**
 * Collaborator notification catalog (in-app /employee).
 * Separate from manager NOTIF — hrefs point to /employee, not /dashboard.
 */

import { TIME_REQUEST_STATUS } from './domain-status.js';

export const EMPLOYEE_NOTIF = Object.freeze({
  LMS_ENROLLED: 'lms_enrolled',
  LMS_OVERDUE: 'lms_overdue',
  MOTIVATORS_INVITE: 'motivators_invite',
  PDI_UPDATED: 'pdi_updated',
  ACCESS_INVITED: 'access_invited',
  DP_LEAVE_UPDATE: 'dp_leave_update',
  DP_DOC_REMINDER: 'dp_doc_reminder',
  DP_SIGNATURE_REQUESTED: 'dp_signature_requested',
  KUDOS_RECEIVED: 'kudos_received',
  FEEDBACK_REQUESTED: 'feedback_requested',
  OKR_ACTIVITY_ASSIGNED: 'okr_activity_assigned',
  TIME_REQUEST_DECIDED: 'time_request_decided',
  GENERIC: 'generic',
});

export const EMPLOYEE_NOTIF_TYPES = new Set(Object.values(EMPLOYEE_NOTIF));

/**
 * @returns {{ titleKey: string, bodyKey: string, values: object }}
 */
export function employeeNotificationCopySpec(type, payload = {}) {
  const p = payload || {};
  switch (type) {
    case EMPLOYEE_NOTIF.LMS_ENROLLED:
      return {
        titleKey: 'employeeHome.notifLmsEnrolledTitle',
        bodyKey: 'employeeHome.notifLmsEnrolledBody',
        values: { title: p.courseTitle || '—' },
      };
    case EMPLOYEE_NOTIF.LMS_OVERDUE:
      return {
        titleKey: 'employeeHome.notifLmsOverdueTitle',
        bodyKey: 'employeeHome.notifLmsOverdueBody',
        values: { title: p.courseTitle || '—', date: p.dueDate || '—' },
      };
    case EMPLOYEE_NOTIF.MOTIVATORS_INVITE:
      return {
        titleKey: 'employeeHome.notifMotivatorsTitle',
        bodyKey: 'employeeHome.notifMotivatorsBody',
        values: {},
      };
    case EMPLOYEE_NOTIF.PDI_UPDATED:
      return {
        titleKey: 'employeeHome.notifPdiTitle',
        bodyKey: 'employeeHome.notifPdiBody',
        values: { title: p.planTitle || p.itemTitle || '—' },
      };
    case EMPLOYEE_NOTIF.ACCESS_INVITED:
      return {
        titleKey: 'employeeHome.notifAccessTitle',
        bodyKey: 'employeeHome.notifAccessBody',
        values: {},
      };
    case EMPLOYEE_NOTIF.DP_LEAVE_UPDATE:
      return {
        titleKey: 'employeeHome.notifDpLeaveTitle',
        bodyKey: 'employeeHome.notifDpLeaveBody',
        values: { status: p.status || '—' },
      };
    case EMPLOYEE_NOTIF.DP_DOC_REMINDER:
      return {
        titleKey: 'employeeHome.notifDpDocTitle',
        bodyKey: 'employeeHome.notifDpDocBody',
        values: {},
      };
    case EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED:
      return {
        titleKey: 'employeeHome.notifDpSignatureTitle',
        bodyKey: 'employeeHome.notifDpSignatureBody',
        values: { doc: p.docKey || '—' },
      };
    case EMPLOYEE_NOTIF.KUDOS_RECEIVED:
      return {
        titleKey: 'employeeHome.notifKudosTitle',
        bodyKey: 'employeeHome.notifKudosBody',
        values: { fromName: p.fromName || '—', message: p.message || '—' },
      };
    case EMPLOYEE_NOTIF.FEEDBACK_REQUESTED:
      return {
        titleKey: 'employeeHome.notifFeedbackTitle',
        bodyKey: 'employeeHome.notifFeedbackBody',
        values: {},
      };
    case EMPLOYEE_NOTIF.OKR_ACTIVITY_ASSIGNED:
      return {
        titleKey: 'employeeHome.notifOkrAssignedTitle',
        bodyKey: 'employeeHome.notifOkrAssignedBody',
        values: {
          title: p.activityTitle || '—',
          cycle: p.cycleTitle || '—',
          deadline: p.deadline || '—',
        },
      };
    case EMPLOYEE_NOTIF.TIME_REQUEST_DECIDED:
      return {
        titleKey: p.status === TIME_REQUEST_STATUS.APPROVED
          ? 'employeeHome.notifTimeRequestApprovedTitle'
          : 'employeeHome.notifTimeRequestRejectedTitle',
        bodyKey: 'employeeHome.notifTimeRequestBody',
        values: { day: p.day || '—' },
      };
    default:
      return {
        titleKey: 'employeeHome.notifGenericTitle',
        bodyKey: 'employeeHome.notifGenericBody',
        values: { message: p.message || '—' },
      };
  }
}

export function employeeNotificationHref(type, payload = {}) {
  if (type === EMPLOYEE_NOTIF.MOTIVATORS_INVITE && payload.assessmentUrl) {
    return String(payload.assessmentUrl);
  }
  if (type === EMPLOYEE_NOTIF.LMS_ENROLLED || type === EMPLOYEE_NOTIF.LMS_OVERDUE) {
    return '/employee/lms';
  }
  if (type === EMPLOYEE_NOTIF.PDI_UPDATED) return '/employee#pdi';
  if (type === EMPLOYEE_NOTIF.MOTIVATORS_INVITE) return '/employee#tasks';
  if (type === EMPLOYEE_NOTIF.DP_LEAVE_UPDATE || type === EMPLOYEE_NOTIF.DP_DOC_REMINDER) {
    return '/employee/dp';
  }
  if (type === EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED) return '/employee/dp';
  if (type === EMPLOYEE_NOTIF.KUDOS_RECEIVED) return '/employee#kudos';
  if (type === EMPLOYEE_NOTIF.FEEDBACK_REQUESTED) return '/employee#feedback';
  if (type === EMPLOYEE_NOTIF.OKR_ACTIVITY_ASSIGNED) return '/employee#okr';
  if (type === EMPLOYEE_NOTIF.TIME_REQUEST_DECIDED) return '/employee/time-clock';
  return '/employee';
}
