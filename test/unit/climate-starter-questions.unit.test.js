import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultClimateQuestions } from '../../lib/people/climate-default-questions.js';
import { t } from '../../lib/i18n.js';

test('starter climate questions match the selected locale and retain the survey structure', () => {
  for (const locale of ['pt-BR', 'pt-PT', 'en', 'es-419', 'es-ES', 'fr-FR', 'de-DE']) {
    const prompts = defaultClimateQuestions(locale);
    assert.equal(prompts.likert.length, 5, locale);
    assert.equal(prompts.text.length, 2, locale);
    assert.equal(new Set([...prompts.likert, ...prompts.text]).size, 7, locale);
    assert.ok(prompts.likert.every(question => question.length <= 500), locale);
    assert.ok(prompts.text.every(question => question.length <= 500), locale);
    for (const key of ['questionStarterLabel', 'questionStarterHelp', 'questionStarterSuggested', 'questionStarterBlank', 'questionStarterNeedQuestion']) {
      assert.notEqual(t(locale, `panel.climate.${key}`), `panel.climate.${key}`, `${locale}.${key}`);
    }
  }
  assert.match(defaultClimateQuestions('en').likert[0], /Overall/);
  assert.match(defaultClimateQuestions('es-ES').text[1], /¿Qué/);
  assert.notEqual(defaultClimateQuestions('pt-PT').likert[0], defaultClimateQuestions('pt-BR').likert[0]);
});
