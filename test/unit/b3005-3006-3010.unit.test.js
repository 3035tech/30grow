/**
 * Unit proof — B-3005/3006/3010 constants and caps.
 */
import assert from 'node:assert/strict';
import {
  WHISTLEBLOWING_CATEGORIES,
  WHISTLEBLOWING_REPORT_STATUSES,
  FEEDBACK_REQUEST_STATUSES,
} from '../../lib/domain-status.js';
import { ORG_TREE_CAP } from '../../lib/people/org-chart.js';
import { FEEDBACK_MONTHLY_CAP, FEEDBACK_RESPONSE_MAX } from '../../lib/people/continuous-feedback.js';
import { WHISTLE_BODY_MIN, WHISTLE_BODY_MAX } from '../../lib/people/whistleblowing.js';
import { CAP, TAB_CAPABILITY } from '../../lib/identity/permissions.js';

function main() {
  assert.ok(WHISTLEBLOWING_CATEGORIES.includes('harassment'));
  assert.ok(WHISTLEBLOWING_CATEGORIES.includes('ethics'));
  assert.ok(WHISTLEBLOWING_REPORT_STATUSES.includes('triaging'));
  assert.ok(FEEDBACK_REQUEST_STATUSES.includes('answered'));
  assert.equal(CAP.WHISTLEBLOWING_VIEW, 'whistleblowing.view');
  assert.equal(TAB_CAPABILITY.whistleblowing, CAP.WHISTLEBLOWING_VIEW);
  assert.ok(ORG_TREE_CAP >= 50 && ORG_TREE_CAP <= 500);
  assert.ok(FEEDBACK_MONTHLY_CAP >= 5 && FEEDBACK_MONTHLY_CAP <= 50);
  assert.ok(WHISTLE_BODY_MIN >= 10);
  assert.ok(WHISTLE_BODY_MAX <= 4000);
  assert.ok(FEEDBACK_RESPONSE_MAX <= 1000);
  console.log('b3005-3006-3010.unit.test.js OK');
}

main();
