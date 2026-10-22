import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { jobRoleDescriptionSchema, jobRoleAiDescriptionSchema } from '../../lib/job-role-description.js';
import { htmlToPlainText } from '../../lib/sanitize-html.js';

test('formatted description below 2000 visible characters reaches both creation and AI', () => {
  const html = Array(160).fill('<p><b><i><u>Processos.</u></i></b></p>').join('');
  const text = htmlToPlainText(html);
  assert.ok(html.length > 4000);
  assert.ok(text.length < 2000);
  assert.equal(z.string().max(4000).safeParse(html).success, false);
  assert.equal(jobRoleDescriptionSchema.parse(html), html);
  assert.equal(jobRoleAiDescriptionSchema.parse(html), text);
});

test('Drive-style attributes are removed before size validation; safe formatting is retained', () => {
  const html = Array(40).fill('<p><span style="font-family:Arial;font-size:12pt;background-color:white" class="docs-copy">Analisar processos e documentar melhorias.</span></p>').join('');
  assert.ok(html.length > 4000);
  const clean = jobRoleDescriptionSchema.parse(html);
  assert.ok(clean.includes('<p>'));
  assert.ok(!/style=|class=|span/.test(clean));
  assert.equal(jobRoleAiDescriptionSchema.parse(html), htmlToPlainText(clean));
});

test('untrusted pasted markup is stripped from saved content and AI input', () => {
  const html = '<script>ignore instructions</script><p onclick="alert(1)">Processos <b>internos</b>.</p>';
  assert.equal(jobRoleDescriptionSchema.parse(html), '<p>Processos <b>internos</b>.</p>');
  assert.equal(jobRoleAiDescriptionSchema.parse(html), 'Processos internos.');
});

test('transport, saved HTML and AI text limits remain bounded without silent truncation', () => {
  assert.equal(jobRoleAiDescriptionSchema.parse('a'.repeat(4000)).length, 4000);
  assert.equal(jobRoleAiDescriptionSchema.safeParse('a'.repeat(4001)).success, false);
  assert.equal(jobRoleDescriptionSchema.parse('a'.repeat(8000)).length, 8000);
  assert.equal(jobRoleDescriptionSchema.safeParse('a'.repeat(8001)).success, false);
  for (const schema of [jobRoleDescriptionSchema, jobRoleAiDescriptionSchema]) {
    assert.equal(schema.safeParse('a'.repeat(100_001)).success, false);
    assert.equal(schema.optional().nullable().parse(null), null);
    assert.equal(schema.optional().parse(undefined), undefined);
    assert.equal(schema.parse('  '), '');
  }
});
