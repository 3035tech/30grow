import { z } from 'zod';
import { titleCasePersonName } from '../person-name.js';

export const EMPLOYEE_CSV_MAX_BYTES = 64 * 1024;
export const EMPLOYEE_CSV_MAX_ROWS = 100;
export const EMPLOYEE_CSV_HEADERS = Object.freeze(['nome_completo', 'email_corporativo', 'data_admissao', 'email_pessoal']);
const REQUIRED_HEADERS = EMPLOYEE_CSV_HEADERS.slice(0, 3);
const emailSchema = z.string().email().max(254);

function parseCells(csv, delimiter) {
  const records = [];
  let record = [], cell = '', quoted = false, closedQuote = false;
  let line = 1, recordLine = 1;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && csv[i + 1] === '\n') i++;
        cell += '\n'; line++;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (cell || closedQuote) throw new Error('CSV_MALFORMED');
      quoted = true;
    } else if (char === delimiter) {
      record.push(cell); cell = ''; closedQuote = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      record.push(cell); records.push({ line: recordLine, cells: record });
      record = []; cell = ''; closedQuote = false; recordLine = ++line;
    } else {
      if (closedQuote && char !== ' ' && char !== '\t') throw new Error('CSV_MALFORMED');
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV_MALFORMED');
  if (record.length || cell) { record.push(cell); records.push({ line: recordLine, cells: record }); }
  return records;
}

function validDate(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today;
}

export function parseEmployeeCsv(input, today = new Date().toISOString().slice(0, 10)) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > EMPLOYEE_CSV_MAX_BYTES) {
    return { ok: false, error: 'CSV_SIZE' };
  }
  const csv = input.replace(/^\uFEFF/, '');
  let records;
  try {
    const headerLine = csv.split(/\r?\n/, 1)[0];
    const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
    records = parseCells(csv, delimiter);
  } catch {
    return { ok: false, error: 'CSV_MALFORMED' };
  }
  if (records.length < 2) return { ok: false, error: 'CSV_EMPTY' };
  const headers = records.shift().cells.map(value => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length ||
      REQUIRED_HEADERS.some(header => !headers.includes(header)) ||
      headers.some(header => !EMPLOYEE_CSV_HEADERS.includes(header))) {
    return { ok: false, error: 'CSV_HEADERS' };
  }
  const rows = [];
  const seen = new Set();
  for (const { line, cells } of records) {
    if (cells.every(cell => !cell.trim())) continue;
    if (rows.length >= EMPLOYEE_CSV_MAX_ROWS) return { ok: false, error: 'CSV_ROWS' };
    const values = Object.fromEntries(headers.map((header, offset) => [header, (cells[offset] || '').trim()]));
    const fullName = titleCasePersonName(values.nome_completo || '');
    const email = (values.email_corporativo || '').toLowerCase();
    const personalEmail = (values.email_pessoal || '').toLowerCase();
    const startDate = values.data_admissao || '';
    const errors = [];
    if (cells.length !== headers.length) errors.push('colunas');
    if (!fullName || fullName.length > 200 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(fullName)) errors.push('nome_completo');
    if (!emailSchema.safeParse(email).success) errors.push('email_corporativo');
    if (personalEmail && !emailSchema.safeParse(personalEmail).success) errors.push('email_pessoal');
    if (email && personalEmail && email === personalEmail) errors.push('email_pessoal');
    if (!validDate(startDate, today)) errors.push('data_admissao');
    if (email && seen.has(email)) errors.push('email_corporativo_duplicado');
    if (personalEmail && seen.has(personalEmail)) errors.push('email_pessoal_duplicado');
    if (email) seen.add(email);
    if (personalEmail) seen.add(personalEmail);
    rows.push({ line, fullName, email, personalEmail, startDate, errors });
  }
  if (!rows.length) return { ok: false, error: 'CSV_EMPTY' };
  return { ok: true, rows };
}
