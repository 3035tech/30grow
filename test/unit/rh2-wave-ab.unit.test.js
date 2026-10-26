/**
 * Unit: RH2 remaining Parte 2 (profile synthesis conversationActions + hedging keys).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ERR } from '../../lib/api-error-codes.js';
import { createEmployeeDirect } from '../../lib/recruiting/hire.js';
import { reopenOnboardingCheckin } from '../../lib/people/onboarding-checkins.js';
import { submitEmployeeOneOnOnePrep } from '../../lib/employee/employee-one-on-one-prep.js';
import { buildProfileSynthesis } from '../../lib/assessment/profile-synthesis.js';
import { t } from '../../lib/i18n.js';

describe('RH2 wave A/B', () => {
  it('exposes EMPLOYEE_ALREADY_EXISTS', () => {
    assert.equal(ERR.EMPLOYEE_ALREADY_EXISTS, 'EMPLOYEE_ALREADY_EXISTS');
  });

  it('exports createEmployeeDirect / reopenOnboardingCheckin / submitEmployeeOneOnOnePrep', () => {
    assert.equal(typeof createEmployeeDirect, 'function');
    assert.equal(typeof reopenOnboardingCheckin, 'function');
    assert.equal(typeof submitEmployeeOneOnOnePrep, 'function');
  });

  it('createEmployeeDirect rejects missing email without DB', async () => {
    const r = await createEmployeeDirect({
      companyId: 1,
      fullName: 'Test Person',
      email: '',
    });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, ERR.EMAIL_REQUIRED);
  });

  it('direct inclusion requires work email even when personal email is provided', async () => {
    for (const email of [undefined, '', '   ']) {
      for (const entryMode of ['new_hire', 'existing_employee']) {
        const result = await createEmployeeDirect({ companyId: 1, fullName: 'Test Person',
          email, personalEmail: 'personal@example.test', entryMode });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, ERR.EMAIL_REQUIRED);
      }
    }
  });

  it('createEmployeeDirect rejects invalid companyId without DB', async () => {
    const r = await createEmployeeDirect({
      companyId: null,
      fullName: 'Test Person',
      email: 'a@b.com',
    });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, ERR.INVALID_ID);
  });
});

describe('RH2 remaining Parte 2', () => {
  it('buildProfileSynthesis returns 2–4 conversationActions with sources', () => {
    const syn = buildProfileSynthesis({
      locale: 'pt-BR',
      topType: 3,
      scores: { 1: 10, 2: 12, 3: 40, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2 },
      motivatorsTop: [
        { key: 'recognition', label: 'Reconhecimento', score: 88 },
        { key: 'security', label: 'Segurança', score: 72 },
      ],
    });
    assert.ok(Array.isArray(syn.conversationActions));
    assert.ok(syn.conversationActions.length >= 2);
    assert.ok(syn.conversationActions.length <= 4);
    for (const a of syn.conversationActions) {
      assert.ok(a.text);
      assert.ok(a.sourceLabel);
      assert.ok(['enneagram', 'motivators'].includes(a.source));
    }
  });

  it('hedging / nomenclature keys exist pt-BR + en', () => {
    for (const loc of ['pt-BR', 'en']) {
      assert.ok(t(loc, 'panel.dossier.hrPurpose').length > 10);
      assert.ok(t(loc, 'hrScore.badgeScoreTitle', { score: 70 }).includes('70'));
      assert.ok(t(loc, 'turnoverRadar.title').length > 3);
      assert.ok(t(loc, 'panel.team.peopleSubTabDp').length > 3);
      assert.ok(t(loc, 'panel.team.motivatorsRadarSeeStyle').length > 3);
      assert.ok(t(loc, 'panel.team.briefPrepareHint').length > 3);
      assert.ok(t(loc, 'panel.team.motivatorsStyleEmpty').length > 3);
      assert.ok(t(loc, 'panel.overview.vacanciesTitle').length > 3);
      assert.ok(t(loc, 'panel.overview.funnelTitle').length > 3);
    }
  });
});
