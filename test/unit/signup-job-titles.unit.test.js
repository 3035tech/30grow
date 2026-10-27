import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSignupJobTitle,
  normalizeSignupJobTitle,
  SIGNUP_JOB_TITLE,
} from '../../lib/marketing/signup-job-titles.js';

describe('signup job title taxonomy', () => {
  it('keeps canonical roles stable for analytics', () => {
    assert.equal(isSignupJobTitle(SIGNUP_JOB_TITLE.HR_MANAGER), true);
    assert.deepEqual(normalizeSignupJobTitle(SIGNUP_JOB_TITLE.HR_MANAGER, 'ignored'), {
      jobTitle: SIGNUP_JOB_TITLE.HR_MANAGER,
      jobTitleOther: '',
    });
  });

  it('preserves the detail only for other', () => {
    assert.deepEqual(normalizeSignupJobTitle(SIGNUP_JOB_TITLE.OTHER, '  HRBP regional  '), {
      jobTitle: SIGNUP_JOB_TITLE.OTHER,
      jobTitleOther: 'HRBP regional',
    });
  });

  it('categorizes legacy free text without losing it', () => {
    assert.deepEqual(normalizeSignupJobTitle('Gerente de Gente', ''), {
      jobTitle: SIGNUP_JOB_TITLE.OTHER,
      jobTitleOther: 'Gerente de Gente',
    });
  });
});
