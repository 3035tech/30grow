/** Recruiting pipeline stages + rejection / hire metadata.
 * Agents: use `PIPELINE_STAGE.*` / `PIPELINE_STAGES` (not raw `'hired'` strings in new code).
 * See AGENTS.md § Constantes + `.cursor/rules/domain-constants.mdc`.
 */

export const PIPELINE_STAGE = Object.freeze({
  NEW: 'new',
  INTERVIEW: 'interview',
  TEST_COMPLETED: 'test_completed',
  SCREENING: 'screening',
  APPROVED: 'approved',
  HIRED: 'hired',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
});

export const PIPELINE_STAGES = Object.freeze(Object.values(PIPELINE_STAGE));

export const PIPELINE_STAGE_SET = new Set(PIPELINE_STAGES);

export const REJECTION_REASONS = [
  'salary',
  'profile_fit',
  'experience',
  'skill_gap',
  'seniority',
  'overqualified',
  'culture',
  'communication',
  'timing',
  'availability',
  'location',
  'competition',
  'role_filled',
  'no_show',
  'withdrew',
  'incomplete',
  'references',
  'other',
];

export const REJECTION_REASON_SET = new Set(REJECTION_REASONS);

export function normalizeRejectionReason(value) {
  if (value == null || value === '') return null;
  const code = String(value).trim().toLowerCase();
  return REJECTION_REASON_SET.has(code) ? code : null;
}

/** Strict validation for the new list and legacy single-reason requests. */
export function normalizeRejectionReasons(value) {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  if (values.length > REJECTION_REASONS.length) return null;
  const reasons = [];
  for (const value of values) {
    if (typeof value !== 'string') return null;
    const reason = normalizeRejectionReason(value);
    if (!reason) return null;
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

/** Legacy writes remain readable during a rolling deployment or app rollback. */
export function rejectionReasonsSql(alias, legacyColumn = 'rejection_reason') {
  return `(CASE WHEN NULLIF(TRIM(${alias}.${legacyColumn}), '') IS NULL THEN ARRAY[]::text[]
    WHEN ${alias}.rejection_reasons[1] = ${alias}.${legacyColumn} THEN ${alias}.rejection_reasons
    ELSE ARRAY[${alias}.${legacyColumn}] END)`;
}

export function normalizeStartDate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function rejectionReasonLabelKey(code) {
  const map = {
    salary: 'recruiting.rejectSalary',
    profile_fit: 'recruiting.rejectProfileFit',
    experience: 'recruiting.rejectExperience',
    skill_gap: 'recruiting.rejectSkillGap',
    seniority: 'recruiting.rejectSeniority',
    overqualified: 'recruiting.rejectOverqualified',
    culture: 'recruiting.rejectCulture',
    communication: 'recruiting.rejectCommunication',
    timing: 'recruiting.rejectTiming',
    availability: 'recruiting.rejectAvailability',
    location: 'recruiting.rejectLocation',
    competition: 'recruiting.rejectCompetition',
    role_filled: 'recruiting.rejectRoleFilled',
    no_show: 'recruiting.rejectNoShow',
    withdrew: 'recruiting.rejectWithdrew',
    incomplete: 'recruiting.rejectIncomplete',
    references: 'recruiting.rejectReferences',
    other: 'recruiting.rejectOther',
  };
  return map[code] || 'recruiting.rejectOther';
}
