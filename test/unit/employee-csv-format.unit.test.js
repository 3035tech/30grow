import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseEmployeeCsv } from '../../lib/employee/employee-csv-format.js';

const header = 'nome_completo,email_corporativo,data_admissao,email_pessoal\r\n';

test('accepts UTF-8 BOM, quoted delimiters and optional personal email', () => {
  const csv = `\uFEFF${header}"Ana, Maria",ANA@EXAMPLE.COM,2020-02-29,\r\n`;
  const parsed = parseEmployeeCsv(csv, '2026-10-26');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.rows.map(row => [row.line, row.fullName, row.email, row.personalEmail, row.errors]),
    [[2, 'Ana, Maria', 'ana@example.com', '', []]]);
});

test('accepts semicolon CSV with escaped quotes and keeps physical line numbers', () => {
  const parsed = parseEmployeeCsv('nome_completo;email_corporativo;data_admissao\n"Joana ""Jô""\nSilva";joana@example.com;2020-01-01\nBia;bia@example.com;2020-01-01\n', '2026-10-26');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows[0].fullName, 'Joana "jô" Silva');
  assert.deepEqual(parsed.rows[0].errors, []);
  assert.deepEqual(parsed.rows.map(row => row.line), [2, 4]);
});

test('flags missing work email, future date and duplicate identity without accepting personal as work', () => {
  const parsed = parseEmployeeCsv(`${header}Ana,,2099-01-01,ana@example.com\nBia,ana@example.com,2020-01-01,\n`, '2026-10-26');
  assert.equal(parsed.ok, true);
  assert.ok(parsed.rows[0].errors.includes('email_corporativo'));
  assert.ok(parsed.rows[0].errors.includes('data_admissao'));
  assert.ok(parsed.rows[1].errors.includes('email_corporativo_duplicado'));
});

test('rejects malformed CSV, unknown headers and impossible dates', () => {
  assert.equal(parseEmployeeCsv(`${header}"Ana,ana@example.com,2020-01-01,`, '2026-10-26').error, 'CSV_MALFORMED');
  assert.equal(parseEmployeeCsv('nome_completo,email_corporativo,data_admissao,cpf\nAna,ana@example.com,2020-01-01,123\n').error, 'CSV_HEADERS');
  const invalid = parseEmployeeCsv(`${header}Ana,ana@example.com,2021-02-29,\n`, '2026-10-26');
  assert.ok(invalid.rows[0].errors.includes('data_admissao'));
});

test('synthetic RH file previews six real-world rows without silent field loss', () => {
  const csv = readFileSync(new URL('../fixtures/employee-csv-rh-sintetico.csv', import.meta.url), 'utf8');
  const parsed = parseEmployeeCsv(csv, '2026-10-26');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 6);
  assert.ok(parsed.rows.every(row => row.errors.length === 0));
  assert.equal(parsed.rows[2].fullName, 'Carla, Maria Oliveira');
  assert.equal(parsed.rows[3].fullName, 'Débora Araújo');
  assert.equal(parsed.rows.filter(row => row.personalEmail).length, 3);
});
