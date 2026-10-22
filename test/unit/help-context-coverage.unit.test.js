import test from 'node:test';
import assert from 'node:assert/strict';

import { DASHBOARD_TAB_NAV } from '../../lib/dashboard-navigation.js';
import { HELP_GUIDE_GROUPS, HELP_GUIDE_SECTIONS, TAB_BY_HELP_SECTION } from '../../lib/help-sections.js';
import { helpMetaForTab, helpScreenPurpose, helpScreenTips, helpTabLabel } from '../../lib/help-screen-context.js';

test('every dashboard screen has a valid contextual Guide destination', () => {
  for (const tab of Object.keys(DASHBOARD_TAB_NAV)) {
    const meta = helpMetaForTab(tab);
    assert.ok(meta, `missing contextual help metadata for ${tab}`);
    assert.ok(meta.guideSections.length > 0, `missing Guide destination for ${tab}`);
    for (const section of meta.guideSections) {
      assert.ok(HELP_GUIDE_SECTIONS.includes(section), `unknown Guide section ${section} for ${tab}`);
    }
  }
});

test('PDI guide and screen context point to the dedicated PDI module', () => {
  const meta = helpMetaForTab('pdi');
  assert.equal(TAB_BY_HELP_SECTION.b600Pdi, 'pdi');
  assert.ok(HELP_GUIDE_GROUPS.find((group) => group.id === 'development')?.sections.includes('b600Pdi'));
  assert.ok(!HELP_GUIDE_GROUPS.find((group) => group.id === 'people')?.sections.includes('b600Pdi'));
  assert.ok(meta?.guideSections.includes('b600Pdi'));
  assert.match(helpScreenPurpose('pt-BR', 'pdi'), /Desenvolvimento → PDI/);
});

test('digital certificate help describes the global setup and opens its dedicated article', () => {
  assert.equal(TAB_BY_HELP_SECTION.digitalCertificate, 'digital-certificate');
  assert.equal(helpMetaForTab('digital-certificate').guideSections[0], 'digitalCertificate');
  assert.ok(HELP_GUIDE_GROUPS.find(group => group.id === 'admin').sections.includes('digitalCertificate'));
  assert.match(helpScreenPurpose('pt-BR', 'digital-certificate'), /global/);
  for (const locale of ['pt-BR', 'en', 'fr-FR', 'de-DE']) {
    assert.notEqual(helpTabLabel(locale, 'digital-certificate'), 'digital-certificate');
    const tips = helpScreenTips(locale, 'digital-certificate')[0];
    assert.equal(tips.section, 'digitalCertificate');
    assert.equal(tips.steps.length, 2);
    assert.ok(tips.steps.every(step => step.length > 20));
  }
});
