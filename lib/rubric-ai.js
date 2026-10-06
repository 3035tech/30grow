/**
 * Rubrica / contexto de vaga via OpenAI (modelo barato: gpt-4o-mini).
 */

import { htmlToPlainText } from './sanitize-html.js';
import { t as i18nT, contentLocale } from './i18n.js';
import {
  buildRubricContextDraft,
  buildRubricWeightsPrompt,
  parseRubricWeightsFromAiText,
  relativeWeightsToPercentRubric,
} from './rubric-prompt.js';
import {
  isOpenAiConfigured,
  isRubricAiConfigured,
  openAiChatCompletion,
  openAiModelName,
} from './openai-chat.js';
import { AI_FEATURE, aiUsageContext } from './ai-usage.js';

export { isRubricAiConfigured, isOpenAiConfigured };

// Rubric prompts carry vacancy / job role text: cache only inside a known company.
const companyCache = usage => (usage?.companyId ? { companyId: usage.companyId } : null);

function vacancyFactsBlock(vacancy, locale) {
  const useEn = contentLocale(locale) === 'en';
  const desc = htmlToPlainText(vacancy?.description || '').slice(0, 4000);
  const lines = [
    i18nT(locale, 'ui.rubricAi.title', { value1: vacancy?.title || '—' }),
    useEn
      ? `Employment type: ${vacancy?.employmentType || 'not set'}`
      : `Formato de contratação: ${vacancy?.employmentType || 'não informado'}`,
    i18nT(locale, 'ui.rubricAi.salaryRange', { value1: vacancy?.salaryMin || '—', value2: vacancy?.salaryMax || '—' }),
    i18nT(locale, 'ui.rubricAi.targetDeadline', { value1: vacancy?.targetDate || '—' }),
    i18nT(locale, 'ui.rubricAi.descriptionPlain'),
    desc || (i18nT(locale, 'ui.rubricAi.empty')),
  ];
  return lines.join('\n');
}

/**
 * Pré-preenche o CONTEXTO DA VAGA a partir dos dados já cadastrados.
 */
export async function suggestRubricContextFromVacancy(vacancy, locale = 'pt-BR', usage = null) {
  const draft = buildRubricContextDraft({
    locale,
    title: vacancy?.title || '',
    descriptionPlain: htmlToPlainText(vacancy?.description || ''),
  });

  const system = i18nT(locale, 'ui.rubricAi.youHelpHrFillA');

  const user = i18nT(locale, 'ui.rubricAi.vacancyDataTemplateToComplete', { value1: vacancyFactsBlock(vacancy, locale), draft });

  const context = await openAiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.4,
    maxTokens: 900,
    usage: aiUsageContext(usage, AI_FEATURE.RUBRIC_CONTEXT),
    feature: AI_FEATURE.RUBRIC_CONTEXT,
    cache: companyCache(usage),
  });

  return { context, model: openAiModelName(AI_FEATURE.RUBRIC_CONTEXT) };
}

/**
 * Sugere pesos T1–T9 (+ notas) a partir do contexto preenchido.
 */
export async function suggestRubricWeightsFromContext(
  context,
  locale = 'pt-BR',
  usage = null,
  feature = AI_FEATURE.RUBRIC_WEIGHTS
) {
  const prompt = buildRubricWeightsPrompt({ locale, context });

  const system = i18nT(locale, 'ui.rubricAi.youAreARecruitingRubric');

  const raw = await openAiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 0.25,
    maxTokens: 900,
    responseFormat: 'json_object',
    usage: aiUsageContext(usage, feature),
    feature,
    cache: companyCache(usage),
  });

  const parsed = parseRubricWeightsFromAiText(raw, locale);
  if (!parsed.ok) {
    const err = new Error('RUBRIC_AI_PARSE');
    err.code = 'RUBRIC_AI_PARSE';
    err.raw = raw;
    throw err;
  }

  return {
    raw,
    weights: parsed.weights,
    notes: parsed.notes || undefined,
    model: openAiModelName(feature),
  };
}

/**
 * Sugere rubrica % T1–T9 para cargo a partir de nome + descrição (mesmo motor da Fit da vaga).
 * @param {{ name?: string, description?: string }} role
 * @param {string} [locale]
 */
export async function suggestJobRoleRubricFromText(role, locale = 'pt-BR', usage = null) {
  const name = String(role?.name || '').trim();
  const description = String(role?.description || '').trim();
  if (name.length < 2) {
    const err = new Error('RUBRIC_AI_NEED_CONTEXT');
    err.code = 'RUBRIC_AI_NEED_CONTEXT';
    throw err;
  }

  const context = buildRubricContextDraft({
    locale,
    title: name,
    descriptionPlain: description,
  });
  const out = await suggestRubricWeightsFromContext(
    context,
    locale,
    aiUsageContext(usage, AI_FEATURE.JOB_ROLE_RUBRIC),
    AI_FEATURE.JOB_ROLE_RUBRIC
  );
  return {
    raw: out.raw,
    weights: out.weights,
    rubric: relativeWeightsToPercentRubric(out.weights),
    notes: out.notes || undefined,
    model: out.model,
  };
}
