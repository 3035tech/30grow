import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORG_UNIT, parseOrgUnitFilter, orgUnitOptions } from '../../lib/org-unit-constants.js';
import { parseDashboardTab } from '../../lib/assessment/assessment-filters.js';
import { CAP } from '../../lib/identity/permissions.js';
import { t } from '../../lib/i18n.js';
import { HELP_GUIDE_SECTIONS, HELP_SECTION_STEP_COUNTS } from '../../lib/help-sections.js';

test('unit filter accepts only positive safe IDs or the unassigned sentinel', () => {
  assert.equal(parseOrgUnitFilter('12'), 12);
  assert.equal(parseOrgUnitFilter(ORG_UNIT.FILTER_NONE), 'none');
  for (const value of ['', '-1', '1.2', 'x', 'Infinity', '9007199254740992']) assert.equal(parseOrgUnitFilter(value), null);
});
test('selectors show the parent path and terminate on corrupted cycles', () => {
  assert.equal(orgUnitOptions([{ id: 1, name: 'Root' }, { id: 2, name: 'Child', parentId: 1 }]).find((u) => u.id === 2).label, 'Root / Child');
  assert.equal(orgUnitOptions([{ id: 1, name: 'A', parentId: 2 }, { id: 2, name: 'B', parentId: 1 }]).length, 2);
});
test('organization inherits Team capability and bilingual help', () => {
  assert.equal(parseDashboardTab({ tab: 'organization' }, { role: 'hr', companyId: 1 }), 'organization');
  assert.notEqual(parseDashboardTab({ tab: 'organization' }, { role: 'hr', companyId: 1, capabilitiesCustomized: true, capabilityOverrides: [CAP.PROFILE_SELF] }), 'organization');
  assert.ok(HELP_GUIDE_SECTIONS.includes('organization'));
  assert.equal(HELP_SECTION_STEP_COUNTS.organization, 5);
  for (const locale of ['pt-BR', 'en']) {
    for (const key of ['panel.orgUnits.title', 'panel.help.organizationStep5', 'errors.ORG_UNIT_IN_USE']) assert.notEqual(t(locale, key), key);
  }
});
