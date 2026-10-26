import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImportFields,
  profileImportSchema,
  importFingerprint,
} from '../../lib/recruiting/candidate-profile-import-core.js';
import { parseListValue } from '../../lib/list-url-state.js';

test('import accepts only professional profile fields and validates edited values', () => {
  assert.deepEqual(
    normalizeImportFields({
      email: ' TEST@example.com ',
      state: 'rs',
      phone: '(51) 99999-1234',
      linkedinUrl: 'linkedin.com/in/test',
    }),
    {
      email: 'test@example.com',
      state: 'RS',
      phone: '51999991234',
      linkedinUrl: 'https://linkedin.com/in/test',
    },
  );
  for (const input of [
    { companyId: '9' },
    { employmentStatus: 'employee' },
    { linkedinUrl: 'https://linkedin.com.evil.test/a' },
    { linkedinUrl: 'javascript:alert(1)' },
    { state: 'XX' },
    { phone: '123' },
    { email: 'bad' },
    { professionalSummary: 'x'.repeat(8001) },
  ])
    assert.throws(() => normalizeImportFields(input, { partial: true }));
  assert.throws(() => normalizeImportFields({}, { partial: true }));
  assert.deepEqual(normalizeImportFields({ email: null, fullName: '' }), {});
});
test('AI output rejects malformed, omitted and extra fields', () => {
  assert.equal(profileImportSchema.safeParse({ professionalSummary: 'hello' }).success, false);
  assert.equal(importFingerprint(null), importFingerprint(''));
  assert.notEqual(importFingerprint('old'), importFingerprint('new'));
});
test('URL list parser protects pagination and tag filter shape', () => {
  for (const raw of ['-2', 'null', '"bad"', '1.5', '1000001'])
    assert.equal(parseListValue(raw, 1, 'page'), 1);
  assert.equal(parseListValue('50', 20, 'pageSize'), 50);
  assert.equal(parseListValue('999', 20, 'pageSize'), 20);
  assert.equal(parseListValue('"query"', '', 'q'), 'query');
  const fallback = { tagIds: [], tagMode: 'any' };
  for (const value of [
    {},
    { tagIds: null, tagMode: 'any' },
    { tagIds: [1], tagMode: 'bad' },
    { tagIds: [-1], tagMode: 'all' },
  ])
    assert.deepEqual(parseListValue(JSON.stringify(value), fallback, 'tagFilters'), fallback);
  assert.deepEqual(parseListValue('{"tagIds":[1,2],"tagMode":"all"}', fallback, 'tagFilters'), {
    tagIds: [1, 2],
    tagMode: 'all',
  });
});

test('PDF extraction handles pooled buffers reliably on the first document', async () => {
  const { profilePdf } = await import('../fixtures/profile-pdf.js');
  const { extractPdfText } = await import('../../lib/recruiting/candidate-cv.js');
  const bytes = profilePdf([
    'Fictional Person',
    'fixture@dtov.invalid',
    'Software engineering, React and PostgreSQL',
  ]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pooled = Buffer.allocUnsafe(bytes.length);
    bytes.copy(pooled);
    assert.match(await extractPdfText(pooled), /fixture@dtov.invalid/);
  }
});

test('shared AI client forwards strict structured output and PDF content with a timeout', async () => {
  const { openAiChatCompletion } = await import('../../lib/openai-chat.js');
  const names = ['OPENAI_API_KEY', 'OPENAI_MOCK', 'DTOV', 'AI_ENABLED'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, { OPENAI_API_KEY: 'synthetic-test-key', OPENAI_MOCK: '0', DTOV: '0', AI_ENABLED: '1' });
    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(payload.response_format.json_schema.strict, true);
      assert.equal(payload.messages[0].content[0].file.filename, 'profile.pdf');
      assert.match(payload.messages[0].content[0].file.file_data, /^data:application\/pdf;base64,/);
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    };
    assert.equal(await openAiChatCompletion({ messages: [{ role: 'user', content: [{ type: 'file', file: { filename: 'profile.pdf', file_data: 'data:application/pdf;base64,JVBERg==' } }] }], responseFormat: { type: 'json_schema', json_schema: { name: 'profile', strict: true, schema: { type: 'object', properties: {}, required: [], additionalProperties: false } } }, timeoutMs: 1000 }), '{"ok":true}');
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});
