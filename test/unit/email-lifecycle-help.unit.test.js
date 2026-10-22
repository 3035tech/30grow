import test from 'node:test';
import assert from 'node:assert/strict';
import { matchHelpFaq, buildHelpChunks } from '../../lib/help-assistant.js';
import { t } from '../../lib/i18n.js';

for (const [locale, question, personal, exit] of [
  ['pt-BR', 'Qual e-mail o candidato usa depois da contratação e do desligamento?', 'pessoal', 'desligamento'],
  ['en', 'Which corporate email is used after hiring and termination?', 'personal', 'exit'],
  ['fr-FR', 'Quel e-mail professionnel après embauche ?', 'personnel', 'départ'],
  ['de-DE', 'Welche geschäftliche E-Mail wird verwendet?', 'private', 'Austritt'],
]) {
  test(`${locale}: email lifecycle FAQ takes precedence over generic hiring help and feeds AI retrieval`, () => {
    const faq = matchHelpFaq(question, locale);
    assert.equal(faq?.id, 'emailLifecycle');
    assert.equal(faq.source, 'faq');
    assert.ok(faq.answer.includes(personal));
    assert.ok(faq.answer.includes(exit));
    const chunk = buildHelpChunks(locale).find(chunk => chunk.section === 'employeeHome');
    assert.ok(chunk.body.includes(personal));
    assert.ok(chunk.body.includes(exit));
    assert.notEqual(t(locale, 'recruiting.hireCorporateEmailLabel'), 'recruiting.hireCorporateEmailLabel');
  });
}

test('same person in different companies is documented without promising shared assessments', () => {
  const faq = matchHelpFaq('O mesmo candidato pode se inscrever em outras empresas com o mesmo email?', 'pt-BR');
  assert.equal(faq.id, 'candidateTenancy');
  assert.ok(faq.answer.includes('não são compartilhados'));
  assert.ok(buildHelpChunks('pt-BR').find(c => c.section === 'employeeHome').body.includes('cadastro próprio'));
});
