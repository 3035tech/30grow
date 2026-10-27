/**
 * P0 journey: trail + experience outcomes + template defaults (offline).
 * Run: node --test test/unit/journey-p0.unit.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ONBOARDING_CHECKIN_OUTCOME } from '../../lib/domain-status.js';
import {
  DEFAULT_PRE_ONBOARDING_TEMPLATE,
  PRE_ONBOARDING_OWNER_ROLES,
} from '../../lib/people/pre-onboarding-template.js';
import { LMS_TRAIL_CAP } from '../../lib/development/lms-job-role-trail.js';

describe('journey P0 constants', () => {
  it('exposes terminate experience outcome', () => {
    assert.equal(ONBOARDING_CHECKIN_OUTCOME.TERMINATE, 'terminate');
    assert.equal(ONBOARDING_CHECKIN_OUTCOME.PASS, 'pass');
    assert.equal(ONBOARDING_CHECKIN_OUTCOME.EXTEND, 'extend');
  });

  it('seeds default D1 template with owners', () => {
    assert.ok(DEFAULT_PRE_ONBOARDING_TEMPLATE.length >= 4);
    assert.ok(PRE_ONBOARDING_OWNER_ROLES.includes('it'));
    assert.ok(DEFAULT_PRE_ONBOARDING_TEMPLATE.some((x) => x.itemKey === 'welcome_kit'));
    assert.ok(DEFAULT_PRE_ONBOARDING_TEMPLATE.some((x) => x.requireMeet === true));
  });

  it('caps LMS trail size', () => {
    assert.equal(LMS_TRAIL_CAP, 40);
  });
});
