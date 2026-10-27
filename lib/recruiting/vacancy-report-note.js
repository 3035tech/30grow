import { contentLocale } from '../locale-negotiation.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

/** Build a draft from recorded inputs only; HR reviews it before sharing. */
export function shortlistNoteDraft({ locale = 'pt-BR', vacancyTitle = '', people = [] } = {}) {
  const en = contentLocale(locale) === 'en';
  const groups = { advance: [], discuss: [], bank: [] };
  const evidence = [];
  const followUps = [];

  for (const person of people) {
    const name = escape(person.name);
    const group = ['advance', 'discuss', 'bank'].includes(person.recommendation) ? person.recommendation : 'bank';
    groups[group].push(name);
    const details = [];
    const score = Number(person.fitScore);
    if (person.fitScore != null && Number.isFinite(score) && score >= 0 && score <= 10) {
      details.push(en ? `fit score ${score.toFixed(1)}/10` : `aderência ${score.toFixed(1)}/10`);
    }
    if (String(person.why || '').trim()) details.push(escape(person.why.trim()));
    if (details.length) evidence.push(`${name}: ${details.join('; ')}`);
    for (const item of [person.watchOut, person.interviewProbe]) {
      if (String(item || '').trim()) followUps.push(`${name}: ${escape(item.trim())}`);
    }
  }

  const role = escape(vacancyTitle || (en ? 'this role' : 'esta vaga'));
  const selected = [
    groups.advance.length ? `${en ? 'Advance' : 'Avançar'}: ${groups.advance.join(', ')}` : null,
    groups.discuss.length ? `${en ? 'Discuss' : 'Conversar'}: ${groups.discuss.join(', ')}` : null,
    groups.bank.length ? `${en ? 'Hold' : 'Manter em análise'}: ${groups.bank.join(', ')}` : null,
  ].filter(Boolean).join('; ');
  const shortlist = selected || (en ? 'No candidates selected yet' : 'Nenhuma pessoa selecionada até o momento');

  return en
    ? `<p><strong>Shortlist for ${role}:</strong> ${shortlist}.</p>
<p><strong>Recorded evidence:</strong> ${evidence.length ? evidence.join(' · ') : 'Add role-specific reasons before sharing this report.'}</p>
<p><strong>Points to confirm:</strong> ${followUps.length ? followUps.join(' · ') : 'Record the questions to validate in the next interview.'}</p>
<p><strong>Next step:</strong> Review the shortlist and recorded evidence with the hiring team before deciding whom to invite.</p>`
    : `<p><strong>Seleção para ${role}:</strong> ${shortlist}.</p>
<p><strong>Evidências registradas:</strong> ${evidence.length ? evidence.join(' · ') : 'Registre os motivos ligados à vaga antes de compartilhar este relatório.'}</p>
<p><strong>Pontos a confirmar:</strong> ${followUps.length ? followUps.join(' · ') : 'Registre as perguntas a validar na próxima entrevista.'}</p>
<p><strong>Próximo passo:</strong> Revise a seleção e as evidências registradas com a equipe da vaga antes de decidir os convites.</p>`;
}
