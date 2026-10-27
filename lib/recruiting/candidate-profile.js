import { stripPhone, stripSalary } from '../br-masks.js';

/** Campos de perfil do candidato (contato + contexto RH). Sem currículo. */

export const AVAILABILITY_VALUES = ['immediate', '15_days', '30_days', '60_days', 'other'];
export const SOURCE_VALUES = ['linkedin', 'referral', 'agency', 'job_board', 'other'];

/** UFs brasileiras (ordem alfabética por nome). */
export const BR_STATES = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'TO', name: 'Tocantins' },
];

export const BR_UF_SET = new Set(BR_STATES.map((s) => s.uf));

function cleanText(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function cleanLinkedIn(v) {
  const s = cleanText(v, 500);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/linkedin\.com\//i.test(s)) return `https://${s.replace(/^\/+/, '')}`;
  if (/^[\w-]+\/?$/i.test(s)) return `https://www.linkedin.com/in/${s.replace(/\/$/, '')}`;
  return s;
}

function cleanState(v) {
  const s = cleanText(v, 32);
  if (!s) return null;
  const uf = s.toUpperCase();
  return BR_UF_SET.has(uf) ? uf : null;
}

function cleanEnum(v, allowed) {
  const s = cleanText(v, 40);
  if (!s) return null;
  return allowed.includes(s) ? s : s;
}

/**
 * Normaliza payload de perfil a partir do body da API / formulário.
 * @returns {{ phone, linkedinUrl, city, state, salaryExpectation, availability, source }}
 */
export function normalizeCandidateProfile(input = {}) {
  return {
    phone: stripPhone(input.phone ?? input.telefone),
    linkedinUrl: cleanLinkedIn(input.linkedinUrl ?? input.linkedin ?? input.linkedin_url),
    city: cleanText(input.city ?? input.cidade, 120),
    state: cleanState(input.state ?? input.uf),
    salaryExpectation: stripSalary(input.salaryExpectation ?? input.salary ?? input.pretensao),
    availability: cleanEnum(input.availability ?? input.disponibilidade, AVAILABILITY_VALUES),
    source: cleanEnum(input.source ?? input.fonte, SOURCE_VALUES),
  };
}

/** Fragmentos SQL para INSERT/UPDATE (valores já normalizados). */
export function profileToSqlParams(profile) {
  return [
    profile.phone,
    profile.linkedinUrl,
    profile.city,
    profile.state,
    profile.salaryExpectation,
    profile.availability,
    profile.source,
  ];
}

export const PROFILE_SQL_COLS = `
  phone, linkedin_url, city, state, salary_expectation, availability, source`.trim();

export const PROFILE_SQL_SELECT = `
  phone,
  linkedin_url AS "linkedinUrl",
  city,
  state,
  salary_expectation AS "salaryExpectation",
  availability,
  source`.trim();
