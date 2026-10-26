/** Transient CSV intake. No persistence, logging or account activation here. */
export const EMPLOYEE_CSV_MAX_ROWS = 100;
export const EMPLOYEE_CSV_MAX_BYTES = 256 * 1024;
const REQUIRED = ['nome_completo', 'email_corporativo', 'data_admissao'];
const HEADERS = [...REQUIRED, 'email_pessoal'];
const emailValid = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function parseEmployeeCsv(input, today = new Date().toISOString().slice(0, 10)) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  if (new TextEncoder().encode(text).length > EMPLOYEE_CSV_MAX_BYTES) throw new Error('CSV_TOO_LARGE');
  // Delimiter is taken only from the unquoted header, not quoted data.
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const records = [], lines = []; let row = [], value = '', quoted = false, closed = false, line = 1, rowStart = 1;
  const cell = () => { row.push(value.trim()); value = ''; closed = false; };
  const record = () => { cell(); if (row.some(Boolean)) { records.push(row); lines.push(rowStart); } row = []; if (records.length > EMPLOYEE_CSV_MAX_ROWS + 1) throw new Error('CSV_TOO_MANY_ROWS'); };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else { value += ch; if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++; }
    } else if (ch === '"') {
      if (value || closed) throw new Error('CSV_INVALID');
      quoted = true;
    } else if (ch === delimiter) cell();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; record(); line++; rowStart = line; }
    else if (closed && !/\s/.test(ch)) throw new Error('CSV_INVALID');
    else if (!closed) value += ch;
  }
  if (quoted) throw new Error('CSV_INVALID');
  if (row.length || value || closed) record();
  const header = records.shift() || [];
  lines.shift();
  if (new Set(header).size !== header.length || REQUIRED.some(key => !header.includes(key)) || header.some(key => !HEADERS.includes(key))) throw new Error('CSV_HEADERS');
  if (!records.length) throw new Error('CSV_EMPTY');
  const seen = new Set();
  return records.map((values, index) => {
    const item = Object.fromEntries(header.map((key, i) => [key, values[i] || '']));
    const email = (item.email_corporativo || '').toLowerCase();
    const personalEmail = (item.email_pessoal || '').toLowerCase();
    const errors = [];
    if (values.length !== header.length) errors.push('CSV_COLUMNS');
    if (!item.nome_completo || item.nome_completo.length > 200) errors.push('CSV_NAME');
    if (!emailValid(email)) errors.push('CSV_EMAIL');
    if (personalEmail && !emailValid(personalEmail)) errors.push('CSV_PERSONAL_EMAIL');
    const date = item.data_admissao;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > today) errors.push('CSV_DATE');
    if (seen.has(email) || (personalEmail && seen.has(personalEmail))) errors.push('CSV_DUPLICATE');
    seen.add(email);
    if (personalEmail) seen.add(personalEmail);
    return { row: lines[index], fullName: item.nome_completo, email, personalEmail, startDate: date, errors };
  });
}
