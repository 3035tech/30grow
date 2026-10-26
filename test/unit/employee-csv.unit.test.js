import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmployeeCsv } from '../../lib/employee-csv.js';
const header = 'nome_completo,email_corporativo,data_admissao,email_pessoal\n';
test('CSV accepts BOM, quoted commas, escaped quotes, CRLF and optional personal contact', () => {
  const rows = parseEmployeeCsv('\uFEFF' + header + '"Ana, ""Silva""",ANA@example.com,2026-01-01,\r\n', '2026-10-26');
  assert.equal(rows.length, 1); assert.equal(rows[0].fullName, 'Ana, "Silva"'); assert.equal(rows[0].email, 'ana@example.com'); assert.deepEqual(rows[0].errors, []);
  assert.equal(parseEmployeeCsv('nome_completo;email_corporativo;data_admissao\nAna;ana@example.com;2026-01-01')[0].errors.length, 0);
});
test('CSV reports invalid required fields, future/invalid dates, columns and duplicate contacts', () => {
  const rows = parseEmployeeCsv(header + ',bad,2026-02-30,wrong\nAna,ana@example.com,2027-01-01,\nBia,ANA@example.com,2026-01-01,\nCaio,c@example.com,2026-01-01,p@example.com\nDuda,p@example.com,2026-01-01,\nExtra,e@example.com,2026-01-01,,extra', '2026-10-26');
  assert.deepEqual(rows[0].errors, ['CSV_NAME', 'CSV_EMAIL', 'CSV_PERSONAL_EMAIL', 'CSV_DATE']);
  assert.ok(rows[1].errors.includes('CSV_DATE')); assert.ok(rows[2].errors.includes('CSV_DUPLICATE')); assert.ok(rows[4].errors.includes('CSV_DUPLICATE')); assert.ok(rows[5].errors.includes('CSV_COLUMNS'));
});
test('CSV refuses malformed input, unknown/duplicate headers and bounded batch size', () => {
  for (const csv of [header + '"unclosed', header + '"Ana"garbage,a@example.com,2026-01-01,']) assert.throws(() => parseEmployeeCsv(csv), /CSV_INVALID/);
  assert.throws(() => parseEmployeeCsv('nome_completo,extra\nAna,x'), /CSV_HEADERS/);
  assert.throws(() => parseEmployeeCsv(header), /CSV_EMPTY/);
  assert.throws(() => parseEmployeeCsv(header + 'x'.repeat(262145)), /CSV_TOO_LARGE/);
  assert.throws(() => parseEmployeeCsv(header + Array.from({ length: 101 }, (_, i) => `Ana,a${i}@example.com,2026-01-01,`).join('\n')), /CSV_TOO_MANY_ROWS/);
});

test('CSV row references account for blank lines and quoted line breaks', () => {
  const rows = parseEmployeeCsv(header + '\n"Ana\nSilva",ana@example.com,2026-01-01,\nBia,bad,2026-01-01,');
  assert.equal(rows[0].row, 3); assert.equal(rows[1].row, 5);
});
