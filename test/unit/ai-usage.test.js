/**
 * Controle de custo de IA (B-2701 / B-2702 / B-2703): teto, registro e kill switch.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_FEATURE,
  aiUsageContext,
  assertAiQuota,
  effectiveCompanyAiLimit,
  estimateAiCostMicros,
  aiModelOverride,
  isAiEnabled,
  listAiUsageReport,
  parseAiMonthlyCallLimit,
  parseAiUsageMonth,
  recordAiUsage,
} from '../../lib/ai-usage.js';
import { isOpenAiConfigured, openAiBaseUrl, openAiChatCompletion, openAiModelName } from '../../lib/openai-chat.js';
import { answerHelpQuestion } from '../../lib/help-assistant.js';
import { interpretPeopleSignalsAi } from '../../lib/people/interpret-ai.js';
import { ERR, httpStatusForError } from '../../lib/api-error-codes.js';

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_COMPANY_MONTHLY_CALL_LIMIT',
  'AI_GLOBAL_MONTHLY_CALL_LIMIT',
  'OPENAI_MOCK',
  'OPENAI_BASE_URL',
  'OPENAI_RUBRIC_MODEL',
  'AI_MODEL_HELP_ASSISTANT',
];

function fakeDb({ limit = null, used = 0, globalUsed = 0, fail = false } = {}) {
  const inserts = [];
  const sqls = [];
  return {
    inserts,
    sqls,
    async query(sql, params = []) {
      sqls.push(sql);
      if (fail) throw new Error('db down');
      if (/INSERT INTO ai_usage_events/.test(sql)) {
        inserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (/FROM companies c/.test(sql)) return { rows: [{ limit, used }] };
      if (/FROM ai_usage_events/.test(sql)) return { rows: [{ used: globalUsed }] };
      return { rows: [] };
    },
  };
}

const messages = [
  { role: 'system', content: 'Você é o assistente de ajuda do 30Grow.' },
  { role: 'user', content: 'Contexto do guia: como criar vaga?' },
];

describe('ai-usage', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.OPENAI_MOCK = '1';
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('estima custo por modelo, aceitando versão e prefixo de gateway', () => {
    assert.equal(estimateAiCostMicros('gpt-4o-mini', 1000, 1000), 750);
    assert.equal(estimateAiCostMicros('gpt-4o-mini-2024-07-18', 1000, 1000), 750);
    assert.equal(estimateAiCostMicros('openai/gpt-4o-mini', 1000, 1000), 750);
    assert.equal(estimateAiCostMicros('gpt-4o', 1000, 0), 2500);
    assert.equal(estimateAiCostMicros('modelo-desconhecido', 1000, 1000), 0);
  });

  it('valida o teto informado no admin', () => {
    assert.deepEqual(parseAiMonthlyCallLimit(''), { ok: true, value: null });
    assert.deepEqual(parseAiMonthlyCallLimit(null), { ok: true, value: null });
    assert.deepEqual(parseAiMonthlyCallLimit('0'), { ok: true, value: 0 });
    assert.deepEqual(parseAiMonthlyCallLimit(250), { ok: true, value: 250 });
    assert.equal(parseAiMonthlyCallLimit('-1').ok, false);
    assert.equal(parseAiMonthlyCallLimit('2.5').ok, false);
    assert.equal(parseAiMonthlyCallLimit('abc').ok, false);
    assert.equal(parseAiMonthlyCallLimit('1000001').ok, false);
  });

  it('teto efetivo: valor da empresa ou padrão do env', () => {
    assert.equal(effectiveCompanyAiLimit(null), 500);
    process.env.AI_COMPANY_MONTHLY_CALL_LIMIT = '40';
    assert.equal(effectiveCompanyAiLimit(null), 40);
    assert.equal(effectiveCompanyAiLimit(0), 0);
    assert.equal(effectiveCompanyAiLimit(7), 7);
  });

  it('kill switch AI_ENABLED=0 desliga configuração e chamadas', async () => {
    assert.equal(isAiEnabled(), true);
    process.env.AI_ENABLED = '0';
    assert.equal(isAiEnabled(), false);
    assert.equal(isOpenAiConfigured(), false);
    const db = fakeDb();
    await assert.rejects(
      openAiChatCompletion({ messages, usage: { companyId: 1, feature: AI_FEATURE.HELP_ASSISTANT, db } }),
      (err) => err.code === ERR.RUBRIC_AI_NOT_CONFIGURED
    );
    assert.equal(db.sqls.length, 0);
  });

  it('OPENAI_BASE_URL só aceita https e remove barra final', () => {
    assert.equal(openAiBaseUrl(), 'https://api.openai.com/v1');
    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1/';
    assert.equal(openAiBaseUrl(), 'https://openrouter.ai/api/v1');
    process.env.OPENAI_BASE_URL = 'http://inseguro.local/v1';
    assert.equal(openAiBaseUrl(), 'https://api.openai.com/v1');
  });

  it('bloqueia quando a empresa atingiu o teto do mês', async () => {
    await assert.rejects(
      assertAiQuota(fakeDb({ limit: 10, used: 10 }), { companyId: 3 }),
      (err) => err.code === ERR.AI_MONTHLY_LIMIT
    );
    await assertAiQuota(fakeDb({ limit: 10, used: 9 }), { companyId: 3 });
    await assert.rejects(
      assertAiQuota(fakeDb({ limit: 0, used: 0 }), { companyId: 3 }),
      (err) => err.code === ERR.AI_MONTHLY_LIMIT
    );
    process.env.AI_COMPANY_MONTHLY_CALL_LIMIT = '5';
    await assert.rejects(
      assertAiQuota(fakeDb({ limit: null, used: 5 }), { companyId: 3 }),
      (err) => err.code === ERR.AI_MONTHLY_LIMIT
    );
    assert.equal(httpStatusForError(ERR.AI_MONTHLY_LIMIT), 429);
  });

  it('teto global opcional vira "IA indisponível"; sem empresa só conta o global', async () => {
    const noGlobal = fakeDb();
    await assertAiQuota(noGlobal, { companyId: null });
    assert.equal(noGlobal.sqls.length, 0);
    process.env.AI_GLOBAL_MONTHLY_CALL_LIMIT = '100';
    await assert.rejects(
      assertAiQuota(fakeDb({ globalUsed: 100 }), { companyId: null }),
      (err) => err.code === ERR.RUBRIC_AI_NOT_CONFIGURED
    );
    await assertAiQuota(fakeDb({ globalUsed: 99 }), { companyId: null });
  });

  it('falha de banco na checagem não bloqueia a feature', async () => {
    await assertAiQuota(fakeDb({ fail: true }), { companyId: 3 });
  });

  it('registro ignora feature fora do domínio e engole erro de banco', async () => {
    const db = fakeDb();
    await recordAiUsage(db, { companyId: 1, feature: 'inventada', model: 'x' });
    assert.equal(db.inserts.length, 0);
    await recordAiUsage(fakeDb({ fail: true }), { companyId: 1, feature: AI_FEATURE.HELP_ASSISTANT });
  });

  it('chamada com contexto registra empresa, usuário, feature, tokens e custo', async () => {
    const db = fakeDb({ limit: 10, used: 0 });
    const text = await openAiChatCompletion({
      messages,
      usage: { companyId: 7, userId: 9, feature: AI_FEATURE.RUBRIC_WEIGHTS, db },
    });
    assert.ok(text.length > 0);
    assert.equal(db.inserts.length, 1);
    const [companyId, userId, feature, , promptTokens, completionTokens, cost] = db.inserts[0];
    assert.equal(companyId, 7);
    assert.equal(userId, 9);
    assert.equal(feature, AI_FEATURE.RUBRIC_WEIGHTS);
    assert.ok(promptTokens > 0 && completionTokens > 0);
    assert.ok(cost >= 0);
  });

  it('teto estourado: não chama o modelo nem registra', async () => {
    const db = fakeDb({ limit: 2, used: 2 });
    await assert.rejects(
      openAiChatCompletion({ messages, usage: { companyId: 7, feature: AI_FEATURE.HELP_ASSISTANT, db } }),
      (err) => err.code === ERR.AI_MONTHLY_LIMIT
    );
    assert.equal(db.inserts.length, 0);
  });

  it('sem contexto (scripts offline) não toca no banco', async () => {
    const text = await openAiChatCompletion({ messages });
    assert.ok(text.length > 0);
  });

  it('aiUsageContext mantém a feature de quem chamou primeiro', () => {
    assert.equal(aiUsageContext(null, AI_FEATURE.RUBRIC_WEIGHTS), null);
    const outer = aiUsageContext({ companyId: 1, userId: 2 }, AI_FEATURE.JOB_ROLE_RUBRIC);
    assert.equal(aiUsageContext(outer, AI_FEATURE.RUBRIC_WEIGHTS).feature, AI_FEATURE.JOB_ROLE_RUBRIC);
  });

  it('assistente de Ajuda volta para a resposta do Guia quando o teto estoura', async () => {
    const db = fakeDb({ limit: 1, used: 1 });
    const out = await answerHelpQuestion({
      question: 'Quais critérios o radar de turnover usa para risco alto?',
      locale: 'pt-BR',
      usage: { companyId: 7, userId: 9, db },
    });
    assert.ok(db.sqls.length > 0);
    assert.equal(out.source, 'retrieve');
    assert.ok(out.answer.length > 0);
    assert.equal(db.inserts.length, 0);
  });

  it('interpretação de pessoas devolve AI_MONTHLY_LIMIT no teto', async () => {
    const out = await interpretPeopleSignalsAi({
      kind: 'person',
      locale: 'pt-BR',
      signals: { candidate: { name: 'Ana' } },
      usage: { companyId: 7, userId: 9, db: fakeDb({ limit: 0 }) },
    });
    assert.deepEqual(out, { ok: false, errorCode: ERR.AI_MONTHLY_LIMIT });
  });

  it('modelo por funcionalidade: AI_MODEL_<FEATURE> sobrepõe o padrão', () => {
    delete process.env.OPENAI_MOCK;
    const savedDtov = process.env.DTOV;
    delete process.env.DTOV;
    try {
      assert.equal(openAiModelName(AI_FEATURE.HELP_ASSISTANT), 'gpt-4o-mini');
      process.env.OPENAI_RUBRIC_MODEL = 'gpt-4.1-mini';
      process.env.AI_MODEL_HELP_ASSISTANT = 'gpt-4.1-nano';
      assert.equal(aiModelOverride(AI_FEATURE.HELP_ASSISTANT), 'gpt-4.1-nano');
      assert.equal(openAiModelName(AI_FEATURE.HELP_ASSISTANT), 'gpt-4.1-nano');
      assert.equal(openAiModelName(AI_FEATURE.RUBRIC_WEIGHTS), 'gpt-4.1-mini');
      assert.equal(openAiModelName(), 'gpt-4.1-mini');
      assert.equal(aiModelOverride('inventada'), null);
    } finally {
      if (savedDtov !== undefined) process.env.DTOV = savedDtov;
    }
  });

  it('mês do relatório: YYYY-MM válido ou mês corrente em UTC', () => {
    assert.deepEqual(parseAiUsageMonth('2026-09'), { month: '2026-09', start: '2026-09-01' });
    const now = new Date(Date.UTC(2026, 0, 31, 23));
    assert.deepEqual(parseAiUsageMonth('2026-13', now), { month: '2026-01', start: '2026-01-01' });
    assert.deepEqual(parseAiUsageMonth('', now), { month: '2026-01', start: '2026-01-01' });
  });

  it('relatório: filtra por mês/empresa/feature, pagina e marca teto atingido', async () => {
    const calls = [];
    const db = {
      async queryRead(sql, params) {
        calls.push({ sql, params });
        if (/GROUP BY e\.company_id/.test(sql)) {
          return {
            rows: [
              { companyId: '4', companyName: 'Acme', companyLimit: 2, calls: 3, promptTokens: '900', completionTokens: '300', costMicros: '315', totalRows: 2 },
              { companyId: null, companyName: null, companyLimit: null, calls: 1, promptTokens: '10', completionTokens: '5', costMicros: '0', totalRows: 2 },
            ],
          };
        }
        return {
          rows: [
            { feature: 'help_assistant', calls: 3, prompt_tokens: '700', completion_tokens: '250', cost_micros: '255' },
            { feature: 'rubric_weights', calls: 1, prompt_tokens: '210', completion_tokens: '55', cost_micros: '60' },
          ],
        };
      },
    };
    const out = await listAiUsageReport(db, { month: '2026-09', companyId: 4, feature: 'help_assistant', page: 2, pageSize: 500 });
    assert.equal(out.month, '2026-09');
    assert.equal(out.pageSize, 100);
    assert.equal(out.total, 2);
    assert.deepEqual(out.totals, { calls: 4, promptTokens: 910, completionTokens: 305, costMicros: 315 });
    assert.deepEqual(out.items[0], {
      companyId: 4, companyName: 'Acme', calls: 3, limit: 2, reached: true,
      promptTokens: 900, completionTokens: 300, costMicros: 315,
    });
    assert.equal(out.items[1].companyId, null);
    assert.equal(out.items[1].limit, null);
    const [companySql, featureSql] = calls;
    assert.deepEqual(companySql.params, ['2026-09-01', 4, 'help_assistant', 100, 100]);
    assert.deepEqual(featureSql.params, ['2026-09-01', 4, 'help_assistant']);
    assert.match(companySql.sql, /e\.created_at >= \$1::date/);
    await listAiUsageReport(db, { feature: 'inventada' });
    assert.equal(calls[2].params.length, 3);
  });
});
