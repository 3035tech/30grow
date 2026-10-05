/**
 * Unit: pilot support SLA (MVP-11) and onboarding funnel helpers (MVP-08).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addSupportBusinessDays,
  feedbackResponseSla,
  parseProductFeedbackListParams,
  SUPPORT_RESPONSE_BUSINESS_DAYS,
} from '../../lib/product-feedback.js';
import { COMPANY_MODULE, moduleForTab } from '../../lib/company-modules.js';
import {
  ONBOARDING_EVENT,
  ONBOARDING_STEP,
  PRODUCT_FEEDBACK_STATUS,
} from '../../lib/domain-status.js';
import { normalizeFunnelDays, recordOnboardingEvent } from '../../lib/onboarding-funnel.js';

describe('addSupportBusinessDays', () => {
  it('promises one business day by default', () => {
    assert.equal(SUPPORT_RESPONSE_BUSINESS_DAYS, 1);
  });

  it('weekday request is due next weekday at the same time', () => {
    // Wednesday 09:00 BRT
    assert.equal(addSupportBusinessDays('2026-10-07T12:00:00Z').toISOString(), '2026-10-08T12:00:00.000Z');
  });

  it('Friday request is due Monday', () => {
    assert.equal(addSupportBusinessDays('2026-10-02T18:00:00Z').toISOString(), '2026-10-05T18:00:00.000Z');
  });

  it('uses Brazil time: Friday 23:30 BRT is still Friday', () => {
    assert.equal(addSupportBusinessDays('2026-10-03T02:30:00Z').toISOString(), '2026-10-06T02:30:00.000Z');
  });

  it('weekend request is due on Monday', () => {
    const due = addSupportBusinessDays('2026-10-03T13:00:00Z');
    assert.equal(due.toISOString(), '2026-10-05T13:00:00.000Z');
  });

  it('invalid date returns null', () => {
    assert.equal(addSupportBusinessDays('not a date'), null);
  });
});

describe('feedbackResponseSla', () => {
  const createdAt = '2026-10-07T12:00:00Z';
  const after = new Date('2026-10-09T12:00:00Z');

  it('open and unanswered past due is overdue', () => {
    const sla = feedbackResponseSla({ createdAt, status: PRODUCT_FEEDBACK_STATUS.NEW }, after);
    assert.equal(sla.overdue, true);
    assert.equal(sla.answered, false);
    assert.equal(sla.dueAt, '2026-10-08T12:00:00.000Z');
  });

  it('answered item is never overdue', () => {
    const sla = feedbackResponseSla(
      { createdAt, status: PRODUCT_FEEDBACK_STATUS.REVIEWING, firstResponseAt: '2026-10-07T15:00:00Z' },
      after
    );
    assert.equal(sla.overdue, false);
    assert.equal(sla.answered, true);
  });

  it('closed item is not overdue', () => {
    const sla = feedbackResponseSla({ createdAt, status: PRODUCT_FEEDBACK_STATUS.DONE }, after);
    assert.equal(sla.overdue, false);
  });

  it('within the window is not overdue', () => {
    const sla = feedbackResponseSla(
      { createdAt, status: PRODUCT_FEEDBACK_STATUS.NEW },
      new Date('2026-10-08T11:00:00Z')
    );
    assert.equal(sla.overdue, false);
  });
});

describe('parseProductFeedbackListParams', () => {
  it('accepts triage filters', () => {
    const p = parseProductFeedbackListParams({
      status: 'open',
      kind: 'question',
      severity: 'critical',
      module: 'recruiting',
      overdue: '1',
    });
    assert.equal(p.status, 'open');
    assert.equal(p.kind, 'question');
    assert.equal(p.severity, 'critical');
    assert.equal(p.module, 'recruiting');
    assert.equal(p.overdue, true);
  });

  it('falls back to all on unknown values', () => {
    const p = parseProductFeedbackListParams({ status: 'x', kind: 'y', severity: 'z', module: 'w', overdue: 'yes' });
    assert.equal(p.status, 'all');
    assert.equal(p.kind, 'all');
    assert.equal(p.severity, 'all');
    assert.equal(p.module, 'all');
    assert.equal(p.overdue, false);
  });
});

describe('moduleForTab', () => {
  it('maps dashboard tabs to commercial modules', () => {
    assert.equal(moduleForTab('vacancies'), COMPANY_MODULE.RECRUITING);
    assert.equal(moduleForTab('talent-bank'), COMPANY_MODULE.RECRUITING);
    assert.equal(moduleForTab('overview'), COMPANY_MODULE.CORE);
  });

  it('returns null for unknown or empty tabs', () => {
    assert.equal(moduleForTab(''), null);
    assert.equal(moduleForTab('nope'), null);
    assert.equal(moduleForTab(null), null);
  });
});

describe('onboarding funnel helpers', () => {
  it('normalizes the period to the allowed options', () => {
    assert.equal(normalizeFunnelDays(90), 90);
    assert.equal(normalizeFunnelDays('30'), 30);
    assert.equal(normalizeFunnelDays(7), 30);
    assert.equal(normalizeFunnelDays(undefined), 30);
  });

  it('records with an idempotent insert', async () => {
    const calls = [];
    const db = { query: async (sql, params) => calls.push({ sql, params }) };
    const res = await recordOnboardingEvent(db, {
      companyId: 3,
      userId: 9,
      step: ONBOARDING_STEP.OBJECTIVE,
      event: ONBOARDING_EVENT.COMPLETED,
      objective: 'recruiting',
    });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /ON CONFLICT \(user_id, step, event\) DO NOTHING/);
    assert.deepEqual(calls[0].params, [3, 9, 'objective', 'completed', 'recruiting']);
  });

  it('rejects unknown steps/events and drops unknown objectives', async () => {
    const calls = [];
    const db = { query: async (sql, params) => calls.push({ sql, params }) };
    assert.equal((await recordOnboardingEvent(db, { companyId: 1, userId: 1, step: 'x', event: 'viewed' })).ok, false);
    assert.equal((await recordOnboardingEvent(db, { companyId: 1, userId: 1, step: 'welcome', event: 'x' })).ok, false);
    assert.equal((await recordOnboardingEvent(db, { companyId: null, userId: 1, step: 'welcome', event: 'viewed' })).ok, false);
    await recordOnboardingEvent(db, { companyId: 1, userId: 1, step: 'welcome', event: 'viewed', objective: 'bogus' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params[4], null);
  });
});
