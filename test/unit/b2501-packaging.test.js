/**
 * B-2501 packaging — playbooks + shortlist composition + report templates.
 * Run: node --test test/unit/b2501-packaging.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildShortlistCompositionRisks, buildShortlistPairTensions } from '../../lib/recruiting/shortlist-composition-risks.js';
import {
  getReportNoteTemplate,
  inferReportTemplateKind,
  REPORT_TEMPLATE_KINDS,
} from '../../lib/recruiting/vacancy-report-note-templates.js';
import { playbooksForTab, PLAYBOOK_IDS } from '../../lib/persona-playbooks.js';

describe('B-2501 packaging', () => {
  it('inferReportTemplateKind heuristics', () => {
    assert.equal(inferReportTemplateKind({ title: 'Engenheiro Backend' }), 'technical');
    assert.equal(inferReportTemplateKind({ title: 'Gerente de Produto' }), 'leadership');
    assert.equal(inferReportTemplateKind({ title: 'Assistente operacional' }), 'operational');
  });

  it('getReportNoteTemplate returns html for each kind', () => {
    for (const kind of REPORT_TEMPLATE_KINDS) {
      const pt = getReportNoteTemplate('pt-BR', kind);
      const en = getReportNoteTemplate('en', kind);
      assert.ok(pt.includes('<p>'));
      assert.ok(en.includes('<p>'));
    }
  });

  it('buildShortlistPairTensions empty with one person', () => {
    const rows = buildShortlistPairTensions({
      locale: 'pt-BR',
      people: [{ candidateId: 1, name: 'A', topType: 3 }],
    });
    assert.equal(rows.length, 0);
  });

  it('buildShortlistCompositionRisks structure', () => {
    const risks = buildShortlistCompositionRisks({
      locale: 'pt-BR',
      shortlist: [
        { candidateId: 1, name: 'A', topType: 1 },
        { candidateId: 2, name: 'B', topType: 8 },
      ],
      nucleus: [{ id: 10, name: 'N', topType: 5 }],
    });
    assert.ok(Array.isArray(risks.pairTensions));
    assert.ok(Array.isArray(risks.nucleusRisks));
    assert.ok(Array.isArray(risks.nucleusCompleters));
    assert.equal(typeof risks.empty, 'boolean');
  });

  it('playbooksForTab filters by role', () => {
    const hrVagas = playbooksForTab('vacancies', 'hr');
    assert.ok(hrVagas.some((p) => p.id === PLAYBOOK_IDS.HR_HIRING));
    const dirOnly = playbooksForTab('analytics', 'hr');
    assert.equal(dirOnly.length, 0);
    const dirAnalytics = playbooksForTab('analytics', 'direction');
    assert.ok(dirAnalytics.some((p) => p.id === PLAYBOOK_IDS.DIRECTION));
  });
});
