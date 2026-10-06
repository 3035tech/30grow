/**
 * B-2600 — IA redige, em linguagem hedged, o diagnóstico "Por que não aparece?" (B-2601).
 * Entrada só com códigos/contagens/etapa genérica: sem nomes, e-mails, busca nem títulos de vaga.
 * Sem dado do tenant no prompt, a resposta pode ir para o cache global.
 */

import { isOpenAiConfigured, openAiChatCompletion, extractJsonObject } from '../openai-chat.js';
import { ERR } from '../api-error-codes.js';
import { AI_FEATURE, AI_BLOCK_CODE, aiUsageContext } from '../ai-usage.js';
import { t, contentLocale } from '../i18n.js';
import { ABSENCE_LIST, ABSENCE_LIST_SET } from './list-absence-diagnostics-core.js';

const SUMMARY_MAX = 600;
const NEXT_STEP_MAX = 240;
const REASONS_MAX = 8;

/** Fatos sem PII enviados à IA (exportado para teste). */
export function absenceExplainFacts({ list, reasons, candidateCount = 0, locale = 'pt-BR' }) {
  const loc = contentLocale(locale);
  const facts = (Array.isArray(reasons) ? reasons : []).slice(0, REASONS_MAX).map((r) => {
    const code = String(r?.code || '');
    const stage = r?.meta?.stage ? String(r.meta.stage).slice(0, 40) : '';
    const fact = { code, meaning: t(loc, `panel.team.diagnoseReason.${code}`, { stage: stage || '…', titles: '…' }) };
    if (Number.isFinite(Number(r?.meta?.count))) fact.count = Number(r.meta.count);
    if (Array.isArray(r?.meta?.titles)) fact.otherVacancyCount = r.meta.titles.length;
    if (stage) fact.stage = stage;
    if (r?.meta?.suggestedRoster) fact.suggestedRoster = String(r.meta.suggestedRoster).slice(0, 20);
    return fact;
  }).filter((f) => f.code);
  return {
    list: ABSENCE_LIST_SET.has(list) ? list : ABSENCE_LIST.TEAM,
    peopleFound: Math.max(0, Math.min(99, Number(candidateCount) || 0)),
    reasons: facts,
  };
}

function systemPrompt(locale) {
  return contentLocale(locale) === 'en'
    ? [
        'You explain to an HR manager why a person may not appear in a list of the 30Grow panel.',
        'Use ONLY the JSON facts. Do not invent people, data or causes. Hedged tone ("probably", "it seems").',
        'Reply ONLY with JSON: {"summary":"1-3 short sentences","nextStep":"one concrete action in the panel"}.',
        'No names, no clinical language, no em dash.',
      ].join(' ')
    : [
        'Você explica a um gestor de RH por que uma pessoa pode não aparecer numa lista do painel 30Grow.',
        'Use SOMENTE os fatos do JSON. Não invente pessoas, dados ou causas. Tom hedged ("provavelmente", "parece").',
        'Responda APENAS com JSON: {"summary":"1-3 frases curtas","nextStep":"uma ação concreta no painel"}.',
        'Sem nomes, sem linguagem clínica, sem travessão.',
      ].join(' ');
}

/** Chat messages for the explanation (exported for tests: the prompt must carry no PII). */
export function buildAbsenceExplainMessages({ list, reasons, candidateCount, locale }) {
  return [
    { role: 'system', content: systemPrompt(locale) },
    { role: 'user', content: JSON.stringify(absenceExplainFacts({ list, reasons, candidateCount, locale })) },
  ];
}

function clean(text, max) {
  return String(text || '').replace(/\s+—\s+/g, '. ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * @returns {Promise<{ ok: true, summary: string, nextStep: string } | { ok: false, errorCode: string }>}
 */
export async function explainAbsenceDiagnosisAi({ list, reasons, candidateCount, locale, usage = null }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  if (!isOpenAiConfigured()) return { ok: false, errorCode: ERR.RUBRIC_AI_NOT_CONFIGURED };
  try {
    const text = await openAiChatCompletion({
      messages: buildAbsenceExplainMessages({ list, reasons, candidateCount, locale }),
      temperature: 0.2,
      maxTokens: 220,
      responseFormat: 'json_object',
      usage: aiUsageContext(usage, AI_FEATURE.HELP_DIAGNOSE),
      feature: AI_FEATURE.HELP_DIAGNOSE,
      cache: { companyId: null },
    });
    let parsed = {};
    try {
      parsed = JSON.parse(extractJsonObject(text) || '{}');
    } catch {
      parsed = {};
    }
    const summary = clean(parsed.summary, SUMMARY_MAX);
    if (!summary) return { ok: false, errorCode: ERR.RUBRIC_AI_PARSE };
    return { ok: true, summary, nextStep: clean(parsed.nextStep, NEXT_STEP_MAX) };
  } catch (err) {
    const code = err?.code;
    if (code === ERR.AI_MONTHLY_LIMIT || code === AI_BLOCK_CODE.DISABLED || code === ERR.RUBRIC_AI_NOT_CONFIGURED) {
      return { ok: false, errorCode: code };
    }
    console.error('[list-absence-explain-ai]', err?.message || err);
    return { ok: false, errorCode: ERR.RUBRIC_AI_FAILED };
  }
}
