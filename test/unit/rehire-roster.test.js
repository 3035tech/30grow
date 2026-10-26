import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rosterScopeSqlPart } from '../../lib/roster-scope-sql.js';
import { EMPLOYMENT_STATUS, ROSTER_SCOPE, ROSTER_SCOPE_SET } from '../../lib/domain-status.js';
import {
  ABSENCE_SUGGESTION,
  buildAbsenceDiagnostics,
  classifyRosterVisibility,
} from '../../lib/people/list-absence-diagnostics-core.js';
import { ERR, httpStatusForError } from '../../lib/api-error-codes.js';
import { t } from '../../lib/i18n.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('alumni is a roster scope', () => {
  assert.equal(ROSTER_SCOPE.ALUMNI, 'alumni');
  assert.ok(ROSTER_SCOPE_SET.has('alumni'));
});

test('internal roster never includes alumni; alumni roster lists only alumni', () => {
  const internal = rosterScopeSqlPart(ROSTER_SCOPE.INTERNAL);
  assert.match(internal, /NOT EXISTS[\s\S]*employment_status = 'alumni'/);
  assert.match(internal, /employment_status = 'employee'/);
  const alumni = rosterScopeSqlPart(ROSTER_SCOPE.ALUMNI);
  assert.match(alumni, /^EXISTS[\s\S]*employment_status = 'alumni'/);
  assert.doesNotMatch(alumni, /NOT EXISTS/);
  assert.equal(rosterScopeSqlPart(ROSTER_SCOPE.RECRUITING), 'ass.vacancy_id IS NOT NULL');
  assert.equal(rosterScopeSqlPart(ROSTER_SCOPE.ALL), null);
  assert.equal(rosterScopeSqlPart('bogus'), internal);
});

test('dashboard list and behavioral intel share the roster predicate', () => {
  assert.match(read('lib/assessment/assessment-filters.js'), /rosterScopeSqlPart\(rosterScope\)/);
  assert.match(read('lib/people/load-team-behavioral-intel.js'), /rosterScopeSqlPart\(rosterScope\)/);
});

test('internal-only rosters exclude alumni (batch motivators, nucleus)', () => {
  assert.match(read('lib/ae/batch-motivators-invites.js'), /employment_status <> '\$\{EMPLOYMENT_STATUS\.ALUMNI\}'/);
  assert.match(read('lib/people/company-nucleus.js'), /employment_status <> '\$\{EMPLOYMENT_STATUS\.ALUMNI\}'/);
});

test('classifyRosterVisibility: alumni with company-link assessment is not internal', () => {
  const row = { employmentStatus: EMPLOYMENT_STATUS.ALUMNI, hasCompanyAssessment: true, hasVacancyAssessment: false };
  assert.equal(classifyRosterVisibility(row, ROSTER_SCOPE.INTERNAL).visible, false);
  assert.equal(classifyRosterVisibility(row, ROSTER_SCOPE.ALUMNI).visible, true);
  assert.equal(classifyRosterVisibility(row, ROSTER_SCOPE.ALL).visible, true);
  const emp = { employmentStatus: EMPLOYMENT_STATUS.EMPLOYEE, hasCompanyAssessment: false, hasVacancyAssessment: true };
  assert.equal(classifyRosterVisibility(emp, ROSTER_SCOPE.INTERNAL).visible, true);
  assert.equal(classifyRosterVisibility(emp, ROSTER_SCOPE.ALUMNI).visible, false);
});

test('absence diagnostics suggest the alumni roster for a former employee', () => {
  const out = buildAbsenceDiagnostics({
    q: 'ana',
    rosterScope: ROSTER_SCOPE.INTERNAL,
    rows: [{
      id: 7,
      fullName: 'Ana',
      employmentStatus: EMPLOYMENT_STATUS.ALUMNI,
      hasCompanyAssessment: true,
      hasVacancyAssessment: false,
    }],
  });
  const sw = out.suggestions.find((s) => s.action === ABSENCE_SUGGESTION.SWITCH_ROSTER);
  assert.equal(sw?.roster, ROSTER_SCOPE.ALUMNI);
});

test('rehire error codes map to HTTP status', () => {
  assert.equal(httpStatusForError(ERR.NOT_ALUMNI), 409);
  assert.equal(httpStatusForError(ERR.REHIRE_BEFORE_EXIT), 400);
});

test('rehire copy exists in every locale without spaced em dash', () => {
  const keys = [
    'panel.rehire.action', 'panel.rehire.title', 'panel.rehire.hint', 'panel.rehire.hintWithExit',
    'panel.rehire.date', 'panel.rehire.invite', 'panel.rehire.ok', 'panel.rehire.leftOn',
    'panel.rehire.rehiredOn', 'dashboard.rosterAlumni', 'errors.NOT_ALUMNI', 'errors.REHIRE_BEFORE_EXIT',
    'panel.help.b1000ExitStep7', 'panel.helpAssist.faqRehire',
  ];
  for (const locale of ['pt-BR', 'en-US', 'fr-FR', 'de-DE']) {
    for (const key of keys) {
      const v = t(locale, key, { name: 'Ana', date: '01/02/2026' });
      assert.ok(v && v !== key, `${locale} ${key}`);
      assert.ok(!v.includes(' — '), `${locale} ${key} em dash`);
    }
  }
  assert.notEqual(t('de-DE', 'panel.rehire.action'), t('pt-BR', 'panel.rehire.action'));
});

test('rehire route uses withAdminApi + exit capability + audit', () => {
  const src = read('app/api/admin/exit-analysis/rehire/route.js');
  assert.match(src, /withAdminApi\(/);
  assert.match(src, /cap: CAP\.EXIT_ANALYSIS_VIEW/);
  assert.match(src, /action: 'employee\.rehire'/);
});
