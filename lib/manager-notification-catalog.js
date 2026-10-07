/**
 * Catálogo de tipos de notificação (sem I/O).
 * Seguro para UI cliente e para o fan-out em lib/manager-notifications.js.
 */

export const NOTIF = {
  ENNEAGRAM_COMPLETED: 'enneagram_completed',
  MOTIVATORS_COMPLETED: 'motivators_completed',
  RETENTION_WATCH: 'retention_watch',
  TURNOVER_RISK_CHANGE: 'turnover_risk_change',
  HIRE_ONBOARDING_KIT: 'hire_onboarding_kit',
  MANAGER_WEEKLY_DIGEST: 'manager_weekly_digest',
  VACANCY_DEADLINE_APPROACHING: 'vacancy_deadline_approaching',
  VACANCY_CLOSED: 'vacancy_closed',
  LMS_ENROLLED: 'lms_enrolled',
  LMS_OVERDUE: 'lms_overdue',
  LMS_COMPLETED: 'lms_completed',
  INTERVIEW_SCHEDULED: 'interview_scheduled',
  DP_LEAVE_REQUESTED: 'dp_leave_requested',
  DP_LEAVE_CANCELLED: 'dp_leave_cancelled',
  DP_LEAVE_FILE: 'dp_leave_file',
  DP_DOC_UPLOADED: 'dp_doc_uploaded',
  DP_DOCS_PENDING: 'dp_docs_pending',
  DP_DOC_SIGNED: 'dp_doc_signed',
  TIME_REQUEST_SUBMITTED: 'time_request_submitted',
  TIME_MIRROR_DISPUTED: 'time_mirror_disputed',
  FIELD_EXPENSE_SUBMITTED: 'field_expense_submitted',
};

export const NOTIF_TYPES = new Set(Object.values(NOTIF));

/** @deprecated */
export const NOTIF_ENNEAGRAM = NOTIF.ENNEAGRAM_COMPLETED;
/** @deprecated */
export const NOTIF_MOTIVATORS = NOTIF.MOTIVATORS_COMPLETED;

/**
 * @param {string} type
 * @param {Record<string, unknown>} payload
 */
export function notificationHref(type, payload = {}) {
  if (type === NOTIF.MOTIVATORS_COMPLETED && payload.attemptId) {
    return `/dashboard?tab=motivators&motivatorsView=results&attempt=${encodeURIComponent(payload.attemptId)}`;
  }
  if (
    (type === NOTIF.ENNEAGRAM_COMPLETED
      || type === NOTIF.RETENTION_WATCH
      || type === NOTIF.TURNOVER_RISK_CHANGE
      || type === NOTIF.HIRE_ONBOARDING_KIT)
    && payload.candidateId
  ) {
    return `/dashboard?tab=team&candidate=${encodeURIComponent(payload.candidateId)}`;
  }
  if (type === NOTIF.MANAGER_WEEKLY_DIGEST) {
    return '/dashboard?tab=overview';
  }
  if (
    (type === NOTIF.VACANCY_DEADLINE_APPROACHING || type === NOTIF.VACANCY_CLOSED)
    && payload.vacancyId
  ) {
    return `/dashboard?tab=vacancies&vacancyDetail=${encodeURIComponent(payload.vacancyId)}`;
  }
  if (type === NOTIF.INTERVIEW_SCHEDULED && payload.vacancyId) {
    return `/dashboard?tab=vacancies&vacancyDetail=${encodeURIComponent(payload.vacancyId)}`;
  }
  if (
    (type === NOTIF.LMS_ENROLLED || type === NOTIF.LMS_OVERDUE || type === NOTIF.LMS_COMPLETED)
    && payload.courseId
  ) {
    return `/dashboard?tab=lms&course=${encodeURIComponent(payload.courseId)}`;
  }
  if (
    type === NOTIF.DP_LEAVE_REQUESTED
    || type === NOTIF.DP_LEAVE_CANCELLED
    || type === NOTIF.DP_LEAVE_FILE
  ) {
    return '/dashboard?tab=dp';
  }
  if (type === NOTIF.TIME_REQUEST_SUBMITTED) {
    return '/dashboard?tab=dp&dpSection=time&timeView=requests';
  }
  if (type === NOTIF.FIELD_EXPENSE_SUBMITTED) {
    return '/dashboard?tab=dp&dpSection=field';
  }
  if (type === NOTIF.TIME_MIRROR_DISPUTED) {
    return '/dashboard?tab=dp&dpSection=time&timeView=closing';
  }
  if (
    (type === NOTIF.DP_DOCS_PENDING || type === NOTIF.DP_DOC_UPLOADED || type === NOTIF.DP_DOC_SIGNED)
    && payload.candidateId
  ) {
    return `/dashboard?tab=team&candidate=${encodeURIComponent(payload.candidateId)}&section=dp`;
  }
  if (payload.candidateId) {
    return `/dashboard?tab=team&candidate=${encodeURIComponent(payload.candidateId)}`;
  }
  if (payload.vacancyId) {
    return `/dashboard?tab=vacancies&vacancyDetail=${encodeURIComponent(payload.vacancyId)}`;
  }
  return '/dashboard';
}

/**
 * @returns {{
 *   titleKey: string,
 *   bodyKey: string|null,
 *   values: Record<string, string|number>,
 *   category: 'assessment' | 'vacancy_deadline' | 'vacancy_status' | 'retention' | 'generic',
 *   tone: 'neutral' | 'attention' | 'success',
 * }}
 */
export function notificationCopySpec(type, payload = {}) {
  const name = payload.candidateName || null;
  const title = payload.vacancyTitle || null;
  const date = payload.targetDate || null;
  const dims = payload.signalLabels || payload.dims || null;

  switch (type) {
    case NOTIF.ENNEAGRAM_COMPLETED:
      return {
        titleKey: 'dashboard.notifEnneagramTitle',
        bodyKey: payload.topType ? 'dashboard.notifEnneagramBody' : null,
        values: { name: name || '—', type: payload.topType || '' },
        category: 'assessment',
        tone: 'neutral',
      };
    case NOTIF.MOTIVATORS_COMPLETED:
      return {
        titleKey: 'dashboard.notifMotivatorsTitle',
        bodyKey: 'dashboard.notifMotivatorsBody',
        values: { name: name || '—' },
        category: 'assessment',
        tone: 'neutral',
      };
    case NOTIF.RETENTION_WATCH:
      return {
        titleKey: 'dashboard.notifRetentionTitle',
        bodyKey: 'dashboard.notifRetentionBody',
        values: { name: name || '—', dims: dims || '—' },
        category: 'retention',
        tone: 'attention',
      };
    case NOTIF.TURNOVER_RISK_CHANGE:
      return {
        titleKey: 'dashboard.notifTurnoverRiskChangeTitle',
        bodyKey: 'dashboard.notifTurnoverRiskChangeBody',
        values: {
          name: name || '—',
          from: payload.from || '—',
          to: payload.to || '—',
        },
        category: 'retention',
        tone: 'attention',
      };
    case NOTIF.HIRE_ONBOARDING_KIT:
      return {
        titleKey: 'dashboard.notifHireKitTitle',
        bodyKey: 'dashboard.notifHireKitBody',
        values: {
          name: name || '—',
          title: title || '—',
          benefits: payload.benefitsSnippet || '—',
        },
        category: 'assessment',
        tone: 'success',
      };
    case NOTIF.MANAGER_WEEKLY_DIGEST:
      return {
        titleKey: 'dashboard.notifWeeklyDigestTitle',
        bodyKey: 'dashboard.notifWeeklyDigestBody',
        values: {
          attention: payload.attentionTotal != null ? Number(payload.attentionTotal) : 0,
          attentionSummary: payload.attentionSummary || '—',
          retention: payload.retentionCount != null ? Number(payload.retentionCount) : 0,
          stale: payload.staleCount != null ? Number(payload.staleCount) : 0,
          retentionNames: payload.retentionNames || '—',
          staleNames: payload.staleNames || '—',
          kudos: payload.kudosCount != null ? Number(payload.kudosCount) : 0,
        },
        category: 'retention',
        tone: 'attention',
      };
    case NOTIF.VACANCY_DEADLINE_APPROACHING:
      return {
        titleKey: 'dashboard.notifVacancyDeadlineTitle',
        bodyKey: 'dashboard.notifVacancyDeadlineBody',
        values: { title: title || '—', date: date || '—' },
        category: 'vacancy_deadline',
        tone: 'attention',
      };
    case NOTIF.VACANCY_CLOSED:
      return {
        titleKey: 'dashboard.notifVacancyClosedTitle',
        bodyKey: 'dashboard.notifVacancyClosedBody',
        values: { title: title || '—' },
        category: 'vacancy_status',
        tone: 'success',
      };
    case NOTIF.LMS_ENROLLED:
      return {
        titleKey: 'dashboard.notifLmsEnrolledTitle',
        bodyKey: 'dashboard.notifLmsEnrolledBody',
        values: {
          title: payload.courseTitle || '—',
          n: payload.enrolled != null ? Number(payload.enrolled) : 0,
        },
        category: 'generic',
        tone: 'neutral',
      };
    case NOTIF.LMS_OVERDUE:
      return {
        titleKey: 'dashboard.notifLmsOverdueTitle',
        bodyKey: 'dashboard.notifLmsOverdueBody',
        values: {
          name: name || '—',
          title: payload.courseTitle || '—',
          date: payload.dueDate || date || '—',
        },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.LMS_COMPLETED:
      return {
        titleKey: 'dashboard.notifLmsCompletedTitle',
        bodyKey: 'dashboard.notifLmsCompletedBody',
        values: {
          name: name || '—',
          title: payload.courseTitle || '—',
        },
        category: 'generic',
        tone: 'success',
      };
    case NOTIF.DP_LEAVE_REQUESTED:
      return {
        titleKey: 'dashboard.notifDpLeaveTitle',
        bodyKey: 'dashboard.notifDpLeaveBody',
        values: { name: name || '—' },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.DP_LEAVE_CANCELLED:
      return {
        titleKey: 'dashboard.notifDpLeaveCancelledTitle',
        bodyKey: 'dashboard.notifDpLeaveCancelledBody',
        values: { name: name || '—' },
        category: 'generic',
        tone: 'neutral',
      };
    case NOTIF.DP_LEAVE_FILE:
      return {
        titleKey: 'dashboard.notifDpLeaveFileTitle',
        bodyKey: 'dashboard.notifDpLeaveFileBody',
        values: { name: name || '—' },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.FIELD_EXPENSE_SUBMITTED:
      return {
        titleKey: 'dashboard.notifFieldExpenseTitle',
        bodyKey: 'dashboard.notifFieldExpenseBody',
        values: { name: name || '—', day: payload.day || '—' },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.TIME_REQUEST_SUBMITTED:
      return {
        titleKey: 'dashboard.notifTimeRequestTitle',
        bodyKey: 'dashboard.notifTimeRequestBody',
        values: { name: name || '—', day: payload.day || '—' },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.TIME_MIRROR_DISPUTED:
      return {
        titleKey: 'dashboard.notifTimeMirrorDisputedTitle',
        bodyKey: 'dashboard.notifTimeMirrorDisputedBody',
        values: { name: name || '—', from: payload.from || '—', to: payload.to || '—' },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.DP_DOC_UPLOADED:
      return {
        titleKey: 'dashboard.notifDpDocUploadedTitle',
        bodyKey: 'dashboard.notifDpDocUploadedBody',
        values: { name: name || '—', doc: payload.docKey || '—' },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.DP_DOC_SIGNED:
      return {
        titleKey: 'dashboard.notifDpDocSignedTitle',
        bodyKey: 'dashboard.notifDpDocSignedBody',
        values: { name: name || '—', doc: payload.docKey || '—' },
        category: 'generic',
        tone: 'success',
      };
    case NOTIF.DP_DOCS_PENDING:
      return {
        titleKey: 'dashboard.notifDpDocsTitle',
        bodyKey: 'dashboard.notifDpDocsBody',
        values: { name: name || '—', n: payload.pending != null ? Number(payload.pending) : 0 },
        category: 'generic',
        tone: 'attention',
      };
    case NOTIF.INTERVIEW_SCHEDULED:
      return {
        titleKey: 'dashboard.notifInterviewScheduledTitle',
        bodyKey: 'dashboard.notifInterviewScheduledBody',
        values: {
          name: name || '—',
          title: title || '—',
          date: payload.startsAt ? String(payload.startsAt).slice(0, 16) : date || '—',
        },
        category: 'generic',
        tone: 'neutral',
      };
    default:
      return {
        titleKey: 'dashboard.notifGenericTitle',
        bodyKey: null,
        values: {},
        category: 'generic',
        tone: 'neutral',
      };
  }
}

/** Visual meta for inbox UI (icon family + optional urgency tone). */
export function notificationVisual(type, payload = {}) {
  const { category, tone } = notificationCopySpec(type, payload);
  return { category, tone };
}
