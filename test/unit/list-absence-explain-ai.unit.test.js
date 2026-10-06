/**
 * B-2600 — IA redige o diagnóstico "Por que não aparece?" sem PII no prompt.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  absenceExplainFacts,
  buildAbsenceExplainMessages,
  explainAbsenceDiagnosisAi,
} from '../../lib/people/list-absence-explain-ai.js';
import {
  ABSENCE_LIST,
  ABSENCE_REASON,
  formatAbsenceExplanation,
} from '../../lib/people/list-absence-diagnostics-core.js';
import { ERR } from '../../lib/api-error-codes.js';

const ENV_KEYS = ['AI_ENABLED', 'OPENAI_MOCK', 'OPENAI_API_KEY', 'DTOV', 'AI_RESPONSE_CACHE'];

const reasons = [
  { code: ABSENCE_REASON.OTHER_VACANCIES, meta: { titles: ['Vaga Secreta Acme', 'Outra Vaga'] } },
  { code: ABSENCE_REASON.HOMONYMS, meta: { count: 3 } },
  { code: ABSENCE_REASON.IN_LIST, meta: { stage: 'interview' } },
];

describe('list-absence-explain-ai', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('facts keep codes/counts and drop vacancy titles', () => {
    const facts = absenceExplainFacts({ list: 'bogus', reasons, candidateCount: 2, locale: 'pt-BR' });
    assert.equal(facts.list, ABSENCE_LIST.TEAM);
    assert.equal(facts.peopleFound, 2);
    const blob = JSON.stringify(facts);
    assert.doesNotMatch(blob, /Secreta|Acme|Outra Vaga/);
    assert.equal(facts.reasons[0].otherVacancyCount, 2);
    assert.equal(facts.reasons[1].count, 3);
    assert.equal(facts.reasons[2].stage, 'interview');
  });

  it('returns not configured when AI is off', async () => {
    const out = await explainAbsenceDiagnosisAi({ list: ABSENCE_LIST.TEAM, reasons, locale: 'pt-BR' });
    assert.deepEqual(out, { ok: false, errorCode: ERR.RUBRIC_AI_NOT_CONFIGURED });
  });

  it('rejects empty reasons without calling the AI', async () => {
    process.env.OPENAI_MOCK = '1';
    const out = await explainAbsenceDiagnosisAi({ list: ABSENCE_LIST.TEAM, reasons: [], locale: 'pt-BR' });
    assert.equal(out.ok, false);
  });

  it('prompt carries codes and counts only (no vacancy titles)', () => {
    const messages = buildAbsenceExplainMessages({ list: ABSENCE_LIST.TEAM, reasons, candidateCount: 1, locale: 'pt-BR' });
    assert.equal(messages.length, 2);
    const blob = JSON.stringify(messages);
    assert.doesNotMatch(blob, /Secreta|Acme|Outra Vaga/);
    assert.match(blob, /other_vacancies/);
    assert.match(messages[0].content, /"nextStep"/);
  });

  it('mock returns summary + next step', async () => {
    process.env.OPENAI_MOCK = '1';
    const out = await explainAbsenceDiagnosisAi({ list: ABSENCE_LIST.TEAM, reasons, candidateCount: 1, locale: 'en-US' });
    assert.equal(out.ok, true);
    assert.match(out.summary, /probably/);
    assert.ok(out.nextStep);
  });

  it('formatAbsenceExplanation renders summary, step and AI note; empty when absent', () => {
    assert.equal(formatAbsenceExplanation('pt-BR', null), '');
    assert.equal(formatAbsenceExplanation('pt-BR', { summary: '  ' }), '');
    const text = formatAbsenceExplanation('pt-BR', { summary: 'Resumo.', nextStep: 'Limpe filtros.' });
    assert.match(text, /^Resumo\.\nPróximo passo sugerido: Limpe filtros\.\nTexto redigido por IA/);
    assert.ok(text.endsWith('\n'));
    assert.doesNotMatch(text, / — /);
  });
});
