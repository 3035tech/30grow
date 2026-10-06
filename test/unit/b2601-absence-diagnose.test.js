/**
 * B-2601 — list absence diagnostics (pure helpers).
 * Run: node --test test/unit/b2601-absence-diagnose.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../../lib/i18n.js';
import { EMPLOYMENT_STATUS, ROSTER_SCOPE } from '../../lib/domain-status.js';
import {
  ABSENCE_LIST,
  ABSENCE_REASON,
  ABSENCE_SUGGESTION,
  buildAbsenceDiagnostics,
  buildListMembershipDiagnostics,
  classifyRosterVisibility,
  formatAbsenceReasonLines,
} from '../../lib/people/list-absence-diagnostics-core.js';
import { PIPELINE_STAGE_COLORS_DARK, getPipelineStageColor } from '../../lib/theme.js';

describe('B-2601 absence diagnostics', () => {
  it('classifyRosterVisibility: vacancy candidate hidden on internal', () => {
    const vis = classifyRosterVisibility(
      {
        employmentStatus: EMPLOYMENT_STATUS.CANDIDATE,
        hasCompanyAssessment: false,
        hasVacancyAssessment: true,
      },
      ROSTER_SCOPE.INTERNAL
    );
    assert.equal(vis.visible, false);
    assert.equal(vis.inRecruiting, true);
  });

  it('classifyRosterVisibility: company-link assessment visible on internal', () => {
    const vis = classifyRosterVisibility(
      {
        employmentStatus: EMPLOYMENT_STATUS.CANDIDATE,
        hasCompanyAssessment: true,
        hasVacancyAssessment: false,
      },
      ROSTER_SCOPE.INTERNAL
    );
    assert.equal(vis.visible, true);
  });

  it('buildAbsenceDiagnostics: no_match + clear_search', () => {
    const out = buildAbsenceDiagnostics({
      q: 'Zzz Nobody',
      rosterScope: ROSTER_SCOPE.INTERNAL,
      rows: [],
    });
    assert.ok(out.reasons.some((r) => r.code === ABSENCE_REASON.NO_MATCH));
    assert.ok(out.suggestions.some((s) => s.action === ABSENCE_SUGGESTION.CLEAR_SEARCH));
  });

  it('buildAbsenceDiagnostics: wrong_roster suggests recruiting', () => {
    const out = buildAbsenceDiagnostics({
      q: 'Ana',
      rosterScope: ROSTER_SCOPE.INTERNAL,
      rows: [
        {
          id: 11,
          fullName: 'Ana Silva',
          email: 'ana@ex.com',
          employmentStatus: EMPLOYMENT_STATUS.CANDIDATE,
          hasCompanyAssessment: false,
          hasVacancyAssessment: true,
          latestAssessmentId: 99,
        },
      ],
    });
    assert.ok(out.reasons.some((r) => r.code === ABSENCE_REASON.WRONG_ROSTER));
    const switchSug = out.suggestions.find((s) => s.action === ABSENCE_SUGGESTION.SWITCH_ROSTER);
    assert.equal(switchSug?.roster, ROSTER_SCOPE.RECRUITING);
    assert.equal(out.candidates.length, 1);
  });

  it('buildAbsenceDiagnostics: alumni + soft_filters', () => {
    const out = buildAbsenceDiagnostics({
      q: 'Bruno',
      rosterScope: ROSTER_SCOPE.ALL,
      listFilter: 'turnover_risk',
      rows: [
        {
          id: 22,
          fullName: 'Bruno Alumni',
          email: null,
          employmentStatus: EMPLOYMENT_STATUS.ALUMNI,
          hasCompanyAssessment: true,
          hasVacancyAssessment: false,
          latestAssessmentId: 7,
        },
      ],
    });
    assert.ok(out.reasons.some((r) => r.code === ABSENCE_REASON.ALUMNI));
    assert.ok(out.reasons.some((r) => r.code === ABSENCE_REASON.SOFT_FILTERS));
    assert.ok(out.suggestions.some((s) => s.action === ABSENCE_SUGGESTION.CLEAR_FILTERS));
  });

  for (const locale of ['pt-BR', 'en']) {
    it(`diagnose + help i18n (${locale})`, () => {
      assert.ok(String(t(locale, 'panel.team.diagnoseCta')).length > 4);
      assert.ok(String(t(locale, 'panel.team.diagnoseReason.wrong_roster')).length > 8);
      assert.ok(String(t(locale, 'panel.help.teamStep7')).length > 8);
      assert.notEqual(t(locale, 'panel.help.teamStep7'), 'panel.help.teamStep7');
    });
  }
});

describe('B-1501 pipeline dark colors', () => {
  it('dark pipeline hues differ from light for muted stages', () => {
    assert.notEqual(
      getPipelineStageColor('new', { isDark: true }),
      getPipelineStageColor('new', { isDark: false })
    );
    assert.equal(PIPELINE_STAGE_COLORS_DARK.hired, '#2DD4BF');
    assert.match(getPipelineStageColor('rejected', { isDark: true }), /^#/i);
  });
});

describe('B-2601 vacancy-side lists (Banco de talentos, pipeline)', () => {
  const codes = (r) => r.reasons.map((x) => x.code);
  const actions = (r) => r.suggestions.map((x) => x.action);

  it('ninguém na empresa: no_match + limpar busca', () => {
    const r = buildListMembershipDiagnostics({ q: 'zz', list: ABSENCE_LIST.TALENT_BANK, rows: [] });
    assert.deepEqual(codes(r), [ABSENCE_REASON.NO_MATCH]);
    assert.deepEqual(actions(r), [ABSENCE_SUGGESTION.CLEAR_SEARCH]);
  });

  it('banco: cadastro sem vínculo com vaga', () => {
    const r = buildListMembershipDiagnostics({
      q: 'ana',
      list: ABSENCE_LIST.TALENT_BANK,
      rows: [{ id: 1, fullName: 'Ana', inList: false, matchesFilters: false }],
    });
    assert.deepEqual(codes(r), [ABSENCE_REASON.NOT_IN_TALENT_BANK]);
    assert.equal(r.candidates[0].inList, false);
  });

  it('banco: está no banco, mas filtros de vaga/etapa/perfil escondem', () => {
    const r = buildListMembershipDiagnostics({
      q: 'ana',
      list: ABSENCE_LIST.TALENT_BANK,
      rows: [{ id: 1, fullName: 'Ana', inList: true, matchesFilters: false }],
    });
    assert.deepEqual(codes(r), [ABSENCE_REASON.SOFT_FILTERS]);
    assert.ok(actions(r).includes(ABSENCE_SUGGESTION.CLEAR_FILTERS));
  });

  it('pipeline: fora da vaga, mas em outras (títulos deduplicados e com teto)', () => {
    const r = buildListMembershipDiagnostics({
      q: 'ana',
      list: ABSENCE_LIST.VACANCY_PIPELINE,
      rows: [
        { id: 1, fullName: 'Ana A', inList: false, otherVacancyTitles: ['Dev', 'QA'] },
        { id: 2, fullName: 'Ana B', inList: false, otherVacancyTitles: ['QA', 'PM', 'UX'] },
      ],
    });
    assert.deepEqual(codes(r), [ABSENCE_REASON.HOMONYMS, ABSENCE_REASON.NOT_IN_VACANCY, ABSENCE_REASON.OTHER_VACANCIES]);
    assert.deepEqual(r.reasons[2].meta.titles, ['Dev', 'QA', 'PM']);
  });

  it('pipeline: na vaga com filtros do quadro ativos vs sem filtros', () => {
    const row = { id: 1, fullName: 'Ana', inList: true, stage: 'interview' };
    const filtered = buildListMembershipDiagnostics({ q: 'ana', list: ABSENCE_LIST.VACANCY_PIPELINE, filtersActive: true, rows: [row] });
    assert.deepEqual(codes(filtered), [ABSENCE_REASON.SOFT_FILTERS]);
    const plain = buildListMembershipDiagnostics({ q: 'ana', list: ABSENCE_LIST.VACANCY_PIPELINE, rows: [row] });
    assert.deepEqual(codes(plain), [ABSENCE_REASON.IN_LIST]);
    assert.equal(plain.reasons[0].meta.stage, 'interview');
  });

  it('formatAbsenceReasonLines preenche títulos/etapa em todos os idiomas e sem travessão', () => {
    const reasons = [
      { code: ABSENCE_REASON.OTHER_VACANCIES, meta: { titles: ['Dev', 'QA'] } },
      { code: ABSENCE_REASON.IN_LIST, meta: { stage: 'interview' } },
      { code: ABSENCE_REASON.IN_LIST, meta: {} },
      { code: 'unknown_code' },
    ];
    for (const locale of ['pt-BR', 'en', 'fr-FR', 'de-DE']) {
      const lines = formatAbsenceReasonLines(locale, reasons, { stageLabel: () => 'Entrevista' });
      assert.match(lines[0], /Dev, QA/);
      assert.match(lines[1], /Entrevista/);
      assert.ok(lines[2].includes(t(locale, 'panel.team.diagnoseNoStage')));
      assert.equal(lines[3], '· unknown_code');
      for (const line of lines) assert.ok(!line.includes(' — '), line);
      for (const code of ['not_in_talent_bank', 'not_in_vacancy']) {
        const key = `panel.team.diagnoseReason.${code}`;
        assert.notEqual(t(locale, key), key, `${locale} ${code}`);
      }
    }
  });
});

