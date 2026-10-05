/**
 * IA interpretativa hedged (B-1904) — recomenda a partir de sinais já no banco.
 * Não altera scores; não inventa dados fora do payload.
 */

import { isOpenAiConfigured, openAiChatCompletion, extractJsonObject } from '../openai-chat.js';
import { ERR } from '../api-error-codes.js';
import { AI_FEATURE, aiUsageContext } from '../ai-usage.js';
import { t as i18nT, contentLocale } from '../i18n.js';

const MAX_SIGNALS_CHARS = 6000;

function clipSignals(signals) {
  let raw = '';
  try {
    raw = JSON.stringify(signals ?? {});
  } catch {
    raw = '{}';
  }
  if (raw.length > MAX_SIGNALS_CHARS) {
    return `${raw.slice(0, MAX_SIGNALS_CHARS)}…`;
  }
  return raw;
}

function systemPrompt(locale) {
  const en = contentLocale(locale) === 'en';
  return en
    ? [
        'You are a 30Grow people-ops assistant. Interpret ONLY the JSON signals provided.',
        'Use hedged language ("tends to", "there are signs"). Never diagnose clinically.',
        'Do not invent people, scores, or events absent from the JSON.',
        'Do not contradict numeric scores; scoring stays authoritative on the server.',
        'Reply ONLY with JSON: {"summary":"2-4 short sentences","recommendations":["…","…"],"cautions":["…"]}.',
        'Max 3 recommendations and 2 cautions. Practical for HR/manager 1:1.',
      ].join(' ')
    : [
        'Você é assistente de people-ops do 30Grow. Interprete SOMENTE os sinais JSON fornecidos.',
        'Use linguagem hedged (“tende a”, “há indícios”). Nunca diagnostique clinicamente.',
        'Não invente pessoas, scores ou eventos ausentes do JSON.',
        'Não contradiga scores numéricos; o scoring autoritativo fica no servidor.',
        'Responda APENAS com JSON: {"summary":"2-4 frases curtas","recommendations":["…","…"],"cautions":["…"]}.',
        'Máx. 3 recomendações e 2 cautelas. Prático para 1:1 de RH/gestor.',
      ].join(' ');
}

function normalizeOut(parsed, locale) {
  const summary = String(parsed?.summary || '').trim().slice(0, 1200);
  const recommendations = (Array.isArray(parsed?.recommendations) ? parsed.recommendations : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const cautions = (Array.isArray(parsed?.cautions) ? parsed.cautions : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!summary && recommendations.length === 0) {
    return {
      ok: false,
      errorCode: ERR.RUBRIC_AI_PARSE,
    };
  }

  return {
    ok: true,
    summary:
      summary ||
      (i18nT(locale, 'ui.interpretAi.thereAreSignsWorthReviewing')),
    recommendations,
    cautions,
  };
}

/**
 * @param {{ kind: 'person'|'team', locale?: string, signals: object, usage?: object|null }} opts
 */
export async function interpretPeopleSignalsAi(opts) {
  const kind = opts?.kind === 'team' ? 'team' : 'person';
  const locale = contentLocale(opts?.locale);
  const signals = opts?.signals && typeof opts.signals === 'object' ? opts.signals : null;

  if (!signals) {
    return { ok: false, errorCode: ERR.INVALID_PARAMS };
  }
  if (!isOpenAiConfigured()) {
    return { ok: false, errorCode: ERR.RUBRIC_AI_NOT_CONFIGURED };
  }

  const blob = clipSignals({ kind, ...signals });
  const user =
    i18nT(locale, 'ui.interpretAi.kindSignalsJsonProduceThe', { kind, blob });

  try {
    const text = await openAiChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt(locale) },
        { role: 'user', content: user },
      ],
      temperature: 0.35,
      maxTokens: 700,
      responseFormat: 'json_object',
      usage: aiUsageContext(opts?.usage, AI_FEATURE.PEOPLE_INTERPRET),
      feature: AI_FEATURE.PEOPLE_INTERPRET,
    });
    const raw = extractJsonObject(text);
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    return normalizeOut(parsed, locale);
  } catch (err) {
    if (err?.code === ERR.RUBRIC_AI_NOT_CONFIGURED || err?.code === ERR.AI_MONTHLY_LIMIT) {
      return { ok: false, errorCode: err.code };
    }
    console.error('[interpret-ai]', err?.message || err);
    return { ok: false, errorCode: ERR.RUBRIC_AI_FAILED };
  }
}
