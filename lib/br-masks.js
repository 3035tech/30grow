import { localeHtmlLang } from './i18n.js';
/** Máscaras BR para UI; persistência sempre sem máscara. */

export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Telefone: estado = só dígitos (DDD + número, sem 55). */
export function stripPhone(value) {
  let d = digitsOnly(value);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  return d || null;
}

/** (11) 99999-9999 / (11) 9999-9999 */
export function formatPhoneBr(value) {
  const d = stripPhone(value) || '';
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

/** CEP: 8 dígitos. */
export function stripCep(value) {
  const d = digitsOnly(value).slice(0, 8);
  return d || null;
}

/** 01310-100 */
export function formatCepBr(value) {
  const d = stripCep(value) || '';
  if (!d) return '';
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** CPF: 11 dígitos. */
export function stripCpf(value) {
  const d = digitsOnly(value).slice(0, 11);
  return d || null;
}

/** 000.000.000-00 */
export function formatCpfBr(value) {
  const d = stripCpf(value) || '';
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** CNPJ numeric or alphanumeric: 00.000.000/0000-00 (mask preserves the 12-character root). */
export function stripCnpj(value) {
  const compact = String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const root = compact.slice(0, 12);
  const checkDigits = compact.slice(12).replace(/\D/g, '').slice(0, 2);
  return (root + checkDigits) || null;
}

export function formatCnpjBr(value) {
  const d = stripCnpj(value) || '';
  if (!d) return '';
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Accepts CPF or CNPJ and stores digits for CPF, uppercase alphanumerics for CNPJ. */
export function stripCpfCnpjBr(value) {
  const raw = String(value ?? '');
  if (/[A-Z]/i.test(raw) || digitsOnly(raw).length > 11) return stripCnpj(raw);
  return stripCpf(raw);
}

export function formatCpfCnpjBr(value) {
  const raw = String(value ?? '');
  if (/[A-Z]/i.test(raw) || digitsOnly(raw).length > 11) return formatCnpjBr(raw);
  return formatCpfBr(raw);
}

/**
 * Converte valor (digitação em centavos, persistido ou máscara) → dígitos de centavos.
 */
export function salaryToCentsDigits(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  // Controle de input: só dígitos = centavos
  if (/^\d+$/.test(s)) return s.slice(0, 15);

  // Remove símbolos comuns (R$, $, espaços / NBSP do toLocaleString)
  const cleaned = s
    .replace(/R\$\s?/gi, '')
    .replace(/\$/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();

  // Persistido sem máscara: 3500.00 ou 3500,00
  if (/^\d+[.,]\d{1,2}$/.test(cleaned)) {
    const n = Number(cleaned.replace(',', '.'));
    if (Number.isFinite(n)) return String(Math.round(n * 100)).slice(0, 15);
  }

  // Máscara pt-BR: 3.500,00
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(cleaned)) {
    const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) return String(Math.round(n * 100)).slice(0, 15);
  }

  // Formato US: 3,500.00
  if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(cleaned)) {
    const n = Number(cleaned.replace(/,/g, ''));
    if (Number.isFinite(n)) return String(Math.round(n * 100)).slice(0, 15);
  }

  // Inteiro sem decimal no texto
  if (/^\d+$/.test(cleaned)) {
    const n = Number(cleaned);
    if (Number.isFinite(n)) return String(Math.round(n * 100)).slice(0, 15);
  }

  return '';
}

/** Persistência: "1234.56" sem R$/milhar. */
export function stripSalary(value) {
  const d = salaryToCentsDigits(value);
  if (!d) return null;
  return (Number(d) / 100).toFixed(2);
}

/** R$ 1.234,56 */
export function formatSalaryBr(value) {
  return formatSalaryDisplay(value, 'pt-BR');
}

/**
 * Moeda na UI conforme locale do painel (pt-BR → BRL, en → USD).
 * Persistência continua numérica sem símbolo (`stripSalary`).
 */
export function formatSalaryDisplay(value, locale = 'pt-BR') {
  if (value == null || value === '') return '';
  const cents = salaryToCentsDigits(value);
  if (!cents) return '';
  const n = Number(cents) / 100;
  if (!Number.isFinite(n)) return '';
  const en = locale === 'en';
  return n.toLocaleString(localeHtmlLang(locale), {
    style: 'currency',
    currency: en ? 'USD' : 'BRL',
  });
}

/** Valor numérico em BRL (reais) a partir do campo persistido da vaga. */
export function salaryAmountNumber(value) {
  if (value == null || value === '') return null;
  const cents = salaryToCentsDigits(value);
  if (!cents) return null;
  const n = Number(cents) / 100;
  return Number.isFinite(n) ? n : null;
}

/** Faixa “R$ … – R$ …” para chips / página pública (sem i18n). */
export function formatVacancySalaryRangeDisplay(min, max) {
  const a = min != null && min !== '' ? formatSalaryBr(min) : '';
  const b = max != null && max !== '' ? formatSalaryBr(max) : '';
  if (a && b) return `${a}–${b}`;
  if (a) return a;
  if (b) return b;
  return null;
}
