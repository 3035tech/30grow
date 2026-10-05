/**
 * Assistentes de IA para vaga / relatório / notas (OpenAI, servidor).
 * Sempre: sugerir → RH revisa → salvar. Linguagem hedged; sem diagnóstico clínico.
 */

import { htmlToPlainText, normalizeAiRichTextHtml } from './sanitize-html.js';
import { t as i18nT, contentLocale } from './i18n.js';
import { STRUCTURED_FIELD_MAX_CHARS } from './vacancy-report-shared.js';
import { extractJsonObject, openAiChatCompletion, openAiModelName } from './openai-chat.js';
import { AI_FEATURE, aiUsageContext } from './ai-usage.js';
import {
  buildVacancyDescriptionTemplate,
  resolveVacancyDescriptionMode,
  vacancyDescriptionSectionGuide,
} from './vacancy-description-template.js';

function clip(s, n) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function vacancyBrief(vacancy, locale) {
  const useEn = contentLocale(locale) === 'en';
  return [
    i18nT(locale, 'ui.vacancyAssistAi.vacancy', { value1: vacancy?.title || '—' }),
    useEn
      ? `Employment: ${vacancy?.employmentType || 'n/a'}`
      : `Contratação: ${vacancy?.employmentType || 'n/d'}`,
    i18nT(locale, 'ui.vacancyAssistAi.salary', { value1: vacancy?.salaryMin || '—', value2: vacancy?.salaryMax || '—' }),
    i18nT(locale, 'ui.vacancyAssistAi.description', { value1: clip(htmlToPlainText(vacancy?.description || ''), 1200) }),
    i18nT(locale, 'ui.vacancyAssistAi.rubricNotes', { value1: clip(htmlToPlainText(vacancy?.rubricNotes || ''), 600) }),
  ].join('\n');
}

/**
 * Parecer executivo HTML para o relatório /r.
 * @param {{ vacancy: object, candidates: object[], locale?: string }} opts
 */
export async function suggestExecutiveNoteAi({ vacancy, candidates, locale = 'pt-BR', usage = null }) {
  const list = (Array.isArray(candidates) ? candidates : []).slice(0, 12).map((c) => ({
    id: c.candidateId ?? c.id,
    name: c.name,
    topType: c.topType,
    fit: c.vacancyFitScore010,
    recommendation: c.recommendation,
    why: c.why || '',
    watchOut: c.watchOut || '',
    motivators: (c.motivatorsTop || []).map((m) => m.key || m).slice(0, 3),
  }));

  const system = i18nT(locale, 'ui.vacancyAssistAi.youWriteExecutiveNotesFor');

  const user = `${vacancyBrief(vacancy, locale)}

Shortlist JSON:
${JSON.stringify(list, null, 2)}

${i18nT(locale, 'ui.vacancyAssistAi.returnOnlyTheHtmlNote')}`;

  const raw = await openAiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.35,
    maxTokens: 900,
    usage: aiUsageContext(usage, AI_FEATURE.VACANCY_EXECUTIVE_NOTE),
    feature: AI_FEATURE.VACANCY_EXECUTIVE_NOTE,
  });

  const html = normalizeAiRichTextHtml(raw, 8000);
  if (!html || htmlToPlainText(html).length < 80) {
    const err = new Error('ASSIST_AI_NOTE_SHORT');
    err.code = 'ASSIST_AI_NOTE_SHORT';
    err.raw = raw;
    throw err;
  }
  return { executiveNote: html, model: openAiModelName(AI_FEATURE.VACANCY_EXECUTIVE_NOTE) };
}

/**
 * Sugere até cinco pessoas para avançar ou discutir na shortlist.
 * A saída é limitada aos IDs presentes no payload; RH ainda revisa antes de gerar o relatório.
 * @param {{ vacancy: object, candidates: object[], locale?: string }} opts
 */
export async function suggestShortlistAi({ vacancy, candidates, locale = 'pt-BR', usage = null }) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .slice(0, 12)
    .map((c) => ({
      candidateId: Number(c.candidateId ?? c.id),
      name: c.name,
      topType: c.topType,
      fit: c.vacancyFitScore010,
      recommendation: c.recommendation,
      why: clip(c.why || '', 400),
      watchOut: clip(c.watchOut || '', 400),
      notes: clip(htmlToPlainText(c.interviewNotes || ''), 500),
      motivators: (c.motivatorsTop || []).map((m) => m.label || m.key || m).slice(0, 3),
    }))
    .filter((c) => Number.isFinite(c.candidateId));
  const allowedIds = new Set(list.map((c) => c.candidateId));

  const system = i18nT(locale, 'ui.vacancyAssistAi.suggestARecruitingShortlistFrom');

  const raw = await openAiChatCompletion({
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${vacancyBrief(vacancy, locale)}

Candidates:
${JSON.stringify(list, null, 2)}`,
      },
    ],
    temperature: 0.25,
    maxTokens: 800,
    usage: aiUsageContext(usage, AI_FEATURE.VACANCY_SHORTLIST),
    feature: AI_FEATURE.VACANCY_SHORTLIST,
  });

  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    const err = new Error('ASSIST_AI_PARSE');
    err.code = 'ASSIST_AI_PARSE';
    err.raw = raw;
    throw err;
  }

  const candidateIds = [...new Set(
    (Array.isArray(parsed?.candidateIds) ? parsed.candidateIds : [])
      .map(Number)
      .filter((id) => Number.isFinite(id) && allowedIds.has(id))
  )].slice(0, 5);
  const rationaleHtml = normalizeAiRichTextHtml(parsed?.rationaleHtml || '', 8000);
  if (!rationaleHtml || htmlToPlainText(rationaleHtml).length < 40) {
    const err = new Error('ASSIST_AI_PARSE');
    err.code = 'ASSIST_AI_PARSE';
    err.raw = raw;
    throw err;
  }

  return { candidateIds, rationaleHtml };
}

/**
 * Campos estruturados why / watchOut / interviewProbe por candidato.
 * @param {{ vacancy: object, candidates: object[], locale?: string }} opts
 */
export async function suggestCandidateFieldsAi({ vacancy, candidates, locale = 'pt-BR', usage = null }) {
  const list = (Array.isArray(candidates) ? candidates : []).slice(0, 12).map((c) => ({
    candidateId: String(c.candidateId ?? c.id),
    name: c.name,
    topType: c.topType,
    fit: c.vacancyFitScore010,
    recommendation: c.recommendation,
    notes: clip(htmlToPlainText(c.interviewNotes || ''), 500),
    motivators: (c.motivatorsTop || []).map((m) => m.label || m.key || m).slice(0, 3),
  }));

  const system = i18nT(locale, 'ui.vacancyAssistAi.forEachCandidateReturnJson', { STRUCTURED_FIELD_MAX_CHARS });

  const user = `${vacancyBrief(vacancy, locale)}

Candidates:
${JSON.stringify(list, null, 2)}`;

  const raw = await openAiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.35,
    maxTokens: 1400,
    usage: aiUsageContext(usage, AI_FEATURE.VACANCY_CANDIDATE_FIELDS),
    feature: AI_FEATURE.VACANCY_CANDIDATE_FIELDS,
  });

  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    const err = new Error('ASSIST_AI_PARSE');
    err.code = 'ASSIST_AI_PARSE';
    err.raw = raw;
    throw err;
  }

  const rows = Array.isArray(parsed?.fields) ? parsed.fields : Array.isArray(parsed) ? parsed : [];
  const fields = {};
  for (const row of rows) {
    const id = String(row.candidateId || row.id || '').trim();
    if (!id) continue;
    fields[id] = {
      why: clip(row.why, STRUCTURED_FIELD_MAX_CHARS),
      watchOut: clip(row.watchOut, STRUCTURED_FIELD_MAX_CHARS),
      interviewProbe: clip(row.interviewProbe, STRUCTURED_FIELD_MAX_CHARS),
    };
  }
  if (!Object.keys(fields).length) {
    const err = new Error('ASSIST_AI_PARSE');
    err.code = 'ASSIST_AI_PARSE';
    err.raw = raw;
    throw err;
  }
  return { fields, model: openAiModelName(AI_FEATURE.VACANCY_CANDIDATE_FIELDS) };
}

/**
 * Resume notas de entrevista em HTML curto (ul/li).
 */
export async function summarizeInterviewNotesAi({ notesHtml, candidateName, locale = 'pt-BR', usage = null }) {
  const plain = htmlToPlainText(notesHtml || '');
  if (plain.length < 20) {
    const err = new Error('ASSIST_AI_NOTES_EMPTY');
    err.code = 'ASSIST_AI_NOTES_EMPTY';
    throw err;
  }

  const system = i18nT(locale, 'ui.vacancyAssistAi.summarizeInterviewNotesInto3');

  const user = i18nT(locale, 'ui.vacancyAssistAi.candidateNotes', { value1: candidateName || '—', value2: clip(plain, 6000) });

  const raw = await openAiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    maxTokens: 500,
    usage: aiUsageContext(usage, AI_FEATURE.INTERVIEW_NOTES_SUMMARY),
    feature: AI_FEATURE.INTERVIEW_NOTES_SUMMARY,
  });

  let html = normalizeAiRichTextHtml(raw, 8000);
  if (html && !/<ul/i.test(html) && !/<li/i.test(html)) {
    html = normalizeAiRichTextHtml(
      `<ul>${plain
        .split(/\n+/)
        .slice(0, 5)
        .map((l) => `<li>${l}</li>`)
        .join('')}</ul>`,
      8000
    );
  }
  // Prefer model HTML; if empty fallback wrap
  if (!html) {
    html = normalizeAiRichTextHtml(`<p>${clip(plain, 800)}</p>`, 8000);
  }
  return { summaryHtml: html, model: openAiModelName(AI_FEATURE.INTERVIEW_NOTES_SUMMARY) };
}

/**
 * Rascunho ou melhoria da descrição da vaga (HTML), seguindo o template canônico.
 * @param {{ vacancy: object, locale?: string, mode?: 'auto'|'draft'|'improve' }} opts
 */
export async function suggestVacancyDescriptionAi({ vacancy, locale = 'pt-BR', mode = 'auto', usage = null }) {
  const resolved = resolveVacancyDescriptionMode(mode, vacancy?.description);
  const guide = vacancyDescriptionSectionGuide(locale);
  const template = buildVacancyDescriptionTemplate(locale);
  const existing = String(vacancy?.description || '').trim();

  const system =
    resolved === 'improve'
      ? i18nT(locale, 'ui.vacancyAssistAi.youImproveVacancyDescriptionsFor')
      : i18nT(locale, 'ui.vacancyAssistAi.youDraftVacancyDescriptionsFor');

  const user =
    resolved === 'improve'
      ? `${vacancyBrief(vacancy, locale)}

${guide}

Current description HTML to improve (keep what is true; fill gaps; reorganize into the sections):
${clip(existing, 8000)}`
      : `${vacancyBrief(vacancy, locale)}

${guide}

Empty template to fill (same headings):
${template}
${existing ? `\nNotes / fragments already typed by RH (use if useful):\n${clip(existing, 2000)}` : ''}`;

  const raw = await openAiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: resolved === 'improve' ? 0.35 : 0.4,
    maxTokens: 1200,
    usage: aiUsageContext(usage, AI_FEATURE.VACANCY_DESCRIPTION),
    feature: AI_FEATURE.VACANCY_DESCRIPTION,
  });

  const html = normalizeAiRichTextHtml(raw, 12000);
  if (!html || htmlToPlainText(html).length < 40) {
    const err = new Error('ASSIST_AI_DESC_SHORT');
    err.code = 'ASSIST_AI_DESC_SHORT';
    err.raw = raw;
    throw err;
  }
  return { description: html, mode: resolved, model: openAiModelName(AI_FEATURE.VACANCY_DESCRIPTION) };
}
