/**
 * Shared domain status / scope string constants (not TypeScript enums).
 * Prefer these over ad-hoc 'employee' / 'open' / 'internal' literals.
 *
 * Agents: AGENTS.md § "Constantes de domínio" + `.cursor/rules/domain-constants.mdc`.
 * Extend this file when adding a new closed status set; do not invent parallel maps in routes/tabs.
 */

export const EMPLOYMENT_STATUS = Object.freeze({
  CANDIDATE: 'candidate',
  EMPLOYEE: 'employee',
  ALUMNI: 'alumni',
});

/** Active internal roster (Equipe / roster=internal). Alumni: roster=alumni, roster=all and Exit Analysis. */
export const EMPLOYMENT_STATUS_INTERNAL = Object.freeze([
  EMPLOYMENT_STATUS.EMPLOYEE,
]);

export const VACANCY_STATUS = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
});

/** Vacancies admin list filter (`?status=` / `vacanciesStatus`). ATTENTION = open but not receiving applications or past deadline. */
export const VACANCY_LIST_FILTER = Object.freeze({
  ALL: 'all',
  OPEN: VACANCY_STATUS.OPEN,
  CLOSED: VACANCY_STATUS.CLOSED,
  ATTENTION: 'attention',
});

export const VACANCY_LIST_FILTER_SET = new Set(Object.values(VACANCY_LIST_FILTER));

export function normalizeVacancyListFilter(value) {
  const v = String(value || '');
  return VACANCY_LIST_FILTER_SET.has(v) ? v : VACANCY_LIST_FILTER.ALL;
}

/** Minimal offer / acceptance on vacancy pipeline (B-703). */
export const OFFER_STATUS = Object.freeze({
  NONE: 'none',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
});

export const OFFER_STATUSES = Object.freeze(Object.values(OFFER_STATUS));

/** B-2707 interview slots (light calendar). */
export const INTERVIEW_SLOT_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
});

export const INTERVIEW_SLOT_STATUSES = Object.freeze(Object.values(INTERVIEW_SLOT_STATUS));

/**
 * Shared checklist lifecycle for pre-onboarding items + D30/60/90 check-ins.
 * (Not PDI item status — those use DEVELOPMENT_PLAN_ITEM_STATUS.)
 */
export const CHECKLIST_ITEM_STATUS = Object.freeze({
  PENDING: 'pending',
  DONE: 'done',
  SKIPPED: 'skipped',
});

export const CHECKLIST_ITEM_STATUSES = Object.freeze(Object.values(CHECKLIST_ITEM_STATUS));

export const CLIMATE_SURVEY_STATUS = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
});

/** Climate survey question kinds (Likert / open text / eNPS). */
export const CLIMATE_QUESTION_KIND = Object.freeze({
  LIKERT: 'likert',
  TEXT: 'text',
  ENPS: 'enps',
});

export const CLIMATE_QUESTION_KINDS = Object.freeze(Object.values(CLIMATE_QUESTION_KIND));

export const PERFORMANCE_CYCLE_STATUS = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  CLOSED: 'closed',
});

export const PERFORMANCE_REVIEW_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
});

/** Goal outcome on performance reviews (manager + side review). */
export const PERFORMANCE_GOAL_OUTCOME = Object.freeze({
  MET: 'met',
  EXCEEDED: 'exceeded',
  DEVELOP: 'develop',
  NOT_MET: 'not_met',
});

export const PERFORMANCE_GOAL_OUTCOMES = Object.freeze(Object.values(PERFORMANCE_GOAL_OUTCOME));

/** B-2704: self/peer side review via token. */
export const SIDE_REVIEW_ROLE = Object.freeze({
  SELF: 'self',
  PEER: 'peer',
});

export const SIDE_REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  EXPIRED: 'expired',
});

/** B-2705: light + formal experience outcomes on onboarding check-ins. */
export const ONBOARDING_CHECKIN_OUTCOME = Object.freeze({
  CONTINUE: 'continue',
  DEVELOP: 'develop',
  CONCERN: 'concern',
  PASS: 'pass',
  FAIL: 'fail',
  EXTEND: 'extend',
  TERMINATE: 'terminate',
});

/** Dashboard `roster=`: internal never includes alumni; ALUMNI lists former employees only. */
export const ROSTER_SCOPE = Object.freeze({
  INTERNAL: 'internal',
  RECRUITING: 'recruiting',
  ALUMNI: 'alumni',
  ALL: 'all',
});

export const ROSTER_SCOPE_SET = new Set(Object.values(ROSTER_SCOPE));

export const DEVELOPMENT_PLAN_STATUS = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
});

export const DEVELOPMENT_PLAN_ITEM_STATUS = Object.freeze({
  TODO: 'todo',
  DOING: 'doing',
  DONE: 'done',
});

/** Origin of a PDI item (must match development_plan_items_source_chk). */
export const DEVELOPMENT_PLAN_ITEM_SOURCE = Object.freeze({
  MANUAL: 'manual',
  SYNTHESIS: 'synthesis',
  ONE_ON_ONE: 'one_on_one',
  RETENTION: 'retention',
  ONBOARDING: 'onboarding',
  PERFORMANCE_REVIEW: 'performance_review',
});

export const DEVELOPMENT_PLAN_ITEM_SOURCES = Object.freeze(
  Object.values(DEVELOPMENT_PLAN_ITEM_SOURCE)
);

export const TEAM_PULSE_STATUS = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  CLOSED: 'closed',
});

/** Internal RH compensation event (not payroll). */
export const COMPENSATION_EVENT_TYPE = Object.freeze({
  HIRE: 'hire',
  RAISE: 'raise',
  ADJUSTMENT: 'adjustment',
  BONUS: 'bonus',
  OTHER: 'other',
});

export const COMPENSATION_EVENT_TYPES = Object.freeze(Object.values(COMPENSATION_EVENT_TYPE));

/** B-3003: variable pay / bonus workflow (not payroll). */
export const COMPENSATION_APPROVAL_STATUS = Object.freeze({
  PROPOSED: 'proposed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const COMPENSATION_APPROVAL_STATUSES = Object.freeze(
  Object.values(COMPENSATION_APPROVAL_STATUS)
);

/** B-3004 light OKR objective levels. */
export const OKR_OBJECTIVE_LEVEL = Object.freeze({
  COMPANY: 'company',
  TEAM: 'team',
  PERSON: 'person',
});

export const OKR_OBJECTIVE_LEVELS = Object.freeze(Object.values(OKR_OBJECTIVE_LEVEL));

/** OKR phase 1: cycle status. */
export const OKR_CYCLE_STATUS = Object.freeze({
  ACTIVE: 'active',
  CLOSED: 'closed',
});

export const OKR_CYCLE_STATUSES = Object.freeze(Object.values(OKR_CYCLE_STATUS));

/** Activity weight for area/cycle rollup. 0 is skipped; 10 pulls the total most. */
export const OKR_WEIGHT_MIN = 0;
export const OKR_WEIGHT_MAX = 10;
export const OKR_WEIGHT_DEFAULT = 5;

/** Exit analysis — type of departure (universal; keep small) */
export const EXIT_TYPE = Object.freeze({
  VOLUNTARY: 'voluntary',
  INVOLUNTARY: 'involuntary',
  MUTUAL: 'mutual',
});

export const EXIT_TYPES = Object.freeze(Object.values(EXIT_TYPE));

/**
 * Exit analysis — primary reason codes (closed taxonomy for insights).
 * Covers tech, serviços, indústria, varejo, saúde e contexto BR sem cadastro livre.
 */
export const EXIT_REASON = Object.freeze({
  BETTER_OFFER: 'better_offer',
  CAREER_GROWTH: 'career_growth',
  COMPENSATION: 'compensation',
  BENEFITS: 'benefits',
  WORK_LIFE_BALANCE: 'work_life_balance',
  BURNOUT: 'burnout',
  WORKLOAD: 'workload',
  RELOCATION: 'relocation',
  COMMUTE: 'commute',
  SCHEDULE: 'schedule',
  PERSONAL: 'personal',
  FAMILY_CARE: 'family_care',
  HEALTH: 'health',
  STUDY: 'study',
  PUBLIC_EXAM: 'public_exam',
  ENTREPRENEURSHIP: 'entrepreneurship',
  PERFORMANCE: 'performance',
  CONDUCT: 'conduct',
  HARASSMENT: 'harassment',
  RESTRUCTURING: 'restructuring',
  LAYOFF: 'layoff',
  POSITION_ELIMINATED: 'position_eliminated',
  CONTRACT_END: 'contract_end',
  SEASONAL_END: 'seasonal_end',
  RETIREMENT: 'retirement',
  CULTURE_FIT: 'culture_fit',
  MANAGER_RELATIONSHIP: 'manager_relationship',
  RECOGNITION: 'recognition',
  LACK_OF_CHALLENGE: 'lack_of_challenge',
  TARGETS_PRESSURE: 'targets_pressure',
  CLIENT_PRESSURE: 'client_pressure',
  TOOLS_PROCESS: 'tools_process',
  OTHER: 'other',
});

export const EXIT_REASONS = Object.freeze(Object.values(EXIT_REASON));

/**
 * Company benefits — indicative type codes (closed; categories stay company-cadastral).
 * Broad enough for tech, indústria, varejo, saúde e serviços.
 */
export const BENEFIT_TYPE = Object.freeze({
  HEALTH: 'health',
  DENTAL: 'dental',
  VISION: 'vision',
  MENTAL_HEALTH: 'mental_health',
  LIFE_INSURANCE: 'life_insurance',
  RETIREMENT: 'retirement',
  PROFIT_SHARING: 'profit_sharing',
  EQUITY: 'equity',
  VACATION: 'vacation',
  PARENTAL_LEAVE: 'parental_leave',
  SABBATICAL: 'sabbatical',
  FLEXIBLE_HOURS: 'flexible_hours',
  REMOTE_WORK: 'remote_work',
  HOME_OFFICE_ALLOWANCE: 'home_office_allowance',
  GYM: 'gym',
  WELLNESS: 'wellness',
  MEAL_VOUCHER: 'meal_voucher',
  FOOD_BASKET: 'food_basket',
  TRANSPORT_VOUCHER: 'transport_voucher',
  PARKING: 'parking',
  MOBILITY: 'mobility',
  PHONE: 'phone',
  EDUCATION: 'education',
  LANGUAGE: 'language',
  DAYCARE: 'daycare',
  LEGAL_AID: 'legal_aid',
  UNIFORM: 'uniform',
  PET: 'pet',
  OTHER: 'other',
});

export const BENEFIT_TYPES = Object.freeze(Object.values(BENEFIT_TYPE));

/** Manager → product team feedback kinds (order = form order). */
export const PRODUCT_FEEDBACK_KIND = Object.freeze({
  BUG: 'bug',
  QUESTION: 'question',
  COMMERCIAL: 'commercial',
  IDEA: 'idea',
  UX: 'ux',
});

export const PRODUCT_FEEDBACK_KINDS = Object.freeze(Object.values(PRODUCT_FEEDBACK_KIND));

/** Impact of a feedback item (pilot support triage). */
export const PRODUCT_FEEDBACK_SEVERITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const PRODUCT_FEEDBACK_SEVERITIES = Object.freeze(Object.values(PRODUCT_FEEDBACK_SEVERITY));

/** Onboarding wizard funnel (onboarding_events). */
export const ONBOARDING_STEP = Object.freeze({
  WELCOME: 'welcome',
  OBJECTIVE: 'objective',
  MODULES: 'modules',
  VACANCY: 'vacancy',
  INVITE: 'invite',
  DONE: 'done',
});

export const ONBOARDING_STEPS = Object.freeze(Object.values(ONBOARDING_STEP));

export const ONBOARDING_EVENT = Object.freeze({
  VIEWED: 'viewed',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
});

export const ONBOARDING_EVENTS = Object.freeze(Object.values(ONBOARDING_EVENT));

export const ONBOARDING_OBJECTIVE = Object.freeze({
  RECRUITING: 'recruiting',
  PEOPLE: 'people',
  COMPLETE: 'complete',
});

export const ONBOARDING_OBJECTIVES = Object.freeze(Object.values(ONBOARDING_OBJECTIVE));

/** Super-admin inbox status for product_feedback. */
export const PRODUCT_FEEDBACK_STATUS = Object.freeze({
  NEW: 'new',
  REVIEWING: 'reviewing',
  DONE: 'done',
  DISMISSED: 'dismissed',
});

export const PRODUCT_FEEDBACK_STATUSES = Object.freeze(Object.values(PRODUCT_FEEDBACK_STATUS));

/** DP leve: checklist documental (não eSocial / GED jurídico). */
export const DP_DOCUMENT_KEY = Object.freeze({
  ID_DOCUMENT: 'id_document',
  CONTRACT: 'contract',
  ASO: 'aso',
  ADDRESS_PROOF: 'address_proof',
  BANK_DATA: 'bank_data',
  DEPENDENTS: 'dependents',
  OTHER: 'other',
});

export const DP_DOCUMENT_KEYS = Object.freeze(Object.values(DP_DOCUMENT_KEY));

export const DP_DOCUMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  RECEIVED: 'received',
  WAIVED: 'waived',
});

export const DP_DOCUMENT_STATUSES = Object.freeze(Object.values(DP_DOCUMENT_STATUS));

/** B-2724: internal admission acknowledgment (not ICP / partner e-sign). */
export const DP_DOCUMENT_SIGNATURE_STATUS = Object.freeze({
  NONE: 'none',
  REQUESTED: 'requested',
  SIGNED: 'signed',
  WAIVED: 'waived',
});

export const DP_DOCUMENT_SIGNATURE_STATUSES = Object.freeze(
  Object.values(DP_DOCUMENT_SIGNATURE_STATUS)
);

/** DP leve: férias / afastamentos. */
export const DP_LEAVE_TYPE = Object.freeze({
  VACATION: 'vacation',
  SICK: 'sick',
  PARENTAL: 'parental',
  BEREAVEMENT: 'bereavement',
  MARRIAGE: 'marriage',
  MEDICAL_APPOINTMENT: 'medical_appointment',
  COMPENSATORY: 'compensatory',
  UNPAID: 'unpaid',
  OTHER: 'other',
});

export const DP_LEAVE_TYPES = Object.freeze(Object.values(DP_LEAVE_TYPE));

export const DP_LEAVE_STATUS = Object.freeze({
  REQUESTED: 'requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  TAKEN: 'taken',
});

export const DP_LEAVE_STATUSES = Object.freeze(Object.values(DP_LEAVE_STATUS));

/**
 * Kinship for DP emergency contact and dependents. Must match the CHECK constraints in
 * migrations/141_dp_kinship_relation.sql; '' means "not informed".
 */
export const KINSHIP_RELATION = Object.freeze({
  SPOUSE: 'spouse',
  PARTNER: 'partner',
  FATHER: 'father',
  MOTHER: 'mother',
  CHILD: 'child',
  STEPCHILD: 'stepchild',
  SIBLING: 'sibling',
  GRANDPARENT: 'grandparent',
  GRANDCHILD: 'grandchild',
  UNCLE_AUNT: 'uncle_aunt',
  COUSIN: 'cousin',
  IN_LAW: 'in_law',
  WARD: 'ward',
  FRIEND: 'friend',
  OTHER: 'other',
});

export const KINSHIP_RELATIONS = Object.freeze(Object.values(KINSHIP_RELATION));

/** A ward (minor under guardianship) is a dependent, never an emergency contact. */
export const EMERGENCY_KINSHIP_RELATIONS = Object.freeze(
  KINSHIP_RELATIONS.filter((k) => k !== KINSHIP_RELATION.WARD)
);

export const DEPENDENT_KINSHIP_RELATIONS = Object.freeze([
  KINSHIP_RELATION.SPOUSE,
  KINSHIP_RELATION.PARTNER,
  KINSHIP_RELATION.CHILD,
  KINSHIP_RELATION.STEPCHILD,
  KINSHIP_RELATION.WARD,
  KINSHIP_RELATION.FATHER,
  KINSHIP_RELATION.MOTHER,
  KINSHIP_RELATION.GRANDPARENT,
  KINSHIP_RELATION.GRANDCHILD,
  KINSHIP_RELATION.SIBLING,
  KINSHIP_RELATION.OTHER,
]);

/** B-2721: time punch kind (in/out only in MVP). */
export const TIME_PUNCH_KIND = Object.freeze({
  IN: 'in',
  OUT: 'out',
});

export const TIME_PUNCH_KINDS = Object.freeze(Object.values(TIME_PUNCH_KIND));

export const TIME_PUNCH_SOURCE = Object.freeze({
  WEB: 'web',
  MANAGER: 'manager',
});

export const TIME_PUNCH_SOURCES = Object.freeze(Object.values(TIME_PUNCH_SOURCE));

export const TIME_PUNCH_FLAG = Object.freeze({
  LATE: 'late',
  EARLY_OUT: 'early_out',
  ODD_PAIR: 'odd_pair',
  MANUAL: 'manual',
});

export const TIME_PUNCH_FLAGS = Object.freeze(Object.values(TIME_PUNCH_FLAG));

export const TIME_PUNCH_REVIEW = Object.freeze({
  NONE: 'none',
  OK: 'ok',
  FLAGGED: 'flagged',
  ADJUSTED: 'adjusted',
});

export const TIME_PUNCH_REVIEWS = Object.freeze(Object.values(TIME_PUNCH_REVIEW));

/** candidates.work_format (migration 124 / history 132). */
export const WORK_FORMAT = Object.freeze({
  CLT: 'clt',
  INTERN: 'intern',
  COOPERATIVE: 'cooperative',
  PJ: 'pj',
});

export const WORK_FORMATS = Object.freeze(Object.values(WORK_FORMAT));

/** Abono do dia no espelho de ponto (migration 137). */
export const TIME_DAY_JUSTIFICATION = Object.freeze({
  MEDICAL_CERTIFICATE: 'medical_certificate',
  EXCUSED_ABSENCE: 'excused_absence',
  HOLIDAY: 'holiday',
  DAY_OFF: 'day_off',
  OTHER: 'other',
});

export const TIME_DAY_JUSTIFICATIONS = Object.freeze(Object.values(TIME_DAY_JUSTIFICATION));

/** Pedido do colaborador no ponto (migration 142). */
export const TIME_REQUEST_KIND = Object.freeze({
  ADJUSTMENT: 'adjustment',
  EXCUSE: 'excuse',
});

export const TIME_REQUEST_KINDS = Object.freeze(Object.values(TIME_REQUEST_KIND));

export const TIME_REQUEST_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
});

export const TIME_REQUEST_STATUSES = Object.freeze(Object.values(TIME_REQUEST_STATUS));

export const TIME_REQUEST_DECISION = Object.freeze({
  APPROVE: 'approve',
  REJECT: 'reject',
});

export const TIME_REQUEST_PUNCH_ACTION = Object.freeze({
  ADD: 'add',
  VOID: 'void',
});

/** Motivos que o colaborador pode pedir; feriado vem do cadastro de feriados. */
export const TIME_REQUEST_EXCUSE_REASONS = Object.freeze([
  TIME_DAY_JUSTIFICATION.MEDICAL_CERTIFICATE,
  TIME_DAY_JUSTIFICATION.EXCUSED_ABSENCE,
  TIME_DAY_JUSTIFICATION.DAY_OFF,
  TIME_DAY_JUSTIFICATION.OTHER,
]);

/** Ocorrência calculada por dia no espelho do gestor (não persistida). */
export const TIME_DAY_OCCURRENCE = Object.freeze({
  OK: 'ok',
  TODAY: 'today',
  IN_PROGRESS: 'in_progress',
  ABSENCE: 'absence',
  INCOMPLETE: 'incomplete',
  REVIEW: 'review',
  MISSING: 'missing',
  JUSTIFIED: 'justified',
  REST: 'rest',
  HOLIDAY: 'holiday',
});

/** Escala da empresa: seg–sex (0 = domingo … 6 = sábado). */
export const COMPANY_WORKDAYS = Object.freeze([1, 2, 3, 4, 5]);
export const WEEKDAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

/** Feriados (migration 143). */
export const HOLIDAY_RECURRENCE = Object.freeze({
  ONCE: 'once',
  YEARLY: 'yearly',
});
export const HOLIDAY_RECURRENCES = Object.freeze(Object.values(HOLIDAY_RECURRENCE));

export const HOLIDAY_SOURCE = Object.freeze({
  MANUAL: 'manual',
  NATIONAL: 'national',
});

/** De onde vem a jornada aplicada no dia. */
export const TIME_SCHEDULE_SOURCE = Object.freeze({
  COMPANY: 'company',
  EMPLOYEE: 'employee',
});

export const TIME_CLOCK_CLOSURE_STATUS = Object.freeze({
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
});

export const TIME_CLOCK_CLOSURE_STATUSES = Object.freeze(Object.values(TIME_CLOCK_CLOSURE_STATUS));

/** B-2721: collaborator acknowledgment of a closed period mirror (migration 147). */
export const TIME_CLOCK_ACK_STATUS = Object.freeze({
  PENDING: 'pending',
  SIGNED: 'signed',
  DISPUTED: 'disputed',
});

export const TIME_CLOCK_ACK_STATUSES = Object.freeze(Object.values(TIME_CLOCK_ACK_STATUS));

/** B-2722: hour bank ledger. */
export const HOUR_BANK_ENTRY_KIND = Object.freeze({
  CREDIT: 'credit',
  DEBIT: 'debit',
});

export const HOUR_BANK_ENTRY_KINDS = Object.freeze(Object.values(HOUR_BANK_ENTRY_KIND));

export const HOUR_BANK_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const HOUR_BANK_STATUSES = Object.freeze(Object.values(HOUR_BANK_STATUS));

export const HOUR_BANK_SOURCE = Object.freeze({
  MANUAL: 'manual',
  TIME_CLOCK: 'time_clock',
  EMPLOYEE: 'employee',
});

export const HOUR_BANK_SOURCES = Object.freeze(Object.values(HOUR_BANK_SOURCE));

/** B-3005: whistleblowing / ouvidoria categories (closed set). */
export const WHISTLEBLOWING_CATEGORY = Object.freeze({
  HARASSMENT: 'harassment',
  ETHICS: 'ethics',
  SAFETY: 'safety',
  DISCRIMINATION: 'discrimination',
  FRAUD: 'fraud',
  OTHER: 'other',
});

export const WHISTLEBLOWING_CATEGORIES = Object.freeze(Object.values(WHISTLEBLOWING_CATEGORY));

export const WHISTLEBLOWING_REPORT_STATUS = Object.freeze({
  NEW: 'new',
  TRIAGING: 'triaging',
  RESPONDED: 'responded',
  CLOSED: 'closed',
});

export const WHISTLEBLOWING_REPORT_STATUSES = Object.freeze(
  Object.values(WHISTLEBLOWING_REPORT_STATUS)
);

/** B-3010: continuous feedback request lifecycle. */
export const FEEDBACK_REQUEST_STATUS = Object.freeze({
  PENDING: 'pending',
  ANSWERED: 'answered',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

export const FEEDBACK_REQUEST_STATUSES = Object.freeze(Object.values(FEEDBACK_REQUEST_STATUS));

/** Succession plan criticality / readiness (B-1005). */
export const SUCCESSION_IMPACT = Object.freeze({
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const SUCCESSION_IMPACTS = Object.freeze(Object.values(SUCCESSION_IMPACT));

export const SUCCESSION_READINESS = Object.freeze({
  NOT_READY: 'not_ready',
  DEVELOPING: 'developing',
  READY: 'ready',
  NOW: 'now',
});

export const SUCCESSION_READINESSES = Object.freeze(Object.values(SUCCESSION_READINESS));

/** B-1008 learning resources catalog (not LMS content_kind). */
export const LEARNING_RESOURCE_TYPE = Object.freeze({
  COURSE: 'course',
  ARTICLE: 'article',
  VIDEO: 'video',
  BOOK: 'book',
  WORKSHOP: 'workshop',
  MENTORING: 'mentoring',
  OTHER: 'other',
});

export const LEARNING_RESOURCE_TYPES = Object.freeze(Object.values(LEARNING_RESOURCE_TYPE));

/** Collaborator ack on journey items (D1 checklist vs D30/60/90). */
export const ONBOARDING_ACK_KIND = Object.freeze({
  PRE: 'pre',
  CHECKIN: 'checkin',
});

export const ONBOARDING_ACK_KINDS = Object.freeze(Object.values(ONBOARDING_ACK_KIND));

/** B-RH2-15 formal competency review models. */
export const FORMAL_REVIEW_MODEL = Object.freeze({
  NINETY: '90',
  ONE_EIGHTY: '180',
  THREE_SIXTY: '360',
});

export const FORMAL_REVIEW_MODELS = Object.freeze(Object.values(FORMAL_REVIEW_MODEL));

export const FORMAL_REVIEW_CYCLE_STATUS = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  CLOSED: 'closed',
});

export const FORMAL_REVIEW_CYCLE_STATUSES = Object.freeze(
  Object.values(FORMAL_REVIEW_CYCLE_STATUS)
);

export const FORMAL_REVIEW_STATUS = Object.freeze({
  DRAFT: 'draft',
  COLLECTING: 'collecting',
  FINALIZED: 'finalized',
  SENT: 'sent',
  ARCHIVED: 'archived',
});

export const FORMAL_REVIEW_STATUSES = Object.freeze(Object.values(FORMAL_REVIEW_STATUS));

export const FORMAL_RATER_ROLE = Object.freeze({
  MANAGER: 'manager',
  UPWARD: 'upward',
  SELF: 'self',
  EXTERNAL: 'external',
});

export const FORMAL_RATER_ROLES = Object.freeze(Object.values(FORMAL_RATER_ROLE));

export const FORMAL_RATER_STATUS = Object.freeze({
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  EXPIRED: 'expired',
});

export const FORMAL_RATER_STATUSES = Object.freeze(Object.values(FORMAL_RATER_STATUS));

export const FORMAL_LIKERT_MIN = 1;
export const FORMAL_LIKERT_MAX = 5;
