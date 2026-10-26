/**
 * Domain constants waves 1–2: closed string sets in lib/domain-status.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHECKLIST_ITEM_STATUS,
  CHECKLIST_ITEM_STATUSES,
  CLIMATE_QUESTION_KIND,
  CLIMATE_QUESTION_KINDS,
  DEVELOPMENT_PLAN_ITEM_SOURCE,
  DEVELOPMENT_PLAN_ITEM_SOURCES,
  LEARNING_RESOURCE_TYPE,
  LEARNING_RESOURCE_TYPES,
  INTERVIEW_SLOT_STATUS,
  INTERVIEW_SLOT_STATUSES,
  OFFER_STATUS,
  OFFER_STATUSES,
  ONBOARDING_ACK_KIND,
  ONBOARDING_ACK_KINDS,
  PERFORMANCE_GOAL_OUTCOME,
  PERFORMANCE_GOAL_OUTCOMES,
  SUCCESSION_IMPACT,
  SUCCESSION_IMPACTS,
  SUCCESSION_READINESS,
  SUCCESSION_READINESSES,
  TEAM_PULSE_STATUS,
  VACANCY_LIST_FILTER,
  VACANCY_STATUS,
  normalizeVacancyListFilter,
} from '../../lib/domain-status.js';
import { ROLES } from '../../lib/permissions.js';
import { normalizeOfferStatus } from '../../lib/people/candidate-offer.js';
import { PERFORMANCE_REVIEW_CAPS } from '../../lib/performance-reviews.js';
import { deriveOverallScoreFromOutcomes } from '../../lib/people/performance-calibration.js';
import { shouldSuggestVariablePay } from '../../lib/people/variable-pay.js';
import { computeHireReadiness } from '../../lib/recruiting/hire-readiness.js';
import { PIPELINE_STAGE } from '../../lib/recruiting/pipeline.js';

describe('domain-status wave1 closed sets', () => {
  it('exposes PDI item sources matching SQL CHECK final list', () => {
    assert.deepEqual([...DEVELOPMENT_PLAN_ITEM_SOURCES].sort(), [
      'manual',
      'one_on_one',
      'onboarding',
      'performance_review',
      'retention',
      'synthesis',
    ].sort());
    assert.equal(DEVELOPMENT_PLAN_ITEM_SOURCE.PERFORMANCE_REVIEW, 'performance_review');
  });

  it('exposes climate question kinds including enps', () => {
    assert.deepEqual([...CLIMATE_QUESTION_KINDS].sort(), ['enps', 'likert', 'text'].sort());
    assert.equal(CLIMATE_QUESTION_KIND.ENPS, 'enps');
  });

  it('exposes performance goal outcomes once (shared by reviews + side reviews)', () => {
    assert.deepEqual([...PERFORMANCE_GOAL_OUTCOMES].sort(), [
      'develop',
      'exceeded',
      'met',
      'not_met',
    ].sort());
    assert.ok(PERFORMANCE_REVIEW_CAPS.OUTCOME_TYPES.has(PERFORMANCE_GOAL_OUTCOME.DEVELOP));
    assert.equal(PERFORMANCE_REVIEW_CAPS.OUTCOME_TYPES.size, 4);
  });

  it('calibration + variable pay use outcome constants', () => {
    const score = deriveOverallScoreFromOutcomes({
      1: { outcome: PERFORMANCE_GOAL_OUTCOME.EXCEEDED },
      2: { outcome: PERFORMANCE_GOAL_OUTCOME.MET },
    });
    assert.equal(score, 87.5);
    assert.equal(
      shouldSuggestVariablePay({
        a: { outcome: PERFORMANCE_GOAL_OUTCOME.EXCEEDED },
        b: { outcome: PERFORMANCE_GOAL_OUTCOME.NOT_MET },
      }),
      true
    );
  });
});

describe('domain-status wave2 closed sets', () => {
  it('exposes offer / interview / checklist / succession / team pulse', () => {
    assert.deepEqual([...OFFER_STATUSES].sort(), ['accepted', 'declined', 'none', 'proposed'].sort());
    assert.deepEqual([...INTERVIEW_SLOT_STATUSES].sort(), [
      'cancelled',
      'completed',
      'no_show',
      'scheduled',
    ].sort());
    assert.deepEqual([...CHECKLIST_ITEM_STATUSES].sort(), ['done', 'pending', 'skipped'].sort());
    assert.deepEqual([...SUCCESSION_IMPACTS].sort(), ['critical', 'high'].sort());
    assert.deepEqual([...SUCCESSION_READINESSES].sort(), [
      'developing',
      'not_ready',
      'now',
      'ready',
    ].sort());
    assert.equal(TEAM_PULSE_STATUS.OPEN, 'open');
    assert.equal(INTERVIEW_SLOT_STATUS.NO_SHOW, 'no_show');
    assert.equal(CHECKLIST_ITEM_STATUS.SKIPPED, 'skipped');
    assert.equal(SUCCESSION_IMPACT.CRITICAL, 'critical');
    assert.equal(SUCCESSION_READINESS.NOW, 'now');
  });

  it('normalizeOfferStatus + hire readiness use OFFER_STATUS', () => {
    assert.equal(normalizeOfferStatus('ACCEPTED'), OFFER_STATUS.ACCEPTED);
    assert.equal(normalizeOfferStatus('nope'), OFFER_STATUS.NONE);
    const ready = computeHireReadiness({
      assessmentId: 1,
      motivatorsAttemptId: 2,
      pipelineStage: PIPELINE_STAGE.APPROVED,
      offerStatus: OFFER_STATUS.PROPOSED,
    });
    assert.equal(ready.checks.find((c) => c.id === 'OFFER_LOGGED')?.ok, true);
    assert.equal(ready.checks.find((c) => c.id === 'OFFER_ACCEPTED')?.ok, false);
  });
});

describe('domain-status wave3 closed sets', () => {
  it('exposes learning resource types + onboarding ack kinds + ROLES', () => {
    assert.ok(LEARNING_RESOURCE_TYPES.includes(LEARNING_RESOURCE_TYPE.COURSE));
    assert.equal(LEARNING_RESOURCE_TYPES.length, 7);
    assert.deepEqual([...ONBOARDING_ACK_KINDS].sort(), ['checkin', 'pre'].sort());
    assert.equal(ONBOARDING_ACK_KIND.PRE, 'pre');
    assert.deepEqual([...ROLES].sort(), ['admin', 'direction', 'hr'].sort());
  });
});

describe('vacancy list filter', () => {
  it('reuses vacancy statuses and falls back to ALL for unknown values', () => {
    assert.equal(VACANCY_LIST_FILTER.OPEN, VACANCY_STATUS.OPEN);
    assert.equal(VACANCY_LIST_FILTER.CLOSED, VACANCY_STATUS.CLOSED);
    assert.equal(normalizeVacancyListFilter(VACANCY_LIST_FILTER.ATTENTION), VACANCY_LIST_FILTER.ATTENTION);
    assert.equal(normalizeVacancyListFilter(null), VACANCY_LIST_FILTER.ALL);
    assert.equal(normalizeVacancyListFilter("open' OR 1=1"), VACANCY_LIST_FILTER.ALL);
  });
});
