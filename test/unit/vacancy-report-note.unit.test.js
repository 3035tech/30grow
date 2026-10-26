import assert from 'node:assert/strict';
import test from 'node:test';
import { shortlistNoteDraft } from '../../lib/vacancy-report-note.js';

test('shortlist draft uses recorded evidence and escapes user text', () => {
  const note = shortlistNoteDraft({
    locale: 'pt-BR',
    vacancyTitle: 'Pessoa <script>',
    people: [
      { name: 'Ana <img>', recommendation: 'advance', fitScore: 7.4, why: 'Experiência em suporte', interviewProbe: 'Como lidou com picos?' },
      { name: 'Bia', recommendation: 'discuss', watchOut: 'Validar disponibilidade' },
    ],
  });
  assert.match(note, /aderência 7\.4\/10/);
  assert.match(note, /Experiência em suporte/);
  assert.match(note, /Como lidou com picos\?/);
  assert.match(note, /Validar disponibilidade/);
  assert.match(note, /&lt;script&gt;/);
  assert.doesNotMatch(note, /<script>|<img>|rubrica T1|profundidade técnica/);
});

test('shortlist draft flags missing evidence instead of inventing a reason', () => {
  const note = shortlistNoteDraft({ locale: 'en', people: [{ name: 'Jo', recommendation: 'advance' }] });
  assert.match(note, /Add role-specific reasons/);
  assert.match(note, /Record the questions/);
  assert.doesNotMatch(note, /ranked by rubric|technical depth|interview notes/);
  assert.match(shortlistNoteDraft({ locale: 'pt-BR' }), /Nenhuma pessoa selecionada até o momento/);
});
