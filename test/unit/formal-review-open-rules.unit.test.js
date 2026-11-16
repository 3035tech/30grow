/**
 * Unit proof — single rule set for opening a formal review (openFormalReview and the
 * set-based cycle publish share formalReviewOpenError).
 */
import assert from 'node:assert/strict';
import { ERR } from '../../lib/api-error-codes.js';
import {
  FORMAL_REVIEW_CYCLE_DISPLAY_STATUS,
  FORMAL_REVIEW_MODEL,
  FORMAL_REVIEW_STATUS,
  formalCycleDisplayStatus,
} from '../../lib/domain-status.js';
import { formalReviewOpenError } from '../../lib/people/formal-competency-reviews.js';

function main() {
  const ok = {
    status: FORMAL_REVIEW_STATUS.DRAFT, itemCount: 2, itemsWithoutSelf: 0, includeSelf: true, hasQuestionnaire: true,
    periodStart: '2026-10-01', periodEnd: '2026-10-31', managerCandidateId: 7, managerIsEmployee: true,
    subjectCandidateId: 9, model: FORMAL_REVIEW_MODEL.THREE_SIXTY, externalName: 'Cliente', externalEmail: 'c@x.test',
    today: '2026-10-05',
  };
  assert.equal(formalReviewOpenError(ok), null);
  assert.equal(formalReviewOpenError({ ...ok, periodEnd: '2026-10-05' }), null, 'last day still opens');

  assert.equal(formalReviewOpenError({ ...ok, status: FORMAL_REVIEW_STATUS.COLLECTING }), ERR.INVALID_STATUS);
  assert.equal(formalReviewOpenError({ ...ok, status: FORMAL_REVIEW_STATUS.COLLECTING, itemCount: 0 }), ERR.INVALID_STATUS, 'status wins');

  for (const [label, patch, expected] of [
    ['no items', { itemCount: 0 }, ERR.FORMAL_REVIEW_ITEMS_REQUIRED],
    ['self without wording', { itemsWithoutSelf: 1 }, ERR.FORMAL_REVIEW_SELF_TEXT_REQUIRED],
    ['no questionnaire', { hasQuestionnaire: false }, ERR.FORMAL_REVIEW_CYCLE_COMPETENCIES_REQUIRED],
    ['no start', { periodStart: null }, ERR.FORMAL_REVIEW_CYCLE_PERIOD_REQUIRED],
    ['no end', { periodEnd: null }, ERR.FORMAL_REVIEW_CYCLE_PERIOD_REQUIRED],
    ['period over', { periodEnd: '2026-10-04' }, ERR.FORMAL_REVIEW_CYCLE_PERIOD_ENDED],
    ['no manager', { managerCandidateId: null }, ERR.FORMAL_REVIEW_MANAGER_REQUIRED],
    ['manager left', { managerIsEmployee: false }, ERR.FORMAL_REVIEW_MANAGER_INVALID],
    ['self-managed', { managerCandidateId: 9 }, ERR.FORMAL_REVIEW_MANAGER_INVALID],
    ['360 without external name', { externalName: '' }, ERR.FORMAL_REVIEW_EXTERNAL_REQUIRED],
    ['360 without external e-mail', { externalEmail: null }, ERR.FORMAL_REVIEW_EXTERNAL_REQUIRED],
  ]) {
    assert.equal(formalReviewOpenError({ ...ok, ...patch }), expected, label);
  }
  assert.equal(formalReviewOpenError({ ...ok, includeSelf: false, itemsWithoutSelf: 3 }), null, 'self wording only matters with self');
  assert.equal(formalReviewOpenError({ ...ok, model: FORMAL_REVIEW_MODEL.ONE_EIGHTY, externalName: '' }), null, 'external only on 360');
  assert.equal(formalReviewOpenError({ ...ok, managerCandidateId: '9' }), ERR.FORMAL_REVIEW_MANAGER_INVALID, 'string ids compare');

  const { OPEN, DRAFT, CLOSED, SCHEDULED } = FORMAL_REVIEW_CYCLE_DISPLAY_STATUS;
  assert.equal(formalCycleDisplayStatus(OPEN, '2026-10-06', '2026-10-05'), SCHEDULED);
  assert.equal(formalCycleDisplayStatus(OPEN, '2026-10-06T00:00:00.000Z', '2026-10-05'), SCHEDULED, 'ISO timestamp');
  assert.equal(formalCycleDisplayStatus(OPEN, '2026-10-05', '2026-10-05'), OPEN, 'starts today');
  assert.equal(formalCycleDisplayStatus(OPEN, null, '2026-10-05'), OPEN);
  assert.equal(formalCycleDisplayStatus(DRAFT, '2026-12-01', '2026-10-05'), DRAFT, 'only open cycles schedule');
  assert.equal(formalCycleDisplayStatus(CLOSED, '2026-12-01', '2026-10-05'), CLOSED);

  console.log('formal-review-open-rules.unit.test.js OK');
}

main();
