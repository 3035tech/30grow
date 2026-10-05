/**
 * Cliente OpenAI compartilhado (servidor apenas).
 * Env: OPENAI_API_KEY, OPENAI_RUBRIC_MODEL (default gpt-4o-mini),
 * OPENAI_BASE_URL (default https://api.openai.com/v1; OpenRouter / Gemini compatível),
 * AI_ENABLED=0 (kill switch). Consumo e teto mensal: lib/ai-usage.js.
 *
 * Mock (sem chamar a API):
 * - OPENAI_MOCK=1 — stub determinístico
 * - DTOV=1 — stub automático (provas offline / full-app)
 */

import {
  AI_BLOCK_CODE,
  aiModelOverride,
  assertAiQuota,
  isAiEnabled,
  isAiFeature,
  recordAiUsage,
} from './ai-usage.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export function openAiBaseUrl() {
  const raw = String(process.env.OPENAI_BASE_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\//i.test(raw) ? raw : DEFAULT_BASE_URL;
}

/** @type {{ at: string, messageCount: number, preview: string }[]} */
const mockLog = [];

export function isOpenAiMock() {
  if (String(process.env.OPENAI_MOCK || '').trim() === '1') return true;
  if (String(process.env.DTOV || '').trim() === '1') return true;
  return false;
}

export function isOpenAiConfigured() {
  if (!isAiEnabled()) return false;
  if (isOpenAiMock()) return true;
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

/** Alias usado pela rubrica. */
export const isRubricAiConfigured = isOpenAiConfigured;

/** Modelo da funcionalidade (AI_MODEL_<FEATURE>) ou o padrão OPENAI_RUBRIC_MODEL. */
export function openAiModelName(feature = null) {
  if (isOpenAiMock()) {
    return String(process.env.OPENAI_RUBRIC_MODEL || 'mock-gpt').trim() || 'mock-gpt';
  }
  return (
    aiModelOverride(feature) ||
    String(process.env.OPENAI_RUBRIC_MODEL || DEFAULT_MODEL).trim() ||
    DEFAULT_MODEL
  );
}

export function __resetOpenAiMockLog() {
  mockLog.length = 0;
}

export function __getOpenAiMockLog() {
  return mockLog.slice();
}

/**
 * Stub determinístico suficiente para rubrica / assistentes (JSON ou HTML).
 * @param {{ messages?: { role: string, content: string }[] }} opts
 */
export function buildOpenAiMockCompletion({ messages } = {}) {
  const blob = (Array.isArray(messages) ? messages : [])
    .map((m) => String(m?.content || ''))
    .join('\n');
  const lower = blob.toLowerCase();
  const isEn = /\byou are the 30grow product help\b/.test(lower) || /\bquestion:\b/.test(lower);

  const idMatches = [...blob.matchAll(/"candidateId"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
  const uniqueIds = [...new Set(idMatches.filter((n) => Number.isFinite(n)))];

  if (lower.includes('candidateids') || lower.includes('"candidateids"')) {
    const ids = uniqueIds.slice(0, 3);
    return JSON.stringify({
      candidateIds: ids.length ? ids : [1],
      rationaleHtml:
        '<p>Há indícios de bom fit nos perfis selecionados (mock DTOV).</p><p>Revisar com o gestor antes de avançar.</p>',
    });
  }

  if (lower.includes('"fields"') && (lower.includes('watchout') || lower.includes('interviewprobe'))) {
    const ids = uniqueIds.length
      ? uniqueIds.slice(0, 5).map(String)
      : ['1'];
    return JSON.stringify({
      fields: ids.map((candidateId) => ({
        candidateId,
        why: 'Há indícios de aderência à vaga (mock DTOV).',
        watchOut: 'Validar ritmo e autonomia na entrevista (mock).',
        interviewProbe: 'Como você prioriza entregas sob prazo apertado?',
      })),
    });
  }

  if (
    lower.includes('interprete somente') ||
    lower.includes('interpret only') ||
    lower.includes('sinais json') ||
    lower.includes('signals json') ||
    lower.includes('interpretação hedged') ||
    lower.includes('hedged interpretation')
  ) {
    return JSON.stringify({
      summary: isEn
        ? 'There are signs of mixed strengths and watch-outs in the provided signals (mock). Validate in a 1:1 — this is not a clinical diagnosis.'
        : 'Há indícios de forças e pontos de atenção nos sinais fornecidos (mock). Validar em 1:1 — não é diagnóstico clínico.',
      recommendations: isEn
        ? [
            'Open a short 1:1 focused on the top watch-out.',
            'Link an overdue PDI item to a concrete next step.',
            'Review fit vs the team nucleus before hiring changes.',
          ]
        : [
            'Abrir 1:1 curto focado no principal ponto de atenção.',
            'Ligar item de PDI em atraso a um próximo passo concreto.',
            'Revisar fit vs núcleo do time antes de mudanças de contratação.',
          ],
      cautions: isEn
        ? ['Do not treat scores as labels; keep hedged language.']
        : ['Não trate scores como rótulos; mantenha linguagem hedged.'],
    });
  }

  if (
    lower.includes('30grow product help') ||
    lower.includes('assistente de ajuda do 30grow') ||
    lower.includes('contexto do guia') ||
    lower.includes('context from the guide')
  ) {
    return isEn
      ? 'Open Vacancies → New vacancy (drawer with Essentials / Role & pay / Public page / Description). For hire readiness, expand the candidate card on the vacancy. See Help for steps.'
      : 'Em Vagas, use “Nova vaga” (drawer com Essenciais / Contrato / Página pública / Descrição). Para contratar, abra o card do candidato na vaga e veja “Pronto para contratar?”. Detalhes no Guia (Ajuda).';
  }

  if (
    (lower.includes('json') && (lower.includes('weights') || lower.includes('t1'))) ||
    lower.includes('"1":') ||
    lower.includes('pesos') ||
    lower.includes('"weights"')
  ) {
    return JSON.stringify({
      weights: { '1': 0, '2': 0, '3': 2, '4': 0, '5': 3, '6': 1, '7': 0, '8': 0, '9': 0 },
      notes:
        'Pesos determinísticos (mock DTOV). Preferência por análise (T5) e entrega (T3). Revisar com o gestor.',
    });
  }

  // Parecer / descrição HTML — texto longo o bastante para passar validação de assistentes
  return [
    '<p>Há indícios de que a shortlist tende a cobrir o perfil pedido (mock DTOV / OPENAI_MOCK).</p>',
    '<p>O fit observado combina entrega e análise; recomenda-se validar ritmo e autonomia na entrevista.</p>',
    '<p>Atenção a expectativas de autonomia e feedback frequente — explorar com o gestor da vaga.</p>',
    '<p>Próximo passo sugerido: alinhar shortlist com o hiring manager e seguir para entrevistas técnicas.</p>',
  ].join('');
}

/**
 * @param {{
 *   messages: {role:string,content:string}[],
 *   temperature?: number,
 *   maxTokens?: number,
 *   responseFormat?: 'json_object' | null,
 *   usage?: { companyId?: number|null, userId?: number|null, feature: string, db?: { query: Function } } | null,
 *   feature?: string | null,
 * }} opts
 * `usage` liga teto mensal + registro em ai_usage_events (sem ele: sem banco, ex. scripts offline).
 * @returns {Promise<string>}
 */
export async function openAiChatCompletion({
  messages,
  temperature = 0.3,
  maxTokens = 1200,
  responseFormat = null,
  usage = null,
  feature = null,
} = {}) {
  if (!isAiEnabled()) {
    const err = new Error(AI_BLOCK_CODE.DISABLED);
    err.code = AI_BLOCK_CODE.DISABLED;
    throw err;
  }

  const tracked = usage && isAiFeature(usage.feature);
  const modelFeature = (tracked && usage.feature) || feature;
  const db = tracked ? usage.db || (await import('./db.js')) : null;
  if (tracked) await assertAiQuota(db, { companyId: usage.companyId });

  const track = (model, promptTokens, completionTokens) =>
    tracked
      ? recordAiUsage(db, {
          companyId: usage.companyId,
          userId: usage.userId,
          feature: usage.feature,
          model,
          promptTokens,
          completionTokens,
        })
      : null;

  if (isOpenAiMock()) {
    const text = buildOpenAiMockCompletion({ messages });
    mockLog.push({
      at: new Date().toISOString(),
      messageCount: Array.isArray(messages) ? messages.length : 0,
      preview: text.slice(0, 120),
      temperature,
      maxTokens,
      responseFormat: responseFormat || null,
      feature: tracked ? usage.feature : null,
    });
    const promptChars = (Array.isArray(messages) ? messages : []).reduce(
      (n, m) => n + String(m?.content || '').length,
      0
    );
    await track(openAiModelName(modelFeature), Math.ceil(promptChars / 4), Math.ceil(text.length / 4));
    return text;
  }

  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    const err = new Error(AI_BLOCK_CODE.DISABLED);
    err.code = AI_BLOCK_CODE.DISABLED;
    throw err;
  }

  const body = {
    model: openAiModelName(modelFeature),
    temperature,
    max_tokens: maxTokens,
    messages,
  };
  if (responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${openAiBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = res.status === 401 || res.status === 403 ? 'RUBRIC_AI_AUTH' : 'RUBRIC_AI_FAILED';
    throw err;
  }

  await track(
    body.model,
    data?.usage?.prompt_tokens,
    data?.usage?.completion_tokens
  );

  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    const err = new Error('RUBRIC_AI_EMPTY');
    err.code = 'RUBRIC_AI_EMPTY';
    throw err;
  }
  return String(text).trim();
}

export function extractJsonObject(text) {
  const fence = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fence ? fence[1].trim() : String(text || '');
  const brace = candidate.match(/\{[\s\S]*\}/);
  if (brace) candidate = brace[0];
  return candidate;
}
