/**
 * Template canônico da descrição de vaga (HTML) — o que o candidato precisa saber.
 * Usado no drawer (inserir estrutura) e como guia da IA (criar / melhorar).
 */

import { htmlToPlainText } from '../sanitize-html.js';
import { t as i18nT, contentLocale } from '../i18n.js';

/** Texto mínimo para considerar que já há conteúdo a melhorar (não só espaços). */
export const VACANCY_DESC_SPARSE_CHARS = 40;

export function isVacancyDescriptionSparse(html) {
  return htmlToPlainText(html || '').trim().length < VACANCY_DESC_SPARSE_CHARS;
}

/**
 * Resolve modo da IA: draft (criar base) | improve (corrigir/melhorar).
 * @param {'auto'|'draft'|'improve'|string} requested
 * @param {string} descriptionHtml
 */
export function resolveVacancyDescriptionMode(requested, descriptionHtml) {
  const m = String(requested || 'auto').trim().toLowerCase();
  if (m === 'draft' || m === 'improve') return m;
  return isVacancyDescriptionSparse(descriptionHtml) ? 'draft' : 'improve';
}

/**
 * Estrutura vazia com seções relevantes para o candidato.
 * Placeholders curtos para o RH completar (ou a IA preencher).
 */
export function buildVacancyDescriptionTemplate(locale = 'pt-BR') {
  const en = contentLocale(locale) === 'en';
  if (en) {
    return `<h2>About the role</h2>
<p>What this role exists for and the main outcome expected…</p>
<h2>What you will do</h2>
<ul>
<li>…</li>
<li>…</li>
<li>…</li>
</ul>
<h2>What we look for</h2>
<ul>
<li>Must-have skills / experience…</li>
<li>…</li>
</ul>
<h2>Nice to have</h2>
<ul>
<li>…</li>
</ul>
<h2>How we work</h2>
<ul>
<li>Employment type / location / cadence…</li>
</ul>
<h2>What we offer</h2>
<ul>
<li>Only list benefits you can confirm…</li>
</ul>
<h2>Selection process</h2>
<p>Next steps (interview, assessments, timeline)…</p>`;
  }
  return `<h2>Sobre a vaga</h2>
<p>Para que essa vaga existe e qual resultado principal esperamos…</p>
<h2>O que você vai fazer</h2>
<ul>
<li>…</li>
<li>…</li>
<li>…</li>
</ul>
<h2>O que buscamos</h2>
<ul>
<li>Requisitos essenciais (skills / experiência)…</li>
<li>…</li>
</ul>
<h2>Diferenciais</h2>
<ul>
<li>…</li>
</ul>
<h2>Como trabalhamos</h2>
<ul>
<li>Formato de contratação / local / ritmo…</li>
</ul>
<h2>O que oferecemos</h2>
<ul>
<li>Liste só benefícios que puder confirmar…</li>
</ul>
<h2>Processo seletivo</h2>
<p>Próximos passos (entrevista, testes, prazo)…</p>`;
}

/** Instruções de seção para o prompt da IA (mesmo mapa do template). */
export function vacancyDescriptionSectionGuide(locale = 'pt-BR') {
  return i18nT(locale, 'ui.vacancyDescriptionTemplate.requiredHtmlSectionsUseH2');
}
