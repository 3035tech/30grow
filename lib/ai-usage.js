/**
 * Controle de custo de IA (B-2701 / B-2702 / B-2703): consumo, teto mensal e kill switch.
 * Tabela: ai_usage_events (migration 144). Teto por empresa: companies.ai_monthly_call_limit.
 *
 * Env:
 * - AI_ENABLED=0 desliga todas as chamadas (UI trata como "IA indisponível").
 * - AI_COMPANY_MONTHLY_CALL_LIMIT (default 500): teto padrão por empresa/mês.
 * - AI_GLOBAL_MONTHLY_CALL_LIMIT (opcional): teto de todo o sistema/mês.
 */

import { ERR } from './api-error-codes.js';

/** Espelha ai_usage_events_feature_chk (migrations 144, 151). */
export const AI_FEATURE = Object.freeze({
  RUBRIC_CONTEXT: 'rubric_context',
  RUBRIC_WEIGHTS: 'rubric_weights',
  JOB_ROLE_RUBRIC: 'job_role_rubric',
  VACANCY_EXECUTIVE_NOTE: 'vacancy_executive_note',
  VACANCY_SHORTLIST: 'vacancy_shortlist',
  VACANCY_CANDIDATE_FIELDS: 'vacancy_candidate_fields',
  INTERVIEW_NOTES_SUMMARY: 'interview_notes_summary',
  VACANCY_DESCRIPTION: 'vacancy_description',
  PEOPLE_INTERPRET: 'people_interpret',
  HELP_ASSISTANT: 'help_assistant',
  HELP_DIAGNOSE: 'help_diagnose',
  PEOPLE_COPILOT: 'people_copilot',
});

const AI_FEATURE_SET = new Set(Object.values(AI_FEATURE));

export const AI_COMPANY_MONTHLY_CALL_LIMIT_DEFAULT = 500;
export const AI_MONTHLY_CALL_LIMIT_MAX = 1000000;

/** Códigos de erro lançados antes da chamada (err.code). */
export const AI_BLOCK_CODE = Object.freeze({
  DISABLED: ERR.RUBRIC_AI_NOT_CONFIGURED,
  COMPANY_LIMIT: ERR.AI_MONTHLY_LIMIT,
});

/** US$ por 1M tokens (entrada / saída). Conferir no painel do fornecedor ao trocar de modelo. */
const PRICE_PER_MTOK = Object.freeze({
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4.1': [2, 8],
});

function envFlagOff(name) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

function envLimit(name) {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, AI_MONTHLY_CALL_LIMIT_MAX) : null;
}

export function isAiEnabled() {
  return !envFlagOff('AI_ENABLED');
}

export function aiDefaultCompanyMonthlyLimit() {
  return envLimit('AI_COMPANY_MONTHLY_CALL_LIMIT') ?? AI_COMPANY_MONTHLY_CALL_LIMIT_DEFAULT;
}

export function aiGlobalMonthlyLimit() {
  return envLimit('AI_GLOBAL_MONTHLY_CALL_LIMIT');
}

export function isAiFeature(value) {
  return AI_FEATURE_SET.has(value);
}

/** Env AI_MODEL_<FEATURE> (ex.: AI_MODEL_HELP_ASSISTANT=gpt-4.1-nano); vazio = modelo padrão. */
export function aiModelOverride(feature) {
  if (!isAiFeature(feature)) return null;
  const v = String(process.env[`AI_MODEL_${feature.toUpperCase()}`] || '').trim();
  return v ? v.slice(0, 120) : null;
}

/** Teto efetivo: valor da empresa ou padrão do sistema. */
export function effectiveCompanyAiLimit(companyLimit) {
  const n = companyLimit == null ? null : Number(companyLimit);
  return Number.isInteger(n) && n >= 0 ? n : aiDefaultCompanyMonthlyLimit();
}

/**
 * Valor do formulário admin → coluna (null = padrão do sistema).
 * @returns {{ ok: true, value: number|null } | { ok: false }}
 */
export function parseAiMonthlyCallLimit(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0 || n > AI_MONTHLY_CALL_LIMIT_MAX) return { ok: false };
  return { ok: true, value: n };
}

const PRICE_KEYS_LONGEST_FIRST = Object.keys(PRICE_PER_MTOK).sort((a, b) => b.length - a.length);

/** Aceita sufixo de versão (gpt-4o-mini-2024-07-18) e prefixo de gateway (openai/gpt-4o-mini). */
function priceFor(model) {
  const key = String(model || '').trim().toLowerCase().split('/').pop();
  if (PRICE_PER_MTOK[key]) return PRICE_PER_MTOK[key];
  const hit = PRICE_KEYS_LONGEST_FIRST.find((k) => key.startsWith(`${k}-`));
  return hit ? PRICE_PER_MTOK[hit] : null;
}

export function estimateAiCostMicros(model, promptTokens, completionTokens) {
  const price = priceFor(model);
  if (!price) return 0;
  const [inPrice, outPrice] = price;
  const micros = (Number(promptTokens) || 0) * inPrice + (Number(completionTokens) || 0) * outPrice;
  return Math.max(0, Math.round(micros));
}

function blockError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/**
 * Bloqueia antes de chamar o modelo: teto da empresa e teto global do mês.
 * Falha de banco não bloqueia a feature (fail-open; o rate limit por usuário continua valendo).
 * @param {{ query: Function }} db
 * @param {{ companyId?: number|null }} ctx
 */
export async function assertAiQuota(db, { companyId } = {}) {
  const cid = Number(companyId);
  const globalLimit = aiGlobalMonthlyLimit();
  try {
    if (Number.isFinite(cid) && cid > 0) {
      const r = await db.query(
        `SELECT c.ai_monthly_call_limit AS "limit",
                (SELECT COUNT(*)::int
                   FROM ai_usage_events e
                  WHERE e.company_id = c.id
                    AND e.created_at >= date_trunc('month', NOW())) AS used
           FROM companies c
          WHERE c.id = $1
          LIMIT 1`,
        [cid]
      );
      const row = r.rows[0];
      if (row && Number(row.used) >= effectiveCompanyAiLimit(row.limit)) {
        throw blockError(AI_BLOCK_CODE.COMPANY_LIMIT);
      }
    }
    if (globalLimit != null) {
      const g = await db.query(
        `SELECT COUNT(*)::int AS used
           FROM ai_usage_events
          WHERE created_at >= date_trunc('month', NOW())`
      );
      if (Number(g.rows[0]?.used) >= globalLimit) {
        throw blockError(AI_BLOCK_CODE.DISABLED);
      }
    }
  } catch (err) {
    if (err?.code === AI_BLOCK_CODE.COMPANY_LIMIT || err?.code === AI_BLOCK_CODE.DISABLED) throw err;
    console.error('[ai-usage] quota check failed', err?.message || err);
  }
}

/**
 * Registra uma chamada concluída. Nunca lança (log não quebra a feature).
 * @param {{ query: Function }} db
 */
export async function recordAiUsage(db, { companyId, userId, feature, model, promptTokens, completionTokens }) {
  if (!isAiFeature(feature)) return;
  const cid = Number(companyId);
  const uid = Number(userId);
  const pt = Math.max(0, Math.round(Number(promptTokens) || 0));
  const ct = Math.max(0, Math.round(Number(completionTokens) || 0));
  const modelName = String(model || '').slice(0, 120);
  try {
    await db.query(
      `INSERT INTO ai_usage_events
         (company_id, user_id, feature, model, prompt_tokens, completion_tokens, cost_micros)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        Number.isFinite(cid) && cid > 0 ? cid : null,
        Number.isFinite(uid) && uid > 0 ? uid : null,
        feature,
        modelName,
        pt,
        ct,
        estimateAiCostMicros(modelName, pt, ct),
      ]
    );
  } catch (err) {
    console.error('[ai-usage] record failed', err?.message || err);
  }
}

/** 'YYYY-MM' → primeiro dia ('YYYY-MM-01'); inválido ou vazio → mês corrente (UTC). */
export function parseAiUsageMonth(raw, now = new Date()) {
  const m = String(raw || '').trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) return { month: `${m[1]}-${m[2]}`, start: `${m[1]}-${m[2]}-01` };
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  return { month: `${y}-${mo}`, start: `${y}-${mo}-01` };
}

/**
 * Consumo do mês agrupado por empresa (paginado) + totais por funcionalidade.
 * Lê só o intervalo do mês (idx_ai_usage_events_created / company_month).
 * @param {{ queryRead: Function }} db
 * @param {{ month?: string, companyId?: number|null, feature?: string|null, page?: number, pageSize?: number }} opts
 */
export async function listAiUsageReport(db, { month, companyId = null, feature = null, page = 1, pageSize = 20 } = {}) {
  const range = parseAiUsageMonth(month);
  const where = [`e.created_at >= $1::date`, `e.created_at < ($1::date + INTERVAL '1 month')`];
  const params = [range.start];
  const cid = Number(companyId);
  if (Number.isFinite(cid) && cid > 0) {
    params.push(cid);
    where.push(`e.company_id = $${params.length}`);
  }
  if (feature && isAiFeature(feature)) {
    params.push(feature);
    where.push(`e.feature = $${params.length}`);
  }
  const whereSql = where.join(' AND ');
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const safePage = Math.max(1, Number(page) || 1);

  const [byCompany, byFeature] = await Promise.all([
    db.queryRead(
      `WITH ev AS (
         SELECT e.company_id,
                COUNT(*)::int AS calls,
                COALESCE(SUM(e.prompt_tokens), 0)::bigint AS prompt_tokens,
                COALESCE(SUM(e.completion_tokens), 0)::bigint AS completion_tokens,
                COALESCE(SUM(e.cost_micros), 0)::bigint AS cost_micros
           FROM ai_usage_events e
          WHERE ${whereSql}
          GROUP BY e.company_id
       )
       SELECT ev.company_id AS "companyId",
              c.name AS "companyName",
              c.ai_monthly_call_limit AS "companyLimit",
              ev.calls,
              ev.prompt_tokens AS "promptTokens",
              ev.completion_tokens AS "completionTokens",
              ev.cost_micros AS "costMicros",
              COUNT(*) OVER ()::int AS "totalRows"
         FROM ev
         LEFT JOIN companies c ON c.id = ev.company_id
        ORDER BY ev.calls DESC, ev.company_id NULLS LAST
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (safePage - 1) * size]
    ),
    db.queryRead(
      `SELECT e.feature,
              COUNT(*)::int AS calls,
              COALESCE(SUM(e.prompt_tokens), 0)::bigint AS prompt_tokens,
              COALESCE(SUM(e.completion_tokens), 0)::bigint AS completion_tokens,
              COALESCE(SUM(e.cost_micros), 0)::bigint AS cost_micros
         FROM ai_usage_events e
        WHERE ${whereSql}
        GROUP BY e.feature
        ORDER BY calls DESC`,
      params
    ),
  ]);

  const features = byFeature.rows.map((r) => ({
    feature: r.feature,
    calls: Number(r.calls) || 0,
    promptTokens: Number(r.prompt_tokens) || 0,
    completionTokens: Number(r.completion_tokens) || 0,
    costMicros: Number(r.cost_micros) || 0,
  }));
  const totals = features.reduce(
    (acc, f) => ({
      calls: acc.calls + f.calls,
      promptTokens: acc.promptTokens + f.promptTokens,
      completionTokens: acc.completionTokens + f.completionTokens,
      costMicros: acc.costMicros + f.costMicros,
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, costMicros: 0 }
  );

  return {
    month: range.month,
    totals,
    features,
    items: byCompany.rows.map((r) => {
      const calls = Number(r.calls) || 0;
      const hasCompany = r.companyId != null;
      const limit = hasCompany ? effectiveCompanyAiLimit(r.companyLimit) : null;
      return {
        companyId: hasCompany ? Number(r.companyId) : null,
        companyName: r.companyName || null,
        calls,
        limit,
        reached: limit != null && calls >= limit,
        promptTokens: Number(r.promptTokens) || 0,
        completionTokens: Number(r.completionTokens) || 0,
        costMicros: Number(r.costMicros) || 0,
      };
    }),
    total: Number(byCompany.rows[0]?.totalRows) || 0,
    page: safePage,
    pageSize: size,
  };
}

/** Contexto de consumo que as rotas passam para os helpers de IA. */
export function aiUsageContext(usage, feature) {
  if (!usage) return null;
  return {
    companyId: usage.companyId ?? null,
    userId: usage.userId ?? null,
    feature: usage.feature || feature,
    db: usage.db,
  };
}
