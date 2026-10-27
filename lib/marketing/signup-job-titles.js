/** Canonical buyer roles captured by the public signup form. */
export const SIGNUP_JOB_TITLE = Object.freeze({
  OWNER_FOUNDER: 'owner_founder',
  EXECUTIVE: 'executive',
  HR_DIRECTOR: 'hr_director',
  HR_MANAGER: 'hr_manager',
  HR_ANALYST: 'hr_analyst',
  PEOPLE_OPS_DP: 'people_ops_dp',
  TALENT_ACQUISITION: 'talent_acquisition',
  RECRUITMENT_CONSULTANT: 'recruitment_consultant',
  PEOPLE_LEADER: 'people_leader',
  OTHER: 'other',
});

export const SIGNUP_JOB_TITLES = Object.freeze(Object.values(SIGNUP_JOB_TITLE));

const SIGNUP_JOB_TITLE_SET = new Set(SIGNUP_JOB_TITLES);

export function isSignupJobTitle(value) {
  return SIGNUP_JOB_TITLE_SET.has(String(value || '').trim());
}

/**
 * Keeps new signups queryable while accepting old clients that still send free text.
 * Unknown legacy values are categorized as `other` and preserved as the detail.
 */
export function normalizeSignupJobTitle(jobTitle, jobTitleOther) {
  const raw = String(jobTitle || '').trim().slice(0, 120);
  const detail = String(jobTitleOther || '').trim().slice(0, 120);
  if (!raw) return { jobTitle: '', jobTitleOther: '' };
  if (isSignupJobTitle(raw)) {
    return {
      jobTitle: raw,
      jobTitleOther: raw === SIGNUP_JOB_TITLE.OTHER ? detail : '',
    };
  }
  return { jobTitle: SIGNUP_JOB_TITLE.OTHER, jobTitleOther: detail || raw };
}
