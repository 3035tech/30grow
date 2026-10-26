import { t as i18nT, contentLocale } from '../i18n.js';

const CONTEXT_TEMPLATE_PT = `INSTRUÇÃO PARA O RH: preencha cada linha abaixo com dados reais desta vaga (não deixe em branco). Exemplo de título: "RH trainee".

- Nome/título: {title}
- Objetivo do papel (o que é sucesso em 60–90 dias):
- Senioridade (júnior/pleno/sênior) e nível de autonomia esperado:
- Ritmo e pressão (baixo/médio/alto) e como é medido:
- Trabalho mais individual vs colaborativo:
- O que mais derruba pessoas nessa função/programa:
- Restrições culturais/valores (ex.: "feedback direto", "alta disciplina", "ambiente caótico"):
{extraDescription}`;

const CONTEXT_TEMPLATE_EN = `INSTRUCTION FOR HR: fill in every line below with real data for this vacancy (do not leave blank). Example title: "HR trainee".

- Role / title: {title}
- Role goal (what success looks like in 60–90 days):
- Seniority (junior/mid/senior) and expected autonomy:
- Pace and pressure (low/medium/high) and how it is measured:
- More individual vs collaborative work:
- What most often causes people to fail in this role/program:
- Cultural constraints/values (e.g. "direct feedback", "high discipline", "chaotic environment"):
{extraDescription}`;

/**
 * Prompt for in-app weight generation — response MUST be parseable JSON only.
 * Machine contract (do not change without updating parseRubricWeightsFromAiText):
 * { "weights": { "1":0..3, ... "9":0..3 }, "notes": "plain text" }
 */
const PROMPT_PT = `Você é especialista em recrutamento e rubricas comportamentais (30Grow / Eneagrama T1–T9 no trabalho: heurística, não diagnóstico clínico).

Tarefa: sugerir PESOS relativos T1–T9 para o perfil desejado da vaga abaixo.

Referência rápida:
- T1 padrões/qualidade · T2 apoio/relacionamento · T3 performance/resultado · T4 profundidade/autenticidade
- T5 análise/autonomia · T6 risco/estrutura · T7 variedade/ideias · T8 assertividade · T9 estabilidade/mediação

Regras:
- Não invente fora do contexto.
- Prefira 2–4 tipos com peso > 0; demais 0.
- Pesos inteiros 0–3 (0=irrelevante, 1=bom ter, 2=importante, 3=muito importante).
- UMA única rubrica (não devolva versões A/B).
- Sem markdown, sem texto fora do JSON, sem blocos \`\`\`.

Resposta OBRIGATÓRIA: um único objeto JSON com exatamente este formato:
{"weights":{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0},"notes":"2 a 5 frases em português explicando o racional para o RH"}

CONTEXTO DA VAGA:
{context}
`;

const PROMPT_EN = `You are an expert in recruiting and behavioral rubrics (30Grow / Enneagram T1–T9 at work: heuristic, not clinical diagnosis).

Task: suggest relative T1–T9 WEIGHTS for the desired profile of the vacancy below.

Quick reference:
- T1 standards/quality · T2 support/relationship · T3 performance/results · T4 depth/authenticity
- T5 analysis/autonomy · T6 risk/structure · T7 variety/ideas · T8 assertiveness · T9 stability/mediation

Rules:
- Do not invent outside the context.
- Prefer 2–4 types with weight > 0; others 0.
- Integer weights 0–3 (0=irrelevant, 1=nice to have, 2=important, 3=very important).
- ONE rubric only (no A/B versions).
- No markdown, no text outside JSON, no \`\`\` fences.

REQUIRED response: a single JSON object with exactly this shape:
{"weights":{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0},"notes":"2–5 short sentences in English explaining the rationale for HR"}

VACANCY CONTEXT:
{context}
`;

/**
 * Structured blank context for the recruiter to complete before copying the prompt.
 * @param {{ locale?: string, title?: string, descriptionPlain?: string }} opts
 */
export function buildRubricContextDraft({ locale = 'pt-BR', title = '', descriptionPlain = '' } = {}) {
  const useEn = contentLocale(locale) === 'en';
  const tpl = useEn ? CONTEXT_TEMPLATE_EN : CONTEXT_TEMPLATE_PT;
  const extra = String(descriptionPlain || '').trim();
  const extraBlock = extra
    ? (i18nT(locale, 'ui.rubricPrompt.additionalDescriptionNotes', { extra }))
    : '';
  return tpl
    .replace('{title}', String(title || '').trim() || (i18nT(locale, 'ui.rubricPrompt.fillIn')))
    .replace('{extraDescription}', extraBlock);
}

/**
 * Prompt for LLM weight suggestion (in-app; response is JSON).
 * @param {{ locale?: string, context?: string, title?: string, descriptionPlain?: string }} opts
 */
export function buildRubricWeightsPrompt({
  locale = 'pt-BR',
  context = '',
  title = '',
  descriptionPlain = '',
} = {}) {
  const useEn = contentLocale(locale) === 'en';
  const filled =
    String(context || '').trim() ||
    buildRubricContextDraft({ locale, title, descriptionPlain });
  const body = useEn ? PROMPT_EN : PROMPT_PT;
  return body.replace('{context}', filled);
}

/**
 * Heuristic: recruiter filled more than title placeholder on several lines.
 * @param {string} context
 */
export function isRubricContextFilledEnough(context) {
  const lines = String(context || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'));
  let filled = 0;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (/^\(preencher\)$/i.test(value) || /^\(fill in\)$/i.test(value)) continue;
    filled += 1;
  }
  return filled >= 3;
}

function extractJsonObject(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fence ? fence[1].trim() : text;
  const brace = candidate.match(/\{[\s\S]*\}/);
  if (brace) candidate = brace[0];
  return candidate;
}

function extractSuggestedNotes(text, locale) {
  const useEn = contentLocale(locale) === 'en';
  const patterns = useEn
    ? [
        /(?:suggested\s+)?internal\s+notes[:\s]*([\s\S]+?)(?=\n\s*(?:\d\)|version\s*[ab]\b|$))/i,
        /(?:3\)\s*)?(?:suggested\s+)?internal\s+notes[^\n]*\n([\s\S]+)/i,
      ]
    : [
        /notas\s+internas(?:\s+sugeridas)?[:\s]*([\s\S]+?)(?=\n\s*(?:\d\)|versão\s*[ab]\b|$))/i,
        /(?:3\)\s*)?notas\s+internas[^\n]*\n([\s\S]+)/i,
      ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const notes = m[1].trim().replace(/^```[\s\S]*?```$/g, '').trim();
      if (notes.length > 8) return notes.slice(0, 4000);
    }
  }
  return '';
}

function normalizeWeightsMap(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const weights = {};
  for (let t = 1; t <= 9; t++) {
    const key = String(t);
    const alt = `T${t}`;
    const v = obj[key] ?? obj[t] ?? obj[alt] ?? obj[alt.toLowerCase()];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) continue;
    weights[key] = Math.max(0, Math.min(10, Math.round(n * 10) / 10));
  }
  return Object.keys(weights).length ? weights : null;
}

/**
 * Converte pesos relativos (ex. 0–3 da IA, chaves "1"…"9") em rubrica de cargo T1–T9 (%).
 * Soma ≈ 100; tipos com peso 0 são omitidos.
 * @param {Record<string, number>|null|undefined} weights
 * @returns {Record<string, number>}
 */
export function relativeWeightsToPercentRubric(weights) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return {};

  const rel = [];
  let sum = 0;
  for (let t = 1; t <= 9; t++) {
    const raw = weights[String(t)] ?? weights[t] ?? weights[`T${t}`] ?? 0;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
    const v = Number.isFinite(n) && n > 0 ? n : 0;
    rel.push(v);
    sum += v;
  }
  if (sum <= 0) return {};

  const entries = [];
  let allocated = 0;
  for (let t = 1; t <= 9; t++) {
    if (rel[t - 1] <= 0) continue;
    const pct = Math.round((rel[t - 1] / sum) * 100);
    entries.push({ type: `T${t}`, pct });
    allocated += pct;
  }
  if (!entries.length) return {};

  // Ajuste de arredondamento no tipo de maior peso relativo
  let drift = 100 - allocated;
  if (drift !== 0) {
    entries.sort((a, b) => b.pct - a.pct);
    entries[0].pct = Math.max(1, entries[0].pct + drift);
  }

  const out = {};
  for (const e of entries) {
    if (e.pct > 0) out[e.type] = Math.min(100, e.pct);
  }
  return out;
}

/**
 * Parse an LLM response into weights (+ optional notes).
 * Preferred shape: { "weights": { "1":0..3, ... }, "notes": "..." }
 * Legacy: flat { "1": n, ... "9": n } (+ optional free-text notes after JSON).
 * @returns {{ ok: true, weights: Record<string, number>, notes?: string } | { ok: false, error: string }}
 */
export function parseRubricWeightsFromAiText(raw, locale = 'pt-BR') {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: 'empty' };

  let obj;
  try {
    obj = JSON.parse(extractJsonObject(text));
  } catch {
    return { ok: false, error: 'json' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'shape' };
  }

  let notesFromJson = '';
  if (typeof obj.notes === 'string' && obj.notes.trim()) {
    notesFromJson = obj.notes.trim().slice(0, 4000);
  }

  // Canonical: { weights: {...}, notes?: "..." }
  let weightSource = obj;
  if (obj.weights && typeof obj.weights === 'object' && !Array.isArray(obj.weights)) {
    weightSource = obj.weights;
  } else if (obj.A && typeof obj.A === 'object') {
    // Legacy A/B — take A only
    weightSource = obj.A.weights && typeof obj.A.weights === 'object' ? obj.A.weights : obj.A;
  }

  const weights = normalizeWeightsMap(weightSource);
  if (!weights) return { ok: false, error: 'emptyWeights' };

  const notes = notesFromJson || extractSuggestedNotes(text, locale);
  return notes ? { ok: true, weights, notes } : { ok: true, weights };
}
