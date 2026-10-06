/**
 * B-2705 — cache of repeated AI answers (memory path; no REDIS_URL in unit runs).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetAiResponseCacheMemory,
  aiResponseCacheKey,
  isAiResponseCacheEnabled,
} from '../../lib/ai-response-cache.js';
import {
  __getOpenAiMockLog,
  __resetOpenAiMockLog,
  openAiChatCompletion,
} from '../../lib/openai-chat.js';
import { AI_FEATURE } from '../../lib/ai-usage.js';

const ENV_KEYS = ['OPENAI_MOCK', 'AI_RESPONSE_CACHE', 'AI_ENABLED', 'REDIS_URL', 'UPSTASH_REDIS_URL'];

const messages = [
  { role: 'system', content: 'Você é o assistente de ajuda do 30Grow.' },
  { role: 'user', content: 'Como   criar uma vaga?\n' },
];

function fakeDb() {
  const inserts = [];
  return {
    inserts,
    async query(sql, params = []) {
      if (/INSERT INTO ai_usage_events/.test(sql)) {
        inserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (/FROM companies c/.test(sql)) return { rows: [{ limit: null, used: 0 }] };
      if (/FROM ai_usage_events/.test(sql)) return { rows: [{ used: 0 }] };
      return { rows: [] };
    },
  };
}

describe('ai-response-cache', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.OPENAI_MOCK = '1';
    __resetAiResponseCacheMemory();
    __resetOpenAiMockLog();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('chave estável ao espaço em branco e separada por escopo, feature e modelo', () => {
    const base = { feature: 'help_assistant', model: 'm', messages };
    const k = aiResponseCacheKey(base);
    const spaced = aiResponseCacheKey({
      ...base,
      messages: messages.map((m) => ({ ...m, content: `  ${m.content.replace(/ /g, '  ')} ` })),
    });
    assert.equal(k, spaced);
    assert.match(k, /^team30:ai:v1:g:help_assistant:[0-9a-f]{64}$/);
    assert.match(aiResponseCacheKey({ ...base, companyId: 7 }), /:ai:v1:c7:/);
    assert.notEqual(aiResponseCacheKey({ ...base, companyId: 7 }), aiResponseCacheKey({ ...base, companyId: 8 }));
    assert.notEqual(k, aiResponseCacheKey({ ...base, feature: 'rubric_context' }));
    assert.notEqual(k, aiResponseCacheKey({ ...base, model: 'other' }));
    assert.notEqual(k, aiResponseCacheKey({ ...base, responseFormat: 'json_object' }));
    assert.equal(aiResponseCacheKey({ ...base, companyId: 'x' }), null);
    assert.equal(aiResponseCacheKey({ ...base, companyId: -1 }), null);
  });

  it('acerto não chama a IA nem registra uso', async () => {
    const db = fakeDb();
    const usage = { companyId: 3, userId: 1, feature: AI_FEATURE.HELP_ASSISTANT, db };
    const opts = { messages, usage, feature: AI_FEATURE.HELP_ASSISTANT, cache: { companyId: null } };
    const first = await openAiChatCompletion(opts);
    const second = await openAiChatCompletion(opts);
    assert.equal(second, first);
    assert.equal(__getOpenAiMockLog().length, 1);
    assert.equal(db.inserts.length, 1);
  });

  it('escopo por empresa não vaza entre tenants', async () => {
    const call = (companyId) =>
      openAiChatCompletion({ messages, feature: AI_FEATURE.RUBRIC_CONTEXT, cache: { companyId } });
    await call(1);
    await call(1);
    await call(2);
    assert.equal(__getOpenAiMockLog().length, 2);
  });

  it('sem opção cache ou com AI_RESPONSE_CACHE=0 sempre chama a IA', async () => {
    await openAiChatCompletion({ messages });
    await openAiChatCompletion({ messages });
    assert.equal(__getOpenAiMockLog().length, 2);

    process.env.AI_RESPONSE_CACHE = '0';
    assert.equal(isAiResponseCacheEnabled(), false);
    await openAiChatCompletion({ messages, cache: { companyId: null } });
    await openAiChatCompletion({ messages, cache: { companyId: null } });
    assert.equal(__getOpenAiMockLog().length, 4);
  });

  it('json_object só entra no cache quando a resposta é JSON válido', async () => {
    const jsonMsgs = [{ role: 'user', content: 'Responda com candidateIds para "candidateId": 4' }];
    await openAiChatCompletion({ messages: jsonMsgs, responseFormat: 'json_object', cache: { companyId: 1 } });
    await openAiChatCompletion({ messages: jsonMsgs, responseFormat: 'json_object', cache: { companyId: 1 } });
    assert.equal(__getOpenAiMockLog().length, 1);

    __resetOpenAiMockLog();
    const textMsgs = [{ role: 'user', content: 'Texto livre sem JSON nenhum.' }];
    const text = await openAiChatCompletion({ messages: textMsgs, responseFormat: 'json_object', cache: { companyId: 1 } });
    assert.throws(() => JSON.parse(text));
    await openAiChatCompletion({ messages: textMsgs, responseFormat: 'json_object', cache: { companyId: 1 } });
    assert.equal(__getOpenAiMockLog().length, 2);
  });
});
